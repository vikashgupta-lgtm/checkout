/**
 * PUBLIC Razorpay API Route — No Shopify auth required!
 *
 * POST /public/razorpay?action=create   → Create Razorpay order
 * POST /public/razorpay?action=verify   → Verify payment + create Shopify order
 *
 * Uses native fetch + Node.js crypto — no extra npm packages needed!
 */

import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";
import { sendMetaCAPI } from "../utils/meta.server";

// ── Helper: Format phone number for Shopify ────────────────────────────────
function formatPhoneNumber(phone) {
  if (!phone) return "";
  let cleaned = phone.toString().replace(/[^\d+]/g, ""); // Remove non-numeric except +
  if (!cleaned.startsWith("+")) {
    if (cleaned.length === 10) return "+91" + cleaned; // Default to India if 10 digits
    if (cleaned.length > 10) return "+" + cleaned;    // Assume leading digits are country code
  }
  return cleaned;
}


// ─── CORS Headers ─────────────────────────────────────────────────────────────
export const headers = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

// Handle OPTIONS preflight
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers() });
  }
  return json({ error: "Use POST" }, { status: 405 });
};

// ─── Main Action ──────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const url = new URL(request.url);
  const actionType = url.searchParams.get("action");

  if (actionType === "create") {
    return handleCreateOrder(request);
  } else if (actionType === "verify") {
    return handleVerifyAndCreateShopifyOrder(request);
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

// ─── Step 1: Create Razorpay Order ───────────────────────────────────────────
async function handleCreateOrder(request) {
  const body = await request.json();
  const { amount, currency = "INR", receipt } = body;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return json({ error: "Razorpay credentials not configured in .env" }, { status: 500 });
  }

  // Amount must be in paise (Razorpay uses smallest currency unit)
  const amountInPaise = Math.round(amount); // amount already in paise from cart

  try {
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const rzpResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency,
        receipt: (receipt || `receipt_${Date.now()}`).slice(0, 40),
      }),
    });

    const rzpData = await rzpResponse.json();

    if (!rzpResponse.ok) {
      console.error("Razorpay Error:", rzpData);
      return json({ error: rzpData.error?.description || "Razorpay order creation failed" }, { status: 400 });
    }

    return json({
      success: true,
      orderId: rzpData.id,
      amount: rzpData.amount,
      currency: rzpData.currency,
      keyId,
    });
  } catch (err) {
    console.error("Create order error:", err);
    return json({ error: "Failed to create payment order: " + err.message }, { status: 500 });
  }
}

