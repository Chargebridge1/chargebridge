import { Router } from "express";
import { randomInt, createHash } from "crypto";
import { db } from "@workspace/db";
import { phoneOtpsTable } from "@workspace/db";
import { eq, and, lt, gte } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logger } from "../lib/logger";

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

// IP-level: max 5 send attempts per 15 minutes per IP (high-risk endpoint)
const sendRateLimitIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many verification requests. Please wait and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// IP-level: max 10 check attempts per 15 minutes per IP
const checkRateLimitIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many verification attempts. Please wait and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ── POST /api/verify/send ─────────────────────────────────────────────────────
router.post("/send", sendRateLimitIp, async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "phone is required" });
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) {
    return res.status(400).json({ error: "Enter a valid 10-digit US phone number" });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !authToken || !from) {
    return res.status(503).json({
      error: "SMS service not configured. Contact support to enable phone verification.",
    });
  }

  // Per-phone rate limit: max 3 send attempts per 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentSends = await db
    .select({ id: phoneOtpsTable.id })
    .from(phoneOtpsTable)
    .where(
      and(
        eq(phoneOtpsTable.phone, digits),
        gte(phoneOtpsTable.createdAt, tenMinutesAgo)
      )
    );

  if (recentSends.length >= 3) {
    return res.status(429).json({
      error: "Too many verification codes sent to this number. Please wait 10 minutes.",
    });
  }

  // Generate a cryptographically secure 6-digit code
  // crypto.randomInt(min, max) is exclusive on max, so 100000–999999 range:
  const code = String(randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await db.insert(phoneOtpsTable).values({
    phone: digits,
    codeHash,
    expiresAt,
    attempts: 0,
  });

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(sid, authToken);
    await client.messages.create({
      body: `Your ChargeBridge verification code is: ${code}. Valid for 5 minutes.`,
      from,
      to: `+1${digits}`,
    });
    // Never log the OTP code itself
    logger.info({ last4: digits.slice(-4) }, "SMS verification code sent");
    return res.json({ ok: true });
  } catch (err) {
    // Clean up the OTP record if SMS fails so the user can retry
    await db.delete(phoneOtpsTable).where(eq(phoneOtpsTable.codeHash, codeHash));
    logger.error({ err }, "Twilio SMS send failed");
    return res.status(500).json({
      error: "Failed to send verification code. Check the phone number and try again.",
    });
  }
});

// ── POST /api/verify/check ────────────────────────────────────────────────────
router.post("/check", checkRateLimitIp, async (req, res) => {
  const { phone, code } = req.body as { phone?: string; code?: string };
  if (!phone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }

  const digits = phone.replace(/\D/g, "");
  const now = new Date();

  // Find the most recent unexpired, unverified OTP for this phone
  const otpRows = await db
    .select()
    .from(phoneOtpsTable)
    .where(
      and(
        eq(phoneOtpsTable.phone, digits),
        gte(phoneOtpsTable.expiresAt, now)
      )
    )
    .orderBy(phoneOtpsTable.createdAt);

  const entry = otpRows[otpRows.length - 1]; // most recent

  if (!entry || entry.verifiedAt) {
    return res.status(400).json({ error: "No active code found for this number. Request a new code." });
  }

  // Check attempt cap (max 5 before invalidation)
  if (entry.attempts >= 5) {
    // Invalidate by expiring it
    await db
      .update(phoneOtpsTable)
      .set({ expiresAt: new Date(0) })
      .where(eq(phoneOtpsTable.id, entry.id));
    return res.status(400).json({ error: "Too many incorrect attempts. Request a new code." });
  }

  const submittedHash = hashCode(String(code).replace(/\D/g, ""));
  if (submittedHash !== entry.codeHash) {
    // Increment attempt counter
    await db
      .update(phoneOtpsTable)
      .set({ attempts: entry.attempts + 1 })
      .where(eq(phoneOtpsTable.id, entry.id));
    return res.status(400).json({ error: "Incorrect code. Please try again." });
  }

  // Success: mark verified and invalidate the code
  await db
    .update(phoneOtpsTable)
    .set({ verifiedAt: now, expiresAt: now })
    .where(eq(phoneOtpsTable.id, entry.id));

  return res.json({ ok: true, verified: true });
});

export default router;
