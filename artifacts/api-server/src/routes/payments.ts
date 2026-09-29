import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { db } from "@workspace/db";
import { chargingSessionsTable, stationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { getPricingConfig } from "./pricing";
import {
  requireChargingSessionOwnerOrAdmin,
  requireStationOwnerOrAdmin,
} from "../middlewares/requireAuth";
import { recordSessionEvent } from "../lib/sessionEvents";

const router = Router();
const markGuestReadPolicy = (req: any, _res: any, next: any) => {
  req.guestReadPolicy = true;
  next();
};

function getBaseUrl(req: any): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domains) return `https://${domains}`;
  return `${req.protocol}://${req.get("host")}`;
}

router.post("/stations/:stationId/checkout", async (req, res) => {
  // Phase 1B: the existing guest path does not bind a durable Attempt ID,
  // immutable quote and payment creation request before calling Stripe.
  // Keep it closed in every runtime environment until that integration is
  // verified. Only the test runner exercises the mocked legacy flow.
  if (process.env.NODE_ENV !== "test") {
    return res.status(503).json({
      code: "CHARGING_CHECKOUT_NOT_READY",
      error: "Charging checkout is unavailable while payment retry and verification safeguards are completed.",
    });
  }
  const stationId = Number(req.params.stationId);
  if (isNaN(stationId)) return res.status(400).json({ error: "Invalid station ID" });

  const { driverEmail, driverName, kwh, chargeMode, successPath, cancelPath } = req.body;

  if (!driverEmail || !driverName || !kwh || kwh <= 0) {
    return res.status(400).json({ error: "driverEmail, driverName, and kwh (>0) are required" });
  }

  const [station] = await db.select().from(stationsTable).where(eq(stationsTable.id, stationId));
  if (!station) return res.status(404).json({ error: "Station not found" });

  const kwhNum = parseFloat(kwh);
  const amountCents = Math.round(station.pricePerKwh * kwhNum * 100);
  if (amountCents < 50) {
    return res.status(400).json({ error: "Amount too small (minimum $0.50)" });
  }

  const modeLabel = chargeMode === "time" ? "by time" : chargeMode === "dollars" ? "by dollar amount" : "by kWh";
  const stripe = await getUncachableStripeClient();
  const baseUrl = getBaseUrl(req);

  const pricing = await getPricingConfig();
  let platformFeeCents = 0;
  if (pricing.platformFeeEnabled) {
    platformFeeCents = Math.round(amountCents * (pricing.platformFeePercent / 100)) + pricing.platformFeeFlatCents;
  }
  const totalCents = amountCents + platformFeeCents;

  // Returned once to the initiating browser. Only the hash is persisted.
  const guestToken = randomBytes(32).toString("hex");
  const guestTokenHash = createHash("sha256").update(guestToken).digest("hex");

  const [session_db] = await db
    .insert(chargingSessionsTable)
    .values({
      stationId,
      stationName: station.name,
      driverEmail,
      driverName,
      kwh: kwhNum,
      amountCents: totalCents,
      currency: "usd",
      status: "pending",
      paymentState: "pending",
      guestTokenHash,
    })
    .returning();

  const lineItems: any[] = [
    {
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `Charging session at ${station.name}`,
          description: `${kwhNum.toFixed(2)} kWh @ $${station.pricePerKwh.toFixed(3)}/kWh (${modeLabel})`,
        },
      },
      quantity: 1,
    },
  ];

  if (platformFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: platformFeeCents,
        product_data: {
          name: "ChargeBridge platform fee",
          description: `${pricing.platformFeePercent > 0 ? `${pricing.platformFeePercent}% ` : ""}${pricing.platformFeeFlatCents > 0 ? `+ $${(pricing.platformFeeFlatCents / 100).toFixed(2)} flat` : ""}`.trim(),
        },
      },
      quantity: 1,
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    customer_email: driverEmail,
    line_items: lineItems,
    mode: "payment",
    success_url: `${baseUrl}${successPath ?? `/stations/${stationId}`}?payment=success&session=${session_db.id}`,
    cancel_url: `${baseUrl}${cancelPath ?? `/stations/${stationId}`}?payment=cancelled`,
    metadata: {
      chargingSessionId: String(session_db.id),
      stationId: String(stationId),
      platformFeeCents: String(platformFeeCents),
    },
  });

  await db
    .update(chargingSessionsTable)
    .set({ stripeCheckoutSessionId: checkoutSession.id, paymentState: "authorized" })
    .where(eq(chargingSessionsTable.id, session_db.id));

  await recordSessionEvent(db, session_db.id, "payment_authorized", {
    checkoutSessionId: checkoutSession.id,
    amountCents: totalCents,
  });

  req.log.info({ sessionId: session_db.id, stationId }, "Checkout session created");
  return res.json({ url: checkoutSession.url, sessionId: session_db.id, guestToken });
});

router.get("/stations/:stationId/sessions", requireStationOwnerOrAdmin, async (req, res) => {
  const stationId = Number(req.params.stationId);
  const statusFilter = req.query.status as string | undefined;
  const conditions = [eq(chargingSessionsTable.stationId, stationId)];

  if (statusFilter) {
    conditions.push(
      eq(
        chargingSessionsTable.status,
        statusFilter as "pending" | "stopping" | "completed" | "failed" | "refunded"
      )
    );
  }

  const sessions = await db
    .select()
    .from(chargingSessionsTable)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(chargingSessionsTable.createdAt))
    .limit(50);

  return res.json(sessions.map((s) => ({
    id: s.id,
    stationId: s.stationId,
    status: s.status,
    paymentState: s.paymentState,
    chargingState: s.chargingState,
    kwh: s.kwh,
    amountCents: s.amountCents,
    amountUsd: (s.amountCents / 100).toFixed(2),
    currency: s.currency,
    createdAt: s.createdAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
  })));
});

router.get("/sessions/:id", markGuestReadPolicy, requireChargingSessionOwnerOrAdmin, async (req, res) => {
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

export default router;
