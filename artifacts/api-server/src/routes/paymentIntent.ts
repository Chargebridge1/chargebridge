import { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { randomBytes } from "crypto";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { chargingSessionsTable, stationsTable, usersTable, stripeRefundJobsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "../lib/logger";
import { getPricingConfig } from "./pricing";
import { remoteStartTransaction, remoteStopTransaction, broadcastStationEvent } from "../lib/ocppCsms";
import { requireAuth, requireChargingSessionOwnerOrAdmin, isAdmin } from "../middlewares/requireAuth";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { recordSessionEvent } from "../lib/sessionEvents";
import { track, hashId } from "../lib/analyticsServer";
import { recordSessionConnectorAffinity } from "../lib/connectorAffinity";

const router = Router();

// POST /stations/:id/payment-intent — 60 per hour per IP
const paymentIntentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many payment requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /sessions/:id/start-charging — 30 per hour per IP
const startChargingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many start-charging requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Card setup creates Stripe resources, so limit it before any customer lookup.
// Authentication runs first so one identity cannot evade its quota by
// rotating IP addresses.
const setupIntentUserRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `user:${(req as any).clerkUserId as string}`,
  message: { error: "Too many card setup requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const setupIntentIpRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many card setup requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Stripe publishable key (safe to expose) ──────────────────────────────────
router.get("/stripe/config", (_req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return res.status(503).json({ error: "Stripe not configured" });
  }
  return res.json({ publishableKey });
});

// ── Create a PaymentIntent for in-app payment (no redirect) ──────────────────
router.post("/stations/:stationId/payment-intent", paymentIntentRateLimit, async (req, res) => {
  // The legacy payment-intent path has no locked Charging Attempt/quote
  // binding. Keep it closed in every runtime environment until replacement.
  // The test runner retains its mocked legacy-flow coverage; it must never be
  // used as a deployed runtime configuration.
  if (process.env.NODE_ENV !== "test") {
    return res.status(503).json({
      code: "CHARGING_PAYMENT_NOT_READY",
      error: "Charging payment is unavailable while durable attempt recovery is completed.",
    });
  }
  const stationId = Number(req.params.stationId);
  if (isNaN(stationId)) return res.status(400).json({ error: "Invalid station ID" });

  const { driverEmail, driverName, kwh, chargeMode } = req.body;
  if (!driverEmail || !driverName || !kwh || kwh <= 0) {
    return res.status(400).json({ error: "driverEmail, driverName, and kwh (>0) are required" });
  }

  const [station] = await db.select().from(stationsTable).where(eq(stationsTable.id, stationId));
  if (!station) return res.status(404).json({ error: "Station not found" });
  if (station.status === "offline") return res.status(400).json({ error: "Station is offline" });

  const kwhNum = parseFloat(kwh);
  const energyCents = Math.round(station.pricePerKwh * kwhNum * 100);

  const pricing = await getPricingConfig();
  let platformFeeCents = 0;
  if (pricing.platformFeeEnabled) {
    platformFeeCents = Math.round(energyCents * (pricing.platformFeePercent / 100)) + pricing.platformFeeFlatCents;
  }
  const totalCents = energyCents + platformFeeCents;

  if (totalCents < 50) {
    return res.status(400).json({ error: "Amount too small (minimum $0.50)" });
  }

  const stripe = await getUncachableStripeClient();

  // ── Saved payment methods: only for authenticated Clerk users ─────────────
  // Guest checkout (unauthenticated) always proceeds without a customer so
  // that an attacker cannot supply another person's email to obtain an
  // ephemeral key for their Stripe Customer.
  let stripeCustomerId: string | undefined;
  let ephemeralKeySecret: string | undefined;
  const clerkUserId = getAuth(req as any)?.userId ?? null;
  if (clerkUserId) {
    try {
      let user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, clerkUserId),
      });

      let customerId = user?.stripeCustomerId ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: driverEmail,
          name: driverName,
          metadata: { clerkUserId },
        });
        customerId = customer.id;
        await db
          .insert(usersTable)
          .values({ clerkId: clerkUserId, email: driverEmail.toLowerCase(), name: driverName, stripeCustomerId: customerId })
          .onConflictDoUpdate({
            target: usersTable.clerkId,
            set: { stripeCustomerId: customerId },
          });
        req.log.info({ customerId, clerkUserId }, "Created Stripe customer for authenticated user");
      } else {
        req.log.info({ customerId, clerkUserId }, "Reusing existing Stripe customer for authenticated user");
      }

      stripeCustomerId = customerId;
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion: "2023-10-16" }
      );
      ephemeralKeySecret = ephemeralKey.secret;
    } catch (err) {
      req.log.warn({ err }, "Could not set up Stripe customer — proceeding without saved payment methods");
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    ...(stripeCustomerId ? {
      customer: stripeCustomerId,
      setup_future_usage: "off_session" as const,
    } : {}),
    receipt_email: driverEmail,
    description: `ChargeBridge — ${kwhNum.toFixed(2)} kWh at ${station.name}`,
    metadata: {
      stationId: String(stationId),
      stationName: station.name,
      driverName,
      driverEmail,
      kwh: String(kwhNum),
      chargeMode: chargeMode ?? "kwh",
      platformFeeCents: String(platformFeeCents),
    },
  });

  // Generate a guest token (returned once) so unauthenticated users can stop their session.
  // We store only the SHA-256 hash — the plaintext token is never persisted.
  let guestToken: string | undefined;
  let guestTokenHash: string | undefined;
  if (!clerkUserId) {
    const rawToken = randomBytes(32).toString("hex");
    guestTokenHash = createHash("sha256").update(rawToken).digest("hex");
    guestToken = rawToken;
  }

  const [session] = await db
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
      paymentState: "authorized",
      stripePaymentIntentId: paymentIntent.id,
      clerkUserId: clerkUserId ?? null,
      guestTokenHash: guestTokenHash ?? null,
    })
    .returning();

  await recordSessionEvent(db, session.id, "payment_authorized", {
    paymentIntentId: paymentIntent.id,
    amountCents: totalCents,
  });

  req.log.info({ sessionId: session.id, stationId, totalCents }, "PaymentIntent created for in-app payment");
  track("payment_intent_created", clerkUserId, {
    station_id: String(stationId),
    amount_usd: totalCents / 100,
  });

  return res.json({
    clientSecret: paymentIntent.client_secret,
    sessionId: session.id,
    amountCents: totalCents,
    energyCents,
    platformFeeCents,
    ...(stripeCustomerId ? { customerId: stripeCustomerId } : {}),
    ...(ephemeralKeySecret ? { ephemeralKeySecret } : {}),
    // guestToken returned once — client must store it to stop the session later
    ...(guestToken ? { guestToken } : {}),
  });
});

