import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import { like } from "drizzle-orm";
import { sendEmail } from "../lib/emailSender";
import { buildInvoiceEmailHtml } from "../lib/invoiceEmailTemplate";
import { logger } from "../lib/logger";
import { requireChargingSessionOwnerOrAdmin } from "../middlewares/requireAuth";

const router = Router();
const markGuestReadPolicy = (req: any, _res: any, next: any) => {
  req.guestReadPolicy = true;
  next();
};

const receiptEmailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: (req) => (req as any).clerkUserId ? 10 : 5,
  keyGenerator: (req) => {
    const clerkUserId = (req as any).clerkUserId as string | undefined;
    if (clerkUserId) return `user:${clerkUserId}`;
    const sessionId = (req as any).chargingSession?.id ?? "unknown";
    return `guest:${sessionId}:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: { error: "Too many receipt requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── GET /sessions/:sessionId/invoice — find the auto-generated invoice for a session ──
router.get("/sessions/:sessionId/invoice", markGuestReadPolicy, requireChargingSessionOwnerOrAdmin, async (req, res) => {
  const sessionId = (req as any).chargingSession.id as number;
  const marker = `[charging-receipt:session-${sessionId}]`;
  const invoices = await db.query.invoicesTable.findMany({
    where: (t, { like }) => like(t.notes, `%${marker}%`),
    with: { items: true },
  });

  if (invoices.length === 0) return res.status(404).json({ error: "No invoice found for this session" });

  const inv = invoices[0];
  const totalAmount = inv.items.reduce((s: number, i: { amount: string }) => s + parseFloat(i.amount), 0);
  return res.json({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, totalAmount });
});

router.get("/charging-sessions/:sessionId", markGuestReadPolicy, requireChargingSessionOwnerOrAdmin, async (req, res) => {
  const session = (req as any).chargingSession;
  return res.json({
    id: session.id,
    stationId: session.stationId,
    status: session.status,
    paymentState: session.paymentState,
    chargingState: session.chargingState,
    kwh: session.kwh,
    amountCents: session.amountCents,
    currency: session.currency,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  });
});

router.post(
  "/charging-sessions/:sessionId/send-receipt",
  markGuestReadPolicy,
  requireChargingSessionOwnerOrAdmin,
  receiptEmailRateLimit,
  async (req, res) => {
  const session = (req as any).chargingSession;
  const sessionId = session.id as number;
  // Deliberately ignore every client-supplied recipient field. Delivery always
  // uses the email stored on the authorized charging-session record.
  const marker = `[charging-receipt:session-${sessionId}]`;
  const invoicesRaw = await db.query.invoicesTable.findMany({
    with: { items: true },
    where: (t, { like }) => like(t.notes, `%${marker}%`),
  });

  let invoiceData;
  if (invoicesRaw.length > 0) {
    const inv = invoicesRaw[0];
    invoiceData = {
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      businessName: inv.businessName,
      businessEmail: inv.businessEmail,
      dueDate: inv.dueDate.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      notes: inv.notes,
      totalAmount: inv.items.reduce((s, i) => s + parseFloat(String(i.amount)), 0),
      items: inv.items.map((item) => ({
        description: item.description,
        quantity: parseFloat(String(item.quantity)),
        unitPrice: parseFloat(String(item.unitPrice)),
        amount: parseFloat(String(item.amount)),
      })),
    };
  } else {
    const totalAmount = session.amountCents / 100;
    invoiceData = {
      invoiceNumber: `CHG-SESSION-${sessionId}`,
      status: session.status === "completed" ? "paid" : "pending",
      businessName: session.driverName,
      businessEmail: session.driverEmail,
      dueDate: (session.completedAt ?? new Date()).toISOString(),
      createdAt: new Date().toISOString(),
      notes: null,
      totalAmount,
      items: [{
        description: `EV Charging Session #${sessionId} — ${session.kwh.toFixed(2)} kWh`,
        quantity: session.kwh,
        unitPrice: totalAmount / session.kwh,
        amount: totalAmount,
      }],
    };
  }

  const html = buildInvoiceEmailHtml(invoiceData, true);
  const result = await sendEmail({
    to: session.driverEmail,
    subject: `Your ChargeBridge charging receipt — ${invoiceData.invoiceNumber}`,
    html,
    replyTo: "support@chargebridge.app",
  });

  logger.info({ sessionId, ok: result.ok }, "Receipt email requested");
  return res.json({
    ok: result.ok,
    message: result.ok ? "Receipt sent" : "Receipt could not be sent",
  });
});

export default router;
