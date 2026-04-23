/**
 * WhatsApp Utility - Handles sending OTP via Meta WhatsApp Business API
 */

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_OTP_TEMPLATE_NAME = process.env.WHATSAPP_OTP_TEMPLATE_NAME || "Promark.";

/**
 * Sends a 6-digit OTP to a phone number via WhatsApp
 * @param {string} phone - Target phone number (E.164 format)
 * @param {string} code - The 6-digit OTP code
 */
export async function sendWhatsAppOTP(phone, code) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error("WhatsApp credentials missing in .env");
    throw new Error("WhatsApp configuration error. Please contact support.");
  }

  // Ensure phone number starts with + and has no special characters
  const formattedPhone = phone.startsWith("+") ? phone.substring(1) : phone;

  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "template",
    template: {
      name: WHATSAPP_OTP_TEMPLATE_NAME,
      language: {
        code: "en_US",
      },
      ...(WHATSAPP_OTP_TEMPLATE_NAME !== "hello_world" && {
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: code,
              },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [
              {
                type: "text",
                text: code,
              },
            ],
          },
        ],
      }),
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("WhatsApp API Error Response:", JSON.stringify(data));
      throw new Error(data.error?.message || "Failed to send WhatsApp message");
    }

    return { success: true, data };
  } catch (err) {
    console.error("WhatsApp Send Error:", err);
    throw err;
  }
}