// ── Start charging — requires session ownership or guest token ────────────────
router.post("/sessions/:id/start-charging", startChargingRateLimit, requireChargingSessionOwnerOrAdmin, async (req, res) => {
  // Session was loaded and ownership verified by the middleware
  const session = (req as any).chargingSession;

  // Verify payment intent status with Stripe (server-side, cannot be spoofed)
  if (session.stripePaymentIntentId) {
    const stripe = await getUncachableStripeClient();
    const pi = await stripe.paymentIntents.retrieve(session.stripePaymentIntentId);
    if (pi.status !== "succeeded") {
      return res.status(402).json({ error: `Payment not confirmed (status: ${pi.status})` });
    }
  }

  // Mark session completed and payment captured
  await db
    .update(chargingSessionsTable)
    .set({ status: "completed", paymentState: "captured", completedAt: new Date() })
    .where(eq(chargingSessionsTable.id, session.id));

  await recordSessionEvent(db, session.id, "payment_captured", {
    source: "start_charging",
    paymentIntentId: session.stripePaymentIntentId,
  });

  // Attempt OCPP remote start (non-fatal)
  let ocppResult: { accepted: boolean; message: string } = { accepted: false, message: "OCPP not available" };
  try {
    if (session.stationId != null) {
      ocppResult = await remoteStartTransaction(session.stationId, "CHARGEBRIDGE", 1, session.id);
    }
    req.log.info({ sessionId: session.id, stationId: session.stationId, ocppResult }, "OCPP remote start after in-app payment");
  } catch (err) {
    req.log.warn({ err }, "OCPP remote start failed (non-fatal)");
  }

  // Payment captured but charger rejected — queue a refund job so the driver
  // is not charged for energy that was never delivered.
  if (!ocppResult.accepted && session.stripePaymentIntentId) {
    const idempotencyKey = `charger_rejected_refund_session_${session.id}`;
    try {
      await db
        .insert(stripeRefundJobsTable)
        .values({
          sessionId: session.id,
          paymentIntentId: session.stripePaymentIntentId,
          idempotencyKey,
          reason: "charger rejected remote start after payment captured",
        })
        .onConflictDoNothing();
      await recordSessionEvent(db, session.id, "charger_rejected_after_payment", {
        ocppMessage: ocppResult.message,
        idempotencyKey,
      });
      req.log.warn(
        { sessionId: session.id, stationId: session.stationId, ocppMessage: ocppResult.message },
        "Start-charging: charger rejected after payment captured — refund job queued"
      );
    } catch (err) {
      req.log.error(
        { err, sessionId: session.id },
        "Start-charging: failed to queue charger-rejection refund job — MANUAL REFUND REQUIRED"
      );
    }
  }

  return res.json({ ok: true, ocppStarted: ocppResult.accepted, message: ocppResult.message });
});