// ─── Step 2: Verify Payment + Create Shopify Order ───────────────────────────
async function handleVerifyAndCreateShopifyOrder(request) {
  const body = await request.json();
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    customerDetails,
    cartItems,
    totalAmount,
    paidAmount,
    paymentMethod,
    shop,
    metaTracking,
  } = body;

  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  // ── 1. Verify Razorpay signature ─────────────────────────────────────────
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return json({ error: "Payment verification failed. Signature mismatch." }, { status: 400 });
  }

  // ── 2. Create order in Shopify via Admin API ──────────────────────────────
  try {
    console.log(`[Razorpay Verify] Attempting to create order for shop: ${shop}`);

    // Find the session for the shop to get the access token dynamically
    const session = await prisma.session.findFirst({
      where: { shop: shop },
    });

    if (!session || !session.accessToken) {
      console.error(`[Razorpay Verify] ERROR: No active session found for shop: ${shop}`);
      return json(
        { error: `No active session found for shop: ${shop}. Please ensure the app is installed.` },
        { status: 400 }
      );
    }

    const storeDomain = session.shop;
    const adminToken = session.accessToken;

    console.log(`[Razorpay Verify] Session found. Using token: ${adminToken.slice(0, 10)}...`);



    // Build line_items from cart items
    const lineItems = cartItems.map((item) => ({
      variant_id: item.variant_id,
      quantity: item.quantity,
      price: (item.price / 100).toFixed(2), // paise → rupees
    }));

    const shopifyOrderPayload = {
      order: {
        line_items: lineItems,

        customer: {
          first_name: customerDetails.firstName,
          last_name: customerDetails.lastName,
          email: customerDetails.email,
          phone: formatPhoneNumber(customerDetails.phone),
        },

        shipping_address: {
          first_name: customerDetails.firstName,
          last_name: customerDetails.lastName,
          address1: customerDetails.address1,
          city: customerDetails.city,
          province: customerDetails.state,
          zip: customerDetails.zip,
          country: customerDetails.country || "India",
          country_code: "IN",
          phone: formatPhoneNumber(customerDetails.phone),
        },

        billing_address: {
          first_name: customerDetails.firstName,
          last_name: customerDetails.lastName,
          address1: customerDetails.address1,
          city: customerDetails.city,
          province: customerDetails.state,
          zip: customerDetails.zip,
          country: customerDetails.country || "India",
          country_code: "IN",
        },

        // Mark as partially paid or paid based on Partial COD status
        financial_status: paymentMethod === "PARTIAL_COD" ? "partially_paid" : "paid",

        // Payment gateway name shown in Shopify Admin
        gateway: paymentMethod === "PARTIAL_COD" ? "Partial COD (Razorpay)" : "Razorpay (Custom Checkout)",

        // Order note with Razorpay payment reference
        note: `Razorpay Payment ID: ${razorpay_payment_id} | Order ID: ${razorpay_order_id}${paymentMethod === "PARTIAL_COD" ? " | Partial COD Advance Paid" : ""}`,

        // Transaction record for Shopify admin
        transactions: [
          {
            kind: "sale",
            status: "success",
            amount: (paidAmount / 100).toFixed(2),
            gateway: "Razorpay (Custom Checkout)",
          },
        ],

        // Suppress confirmation email (optional — set to false to send)
        send_receipt: true,
        send_fulfillment_receipt: true,

        // Source identifier — useful for analytics
        source_name: "custom_checkout",
        tags: "custom-checkout, razorpay, prepaid",
        discount_codes: body.discountCode ? [{ code: body.discountCode, amount: "0.00", type: "percentage" }] : undefined
      },
    };

    const shopifyResponse = await fetch(
      `https://${storeDomain}/admin/api/2024-01/orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify(shopifyOrderPayload),
      }
    );

    const shopifyData = await shopifyResponse.json();

    if (!shopifyResponse.ok) {
      console.error(`[Razorpay Verify] Shopify API Error:`, JSON.stringify(shopifyData.errors));
      const errorMsg = typeof shopifyData.errors === 'string'
        ? shopifyData.errors
        : JSON.stringify(shopifyData.errors).replace(/[{}"]/g, '');
      return json(
        { error: "Payment received but Shopify order failed: " + errorMsg, details: shopifyData },
        { status: 500 }
      );
    }

    const order = shopifyData.order;
    console.log(`[Razorpay Verify] SUCCESS: Order created: ${order.name}`);


    return json({
      success: true,
      orderId: order.id,
      orderName: order.name,          // e.g. "#1001"
      orderStatus: order.financial_status,
      razorpayPaymentId: razorpay_payment_id,
      // Meta Tracking Data for frontend browser pixel
      metaData: {
        eventId: metaTracking?.eventId,
        totalPrice: order.total_price,
        currency: order.currency,
        items: order.line_items
      }
    });

    // ── Meta CAPI Call ───────────────────────────────────────────────────
    if (metaTracking?.eventId) {
      await sendMetaCAPI({
        orderData: {
          orderName: order.name,
          totalPrice: order.total_price,
          currency: order.currency,
          items: order.line_items
        },
        userData: {
          email: customerDetails.email,
          phone: customerDetails.phone
        },
        trackingData: metaTracking,
        request
      });
    }

    return response;
  } catch (err) {
    console.error("Shopify order error:", err);
    return json({ error: "Order creation error: " + err.message }, { status: 500 });
  }
}
