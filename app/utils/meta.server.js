import crypto from "crypto";

/**
 * Hash data using SHA256 (required by Meta CAPI)
 * @param {string} value 
 * @returns {string} Hashed value
 */
export function hashData(value) {
    if (!value) return "";
    return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Send Purchase event to Meta Conversions API
 * @param {Object} options 
 * @param {Object} options.orderData - Order details
 * @param {Object} options.userData - Unhashed user data (email, phone, etc.)
 * @param {Object} options.trackingData - Meta specific IDs (eventId, fbclid, fbp)
 * @param {Request} options.request - Remix request object for IP and User Agent
 */
export async function sendMetaCAPI({ orderData, userData, trackingData, request }) {
    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
    const TEST_CODE = process.env.META_TEST_EVENT_CODE;
    console.log("[Meta CAPI] Pixel ID:", PIXEL_ID);
    console.log("[Meta CAPI] Access Token:", ACCESS_TOKEN);


    if (!PIXEL_ID || !ACCESS_TOKEN) {
        console.error("[Meta CAPI] Skipping: META_PIXEL_ID or META_CAPI_TOKEN not set in .env");
        return;
    }

    const eventTime = Math.floor(Date.now() / 1000);
    const userAgent = request.headers.get("user-agent");
    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("host"); // Best effort IP

    const payload = {
        data: [{
            event_name: "Purchase",
            event_time: eventTime,
            event_id: trackingData.eventId,
            action_source: "website",
            event_source_url: request.url,
            user_data: {
                ph: [hashData(userData.phone)],
                em: [hashData(userData.email)],
                client_ip_address: ipAddress,
                client_user_agent: userAgent,
                ...(trackingData.fbclid && { fbc: `fb.1.${eventTime}.${trackingData.fbclid}` }),
                ...(trackingData.fbp && { fbp: trackingData.fbp })
            },
            custom_data: {
                currency: orderData.currency || "INR",
                value: parseFloat(orderData.totalPrice),
                content_type: "product",
                content_ids: orderData.items.map(i => i.variant_id.toString()),
                num_items: orderData.items.reduce((acc, i) => acc + i.quantity, 0),
                order_id: orderData.orderName
            }
        }],
        ...(TEST_CODE && { test_event_code: TEST_CODE })
    };

    console.log(`[Meta CAPI] Sending Purchase event for order ${orderData.orderName}...`);

    try {
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }
        );
        const result = await response.json();
        console.log("[Meta CAPI] Response:", JSON.stringify(result));
        return result;
    } catch (err) {
        console.error("[Meta CAPI] Error:", err);
    }
}