// ── Stop charging — requires session ownership or guest token ─────────────────
router.post("/sessions/:id/stop-charging", requireChargingSessionOwnerOrAdmin, async (req, res) => {
  const session = (req as any).chargingSession;

  // If the session is still `pending` (payment made but charging never
  // properly started / OCPP start not confirmed), transition it to `stopping`
  // so the orphan sweeper knows this is an intentional in-progress stop and
  // does not race to mark it `failed`. The session will be resolved to `failed`
  // by the OCPP CSMS when the StopTransaction confirmation arrives, or by the
  // sweeper's stopping-timeout pass if no confirmation comes.
  //
  // Sessions already in `completed` (normal charging) stay as-is — the OCPP
  // stop command will advance the charger state independently.
  if (session.status === "pending") {
    await db
      .update(chargingSessionsTable)
      .set({ status: "stopping", stopInitiatedAt: new Date() })
      .where(eq(chargingSessionsTable.id, session.id));

    req.log.info(
      { sessionId: session.id, stationId: session.stationId },
      "Stop-charging: pending session marked stopping before OCPP remote stop"
    );
  }

  let ocppResult: { accepted: boolean; message: string } = { accepted: false, message: "OCPP not available" };
  try {
    if (session.stationId != null) {
      ocppResult = await remoteStopTransaction(session.stationId, session.id);
    }
    req.log.info({ sessionId: session.id, stationId: session.stationId, ocppResult }, "OCPP remote stop requested");
  } catch (err) {
    req.log.warn({ err }, "OCPP remote stop failed (non-fatal)");
  }

  return res.json({ ok: true, ocppStopped: ocppResult.accepted, message: ocppResult.message });
});

