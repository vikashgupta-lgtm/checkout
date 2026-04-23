import { json } from "@remix-run/node";
import prisma from "../db.server";
import { sendMetaCAPI } from "../utils/meta.server";


import { useLoaderData, Form, useNavigation, useActionData } from "@remix-run/react";
import { useState, useEffect, useRef } from "react";

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

// Allow this page to be accessed cross-origin from the storefront
export const headers = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Frame-Options": "ALLOWALL",
});

/**
 * PUBLIC Checkout Route - No Shopify auth required!
 * URL: /public/checkout?cartData=<base64>&shop=<myshopify-domain>
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const cartDataEncoded = url.searchParams.get("cartData");
  const shop = url.searchParams.get("shop");

  if (!cartDataEncoded || !shop) {
    return json({ error: "Missing cart or shop parameter.", cart: null, shop: null });
  }

  try {
    const cartJson = Buffer.from(decodeURIComponent(cartDataEncoded), "base64").toString("utf8");
    const cart = JSON.parse(cartJson);

    if (!cart || !cart.token) {
      return json({ error: "Invalid cart data. Please go back and try again.", cart: null, shop });
    }

    // ── Fetch latest totals from Shopify (Draft Order API) ──────────────────
    let refinedCart = { ...cart };
    const discountCode = url.searchParams.get("discount") || "";

    const session = await prisma.session.findFirst({ where: { shop: shop } });
    if (session && session.accessToken) {
      try {
        const draftOrderPayload = {
          draft_order: {
            line_items: cart.items.map(item => ({
              variant_id: item.variant_id,
              quantity: item.quantity
            })),
            use_customer_default_address: true,
            applied_discount: discountCode ? {
              code: discountCode,
              value_type: "fixed_amount", // This is just a placeholder, Shopify will resolve the code
              value: "0"
            } : undefined
          }
        };

        // Note: For actual code validation, we should use the 'applied_discount' object properly
        // but often just passing the code in 'applied_discount' isn't enough for coupons.
        // However, for automatic discounts, just the line items are enough.
        // If it's a manual code, we might need a different approach, but let's try this.
        
        const shopifyRes = await fetch(`https://${shop}/admin/api/2024-04/draft_orders.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken
          },
          body: JSON.stringify(draftOrderPayload)
        });

        if (shopifyRes.ok) {
          const draftData = await shopifyRes.json();
          const draft = draftData.draft_order;
          
          // Update cart totals from draft order
          refinedCart.total_price = Math.round(parseFloat(draft.total_price) * 100);
          refinedCart.subtotal_price = Math.round(parseFloat(draft.subtotal_price) * 100);
          refinedCart.total_discount = Math.round(parseFloat(draft.total_discounts) * 100);
          
          // Store draft order ID for reference if needed
          refinedCart.draft_order_id = draft.id;
        }
      } catch (e) {
        console.error("Failed to fetch refined totals from Shopify:", e);
      }
    }

    // Pass Razorpay Key ID to frontend (safe — public key)
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";

    const { getAppConfig } = await import("../models/config.server");
    const config = await getAppConfig(shop);

    // Pass Meta Pixel ID to frontend
    const metaPixelId = process.env.META_PIXEL_ID || "";

    return json({ cart: refinedCart, shop, error: null, razorpayKeyId, config, metaPixelId, discountCode });
  } catch (err) {
    return json({ error: "Failed to decode cart: " + err.message, cart: null, shop, config: null, metaPixelId: "" });
  }
};

// ── COD order action (Remix Form POST for cash on delivery) ──────────────────
export const action = async ({ request }) => {
  const formData = await request.formData();

  const firstName = formData.get("firstName") || "";
  const lastName = formData.get("lastName") || "";
  const email = formData.get("email") || "";
  const phone = formatPhoneNumber(formData.get("phone") || "");
  const address1 = formData.get("address1") || "";
  const city = formData.get("city") || "";
  const state = formData.get("state") || "";
  const zip = formData.get("zip") || "";
  const country = formData.get("country") || "India";
  const cartToken = formData.get("cartToken") || "";
  const shop = formData.get("shop") || "";
  const discountCode = formData.get("discountCode") || "";

  // Meta Tracking Data
  const fbclid = formData.get("fbclid") || "";
  const fbp = formData.get("fbp") || "";
  const eventId = formData.get("eventId") || "";

  // ── Create COD order via Shopify Admin API ────────────────────────────────
  console.log(`[Checkout Action] Attempting to create COD order for shop: ${shop}`);

  // Find the session for the shop to get the access token dynamically
  const session = await prisma.session.findFirst({
    where: { shop: shop },
  });

  if (!session || !session.accessToken) {
    console.error(`[Checkout Action] ERROR: No active session found for shop: ${shop}`);
    return json({ error: "Store session not found. Please ensure the app is installed correctly." }, { status: 400 });
  }

  const storeDomain = session.shop;
  const adminToken = session.accessToken;

  console.log(`[Checkout Action] Session found. Using token: ${adminToken.slice(0, 10)}...`);

  // Parse cart items from hidden field
  let cartItems = [];
  try {
    cartItems = JSON.parse(formData.get("cartItems") || "[]");
  } catch (_) { }

  if (storeDomain && adminToken && cartItems.length > 0) {
    try {
      const lineItems = cartItems.map((item) => ({
        variant_id: item.variant_id,
        quantity: item.quantity,
      }));

      const payload = {
        order: {
          line_items: lineItems,
          customer: { first_name: firstName, last_name: lastName, email, phone },
          shipping_address: {
            first_name: firstName, last_name: lastName,
            address1, city, province: state, zip,
            country: country || "India", country_code: "IN", phone,
          },
          financial_status: "pending",
          gateway: "Cash on Delivery",
          payment_gateway_names: ["Cash on Delivery"],
          source_name: "custom_checkout",
          tags: "custom-checkout, cod",
          send_receipt: true,
          discount_codes: discountCode ? [{ code: discountCode, amount: "0.00", type: "percentage" }] : undefined
        },
      };

      const res = await fetch(
        `https://${storeDomain}/admin/api/2024-04/orders.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": adminToken,
          },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (res.ok) {
        console.log(`[Checkout Action] SUCCESS: Order created: ${data.order.name}`);

        // ── Meta CAPI Call ───────────────────────────────────────────────────
        if (eventId) {
          await sendMetaCAPI({
            orderData: {
              orderName: data.order.name,
              totalPrice: data.order.total_price,
              currency: data.order.currency,
              items: data.order.line_items
            },
            userData: { email, phone },
            trackingData: { eventId, fbclid, fbp },
            request
          });
        }

        return json({
          success: true,
          orderId: data.order.name,
          paymentMethod: "COD",
          name: `${firstName} ${lastName}`,
          // Pass tracking back to frontend for browser pixel
          metaData: { eventId, totalPrice: data.order.total_price, currency: data.order.currency, items: data.order.line_items }
        });
      } else {
        console.error(`[Checkout Action] Shopify API Error:`, JSON.stringify(data.errors));
        const errorMsg = typeof data.errors === 'string'
          ? data.errors
          : JSON.stringify(data.errors).replace(/[{}"]/g, '');
        return json({ error: "Shopify Error: " + errorMsg }, { status: 500 });
      }
    } catch (err) {
      console.error("[Checkout Action] Exception:", err);
      return json({ error: "Order creation error: " + err.message }, { status: 500 });
    }
  }

  return json({ error: "Invalid request data. Please check your cart and try again." }, { status: 400 });
};


// ─── UI ──────────────────────────────────────────────────────────────────────

export default function PublicCheckout() {
  const { cart, shop, error, razorpayKeyId, config, metaPixelId, discountCode: initialDiscountCode } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [rzpLoading, setRzpLoading] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [paymentError, setPaymentError] = useState(null);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [discountCode, setDiscountCode] = useState(initialDiscountCode || "");
  const formRef = useRef(null);

  // ── OTP Verification State ──────────────────────────────────────────────
  const [verificationStep, setVerificationStep] = useState("initial"); // initial, otp_sent, verified
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [resendTimer, setResendTimer] = useState(0);

  // Auto-fetch phone number from cart on mount
  useEffect(() => {
    if (cart) {
      const cartPhone = cart.customer?.phone || cart.shipping_address?.phone || "";
      if (cartPhone) {
        setPhoneNumber(cartPhone);
      }
    }
  }, [cart]);

  // Handle Resend Timer
  useEffect(() => {
    let timer;
    if (resendTimer > 0) {
      timer = setInterval(() => setResendTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendTimer]);

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    if (!phoneNumber || phoneNumber.length < 10) {
      setOtpError("Please enter a valid phone number.");
      return;
    }

    setIsVerifying(true);
    setOtpError("");
    try {
      const res = await fetch("/public/otp?action=send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: formatPhoneNumber(phoneNumber) }),
      });
      const data = await res.json();
      if (data.success) {
        setVerificationStep("otp_sent");
        setResendTimer(60);
      } else {
        setOtpError(data.error || "Failed to send OTP.");
      }
    } catch (err) {
      setOtpError("Connection error. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (otpCode.length !== 6) {
      setOtpError("Please enter the 6-digit code.");
      return;
    }

    setIsVerifying(true);
    setOtpError("");
    try {
      const res = await fetch("/public/otp?action=verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: formatPhoneNumber(phoneNumber), code: otpCode }),
      });
      const data = await res.json();
      if (data.success) {
        setVerificationStep("verified");
      } else {
        setOtpError(data.error || "Incorrect OTP.");
      }
    } catch (err) {
      setOtpError("Verification error. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  // ── Address Selection State ─────────────────────────────────────────────
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(-1);
  const [editingAddressIndex, setEditingAddressIndex] = useState(null); // null for new, index for editing
  const [addressView, setAddressView] = useState("form"); // form, list, summary

  // Load addresses from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("saved_addresses");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.length > 0) {
            setSavedAddresses(parsed);
            setSelectedAddressIndex(0);
            setAddressView("summary");
          }
        } catch (e) {
          console.error("Failed to parse saved addresses", e);
        }
      } else {
        setAddressView("form");
      }
    }
  }, []);

  // Save changes to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("saved_addresses", JSON.stringify(savedAddresses));
    }
  }, [savedAddresses]);

  const selectedAddress = selectedAddressIndex >= 0 ? savedAddresses[selectedAddressIndex] : null;

  // ── Meta Pixel & Tracking IDs ───────────────────────────────────────────
  const eventIdRef = useRef(`evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [fbclid, setFbclid] = useState("");
  const [fbp, setFbp] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Capture fbclid from URL
    const urlParams = new URLSearchParams(window.location.search);
    const cid = urlParams.get("fbclid");
    if (cid) setFbclid(cid);

    // Capture fbp from cookie
    const getCookie = (name) => {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? match[2] : null;
    };
    const fbpCookie = getCookie("_fbp");
    if (fbpCookie) setFbp(fbpCookie);

    // Meta Pixel Base Script
    if (metaPixelId && !window.fbq) {
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () {
          n.callMethod ?
            n.callMethod.apply(n, arguments) : n.queue.push(arguments)
        }; if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0;
        t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s)
      }(window,
        document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', metaPixelId);
      fbq('track', 'PageView');
    }

    // Razorpay SDK
    if (document.getElementById("razorpay-script")) return;
    const script = document.createElement("script");
    script.id = "razorpay-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.head.appendChild(script);
  }, [metaPixelId]);

  // ── Fire Browser Pixel on Success ────────────────────────────────────────
  useEffect(() => {
    const successData = actionData?.success ? actionData : orderResult?.success ? orderResult : null;
    if (successData && window.fbq && successData.metaData) {
      const { eventId, totalPrice, currency, items } = successData.metaData;
      fbq('track', 'Purchase', {
        value: parseFloat(totalPrice),
        currency: currency || 'INR',
        content_type: 'product',
        content_ids: items.map(i => i.variant_id.toString()),
        num_items: items.reduce((acc, i) => acc + i.quantity, 0)
      }, { eventID: eventId });
      console.log("[Meta Pixel] Purchase event fired:", eventId);
    }
  }, [actionData, orderResult]);

  if (error) return <ErrorScreen message={error} shop={shop} />;
  if (!cart) return <ErrorScreen message="Cart not found. Please go back and try again." shop={shop} />;
  if (actionData?.success) return <SuccessScreen order={actionData} shop={shop} />;
  if (orderResult?.success) return <SuccessScreen order={orderResult} shop={shop} />;

  const items = cart.items || [];
  const totalCents = cart.total_price || 0;
  const originalTotalCents = cart.original_total_price || totalCents;
  const discountCents = cart.total_discount || (originalTotalCents - totalCents);
  const currency = cart.currency || "INR";

  const formattedTotal = new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
  }).format(totalCents / 100);

  const formattedOriginalTotal = new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
  }).format(originalTotalCents / 100);

  const formattedDiscount = new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
  }).format(discountCents / 100);

  const partialCod = config?.partialCod || { enabled: false, minOrder: 0, upfrontPercentage: 20, upfrontLabel: "Pay now", deliveryLabel: "Pay on delivery" };
  const totalINR = totalCents / 100;
  const isPartialCodEligible = partialCod.enabled && totalINR >= (partialCod.minOrder || 0);
  const upfrontAmountCents = Math.round(totalCents * ((partialCod.upfrontPercentage || 0) / 100));
  const remainingCodCents = Math.max(0, totalCents - upfrontAmountCents);

  const formattedUpfront = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(upfrontAmountCents / 100);
  const formattedRemaining = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(remainingCodCents / 100);

  // ── Razorpay payment handler ─────────────────────────────────────────────
  const handleOnlinePayment = async () => {
    setPaymentError(null);

    // Validate form
    const form = formRef.current;
    if (!form.reportValidity()) return;

    const firstName = form.firstName.value.trim();
    const lastName = form.lastName.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const address1 = form.address1.value.trim();
    const city = form.city.value.trim();
    const state = form.state.value.trim();
    const zip = form.zip.value.trim();
    const country = form.country.value.trim() || "India";

    if (!firstName || !email || !phone || !address1 || !city || !zip) {
      setPaymentError("Please fill all required fields before paying online.");
      return;
    }

    setRzpLoading(true);

    try {
      // ── Step 1: Create Razorpay order on backend ──────────────────────
      const amountToPay = paymentMethod === "PARTIAL_COD" ? upfrontAmountCents : totalCents;

      const createRes = await fetch("/public/razorpay?action=create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountToPay,   // already in smallest unit
          currency: "INR",     // Force INR — enables UPI, Netbanking, Wallets
          receipt: `cart_${cart.token}`,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok || !createData.orderId) {
        throw new Error(createData.error || "Could not initiate payment.");
      }

      // ── Step 2: Open Razorpay Checkout popup ──────────────────────────
      const options = {
        key: razorpayKeyId || createData.keyId,
        amount: createData.amount,
        currency: createData.currency,
        name: shop || "My Store",
        description: `Order for ${firstName} ${lastName}`,
        order_id: createData.orderId,

        prefill: { name: `${firstName} ${lastName}`, email, contact: phone },

        theme: { color: "#6366f1" },

        handler: async function (response) {
          // ── Step 3: Verify payment + create Shopify order ─────────────
          setRzpLoading(true);
          try {
            const verifyRes = await fetch("/public/razorpay?action=verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                customerDetails: { firstName, lastName, email, phone, address1, city, state, zip, country },
                cartItems: items.map((i) => ({
                  variant_id: i.variant_id,
                  quantity: i.quantity,
                  price: i.price,
                })),
                totalAmount: totalCents,
                paidAmount: amountToPay,
                paymentMethod: paymentMethod,
                shop,
                // Pass tracking data for CAPI
                metaTracking: {
                  fbclid,
                  fbp,
                  eventId: eventIdRef.current,
                  discountCode: discountCode
                }
              }),
            });

            const verifyData = await verifyRes.json();
            if (!verifyRes.ok || !verifyData.success) {
              throw new Error(verifyData.error || "Payment verification failed.");
            }

            setOrderResult({
              success: true,
              orderId: verifyData.orderName,
              paymentMethod: paymentMethod,
              name: `${firstName} ${lastName}`,
              razorpayPaymentId: verifyData.razorpayPaymentId,
              metaData: verifyData.metaData // Pass tracking back for browser pixel
            });
          } catch (err) {
            setPaymentError("Payment done but order failed: " + err.message + ". Please contact support.");
          } finally {
            setRzpLoading(false);
          }
        },

        modal: {
          ondismiss: () => {
            setRzpLoading(false);
            setPaymentError("Payment cancelled. Please try again.");
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (response) => {
        setRzpLoading(false);
        setPaymentError("Payment failed: " + (response.error?.description || "Unknown error"));
      });
      rzp.open();
    } catch (err) {
      setPaymentError(err.message);
      setRzpLoading(false);
    }
  };

  const handlePlaceOrder = (e) => {
    if (addressView !== "summary") {
      e.preventDefault();
      alert("Please select or enter a delivery address first.");
      // Scroll to address section
      const addrSection = document.querySelector("#address-section");
      if (addrSection) addrSection.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (paymentMethod === "ONLINE" || paymentMethod === "PARTIAL_COD") {
      e.preventDefault();
      handleOnlinePayment();
    }
    // COD = normal form submit
  };

  return (
    <div style={styles.page}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; }
        input:focus { border-color: #6366f1 !important; outline: none; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
        input::placeholder { opacity: 0; }
        input:not(:placeholder-shown) + label,
        input:focus + label {
          top: 8px !important;
          font-size: 11px !important;
          color: #6366f1 !important;
        }
        .spinner {
          width: 20px; height: 20px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: inline-block;
          vertical-align: middle;
          margin-right: 8px;
        }
        /* Address Section Styles */
        .address-card {
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 20px;
          margin-bottom: 16px;
          position: relative;
          transition: all 0.2s ease;
          background: white;
          cursor: pointer;
        }
        .address-card.active {
          border-color: #000;
          box-shadow: 0 0 0 1px #000;
        }
        .address-card:hover {
          border-color: #cbd5e1;
        }
        .address-card.active:hover {
          border-color: #000;
        }
        .address-badge {
          background: #eff6ff;
          color: #2563eb;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          margin-left: 8px;
        }
        .deliver-here-btn {
          width: 100%;
          background: #000;
          color: #fff;
          border: none;
          padding: 12px;
          border-radius: 10px;
          font-weight: 600;
          margin-top: 16px;
          cursor: pointer;
        }
        .address-summary {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          background: white;
        }
        .address-summary-icon {
          width: 40px;
          height: 40px;
          border: 1px solid #e2e8f0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          font-size: 20px;
        }
        .address-summary-content {
          flex: 1;
        }
        .change-btn {
          border: 1px solid #000;
          background: white;
          color: #000;
          padding: 6px 16px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        }
        .add-address-btn {
          border: 1px solid #000;
          background: white;
          color: #000;
          padding: 8px 16px;
          border-radius: 20px;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        }
        .section-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .address-menu-container {
          position: relative;
        }
        .address-menu-trigger {
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: background 0.2s;
          font-size: 20px;
          color: #64748b;
          line-height: 1;
        }
        .address-menu-trigger:hover {
          background: #f1f5f9;
        }
        .address-menu-dropdown {
          position: absolute;
          right: 0;
          top: 30px;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          z-index: 10;
          min-width: 100px;
          overflow: hidden;
        }
        .address-menu-item {
          padding: 10px 12px;
          font-size: 14px;
          color: #1e293b;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.2s;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
        }
        .address-menu-item:hover {
          background: #f8fafc;
        }
        .address-menu-item.delete {
          color: #ef4444;
        }

        /* Mobile Summary Styles */
        .mobile-summary-bar {
          display: none;
          position: sticky;
          top: 64px;
          z-index: 90;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          padding: 12px 24px;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
        }
        .mobile-summary-content {
          overflow: hidden;
          transition: max-height 0.3s ease-out, padding 0.3s ease;
          background: white;
          max-height: 0;
        }
        .mobile-summary-content.expanded {
          max-height: 1000px;
          padding-bottom: 20px;
          border-bottom: 1px solid #e2e8f0;
        }

        @media (max-width: 768px) {
          .mobile-summary-bar { display: flex; }
          .desktop-summary { display: none !important; }
          .checkout-container { 
            grid-template-columns: 1fr !important; 
            gap: 20px !important;
          }
          .horizontalBadge{
            zoom:0.7;}
          button.placeOrderBtn{
          margin-left: 10px !important;
          margin-right: 10px !important;}
          .checkout-main { padding: 0px 0px 80px !important; }
          .checkout-header { padding: 0 16px !important; }
          .form-section { border-radius: 0 !important; border-left: none !important; border-right: none !important; }
        }

        /* OTP Overlay Styles */
        .otp-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(10px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .otp-card {
          background: white;
          width: 100%;
          max-width: 440px;
          padding: 40px;
          border-radius: 24px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.08);
          text-align: center;
          border: 1px solid #f1f5f9;
        }
        .otp-icon {
          width: 64px;
          height: 64px;
          background: #25d366;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 24px;
          color: white;
          font-size: 32px;
        }
        .otp-title {
          font-size: 24px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 8px;
        }
        .otp-subtitle {
          color: #64748b;
          font-size: 15px;
          line-height: 1.5;
          margin-bottom: 32px;
        }
        .otp-input-group {
          margin-bottom: 24px;
          text-align: left;
        }
        .otp-input {
          width: 100%;
          padding: 16px;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 2px;
          transition: all 0.2s;
        }
        .otp-btn {
          width: 100%;
          background: #0f172a;
          color: white;
          border: none;
          padding: 16px;
          border-radius: 14px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .otp-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .otp-btn:hover:not(:disabled) {
          background: #1e293b;
          transform: translateY(-1px);
        }
        .otp-error {
          background: #fef2f2;
          color: #dc2626;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .resend-link {
          margin-top: 20px;
          font-size: 14px;
          color: #64748b;
        }
        .resend-btn {
          background: none;
          border: none;
          color: #2563eb;
          font-weight: 600;
          cursor: pointer;
          padding: 0 4px;
        }
        .resend-btn:disabled {
          color: #94a3b8;
          cursor: not-allowed;
        }
      `}</style>

      {/* Header */}
      <header style={styles.header} className="checkout-header">
        <div style={styles.headerInner}>
          <div style={styles.logo}>🛒 CheckoutPro</div>
          <div style={styles.secureTag}>Powered by Promark.</div>
        </div>
      </header>

      {/* MOBILE SUMMARY TOGGLE */}
      <div className="mobile-summary-bar" onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", color: "#6366f1", fontWeight: "600" }}>
            {isSummaryExpanded ? "Hide order summary" : "Show order summary"}
          </span>
          <span style={{
            fontSize: "12px",
            transform: isSummaryExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s"
          }}>▼</span>
        </div>
        <div style={{ fontWeight: "700", fontSize: "16px", color: "#111827" }}>
          {formattedTotal}
        </div>
      </div>

      <div className={`mobile-summary-content ${isSummaryExpanded ? "expanded" : ""}`}>
        <div style={{ padding: "20px 24px" }}>
          <div style={styles.itemList}>
            {items.map((item) => (
              <OrderItem key={item.id} item={item} currency={currency} />
            ))}
          </div>
          <div style={styles.divider} />
          <div style={styles.totalRow}>
            <span>Subtotal</span>
            <span>{formattedOriginalTotal}</span>
          </div>
          {discountCents > 0 && (
            <div style={{ ...styles.totalRow, color: "#dc2626" }}>
              <span>Discount {discountCode ? `(${discountCode})` : ""}</span>
              <span>-{formattedDiscount}</span>
            </div>
          )}
          <div style={{ ...styles.totalRow, color: "#22c55e" }}>
            <span>Shipping</span>
            <span>FREE</span>
          </div>
          <div style={styles.divider} />
          <div style={{ ...styles.totalRow, fontWeight: "700", fontSize: "18px", color: "#111827" }}>
            <span>Total</span>
            <span>{formattedTotal}</span>
          </div>
        </div>
      </div>

      <main style={styles.main} className="checkout-main">
        {verificationStep !== "verified" && (
          <div className="otp-overlay">
            <div className="otp-card">
              <div className="otp-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              </div>
              <h1 className="otp-title">
                {verificationStep === "initial" ? "Verify your number" : "Enter Verification Code"}
              </h1>
              <p className="otp-subtitle">
                {verificationStep === "initial"
                  ? "Receive a 6-digit verification code on WhatsApp to proceed with your order."
                  : `We've sent a 6-digit code to WhatsApp on ${phoneNumber}`}
              </p>

              {otpError && (
                <div className="otp-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  {otpError}
                </div>
              )}

              {verificationStep === "initial" ? (
                <form onSubmit={handleSendOtp}>
                  <div className="otp-input-group">
                    <input
                      className="otp-input"
                      type="tel"
                      placeholder="Phone Number (with +91)"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <button className="otp-btn" type="submit" disabled={isVerifying}>
                    {isVerifying ? <div className="spinner"></div> : null}
                    Send Code on WhatsApp
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp}>
                  <div className="otp-input-group">
                    <input
                      className="otp-input"
                      type="text"
                      maxLength="6"
                      placeholder="Enter 6-digit code"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      required
                      autoFocus
                    />
                  </div>
                  <button className="otp-btn" type="submit" disabled={isVerifying}>
                    {isVerifying ? <div className="spinner"></div> : null}
                    Verify & Continue
                  </button>
                  <div className="resend-link">
                    Didn't receive code?{" "}
                    <button
                      type="button"
                      className="resend-btn"
                      onClick={handleSendOtp}
                      disabled={resendTimer > 0 || isVerifying}
                    >
                      {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        <div style={styles.container} className="checkout-container">

          {/* LEFT COLUMN */}
          <div style={styles.formCol}>
            <Form method="post" style={styles.form} ref={formRef} onSubmit={handlePlaceOrder}>
              <input type="hidden" name="paymentMethod" value={paymentMethod} />
              <input type="hidden" name="cartToken" value={cart.token || ""} />
              <input type="hidden" name="shop" value={shop || ""} />
              <input type="hidden" name="cartItems" value={JSON.stringify(
                items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, price: i.price }))
              )} />
              <input type="hidden" name="discountCode" value={discountCode} />

              {/* Meta Tracking Hidden Fields */}
              <input type="hidden" name="fbclid" value={fbclid} />
              <input type="hidden" name="fbp" value={fbp} />
              <input type="hidden" name="eventId" value={eventIdRef.current} />

              {/* ADDRESS SECTION */}
              <section id="address-section" style={styles.section} className="form-section">
                {addressView === "summary" && selectedAddress ? (
                  <>
                    <h2 style={styles.sectionTitle}>
                      <span style={styles.stepBadge}>1</span> Delivery Address
                    </h2>
                    <AddressSummary
                      address={selectedAddress}
                      onChange={() => setAddressView("list")}
                    />
                    {/* Hidden fields for Form submission */}
                    <input type="hidden" name="firstName" value={selectedAddress.firstName} />
                    <input type="hidden" name="lastName" value={selectedAddress.lastName} />
                    <input type="hidden" name="email" value={selectedAddress.email} />
                    <input type="hidden" name="phone" value={selectedAddress.phone} />
                    <input type="hidden" name="address1" value={selectedAddress.address1} />
                    <input type="hidden" name="city" value={selectedAddress.city} />
                    <input type="hidden" name="zip" value={selectedAddress.zip} />
                    <input type="hidden" name="state" value={selectedAddress.state} />
                    <input type="hidden" name="country" value={selectedAddress.country || "India"} />
                  </>
                ) : addressView === "list" ? (
                  <>
                    <div className="section-header-row">
                      <h2 style={styles.sectionTitle}><span style={styles.stepBadge}>1</span> Select Delivery Address</h2>
                      <button type="button" className="add-address-btn" onClick={() => { setEditingAddressIndex(null); setAddressView("form"); }}>+ Add New Address</button>
                    </div>
                    {savedAddresses.map((addr, idx) => (
                      <AddressCard
                        key={idx}
                        address={addr}
                        isActive={selectedAddressIndex === idx}
                        onSelect={() => setSelectedAddressIndex(idx)}
                        onDeliver={() => {
                          setSelectedAddressIndex(idx);
                          setAddressView("summary");
                        }}
                        onEdit={() => {
                          setEditingAddressIndex(idx);
                          setAddressView("form");
                        }}
                        onDelete={() => {
                          const updated = savedAddresses.filter((_, i) => i !== idx);
                          setSavedAddresses(updated);
                          if (selectedAddressIndex === idx) setSelectedAddressIndex(-1);
                          else if (selectedAddressIndex > idx) setSelectedAddressIndex(selectedAddressIndex - 1);
                        }}
                      />
                    ))}
                  </>
                ) : (
                  <>
                    <h2 style={styles.sectionTitle}>
                      <span style={styles.stepBadge}>1</span> {editingAddressIndex !== null ? "Edit Address" : savedAddresses.length > 0 ? "Add New Address" : "Delivery Address"}
                    </h2>
                    <div key={editingAddressIndex === null ? "new" : `edit-${editingAddressIndex}`}>
                      <div style={styles.row}>
                        <FloatingInput name="firstName" label="First Name" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].firstName : ""} />
                        <FloatingInput name="lastName" label="Last Name" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].lastName : ""} />
                      </div>
                      <FloatingInput name="email" label="Email Address" type="email" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].email : ""} />
                      <FloatingInput name="phone" label="Phone Number" type="tel" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].phone : ""} />
                      <FloatingInput name="address1" label="House / Flat / Street" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].address1 : ""} />
                      <div style={styles.row}>
                        <FloatingInput name="city" label="City" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].city : ""} />
                        <FloatingInput name="zip" label="PIN Code" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].zip : ""} />
                      </div>
                      <div style={styles.row}>
                        <FloatingInput name="state" label="State" required defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].state : ""} />
                        <FloatingInput name="country" label="Country" defaultValue={editingAddressIndex !== null ? savedAddresses[editingAddressIndex].country : "India"} required />
                      </div>
                    </div>
                    {/* Action buttons for form */}
                    <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
                      <button
                        type="button"
                        className="deliver-here-btn"
                        style={{ margin: 0 }}
                        onClick={() => {
                          const form = formRef.current;
                          if (form.reportValidity()) {
                            const updatedAddr = {
                              firstName: form.firstName.value,
                              lastName: form.lastName.value,
                              email: form.email.value,
                              phone: form.phone.value,
                              address1: form.address1.value,
                              city: form.city.value,
                              zip: form.zip.value,
                              state: form.state.value,
                              country: form.country.value,
                            };

                            if (editingAddressIndex !== null) {
                              const updated = [...savedAddresses];
                              updated[editingAddressIndex] = updatedAddr;
                              setSavedAddresses(updated);
                              setSelectedAddressIndex(editingAddressIndex);
                            } else {
                              // Always add new address to the top
                              const updated = [updatedAddr, ...savedAddresses];
                              setSavedAddresses(updated);
                              setSelectedAddressIndex(0);
                            }
                            setAddressView("list"); // Go back to list so user can see all stored addresses
                            setEditingAddressIndex(null);
                          }
                        }}
                      >
                        Deliver Here
                      </button>
                      {savedAddresses.length > 0 && (
                        <button
                          type="button"
                          className="change-btn"
                          style={{ height: "48px", borderRadius: "10px" }}
                          onClick={() => { setAddressView("list"); setEditingAddressIndex(null); }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>

              {/* PAYMENT SECTION */}
              <section style={styles.section} className="form-section">
                <h2 style={styles.sectionTitle}>
                  <span style={styles.stepBadge}>2</span> Payment Method
                </h2>

                <div style={styles.paymentOptions}>
                  <PaymentOption
                    id="cod"
                    value="COD"
                    label="Cash on Delivery"
                    icon="💵"
                    description="Pay when your order arrives · No extra charges"
                    selected={paymentMethod === "COD"}
                    onSelect={setPaymentMethod}
                  />
                  {isPartialCodEligible && (
                    <PaymentOption
                      id="partial-cod"
                      value="PARTIAL_COD"
                      label="Partial COD (Pay Advance)"
                      icon="🌗"
                      description={`${partialCod.upfrontLabel || "Pay now"}: ${formattedUpfront} · ${partialCod.deliveryLabel || "On Delivery"}: ${formattedRemaining}`}
                      selected={paymentMethod === "PARTIAL_COD"}
                      onSelect={setPaymentMethod}
                      badge="Recommended"
                    />
                  )}
                  <PaymentOption
                    id="online"
                    value="ONLINE"
                    label="Pay Online"
                    icon="💳"
                    description="UPI · Debit/Credit Card · Net Banking · Wallets"
                    selected={paymentMethod === "ONLINE"}
                    onSelect={setPaymentMethod}
                    badge="5% OFF"
                  />
                </div>

                {/* Online payment trust badges */}
                {(paymentMethod === "ONLINE" || paymentMethod === "PARTIAL_COD") && (
                  <div style={styles.trustBadges}>
                    <span style={styles.trustBadge}>🔒 256-bit SSL</span>
                    <span style={styles.trustBadge}>✅ Razorpay Secured</span>
                    <span style={styles.trustBadge}>🏦 100+ Payment Options</span>
                  </div>
                )}
              </section>

              {/* Error message */}
              {paymentError && (
                <div style={styles.errorBox}>
                  ⚠️ {paymentError}
                </div>
              )}

              {/* PLACE ORDER BUTTON */}
              <button
                type={paymentMethod === "COD" ? "submit" : "button"}
                onClick={(paymentMethod === "ONLINE" || paymentMethod === "PARTIAL_COD") ? handlePlaceOrder : undefined}
                style={{
                  ...styles.placeOrderBtn,
                  margin: "unset",
                  opacity: (isSubmitting || rzpLoading) ? 0.8 : 1,
                  cursor: (isSubmitting || rzpLoading) ? "not-allowed" : "pointer",
                }}
                disabled={isSubmitting || rzpLoading}
                className="placeOrderBtn"
                id="place-order-btn"
              >
                {(isSubmitting || rzpLoading) ? (
                  <><span className="spinner" />Processing...</>
                ) : paymentMethod === "ONLINE" ? (
                  `Pay ${formattedTotal} — Securely`
                ) : paymentMethod === "PARTIAL_COD" ? (
                  `Pay ${formattedUpfront} to Place Order`
                ) : (
                  `Place COD Order — ${formattedTotal}`
                )}
              </button>

              <p style={styles.secureNote}>
                🔒 Your personal &amp; payment information is always protected.
              </p>
            </Form>
          </div>

          {/* RIGHT COLUMN - Order Summary */}
          <div style={styles.summaryCol} className="desktop-summary">
            <div style={styles.summaryCard}>
              <h2 style={styles.summaryTitle}>Order Summary</h2>
              <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "20px" }}>
                {cart.item_count} item{cart.item_count !== 1 ? "s" : ""} from {shop}
              </p>

              <div style={styles.itemList}>
                {items.map((item) => (
                  <OrderItem key={item.id} item={item} currency={currency} />
                ))}
              </div>

              <div style={styles.divider} />
              <div style={styles.totalRow}>
                <span>Subtotal</span>
                <span>{formattedOriginalTotal}</span>
              </div>
              {discountCents > 0 && (
                <div style={{ ...styles.totalRow, color: "#dc2626" }}>
                  <span>Discount {discountCode ? `(${discountCode})` : ""}</span>
                  <span>-{formattedDiscount}</span>
                </div>
              )}
              <div style={{ ...styles.totalRow, color: "#22c55e" }}>
                <span>Shipping</span>
                <span>FREE</span>
              </div>
              {(paymentMethod === "ONLINE" || paymentMethod === "PARTIAL_COD") && (
                <div style={{ ...styles.totalRow, color: "#f59e0b" }}>
                  <span>{paymentMethod === "PARTIAL_COD" ? "Advance Payment" : "Payment"}</span>
                  <span>{paymentMethod === "PARTIAL_COD" ? formattedUpfront : "Razorpay ✓"}</span>
                </div>
              )}
              <div style={styles.divider} />
              <div style={{ ...styles.totalRow, fontWeight: "700", fontSize: "18px", color: "#111827" }}>
                <span>Total</span>
                <span>{formattedTotal}</span>
              </div>

              {/* Security seals */}
              <div style={styles.sealRow}>
                <div style={styles.seal}>🔒<br /><span>Secure</span></div>
                <div style={styles.seal}>🏭<br /><span>Shopify</span></div>
                <div style={styles.seal}>💳<br /><span>Razorpay</span></div>
              </div>
            </div>
          </div>

        </div>
      </main>

      <footer style={styles.footer}>
        <div style={styles.poweredByContainer}>
          <svg style={styles.curvedTextSVG} viewBox="0 0 100 40">
            <path id="curve" d="M 0 40 Q 50 0 100 40" fill="transparent" />
            <text style={{ fontSize: '8px', fill: '#94a3b8', fontWeight: '500', letterSpacing: '2px' }}>
              <textPath href="#curve" startOffset="50%" textAnchor="middle">
                POWERED BY
              </textPath>
            </text>
          </svg>
          <img src="/footer_shield.png" alt="Secure" style={styles.footerShield} />
          <img src="/promark_logo_h.png" alt="Promark" style={styles.promarkLogoH} />
        </div>

        <div style={styles.horizontalBadges} className="horizontalBadge">
          <div style={styles.badgeItem}>
            <img src="/pci_badge.png" alt="PCI DSS" style={styles.badgeIcon} />
            <div style={styles.badgeText}>
              <span style={styles.badgeTitle}>PCI DSS</span>
              <span style={styles.badgeSub}>Certified</span>
            </div>
          </div>
          <div style={styles.badgeItem}>
            <img src="/secured_badge.png" alt="Secured" style={styles.badgeIcon} />
            <div style={styles.badgeText}>
              <span style={styles.badgeTitle}>Secured</span>
              <span style={styles.badgeSub}>Payments</span>
            </div>
          </div>
          <div style={styles.badgeItem}>
            <img src="/verified_badge.png" alt="Verified" style={styles.badgeIcon} />
            <div style={styles.badgeText}>
              <span style={styles.badgeTitle}>Verified</span>
              <span style={styles.badgeSub}>Merchant</span>
            </div>
          </div>
        </div>

        <div style={styles.footerId}>26f6ec13</div>

        <div style={styles.footerDisclaimer}>
          By proceeding, I agree to Promark's{' '}
          <span style={styles.footerLink}>Privacy Policy</span> and{' '}
          <span style={styles.footerLink}>T&C</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AddressSummary({ address, onChange }) {
  if (!address) return null;
  return (
    <div className="address-summary">
      <div className="address-summary-icon">📍</div>
      <div className="address-summary-content">
        <div style={{ fontWeight: "700", fontSize: "16px", marginBottom: "4px" }}>
          Deliver To {address.firstName} {address.lastName}
        </div>
        <div style={{ color: "#475569", fontSize: "14px", lineHeight: "1.4" }}>
          {address.address1}, {address.city}<br />
          {address.state}, {address.zip}
        </div>
        <div style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
          {address.phone} | {address.email}
        </div>
      </div>
      <button type="button" onClick={onChange} className="change-btn">Change</button>
    </div>
  );
}

function AddressCard({ address, isActive, onSelect, onDeliver, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu when clicking elsewhere
  useEffect(() => {
    if (!menuOpen) return;
    const handleClose = () => setMenuOpen(false);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, [menuOpen]);

  return (
    <div className={`address-card ${isActive ? "active" : ""}`} onClick={() => onSelect()}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontWeight: "700", fontSize: "16px" }}>{address.firstName} {address.lastName}</span>
          <span className="address-badge">Home</span>
        </div>
        <div className="address-menu-container" onClick={(e) => e.stopPropagation()}>
          <div className="address-menu-trigger" onClick={() => setMenuOpen(!menuOpen)}>⋮</div>
          {menuOpen && (
            <div className="address-menu-dropdown">
              <button type="button" className="address-menu-item" onClick={() => { onEdit(); setMenuOpen(false); }}>
                ✏️ Edit
              </button>
              <button type="button" className="address-menu-item delete" onClick={() => { if (confirm("Delete this address?")) onDelete(); setMenuOpen(false); }}>
                🗑️ Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ color: "#475569", fontSize: "14px", lineHeight: "1.4", marginBottom: "4px" }}>
        {address.address1}, {address.city}, {address.state}, {address.zip}
      </div>
      <div style={{ color: "#64748b", fontSize: "14px", marginBottom: "12px" }}>
        {address.email}
      </div>
      {isActive && (
        <button type="button" className="deliver-here-btn" onClick={(e) => { e.stopPropagation(); onDeliver(); }}>
          Deliver Here
        </button>
      )}
    </div>
  );
}

function FloatingInput({ name, label, type = "text", required, defaultValue }) {
  return (
    <div style={styles.inputGroup}>
      <input
        id={`field-${name}`}
        name={name}
        type={type}
        placeholder=" "
        required={required}
        defaultValue={defaultValue}
        style={styles.input}
      />
      <label htmlFor={`field-${name}`} style={styles.inputLabel}>{label}</label>
    </div>
  );
}

function PaymentOption({ id, value, label, icon, description, selected, onSelect, badge }) {
  return (
    <div
      onClick={() => onSelect(value)}
      style={{
        ...styles.paymentOption,
        border: selected ? "2px solid #6366f1" : "2px solid #e2e8f0",
        background: selected ? "#eff6ff" : "white",
        boxShadow: selected ? "0 4px 12px rgba(99,102,241,0.08)" : "none",
      }}
    >
      <div style={{
        width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
        border: selected ? "6px solid #6366f1" : "2px solid #d1d5db",
        transition: "all 0.2s",
        background: "white"
      }} />
      <div style={{ fontSize: "24px", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={styles.paymentLabel}>{label}</div>
        <div style={styles.paymentDesc}>{description}</div>
      </div>
      {badge && (
        <div style={styles.badge}>{badge}</div>
      )}
    </div>
  );
}

function OrderItem({ item, currency }) {
  const title = item.product_title || item.title || "Product";
  const variant = item.variant_title;
  const qty = item.quantity;
  const priceCents = item.line_price || item.price * item.quantity;
  const image = item.featured_image?.url || item.image;

  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency", currency,
  }).format(priceCents / 100);

  return (
    <div style={styles.orderItem}>
      <div style={styles.itemImageWrap}>
        {image ? (
          <img src={image} alt={title} style={styles.itemImage} />
        ) : (
          <div style={styles.itemImageFallback}>📦</div>
        )}
        <span style={styles.qtyBadge}>{qty}</span>
      </div>
      <div style={styles.itemDetails}>
        <div style={styles.itemTitle}>{title}</div>
        {variant && variant !== "Default Title" && (
          <div style={styles.itemVariant}>{variant}</div>
        )}
      </div>
      <div style={styles.itemPrice}>{formatted}</div>
    </div>
  );
}

function SuccessScreen({ order, shop }) {
  const isOnline = order.paymentMethod === "ONLINE";
  return (
    <div style={{ ...styles.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{
        background: "white", borderRadius: "24px",
        padding: "60px 48px", textAlign: "center", maxWidth: "480px", width: "100%",
        border: "1px solid #e2e8f0", boxShadow: "0 10px 25px rgba(0,0,0,0.05)"
      }}>
        <div style={{ fontSize: "72px", marginBottom: "16px" }}>{isOnline ? "🎊" : "🎉"}</div>
        <h1 style={{ color: "#111827", fontSize: "32px", marginBottom: "8px" }}>Order Placed!</h1>
        <p style={{ color: "#64748b", marginBottom: "24px" }}>
          Thanks {order.name}! Your order <strong style={{ color: "#111827" }}>{order.orderId}</strong> has been successfully placed.
        </p>
        <div style={{
          background: isOnline ? "#f0fdf4" : "#eef2ff",
          borderRadius: "12px", padding: "16px", marginBottom: "16px",
          color: isOnline ? "#166534" : "#3730a3",
          border: isOnline ? "1px solid #bbf7d0" : "1px solid #c3dafe"
        }}>
          {isOnline ? "✅ Payment Successful via Razorpay" : "💵 Cash on Delivery"}
        </div>
        {order.razorpayPaymentId && (
          <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "20px" }}>
            Payment ID: {order.razorpayPaymentId}
          </p>
        )}
        <a href={`https://${order.shop || shop}`} style={{
          display: "inline-block", padding: "14px 32px",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "white", borderRadius: "12px", textDecoration: "none", fontWeight: "600"
        }}>Continue Shopping</a>
      </div>
    </div>
  );
}

