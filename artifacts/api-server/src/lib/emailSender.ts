import { logger } from "./logger";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; message: string }> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    logger.warn({ to: payload.to, subject: payload.subject }, "RESEND_API_KEY not set — email skipped");
    return { ok: false, message: "Email service not configured. Add RESEND_API_KEY to enable sending." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ChargeBridge <receipts@chargebridge.app>",
        to: [payload.to],
        reply_to: payload.replyTo,
        subject: payload.subject,
        html: payload.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      logger.error({ status: res.status, data }, "Resend API error");
      return { ok: false, message: data.message ?? "Failed to send email" };
    }

    logger.info({ to: payload.to, id: data.id }, "Email sent via Resend");
    return { ok: true, message: "Email sent successfully" };
  } catch (err: any) {
    logger.error({ err }, "Email send failed");
    return { ok: false, message: err.message ?? "Unknown error sending email" };
  }
}