// ── Force-stop a session — station owner or admin, no guest token required ────
// Lets an owner/admin terminate any orphaned or stuck session on their station
// even when the guest token is lost or expired. Updates the session to failed
// and sends a remote stop so the physical charger is released.
router.post("/sessions/:id/force-stop", async (req, res) => {
  const auth = getAuth(req as any);
  if (!auth?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid session ID" });
  }

  const [session] = await db
    .select()
    .from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.id, id))
    .limit(1);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Admins can force-stop any session
  const admin = isAdmin(auth);
  if (!admin) {
    // Non-admins must own the station tied to this session
    if (session.stationId == null) {
      return res.status(403).json({ error: "Forbidden — station has been deleted; admin required to force-stop" });
    }
    const [station] = await db
      .select({ ownerClerkUserId: stationsTable.ownerClerkUserId })
      .from(stationsTable)
      .where(eq(stationsTable.id, session.stationId))
      .limit(1);

    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }
    if (!station.ownerClerkUserId || station.ownerClerkUserId !== auth.userId) {
      return res.status(403).json({ error: "Forbidden — you must own this station to force-stop a session" });
    }
  }

  // ── Mark session failed immediately — before any Stripe or OCPP calls ────────
  // Doing this first eliminates a race where the Stripe webhook fires while this
  // route is awaiting a Stripe API call: the webhook reads the session as "failed"
  // and can then take the correct refund path instead of treating it as a normal
  // completed session. Any subsequent Stripe/OCPP errors are non-fatal.
  await db
    .update(chargingSessionsTable)
    .set({ status: "failed" })
    .where(eq(chargingSessionsTable.id, session.id));

  req.log.info({ sessionId: session.id, stationId: session.stationId, admin }, "Force-stop: session marked failed");

  // Notify all live SSE subscribers on this station immediately so other devices
  // (owner's second tab, driver's screen) refetch the session list without waiting
  // for their 30-second polling interval.
  if (session.stationId != null) {
    broadcastStationEvent(session.stationId, "session_force_stopped", { sessionId: session.id });
  }

  // ── Cancel the Stripe PaymentIntent to prevent a phantom charge ──────────────
  // Only runs when Stripe is configured and the session has an associated intent.
  // Outcome meanings:
  //   "cancelled"          — intent was not yet charged; successfully cancelled
  //   "already_succeeded"  — charge already captured; auto-refund issued
  //   "processing"         — Stripe is processing the charge; cannot cancel now;
  //                          the payment_intent.succeeded webhook will auto-refund
  //                          if the charge completes (it will see status = "failed")
  //   "already_cancelled"  — intent was already in a terminal cancelled state
  //   "no_intent"          — session had no PaymentIntent (cash/offline charge)
  //   "stripe_unavailable" — Stripe API error; manual review required
  //
  // Idempotency key for refunds: "force_stop_refund_session_{id}" — shared with
  // the webhook refund path so Stripe deduplicates if both paths fire at once.
  let stripeOutcome:
    | "cancelled"
    | "already_succeeded"
    | "refund_failed"
    | "processing"
    | "already_cancelled"
    | "no_intent"
    | "stripe_unavailable" = "no_intent";

  if (session.stripePaymentIntentId) {
    try {
      const stripe = await getUncachableStripeClient();
      const pi = await stripe.paymentIntents.retrieve(session.stripePaymentIntentId);

      if (
        pi.status === "requires_capture" ||
        pi.status === "requires_confirmation" ||
        pi.status === "requires_payment_method" ||
        pi.status === "requires_action"
      ) {
        // Safe to cancel — no charge has occurred yet
        await stripe.paymentIntents.cancel(session.stripePaymentIntentId);
        req.log.info(
          { sessionId: session.id, paymentIntentId: session.stripePaymentIntentId, piStatus: pi.status },
          "Force-stop: PaymentIntent cancelled to prevent double-charge"
        );
        stripeOutcome = "cancelled";
        await db
          .update(chargingSessionsTable)
          .set({ paymentState: "failed" })
          .where(eq(chargingSessionsTable.id, session.id));
        await recordSessionEvent(db, session.id, "payment_cancelled", {
          source: "force_stop",
          piStatus: pi.status,
          paymentIntentId: session.stripePaymentIntentId,
        });
      } else if (pi.status === "succeeded") {
        // Charge already captured — issue an automatic full refund so the driver
        // is not charged for a session that was force-stopped.
        // The idempotency key is shared with the webhook path so Stripe deduplicates
        // if both paths race to issue the refund for the same session.
        const idempotencyKey = `force_stop_refund_session_${session.id}`;
        const refundReason = "force-stop: session terminated before energy delivery confirmed";
        try {
          const refund = await stripe.refunds.create(
            {
              payment_intent: session.stripePaymentIntentId,
              reason: "fraudulent",
              metadata: { sessionId: String(session.id), reason: refundReason },
            },
            { idempotencyKey }
          );
          // Persist the refund ID so operators can trace it in the admin panel
          await db
            .update(chargingSessionsTable)
            .set({ stripeRefundId: refund.id })
            .where(eq(chargingSessionsTable.id, session.id));
          req.log.warn(
            { sessionId: session.id, paymentIntentId: session.stripePaymentIntentId, refundId: refund.id },
            "Force-stop: PaymentIntent already succeeded — automatic full refund issued"
          );
          stripeOutcome = "already_succeeded";
          await db
            .update(chargingSessionsTable)
            .set({ paymentState: "refunded" })
            .where(eq(chargingSessionsTable.id, session.id));
          await recordSessionEvent(db, session.id, "payment_refunded", {
            source: "force_stop",
            refundId: refund.id,
            paymentIntentId: session.stripePaymentIntentId,
          });
        } catch (refundErr) {
          // Immediate refund failed — queue a durable job so the sweeper retries
          // with exponential backoff until Stripe accepts it.
          try {
            await db
              .insert(stripeRefundJobsTable)
              .values({
                sessionId: session.id,
                paymentIntentId: session.stripePaymentIntentId,
                idempotencyKey,
                reason: refundReason,
              })
              .onConflictDoNothing();
          } catch (dbErr) {
            req.log.error(
              { dbErr, sessionId: session.id, paymentIntentId: session.stripePaymentIntentId },
              "Force-stop: failed to queue refund job — MANUAL REFUND REQUIRED"
            );
          }
          req.log.error(
            { refundErr, sessionId: session.id, paymentIntentId: session.stripePaymentIntentId },
            "Force-stop: immediate refund failed — queued for retry by refund sweeper"
          );
          stripeOutcome = "refund_failed";
        }
      } else if (pi.status === "processing") {
        // Stripe is actively processing the charge — cancellation is not possible.
        // Because we already marked the session "failed" above, the webhook handler
        // for payment_intent.succeeded will see status = "failed" and auto-refund.
        req.log.warn(
          { sessionId: session.id, paymentIntentId: session.stripePaymentIntentId },
          "Force-stop: PaymentIntent is processing — cannot cancel; webhook will auto-refund if charge succeeds"
        );
        stripeOutcome = "processing";
      } else {
        // "canceled" (Stripe terminal state) — nothing to do
        req.log.info(
          { sessionId: session.id, paymentIntentId: session.stripePaymentIntentId, piStatus: pi.status },
          "Force-stop: PaymentIntent already in terminal cancelled state — no action needed"
        );
        stripeOutcome = "already_cancelled";
        await db
          .update(chargingSessionsTable)
          .set({ paymentState: "failed" })
          .where(eq(chargingSessionsTable.id, session.id));
        await recordSessionEvent(db, session.id, "payment_cancelled", {
          source: "force_stop",
          piStatus: pi.status,
          paymentIntentId: session.stripePaymentIntentId,
        });
      }
    } catch (err) {
      // Stripe is unavailable or the key is missing. We cannot determine whether
      // the PI was captured or not, so we enqueue a durable "reconcile" job.
      // The sweeper will re-fetch PI state when Stripe is available and then
      // cancel (if uncaptured) or refund (if captured) automatically.
      const reconcileKey = `reconcile_session_${session.id}`;
      try {
        await db
          .insert(stripeRefundJobsTable)
          .values({
            sessionId: session.id,
            paymentIntentId: session.stripePaymentIntentId,
            idempotencyKey: reconcileKey,
            reason: "force-stop: Stripe was unavailable at stop time; reconciling PI state",
            jobType: "reconcile",
          })
          .onConflictDoNothing();
        req.log.error(
          { err, sessionId: session.id, paymentIntentId: session.stripePaymentIntentId },
          "Force-stop: Stripe unavailable — reconcile job queued; sweeper will cancel or refund when Stripe is reachable"
        );
      } catch (dbErr) {
        req.log.error(
          { err, dbErr, sessionId: session.id, paymentIntentId: session.stripePaymentIntentId },
          "Force-stop: Stripe unavailable AND failed to queue reconcile job — MANUAL REVIEW REQUIRED"
        );
      }
      stripeOutcome = "stripe_unavailable";
    }
  }

  // Attempt OCPP remote stop (non-fatal — session already marked failed above)
  let ocppResult: { accepted: boolean; message: string } = { accepted: false, message: "OCPP not available" };
  try {
    if (session.stationId != null) {
      ocppResult = await remoteStopTransaction(session.stationId);
    }
    req.log.info({ sessionId: session.id, stationId: session.stationId, ocppResult }, "Force-stop: remote stop sent");
  } catch (err) {
    req.log.warn({ err, sessionId: session.id }, "Force-stop: remote stop failed (non-fatal)");
  }

  req.log.info({ sessionId: session.id, stationId: session.stationId, admin, stripeOutcome }, "Force-stop: complete");

  return res.json({
    ok: true,
    ocppStopped: ocppResult.accepted,
    message: ocppResult.message,
    stripeOutcome,
    refundIssued: stripeOutcome === "already_succeeded",
  });
});