function ErrorScreen({ message, shop }) {
  return (
    <div style={{ ...styles.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{
        background: "#fef2f2", borderRadius: "24px",
        padding: "48px", textAlign: "center", maxWidth: "480px",
        border: "1px solid #fee2e2"
      }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>⚠️</div>
        <h2 style={{ color: "#991b1b", marginBottom: "8px" }}>Something went wrong</h2>
        <p style={{ color: "#7f1d1d", marginBottom: "24px" }}>{message}</p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button onClick={() => window.history.back()} style={{
            padding: "12px 24px",
            background: "#1e293b", color: "white", borderRadius: "10px",
            border: "none", cursor: "pointer", fontSize: "15px"
          }}>Go Back</button>
          {shop && (
            <a href={`https://${shop}`} style={{
              padding: "12px 24px",
              background: "white", color: "#1e293b", borderRadius: "10px",
              border: "1px solid #1e293b", textDecoration: "none", fontSize: "15px", fontWeight: "500"
            }}>Return to Store</a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "'Inter', -apple-system, sans-serif",
    color: "#1e293b",
    width: "100%",
  },
  header: {
    background: "white",
    borderBottom: "1px solid #e2e8f0",
    position: "sticky", top: 0, zIndex: 100, padding: "0 24px",
  },
  headerInner: {
    maxWidth: "1200px", margin: "0 auto",
    display: "flex", justifyContent: "space-between", alignItems: "center", height: "64px",
  },
  logo: { fontSize: "22px", fontWeight: "700", color: "#1e293b" },
  secureTag: { color: "#64748b", fontSize: "13px" },
  main: { padding: "40px 24px 80px" },
  container: {
    maxWidth: "1100px", margin: "0 auto",
    display: "grid", gridTemplateColumns: "1fr 380px",
    gap: "32px", alignItems: "start",
  },
  formCol: {},
  form: { display: "flex", flexDirection: "column", gap: "24px" },
  section: {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "20px", padding: "28px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  sectionTitle: {
    fontSize: "18px", fontWeight: "600", color: "#111827",
    marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px",
  },
  stepBadge: {
    width: "28px", height: "28px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    borderRadius: "50%", display: "inline-flex",
    alignItems: "center", justifyContent: "center",
    fontSize: "14px", fontWeight: "700", color: "white", flexShrink: 0,
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
  inputGroup: { position: "relative", marginBottom: "16px" },
  input: {
    width: "100%", padding: "22px 16px 8px",
    background: "#f9fafb",
    border: "1px solid #d1d5db",
    borderRadius: "12px", color: "#111827",
    fontSize: "15px", outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
    fontFamily: "inherit",
  },
  inputLabel: {
    position: "absolute", top: "50%", left: "16px",
    transform: "translateY(-50%)",
    color: "#6b7280", fontSize: "14px",
    pointerEvents: "none", transition: "all 0.2s",
  },
  paymentOptions: { display: "flex", flexDirection: "column", gap: "12px" },
  paymentOption: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "16px 20px", borderRadius: "14px",
    cursor: "pointer", transition: "all 0.2s",
  },
  paymentLabel: { fontWeight: "600", color: "#111827", marginBottom: "2px" },
  paymentDesc: { fontSize: "13px", color: "#64748b" },
  badge: {
    background: "linear-gradient(135deg, #22c55e, #16a34a)",
    color: "white", borderRadius: "6px",
    padding: "3px 8px", fontSize: "11px", fontWeight: "700",
    whiteSpace: "nowrap",
  },
  trustBadges: {
    display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px",
  },
  trustBadge: {
    background: "#f5f3ff",
    border: "1px solid #ddd6fe",
    borderRadius: "8px", padding: "6px 12px",
    fontSize: "12px", color: "#4f46e5",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fee2e2",
    borderRadius: "12px", padding: "14px 18px",
    color: "#b91c1c", fontSize: "14px",
  },
  placeOrderBtn: {
    padding: "18px",
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    color: "white", border: "none", borderRadius: "14px",
    fontSize: "17px", fontWeight: "700", cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "0 8px 32px rgba(99,102,241,0.25)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  secureNote: { textAlign: "center", color: "#94a3b8", fontSize: "13px" },
  summaryCol: { position: "sticky", top: "84px" },
  summaryCard: {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "20px", padding: "28px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  summaryTitle: { fontSize: "18px", fontWeight: "700", color: "#111827", marginBottom: "4px" },
  itemList: { display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" },
  orderItem: { display: "flex", alignItems: "center", gap: "12px" },
  itemImageWrap: { position: "relative", flexShrink: 0 },
  itemImage: { width: "60px", height: "60px", borderRadius: "10px", objectFit: "cover" },
  itemImageFallback: {
    width: "60px", height: "60px", borderRadius: "10px",
    background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px",
  },
  qtyBadge: {
    position: "absolute", top: "-6px", right: "-6px",
    background: "#6366f1", color: "white",
    borderRadius: "50%", width: "20px", height: "20px",
    fontSize: "11px", fontWeight: "700",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  itemDetails: { flex: 1 },
  itemTitle: { fontWeight: "600", color: "#111827", fontSize: "14px", marginBottom: "2px" },
  itemVariant: { fontSize: "12px", color: "#64748b" },
  itemPrice: { fontWeight: "600", color: "#111827", whiteSpace: "nowrap" },
  divider: { height: "1px", background: "#e2e8f0", margin: "16px 0" },
  totalRow: { display: "flex", justifyContent: "space-between", color: "#4b5563", marginBottom: "8px" },
  sealRow: { display: "flex", justifyContent: "space-around", marginTop: "24px" },
  seal: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: "12px",
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    background: "#f8fafc",
    width: "100%",
    paddingBottom: "25px",
  },
  poweredByContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  curvedTextSVG: {
    width: "140px",
    height: "50px",
    marginBottom: "-20px",
  },
  footerShield: {
    width: "36px",
    height: "36px",
    marginBottom: "16px",
    objectFit: "contain",
    opacity: "0.8",
  },
  promarkLogoH: {
    height: "62px",
    width: "185%",
    objectFit: "cover",
  },
  horizontalBadges: {
    display: "flex",
    justifyContent: "center",
    gap: "48px",
    margin: "48px 0 24px",
    flexWrap: "wrap",
  },
  badgeItem: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  badgeIcon: {
    width: "48px",
    height: "48px",
    objectFit: "contain",
    opacity: "0.8",
  },
  badgeText: {
    display: "flex",
    flexDirection: "column",
    textAlign: "left",
  },
  badgeTitle: {
    fontSize: "15px",
    fontWeight: "700",
    color: "#475569",
    lineHeight: "1.2",
  },
  badgeSub: {
    fontSize: "14px",
    color: "#94a3b8",
  },
  footerId: {
    fontSize: "13px",
    color: "#cbd5e1",
    marginBottom: "12px",
    fontFamily: "monospace",
  },
  footerDisclaimer: {
    fontSize: "15px",
    color: "#334155",
    textAlign: "center",
    lineHeight: "1.6",
    maxWidth: "600px",
  },
  footerLink: {
    fontWeight: "700",
    textDecoration: "underline",
    color: "#000",
    cursor: "pointer",
  },
};
