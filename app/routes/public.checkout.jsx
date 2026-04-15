import { json } from "@remix-run/node";
import prisma from "../db.server";

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

    // Pass Razorpay Key ID to frontend (safe — public key)
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";

    const { getAppConfig } = await import("../models/config.server");
    const config = await getAppConfig(shop);

    return json({ cart, shop, error: null, razorpayKeyId, config });
  } catch (err) {
    return json({ error: "Failed to decode cart: " + err.message, cart: null, shop, config: null });
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
        return json({
          success: true,
          orderId: data.order.name,
          paymentMethod: "COD",
          name: `${firstName} ${lastName}`,
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
  const { cart, shop, error, razorpayKeyId, config } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [rzpLoading, setRzpLoading] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [paymentError, setPaymentError] = useState(null);
  const formRef = useRef(null);

  // ── Load Razorpay SDK from CDN ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (document.getElementById("razorpay-script")) return;
    const script = document.createElement("script");
    script.id = "razorpay-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  if (error) return <ErrorScreen message={error} />;
  if (!cart) return <ErrorScreen message="Cart not found. Please go back and try again." />;
  if (actionData?.success) return <SuccessScreen order={actionData} />;
  if (orderResult?.success) return <SuccessScreen order={orderResult} />;

  const items = cart.items || [];
  const totalCents = cart.total_price || 0;
  const currency = cart.currency || "INR";

  // Always display in INR — Razorpay UPI/Netbanking/Wallets only work with INR
  const formattedTotal = new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
  }).format(totalCents / 100);

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
        @keyframes spin {
          to { transform: rotate(360deg); }
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
      `}</style>

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>🛒 CheckoutPro</div>
          <div style={styles.secureTag}>Powered by Promark.</div>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.container}>

          {/* LEFT COLUMN */}
          <div style={styles.formCol}>
            <Form method="post" style={styles.form} ref={formRef} onSubmit={handlePlaceOrder}>
              <input type="hidden" name="paymentMethod" value={paymentMethod} />
              <input type="hidden" name="cartToken" value={cart.token || ""} />
              <input type="hidden" name="shop" value={shop || ""} />
              <input type="hidden" name="cartItems" value={JSON.stringify(
                items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, price: i.price }))
              )} />

              {/* ADDRESS SECTION */}
              <section style={styles.section}>
                <h2 style={styles.sectionTitle}>
                  <span style={styles.stepBadge}>1</span> Delivery Address
                </h2>
                <div style={styles.row}>
                  <FloatingInput name="firstName" label="First Name" required />
                  <FloatingInput name="lastName" label="Last Name" required />
                </div>
                <FloatingInput name="email" label="Email Address" type="email" required />
                <FloatingInput name="phone" label="Phone Number" type="tel" required />
                <FloatingInput name="address1" label="House / Flat / Street" required />
                <div style={styles.row}>
                  <FloatingInput name="city" label="City" required />
                  <FloatingInput name="zip" label="PIN Code" required />
                </div>
                <div style={styles.row}>
                  <FloatingInput name="state" label="State" required />
                  <FloatingInput name="country" label="Country" defaultValue="India" required />
                </div>
              </section>

              {/* PAYMENT SECTION */}
              <section style={styles.section}>
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
                  opacity: (isSubmitting || rzpLoading) ? 0.8 : 1,
                  cursor: (isSubmitting || rzpLoading) ? "not-allowed" : "pointer",
                }}
                disabled={isSubmitting || rzpLoading}
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
          <div style={styles.summaryCol}>
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
                <span>{formattedTotal}</span>
              </div>
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
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function SuccessScreen({ order }) {
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
        <a href="/" style={{
          display: "inline-block", padding: "14px 32px",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "white", borderRadius: "12px", textDecoration: "none", fontWeight: "600"
        }}>Continue Shopping</a>
      </div>
    </div>
  );
}

function ErrorScreen({ message }) {
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
        <button onClick={() => window.history.back()} style={{
          padding: "12px 28px",
          background: "#1e293b", color: "white", borderRadius: "10px",
          border: "none", cursor: "pointer", fontSize: "15px"
        }}>Go Back</button>
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
};