// ── Create a SetupIntent so the mobile app can save a card via PaymentSheet ───
router.post(
  "/setup-intent",
  requireAuth,
  setupIntentUserRateLimit,
  setupIntentIpRateLimit,
  async (req, res) => {
    const clerkUserId = (req as any).clerkUserId;

    try {
      let stripeClient: Awaited<ReturnType<typeof getUncachableStripeClient>> | undefined;
      const getStripe = async () => {
        stripeClient ??= await getUncachableStripeClient();
        return stripeClient;
      };

      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkUserId) });
      let customerId = user?.stripeCustomerId ?? null;

      if (!customerId) {
        let profileUnavailable = false;
        const provisionedCustomerId = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(731204, hashtext(${clerkUserId}))`);

          const [lockedUser] = await tx
            .select({ stripeCustomerId: usersTable.stripeCustomerId })
            .from(usersTable)
            .where(eq(usersTable.clerkId, clerkUserId))
            .limit(1);
          if (lockedUser?.stripeCustomerId) return lockedUser.stripeCustomerId;

          const clerkUser = await clerkClient.users.getUser(clerkUserId);
          const primaryEmail = clerkUser.emailAddresses.find(
            (email) => email.id === clerkUser.primaryEmailAddressId,
          );
          const verifiedEmail =
            primaryEmail?.verification?.status === "verified"
              ? primaryEmail.emailAddress.trim().toLowerCase()
              : "";

          if (!verifiedEmail) {
            profileUnavailable = true;
            return null;
          }

          const verifiedName = clerkUser.fullName?.trim() || null;
          const customerParams = {
            email: verifiedEmail,
            ...(verifiedName ? { name: verifiedName } : {}),
            metadata: { clerkUserId },
          };
          const customer = await (await getStripe()).customers.create(customerParams, {
            idempotencyKey: `saved-card-customer-${createHash("sha256").update(clerkUserId).digest("hex")}`,
          });
          const resolvedCustomerId = customer.id;

          await tx
            .insert(usersTable)
            .values({
              clerkId: clerkUserId,
              email: verifiedEmail,
              name: verifiedName,
              stripeCustomerId: resolvedCustomerId,
            })
            .onConflictDoUpdate({
              target: usersTable.clerkId,
              set: {
                stripeCustomerId: resolvedCustomerId,
                email: verifiedEmail,
                name: verifiedName,
              },
            });

          return resolvedCustomerId;
        });
        if (!provisionedCustomerId && profileUnavailable) {
          return res.status(503).json({
            code: "SAVED_CARD_PROFILE_UNVERIFIED",
            error: "A verified primary account email is required for saved-card setup.",
          });
        }
        if (!provisionedCustomerId) {
          throw new Error("Stripe customer provisioning returned no customer ID");
        }
        customerId = provisionedCustomerId;
        req.log.info({ customerId, clerkUserId }, "Created Stripe customer for setup intent");
      }

      const stripe = await getStripe();
      const [ephemeralKey, setupIntent] = await Promise.all([
        stripe.ephemeralKeys.create({ customer: customerId }, { apiVersion: "2023-10-16" }),
        stripe.setupIntents.create({ customer: customerId, usage: "off_session" }),
      ]);

      return res.json({
        setupIntentClientSecret: setupIntent.client_secret,
        customerId,
        ephemeralKeySecret: ephemeralKey.secret,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to create setup intent");
      return res.status(500).json({ error: "Failed to create setup intent" });
    }
  },
);

// ── List saved Stripe payment methods for authenticated user ──────────────────
router.get("/payment-methods", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId;

  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkUserId) });
    if (!user?.stripeCustomerId) {
      return res.json({ methods: [] });
    }

    const stripe = await getUncachableStripeClient();
    const stripeResult = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: "card",
    });

    return res.json({
      methods: stripeResult.data.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand ?? "card",
        last4: pm.card?.last4 ?? "****",
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list payment methods");
    return res.status(500).json({ error: "Failed to list payment methods" });
  }
});

// ── Detach a saved Stripe payment method for authenticated user ───────────────
router.delete("/payment-methods/:id", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId;
  const pmId = String(req.params.id);

  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkUserId) });
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: "No billing account found" });
    }

    const stripe = await getUncachableStripeClient();

    // Verify the payment method belongs to this customer before detaching so
    // a user cannot detach another user's payment method by guessing IDs.
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== user.stripeCustomerId) {
      return res.status(403).json({ error: "Payment method does not belong to this account" });
    }

    await stripe.paymentMethods.detach(pmId);
    req.log.info({ pmId, clerkUserId }, "Payment method detached");
    return res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Failed to detach payment method");
    if (err?.statusCode === 404) {
      return res.status(404).json({ error: "Payment method not found" });
    }
    return res.status(500).json({ error: "Failed to remove payment method" });
  }
});

export default router;
