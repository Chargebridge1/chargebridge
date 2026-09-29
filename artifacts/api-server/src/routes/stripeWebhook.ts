import express, { Router } from "express";
import { db } from "@workspace/db";
import { chargingSessionsTable, stationsTable, invoicesTable, invoiceItemsTable, stripeEventsTable, stripeRefundJobsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "../lib/logger";
import { remoteStartTransaction } from "../lib/ocppCsms";
import { recordSessionEvent } from "../lib/sessionEvents";
import { track, hashId } from "../lib/analyticsServer";
import { recordSessionConnectorAffinity } from "../lib/connectorAffinity";
import { getMembershipPlanForSubscriptionPrices } from "../lib/membershipCatalog";

const router = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function generateReceiptNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `CHG-${year}${month}-${rand}`;
}

async function createChargingInvoice(tx: Tx, sessionId: number) {
  const [session] = await tx
    .select()
    .from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.id, sessionId));
  if (!session) return;

  if (session.stationId == null) return;
  const [station] = await tx
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, session.stationId));
  if (!station) return;

  const totalAmount = session.amountCents / 100;
  const unitPrice = station.pricePerKwh;
  const dueDate = new Date();

  // Use ON CONFLICT DO NOTHING on charging_session_id so that a Stripe webhook
  // retry (after a timeout that rolled back the previous transaction) does not
  // create a second invoice for the same session.
  const [invoice] = await tx
    .insert(invoicesTable)
    .values({
      invoiceNumber: generateReceiptNumber(),
      businessName: session.driverName,
      businessEmail: session.driverEmail,
      ownerClerkId: session.clerkUserId ?? null,
      status: "paid",
      dueDate,
      notes: `[charging-receipt:session-${session.id}] Auto-generated receipt · ${station.name} · Stripe payment confirmed`,
      chargingSessionId: session.id,
    })
    .onConflictDoNothing()
    .returning();

  if (!invoice) {
    logger.info({ sessionId }, "Invoice already exists for session — skipping duplicate (webhook retry)");
    return;
  }

  await tx.insert(invoiceItemsTable).values({
    invoiceId: invoice.id,
    description: `EV Charging at ${station.name} — ${session.kwh.toFixed(2)} kWh`,
    quantity: String(session.kwh.toFixed(2)),
    unitPrice: String(unitPrice.toFixed(4)),
    amount: String(totalAmount.toFixed(2)),
  });

  logger.info({ invoiceId: invoice.id, sessionId }, "Payment receipt invoice created");
}

function stripeReferenceId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

