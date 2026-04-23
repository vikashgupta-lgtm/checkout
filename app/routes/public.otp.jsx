import { json } from "@remix-run/node";
import prisma from "../db.server";
import { sendWhatsAppOTP } from "../utils/whatsapp.server";

export const headers = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

export const loader = async () => {
  return json({ error: "Method not allowed" }, { status: 405 });
};

export const action = async ({ request }) => {
  const url = new URL(request.url);
  const actionType = url.searchParams.get("action");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers() });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();

  if (actionType === "send") {
    return handleSendOtp(body);
  } else if (actionType === "verify") {
    return handleVerifyOtp(body);
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

async function handleSendOtp({ phone }) {
  if (!phone) {
    return json({ error: "Phone number is required." }, { status: 400 });
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  try {
    // Delete any existing unverified OTPs for this phone to avoid clutter
    await prisma.otpVerification.deleteMany({
      where: { phone, verified: false },
    });

    // Save to DB
    await prisma.otpVerification.create({
      data: { phone, code, expiresAt },
    });

    // Send via WhatsApp
    await sendWhatsAppOTP(phone, code);

    return json({ success: true, message: "OTP sent successfully." });
  } catch (err) {
    console.error("[OTP Action] Send Error:", err);
    return json({ error: err.message || "Failed to send OTP. Please try again." }, { status: 500 });
  }
}

async function handleVerifyOtp({ phone, code }) {
  if (!phone || !code) {
    return json({ error: "Phone and code are required." }, { status: 400 });
  }

  try {
    const record = await prisma.otpVerification.findFirst({
      where: {
        phone,
        code,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return json({ error: "Invalid or expired OTP. Please try again." }, { status: 400 });
    }

    // Mark as verified
    await prisma.otpVerification.update({
      where: { id: record.id },
      data: { verified: true },
    });

    return json({ success: true, message: "Phone verified successfully." });
  } catch (err) {
    console.error("[OTP Action] Verify Error:", err);
    return json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