function stripeTimestamp(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateFromDatabase(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

/**
 * Store a non-mutating, append-only decision record for each unique
 * subscription event. Subscription/customer ownership and the approved Price
 * are checked against current local records, but a Checkout Session operation
 * association is not currently available to verify; therefore every event
 * remains quarantined and no entitlement is granted or revoked here.
 */
async function recordSubscriptionReconciliationEvent(
  tx: Tx,
  event: any,
): Promise<void> {
  const subscription = event?.data?.object;
  const subscriptionId = stripeReferenceId(subscription?.id);
  const customerId = stripeReferenceId(subscription?.customer);
  const rawItems: any[] = Array.isArray(subscription?.items?.data)
    ? subscription.items.data
    : [];
  const items = rawItems.map((item: any) => ({
    stripeItemId: stripeReferenceId(item?.id),
    priceId: stripeReferenceId(item?.price),
    quantity: numberOrNull(item?.quantity),
  }));
  const priceIds: Array<string | null> = items.map(
    (item: { priceId: string | null }) => item.priceId,
  );
  const plan = getMembershipPlanForSubscriptionPrices(priceIds);
  const eventCreatedAt = stripeTimestamp(event?.created);
  const receivedAt = new Date();
  const objectType = stringOrNull(subscription?.object);
  const validEventObject =
    typeof event?.type === "string" &&
    event.type.startsWith("customer.subscription.") &&
    objectType === "subscription" &&
    subscriptionId !== null;

  let previousEventCreatedAt: Date | null = null;
  if (subscriptionId) {
    // Serialize deliveries for a given subscription, including the first
    // delivery when no journal row exists yet.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${subscriptionId}))`,
    );
    const previousResult = await tx.execute(
      sql`SELECT event_created_at
          FROM subscription_reconciliation_events
          WHERE stripe_subscription_id = ${subscriptionId}
          ORDER BY event_created_at DESC NULLS LAST, received_at DESC
          LIMIT 1
          FOR UPDATE`,
    );
    const previousRows = Array.isArray(previousResult)
      ? previousResult
      : (previousResult as { rows?: unknown[] })?.rows ?? [];
    previousEventCreatedAt = dateFromDatabase(
      (previousRows[0] as { event_created_at?: unknown } | undefined)
        ?.event_created_at,
    );
  }

  const outOfOrder =
    eventCreatedAt !== null &&
    previousEventCreatedAt !== null &&
    eventCreatedAt.getTime() <= previousEventCreatedAt.getTime();

  const owners = customerId
    ? await tx
        .select({
          clerkId: usersTable.clerkId,
          stripeCustomerId: usersTable.stripeCustomerId,
          stripeSubscriptionId: usersTable.stripeSubscriptionId,
        })
        .from(usersTable)
        .where(eq(usersTable.stripeCustomerId, customerId))
    : [];
  const owner = owners.length === 1 ? owners[0] : null;
  const existingSubscription =
    owner !== null && owner.stripeSubscriptionId === subscriptionId;
  const hasConflictingSubscription =
    owner !== null &&
    typeof owner.stripeSubscriptionId === "string" &&
    owner.stripeSubscriptionId.length > 0 &&
    owner.stripeSubscriptionId !== subscriptionId;

  const reconciliationReasons: string[] = [];
  if (!validEventObject) reconciliationReasons.push("invalid_subscription_event_object");
  if (!eventCreatedAt) reconciliationReasons.push("invalid_event_created_timestamp");
  if (!subscriptionId) reconciliationReasons.push("missing_subscription_id");
  if (!customerId) reconciliationReasons.push("missing_customer_id");
  if (priceIds.length !== 1 || !plan) {
    reconciliationReasons.push(
      priceIds.length === 0 || priceIds.some((priceId) => priceId === null)
        ? "missing_price"
        : priceIds.length > 1
          ? "multiple_prices"
          : "unmapped_price",
    );
  }
  if (customerId && owners.length === 0) {
    reconciliationReasons.push("stripe_customer_has_no_local_owner");
  } else if (owners.length > 1) {
    reconciliationReasons.push("stripe_customer_has_ambiguous_local_owners");
  }
  if (existingSubscription) {
    reconciliationReasons.push("existing_subscription_preserved");
  } else if (hasConflictingSubscription) {
    reconciliationReasons.push("customer_has_different_linked_subscription");
  } else if (owner) {
    reconciliationReasons.push("subscription_not_linked_to_customer_owner");
  }
  // No durable checkout-operation/subscription association has been
  // established yet. Stripe metadata alone is deliberately not accepted.
  reconciliationReasons.push("checkout_operation_association_not_verified");
  if (outOfOrder) {
    reconciliationReasons.push(
      eventCreatedAt?.getTime() === previousEventCreatedAt?.getTime()
        ? "event_timestamp_tie_order_ambiguous"
        : "out_of_order_subscription_event",
    );
  }

  let disposition = "unassociated_subscription_quarantined";
  if (!validEventObject || !eventCreatedAt) {
    disposition = "invalid_event_quarantined";
  } else if (outOfOrder) {
    disposition = "out_of_order_event_quarantined";
  } else if (!plan) {
    disposition = "unmapped_price_quarantined";
  } else if (!customerId || owners.length === 0) {
    disposition = "unowned_customer_quarantined";
  } else if (owners.length > 1) {
    disposition = "ambiguous_customer_owner_quarantined";
  } else if (existingSubscription) {
    disposition = "existing_subscription_preserved";
  } else if (hasConflictingSubscription) {
    disposition = "subscription_owner_mismatch_quarantined";
  }

  // Keep only fields needed to review subscription state. Do not persist
  // arbitrary metadata, email, address, or payment-method details from Stripe.
  const snapshot = {
    objectType,
    subscriptionId,
    customerId,
    status: stringOrNull(subscription?.status),
    cancelAtPeriodEnd:
      typeof subscription?.cancel_at_period_end === "boolean"
        ? subscription.cancel_at_period_end
        : null,
    cancelAt: numberOrNull(subscription?.cancel_at),
    canceledAt: numberOrNull(subscription?.canceled_at),
    currentPeriodEnd: numberOrNull(subscription?.current_period_end),
    trialEnd: numberOrNull(subscription?.trial_end),
    latestInvoiceId: stripeReferenceId(subscription?.latest_invoice),
  };

  await tx.execute(sql`INSERT INTO subscription_reconciliation_events (
      stripe_event_id,
      event_type,
      event_livemode,
      event_created_at,
      received_at,
      stripe_subscription_id,
      stripe_customer_id,
      owner_clerk_id,
      owner_match_count,
      subscription_status,
      approved_plan,
      price_ids,
      items,
      snapshot,
      operation_association_status,
      previous_event_created_at,
      out_of_order,
      disposition,
      reconciliation_reasons
    ) VALUES (
      ${event.id},
      ${event.type},
      ${typeof event.livemode === "boolean" ? event.livemode : null},
      ${eventCreatedAt},
      ${receivedAt},
      ${subscriptionId},
      ${customerId},
      ${owner?.clerkId ?? null},
      ${owners.length},
      ${snapshot.status},
      ${plan?.id ?? null},
      ${JSON.stringify(priceIds)}::jsonb,
      ${JSON.stringify(items)}::jsonb,
      ${JSON.stringify(snapshot)}::jsonb,
      'not_verified',
      ${previousEventCreatedAt},
      ${outOfOrder},
      ${disposition},
      ${JSON.stringify(reconciliationReasons)}::jsonb
    )`);

  logger.warn(
    {
      stripeEventId: event.id,
      eventType: event.type,
      subscriptionId,
      customerId,
      ownerMatchCount: owners.length,
      ownerClerkId: owner?.clerkId ?? null,
      priceIds,
      approvedPlan: plan?.id ?? null,
      disposition,
      reconciliationReasons,
      entitlementChanged: false,
    },
    "Subscription lifecycle event persisted for manual reconciliation; entitlement unchanged",
  );
}

router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Fail closed: if STRIPE_WEBHOOK_SECRET is not configured, reject all webhooks.
    if (!webhookSecret) {
      logger.error("STRIPE_WEBHOOK_SECRET is not configured — rejecting webhook");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!sig) {
      logger.warn("Stripe webhook received without stripe-signature header");
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    const stripe = await getUncachableStripeClient();
    let event: any;

    try {
      const sigStr = Array.isArray(sig) ? sig[0] : sig;
      event = stripe.webhooks.constructEvent(req.body as Buffer, sigStr, webhookSecret);
    } catch (err: any) {
      logger.error({ err }, "Stripe webhook signature verification failed");
      return res.status(400).json({ error: "Webhook signature verification failed" });
    }

    // ── Transactional idempotency + event processing ──────────────────────────
    // The stripe_events insert and ALL DB writes run inside a single transaction.
    // If a crash occurs mid-processing, the transaction rolls back (including the
    // idempotency record), so Stripe will retry and the event will be re-processed.
    // Duplicate delivery is caught by the unique constraint on stripe_event_id.
    //
    // External side effects (Stripe refunds) are collected during the transaction
    // and executed AFTER it commits, because Stripe calls are not rollbackable.
    // This prevents the "refund issued but event row never committed" scenario.
    type RefundSideEffect = { paymentIntentId: string; sessionId: number; idempotencyKey: string };
    const pendingRefunds: RefundSideEffect[] = [];

    try {
      await db.transaction(async (tx) => {
        // 1. Record this event ID — will throw on unique constraint if already processed.
        await tx.insert(stripeEventsTable).values({ stripeEventId: event.id });

        // 2. Process event inside the same transaction.

        if (event.type === "payment_intent.succeeded") {
          const pi = event.data.object;
          const sessionRows = await tx
            .select()
            .from(chargingSessionsTable)
            .where(eq(chargingSessionsTable.stripePaymentIntentId, pi.id));
          const cs = sessionRows[0];
          if (cs && cs.status === "pending") {
            await tx
              .update(chargingSessionsTable)
              .set({ status: "completed", paymentState: "captured", completedAt: new Date() })
              .where(eq(chargingSessionsTable.id, cs.id));
            await recordSessionEvent(tx, cs.id, "payment_captured", {
              stripeEventId: event.id,
              paymentIntentId: pi.id,
            });
            await createChargingInvoice(tx, cs.id);
            track("payment_captured", cs.clerkUserId, {
              station_id: String(cs.stationId ?? ""),
              session_id_hash: hashId(cs.id),
              amount_usd: cs.amountCents / 100,
            });
            logger.info({ chargingSessionId: cs.id }, "In-app PaymentIntent succeeded — session completed");
          } else if (cs && cs.status === "failed") {
            // The session was force-stopped (status set to "failed" before Stripe
            // was checked). The PaymentIntent was in "processing" state at that time;
            // now that the charge has landed we must refund it.
            //
            // Insert a durable refund job inside this transaction so the record is
            // committed atomically with the event idempotency row. The post-transaction
            // code will attempt the refund immediately; if that fails the sweeper will
            // retry with exponential backoff using the same idempotency key.
            const idempotencyKey = `force_stop_refund_session_${cs.id}`;
            await tx
              .insert(stripeRefundJobsTable)
              .values({
                sessionId: cs.id,
                paymentIntentId: pi.id,
                idempotencyKey,
                reason: "force-stop race: session was terminated while payment was processing",
              })
              .onConflictDoNothing();
            await recordSessionEvent(tx, cs.id, "payment_force_stop_race", {
              stripeEventId: event.id,
              paymentIntentId: pi.id,
              idempotencyKey,
            });
            pendingRefunds.push({ paymentIntentId: pi.id, sessionId: cs.id, idempotencyKey });
            logger.warn(
              { chargingSessionId: cs.id, paymentIntentId: pi.id },
              "payment_intent.succeeded for force-stopped session — refund job recorded, will attempt immediately"
            );
          }
          // Record connector affinity for all successfully-paid sessions (fire-and-forget).
          // Placed outside the pending/completed guards so it fires regardless of whether
          // start-charging or the webhook ran first. Each Stripe event is processed at most
          // once (stripeEventsTable idempotency), so this never double-increments.
          // Excludes force-stopped sessions (status === "failed") — those got refunded.
          if (cs && cs.clerkUserId && cs.status !== "failed") {
            recordSessionConnectorAffinity(cs.clerkUserId, cs.stationId);
          }
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const chargingSessionId = session.metadata?.chargingSessionId;

          if (chargingSessionId) {
            const id = Number(chargingSessionId);
            await tx
              .update(chargingSessionsTable)
              .set({
                status: "completed",
                paymentState: "captured",
                stripePaymentIntentId: session.payment_intent ?? null,
                completedAt: new Date(),
              })
              .where(eq(chargingSessionsTable.id, id));

            await recordSessionEvent(tx, id, "payment_captured", {
              stripeEventId: event.id,
              checkoutSessionId: session.id,
              paymentIntentId: session.payment_intent ?? null,
            });

            await createChargingInvoice(tx, id);
            logger.info({ chargingSessionId }, "Charging session completed + receipt created");

            // Trigger remote start on OCPP-enabled chargers.
            // This runs after the transaction commits so it never rolls it back.
            // If the charger rejects, we queue a refund job so the driver is not
            // charged for energy that was never delivered.
            const [cs] = await tx
              .select({
                id: chargingSessionsTable.id,
                stationId: chargingSessionsTable.stationId,
                clerkUserId: chargingSessionsTable.clerkUserId,
              })
              .from(chargingSessionsTable)
              .where(eq(chargingSessionsTable.id, id));
            if (cs) {
              // Update connector affinity regardless of OCPP availability (fire-and-forget)
              recordSessionConnectorAffinity(cs.clerkUserId, cs.stationId);
            }
            if (cs && cs.stationId != null) {
              const checkoutPaymentIntentId = (session.payment_intent as string | null) ?? null;
              track("payment_captured", null, {
                station_id: String(cs.stationId),
                session_id_hash: hashId(cs.id),
                amount_usd: (session.amount_total ?? 0) / 100,
              });
              remoteStartTransaction(cs.stationId, "CHARGEBRIDGE", 1, cs.id).then(async (result) => {
                if (result.accepted) {
                  logger.info({ stationId: cs.stationId, chargingSessionId: id }, "OCPP remote start triggered after checkout payment");
                } else {
                  logger.warn(
                    { stationId: cs.stationId, chargingSessionId: id, reason: result.message },
                    "Checkout: OCPP remote start rejected after capture — queuing refund job"
                  );
                  if (checkoutPaymentIntentId) {
                    const idempotencyKey = `charger_rejected_refund_session_${id}`;
                    try {
                      await db
                        .insert(stripeRefundJobsTable)
                        .values({
                          sessionId: id,
                          paymentIntentId: checkoutPaymentIntentId,
                          idempotencyKey,
                          reason: "charger rejected remote start after checkout.session.completed payment captured",
                        })
                        .onConflictDoNothing();
                      await recordSessionEvent(db, id, "charger_rejected_after_payment", {
                        stripeEventId: event.id,
                        stationId: cs.stationId,
                        ocppMessage: result.message,
                        idempotencyKey,
                      });
                    } catch (err) {
                      logger.error(
                        { err, chargingSessionId: id },
                        "Checkout: failed to queue charger-rejection refund job — MANUAL REFUND REQUIRED"
                      );
                    }
                  }
                }
              }).catch((err) => {
                logger.warn({ err, chargingSessionId: id }, "OCPP remote start error (non-fatal)");
              });
            }
          } else if (session.mode === "subscription" && session.customer) {
            logger.info({ customerId: session.customer, subscriptionId: session.subscription }, "Membership subscription checkout completed");
          }
        }

        if (event.type === "checkout.session.expired") {
          const session = event.data.object;
          const chargingSessionId = session.metadata?.chargingSessionId;
          if (chargingSessionId) {
            const id = Number(chargingSessionId);
            await tx
              .update(chargingSessionsTable)
              .set({ status: "failed", paymentState: "failed" })
              .where(eq(chargingSessionsTable.id, id));
            await recordSessionEvent(tx, id, "payment_expired", {
              stripeEventId: event.id,
              checkoutSessionId: session.id,
            });
          }
        }

        // ── charge.refunded: Stripe confirms a refund went through ─────────────
        // This fires after any refund — manual, force-stop, or sweeper-queued.
        // We update both the legacy status and the independent paymentState so
        // every read path sees a consistent terminal state.
        if (event.type === "charge.refunded") {
          const charge = event.data.object;
          const paymentIntentId = charge.payment_intent as string | null;
          if (paymentIntentId) {
            const [cs] = await tx
              .select()
              .from(chargingSessionsTable)
              .where(eq(chargingSessionsTable.stripePaymentIntentId, paymentIntentId));
            if (cs) {
              const latestRefundId = (charge.refunds?.data?.[0]?.id as string | undefined) ?? null;
              await tx
                .update(chargingSessionsTable)
                .set({
                  status: "refunded",
                  paymentState: "refunded",
                  ...(latestRefundId ? { stripeRefundId: latestRefundId } : {}),
                })
                .where(eq(chargingSessionsTable.id, cs.id));
              await recordSessionEvent(tx, cs.id, "payment_refunded", {
                stripeEventId: event.id,
                chargeId: charge.id,
                amountRefunded: charge.amount_refunded,
                refundId: latestRefundId,
              });
              track("session_refunded", cs.clerkUserId, {
                station_id: String(cs.stationId ?? ""),
                session_id_hash: hashId(cs.id),
                refund_amount_usd: (charge.amount_refunded ?? 0) / 100,
                refund_reason: "user_requested",
              });
              logger.info(
                { chargingSessionId: cs.id, chargeId: charge.id, amountRefunded: charge.amount_refunded },
                "charge.refunded — session marked refunded"
              );
            }
          }
        }

        if (
          typeof event.type === "string" &&
          event.type.startsWith("customer.subscription.")
        ) {
          // Both journal rows are committed atomically. The stripe_events
          // uniqueness constraint makes a Stripe replay a safe no-op.
          await recordSubscriptionReconciliationEvent(tx, event);
        }
      });
    } catch (err: any) {
      // Unique constraint violation = already processed (duplicate delivery).
      // Drizzle ORM wraps the underlying pg error in DrizzleQueryError, so the
      // pg error code ("23505") lives on err.cause.code, not err.code directly.
      const isUniqueViolation =
        err?.code === "23505" ||
        err?.cause?.code === "23505" ||
        err?.message?.includes("unique") ||
        err?.cause?.message?.includes("unique");
      if (isUniqueViolation) {
        track("stripe_event_duplicate", null, {
          event_type: event.type,
          stripe_event_id_hash: hashId(event.id),
        });
        logger.info({ eventId: event.id, type: event.type }, "Skipping duplicate Stripe event");
        return res.json({ received: true });
      }
      logger.error({ err, eventId: event.id }, "Failed to process Stripe webhook event");
      return res.status(500).json({ error: "Internal error processing webhook" });
    }

    // ── Post-transaction side effects: attempt refunds immediately ───────────────
    // The refund job row is already committed in the DB (inside the transaction
    // above), so even if this optimistic attempt fails the sweeper will retry it.
    // This just speeds up the happy path — most refunds succeed on first try.
    if (pendingRefunds.length > 0) {
      const stripe = await getUncachableStripeClient();
      for (const { paymentIntentId, sessionId, idempotencyKey } of pendingRefunds) {
        try {
          await stripe.refunds.create(
            {
              payment_intent: paymentIntentId,
              reason: "fraudulent",
              metadata: {
                sessionId: String(sessionId),
                reason: "force-stop race: session was terminated while payment was processing",
              },
            },
            { idempotencyKey }
          );
          // Mark the job done so the sweeper doesn't re-attempt
          await db
            .update(stripeRefundJobsTable)
            .set({ succeededAt: new Date(), attempts: 1, lastAttemptAt: new Date() })
            .where(eq(stripeRefundJobsTable.idempotencyKey, idempotencyKey));
          logger.warn(
            { chargingSessionId: sessionId, paymentIntentId },
            "Auto-refund issued for force-stopped session — driver will not be charged"
          );
        } catch (refundErr) {
          // Transient failure — job row is already persisted; sweeper will retry
          logger.error(
            { refundErr, chargingSessionId: sessionId, paymentIntentId },
            "Auto-refund attempt failed — sweeper will retry with exponential backoff"
          );
        }
      }
    }

    return res.json({ received: true });
  }
);

export { router as stripeWebhookRouter };
