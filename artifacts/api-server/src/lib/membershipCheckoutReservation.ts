import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { getMembershipPlan, type MembershipPlanId } from "./membershipCatalog";

const LEASE_MS = 60_000;
const CHECKOUT_RESERVATION_MS = 24 * 60 * 60 * 1_000;
const EVIDENCE_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const ADVISORY_LOCK_NAMESPACE = 731_009;

export type MembershipCheckoutReservationState =
  | "processing"
  | "session_created"
  | "reconciling"
  | "completed"
  | "terminal_failure"
  | "expired"
  | "manual_review";

export type MembershipCheckoutReservation = {
  id: string;
  clerkUserId: string;
  stripeCustomerId: string;
  planId: "driver" | "family" | "fleet";
  stripeProductId: string;
  stripePriceId: string;
  unitAmount: number;
  currency: "usd";
  interval: "month";
  intervalCount: 1;
  requestFingerprint: string;
  fingerprintKeyVersion: number;
  state: MembershipCheckoutReservationState;
  stripeIdempotencyKey: string;
  paymentCreationRequestId: string;
  stripeCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  stripeSessionExpiresAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  reconciliationEvidence: MembershipCheckoutReconciliationEvidence[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  retentionExpiresAt: Date;
};

export type MembershipCheckoutReconciliationEvidence = {
  reason: string;
  observedAt: string;
  stripeEventId?: string;
  stripeSessionId?: string;
  stripeSubscriptionId?: string;
  stripeStatus?: string;
  paymentStatus?: string;
  errorCategory?: string;
};

export type MembershipCheckoutStripeDispositionProof = {
  /** Exact webhook request bytes, retained only for the trusted verifier. */
  rawPayload: Buffer;
  stripeSignature: string;
  stripeEventId: string;
  stripeSessionId: string;
  stripeSubscriptionId: string | null;
  checkoutSessionStatus: "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  observedAt: string;
};

/**
 * Must verify the signature against the exact raw payload using the server's
 * configured Stripe webhook secret and confirm that the signed event contains
 * the supplied Checkout Session disposition. Never implement this using
 * caller-provided booleans or fields alone.
 */
export type MembershipCheckoutStripeDispositionVerifier = (
  proof: MembershipCheckoutStripeDispositionProof,
) => Promise<boolean>;

export type MembershipCheckoutReservationInput = {
  /** Must come from a verified Clerk principal, never from the request body. */
  clerkUserId: string;
  /** Must be loaded from the server-owned user-to-Stripe-Customer association. */
  stripeCustomerId: string;
  /** Canonical ID only. All billing terms are loaded from MEMBERSHIP_CATALOG. */
  planId: MembershipPlanId;
};

export type MembershipCheckoutReservationDecision =
  | {
      kind: "created";
      reservation: MembershipCheckoutReservation;
      leaseOwner: string;
    }
  | { kind: "in_progress"; reservationId: string }
  | { kind: "recover_session"; reservationId: string; stripeSessionId: string }
  | { kind: "reconciling"; reservationId: string }
  | { kind: "conflict"; reservationId: string; code: "CHECKOUT_REQUEST_CONFLICT" }
  | { kind: "manual_review"; reservationIds: string[] };

export type MembershipCheckoutTransaction = {
  findUnresolvedForPrincipal(
    clerkUserId: string,
  ): Promise<MembershipCheckoutReservation[]>;
  create(
    reservation: MembershipCheckoutReservation,
    snapshot: MembershipCheckoutRequestSnapshot,
  ): Promise<void>;
  markReconciliation(
    reservation: MembershipCheckoutReservation,
    evidence: MembershipCheckoutReconciliationEvidence,
  ): Promise<void>;
  recordStripeSession(
    reservation: MembershipCheckoutReservation,
    session: {
      stripeSessionId: string;
      stripeSubscriptionId?: string | null;
      stripeSessionExpiresAt: Date;
      observedAt: Date;
    },
  ): Promise<MembershipCheckoutReservationState>;
  markTerminal(
    reservation: MembershipCheckoutReservation,
    state: "completed" | "terminal_failure" | "expired",
    evidence: MembershipCheckoutReconciliationEvidence,
  ): Promise<void>;
};

export type MembershipCheckoutReservationStore = {
  /**
   * Implementations must run the callback inside a PostgreSQL transaction and
   * take a transaction-scoped lock for clerkUserId before invoking it.
   */
  withPrincipalTransaction<T>(
    clerkUserId: string,
    callback: (tx: MembershipCheckoutTransaction) => Promise<T>,
  ): Promise<T>;
};

export type MembershipCheckoutRequestSnapshot = {
  clerkUserId: string;
  stripeCustomerId: string;
  planId: "driver" | "family" | "fleet";
  stripeProductId: string;
  stripePriceId: string;
  unitAmount: number;
  currency: "usd";
  interval: "month";
  intervalCount: 1;
};

function requestHashConfig(): { secret: string; version: number } {
  const secret = process.env.CHARGING_ATTEMPT_HMAC_KEY;
  const version = Number(process.env.CHARGING_ATTEMPT_HMAC_KEY_VERSION);
  if (!secret || secret.length < 32 || !Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      "CHARGING_ATTEMPT_HMAC_KEY (at least 32 characters) and a positive CHARGING_ATTEMPT_HMAC_KEY_VERSION are required before membership checkout reservations can be created",
    );
  }
  return { secret, version };
}

function hmac(value: string, purpose: string): string {
  const { secret } = requestHashConfig();
  return createHmac("sha256", secret)
    .update(`${purpose}\0${value}`)
    .digest("hex");
}

function sameFingerprint(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function fingerprintMembershipCheckoutRequest(
  input: MembershipCheckoutReservationInput,
): {
  snapshot: MembershipCheckoutRequestSnapshot;
  fingerprint: string;
  keyVersion: number;
} {
  if (!input.clerkUserId.trim()) {
    throw new Error("A verified Clerk user ID is required");
  }
  if (!/^cus_[A-Za-z0-9]+$/.test(input.stripeCustomerId)) {
    throw new Error("A server-associated Stripe Customer ID is required");
  }

  const plan = getMembershipPlan(input.planId);
  if (!plan || plan.id === "explorer" || !plan.priceId || !plan.productId) {
    throw new Error("A canonical paid membership plan is required");
  }

  const snapshot: MembershipCheckoutRequestSnapshot = {
    clerkUserId: input.clerkUserId,
    stripeCustomerId: input.stripeCustomerId,
    planId: plan.id,
    stripeProductId: plan.productId,
    stripePriceId: plan.priceId,
    unitAmount: plan.unitAmount,
    currency: plan.currency,
    interval: plan.interval,
    intervalCount: 1,
  };

  const { version } = requestHashConfig();
  return {
    snapshot,
    fingerprint: hmac(JSON.stringify(snapshot), "membership-checkout-request-v1"),
    keyVersion: version,
  };
}

function decisionForExisting(
  reservation: MembershipCheckoutReservation,
  fingerprint: string,
  now: Date,
): MembershipCheckoutReservationDecision | "reconcile_lease" {
  if (!sameFingerprint(reservation.requestFingerprint, fingerprint)) {
    return {
      kind: "conflict",
      reservationId: reservation.id,
      code: "CHECKOUT_REQUEST_CONFLICT",
    };
  }

  switch (reservation.state) {
    case "processing":
      if (reservation.leaseExpiresAt && reservation.leaseExpiresAt <= now) {
        return "reconcile_lease";
      }
      return { kind: "in_progress", reservationId: reservation.id };
    case "session_created":
      if (reservation.stripeCheckoutSessionId) {
        return {
          kind: "recover_session",
          reservationId: reservation.id,
          stripeSessionId: reservation.stripeCheckoutSessionId,
        };
      }
      return { kind: "manual_review", reservationIds: [reservation.id] };
    case "reconciling":
      return { kind: "reconciling", reservationId: reservation.id };
    case "manual_review":
      return { kind: "manual_review", reservationIds: [reservation.id] };
    case "completed":
    case "terminal_failure":
    case "expired":
      // These states are not returned by findUnresolvedForPrincipal().
      return { kind: "manual_review", reservationIds: [reservation.id] };
  }
}

export async function reserveMembershipCheckout(
  input: MembershipCheckoutReservationInput,
  options: {
    store?: MembershipCheckoutReservationStore;
    now?: Date;
  } = {},
): Promise<MembershipCheckoutReservationDecision> {
  const { snapshot, fingerprint, keyVersion } =
    fingerprintMembershipCheckoutRequest(input);
  const store = options.store ?? postgresMembershipCheckoutReservationStore;
  const now = options.now ?? new Date();

  return store.withPrincipalTransaction(input.clerkUserId, async (tx) => {
    const unresolved = await tx.findUnresolvedForPrincipal(input.clerkUserId);

    if (unresolved.length > 1) {
      const evidence: MembershipCheckoutReconciliationEvidence = {
        reason: "Multiple unresolved membership reservations exist for the same principal",
        observedAt: now.toISOString(),
      };
      for (const reservation of unresolved) {
        await tx.markReconciliation(reservation, evidence);
      }
      return {
        kind: "manual_review",
        reservationIds: unresolved.map((reservation) => reservation.id),
      };
    }

    const existing = unresolved[0];
    if (existing) {
      const decision = decisionForExisting(existing, fingerprint, now);
      if (decision !== "reconcile_lease") return decision;

      await tx.markReconciliation(existing, {
        reason: "Reservation lease expired; Stripe outcome must be reconciled before retry",
        observedAt: now.toISOString(),
        stripeSessionId: existing.stripeCheckoutSessionId ?? undefined,
        stripeSubscriptionId: existing.stripeSubscriptionId ?? undefined,
      });
      return { kind: "reconciling", reservationId: existing.id };
    }

    const id = randomUUID();
    const paymentCreationRequestId = randomUUID();
    const leaseOwner = randomUUID();
    const stripeIdempotencyKey = `cb_mchk_v1_${randomBytes(32).toString("hex")}`;
    const reservation: MembershipCheckoutReservation = {
      id,
      clerkUserId: snapshot.clerkUserId,
      stripeCustomerId: snapshot.stripeCustomerId,
      planId: snapshot.planId,
      stripeProductId: snapshot.stripeProductId,
      stripePriceId: snapshot.stripePriceId,
      unitAmount: snapshot.unitAmount,
      currency: snapshot.currency,
      interval: snapshot.interval,
      intervalCount: snapshot.intervalCount,
      requestFingerprint: fingerprint,
      fingerprintKeyVersion: keyVersion,
      state: "processing",
      stripeIdempotencyKey,
      paymentCreationRequestId,
      stripeCheckoutSessionId: null,
      stripeSubscriptionId: null,
      stripeSessionExpiresAt: null,
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attemptCount: 1,
      reconciliationEvidence: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + CHECKOUT_RESERVATION_MS),
      retentionExpiresAt: new Date(now.getTime() + EVIDENCE_RETENTION_MS),
    };

    await tx.create(reservation, snapshot);
    return { kind: "created", reservation, leaseOwner };
  });
}

export async function recordMembershipCheckoutStripeSession(
  input: {
    clerkUserId: string;
    reservationId: string;
    leaseOwner: string;
    stripeSessionId: string;
    stripeSubscriptionId?: string | null;
    stripeSessionExpiresAt: Date;
    now?: Date;
  },
  store: MembershipCheckoutReservationStore = postgresMembershipCheckoutReservationStore,
): Promise<MembershipCheckoutReservationState> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(input.stripeSessionId)) {
    throw new Error("A Stripe Checkout Session ID is required");
  }
  return store.withPrincipalTransaction(input.clerkUserId, async (tx) => {
    const unresolved = await tx.findUnresolvedForPrincipal(input.clerkUserId);
    const reservation = unresolved.find((item) => item.id === input.reservationId);
    if (!reservation || reservation.clerkUserId !== input.clerkUserId) {
      throw new Error("Membership checkout reservation was not found for this principal");
    }
    const conflictingSessionId =
      reservation.stripeCheckoutSessionId !== null &&
      reservation.stripeCheckoutSessionId !== input.stripeSessionId;
    const conflictingSubscriptionId =
      reservation.stripeSubscriptionId !== null &&
      input.stripeSubscriptionId != null &&
      reservation.stripeSubscriptionId !== input.stripeSubscriptionId;
    if (conflictingSessionId || conflictingSubscriptionId) {
      await tx.markReconciliation(reservation, {
        reason: "Conflicting Stripe Checkout Session or subscription identifier observed",
        observedAt: (input.now ?? new Date()).toISOString(),
        stripeSessionId: input.stripeSessionId,
        stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
        errorCategory: "conflicting_stripe_result",
      });
      return "reconciling";
    }
    if (reservation.state === "reconciling") {
      return tx.recordStripeSession(reservation, {
        stripeSessionId: input.stripeSessionId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripeSessionExpiresAt: input.stripeSessionExpiresAt,
        observedAt: input.now ?? new Date(),
      });
    }
    if (
      reservation.state !== "processing" ||
      reservation.leaseOwner !== input.leaseOwner
    ) {
      const evidence: MembershipCheckoutReconciliationEvidence = {
        reason: "Stripe Checkout Session result did not match the active reservation lease",
        observedAt: (input.now ?? new Date()).toISOString(),
        stripeSessionId: input.stripeSessionId,
        stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
      };
      await tx.markReconciliation(reservation, evidence);
      return "reconciling";
    }
    return tx.recordStripeSession(reservation, {
      stripeSessionId: input.stripeSessionId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSessionExpiresAt: input.stripeSessionExpiresAt,
      observedAt: input.now ?? new Date(),
    });
  });
}

export async function markMembershipCheckoutTerminal(
  input: {
    clerkUserId: string;
    reservationId: string;
    state: "completed" | "terminal_failure" | "expired";
    reason: string;
    proof?: MembershipCheckoutStripeDispositionProof;
    now?: Date;
  },
  store: MembershipCheckoutReservationStore = postgresMembershipCheckoutReservationStore,
  verifyProof?: MembershipCheckoutStripeDispositionVerifier,
): Promise<void> {
  if (!input.proof || !verifyProof) {
    throw new Error(
      "A verifiable Stripe disposition proof and trusted verifier are required before a membership reservation can become terminal",
    );
  }
  return store.withPrincipalTransaction(input.clerkUserId, async (tx) => {
    const unresolved = await tx.findUnresolvedForPrincipal(input.clerkUserId);
    const reservation = unresolved.find((item) => item.id === input.reservationId);
    if (!reservation || reservation.clerkUserId !== input.clerkUserId) {
      throw new Error("Membership checkout reservation was not found for this principal");
    }
    if (
      reservation.reconciliationEvidence.some(
        (evidence) => evidence.errorCategory === "conflicting_stripe_result",
      )
    ) {
      throw new Error(
        "A conflicting Stripe result requires manual reconciliation before terminal resolution",
      );
    }
    const proof = input.proof!;
    const observedAt = new Date(proof.observedAt);
    if (
      proof.rawPayload.length === 0 ||
      !proof.stripeSignature.trim() ||
      !Number.isFinite(observedAt.getTime()) ||
      !/^evt_[A-Za-z0-9]+$/.test(proof.stripeEventId) ||
      (proof.stripeSubscriptionId !== null &&
        !/^sub_[A-Za-z0-9]+$/.test(proof.stripeSubscriptionId)) ||
      !reservation.stripeCheckoutSessionId ||
      reservation.stripeCheckoutSessionId !== proof.stripeSessionId ||
      (reservation.stripeSubscriptionId !== null &&
        reservation.stripeSubscriptionId !== proof.stripeSubscriptionId)
    ) {
      throw new Error(
        "Stripe disposition proof does not match the persisted Checkout Session",
      );
    }
    const dispositionMatches =
      (input.state === "completed" &&
        proof.checkoutSessionStatus === "complete" &&
        (proof.paymentStatus === "paid" ||
          proof.paymentStatus === "no_payment_required") &&
        proof.stripeSubscriptionId !== null) ||
      (input.state === "expired" &&
        proof.checkoutSessionStatus === "expired" &&
        proof.paymentStatus === "unpaid");
    if (!dispositionMatches || !(await verifyProof(proof))) {
      throw new Error("Stripe disposition proof could not be verified");
    }
    await tx.markTerminal(reservation, input.state, {
      reason: input.reason,
      observedAt: proof.observedAt,
      stripeEventId: proof.stripeEventId,
      stripeSessionId: proof.stripeSessionId,
      stripeSubscriptionId: proof.stripeSubscriptionId ?? undefined,
      stripeStatus: proof.checkoutSessionStatus,
      paymentStatus: proof.paymentStatus,
    });
  });
}

type SqlResult = { rows: Array<Record<string, unknown>> };
type SqlExecutor = {
  execute(query: SQL): Promise<SqlResult>;
};
type SqlDatabase = SqlExecutor & {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

type ReservationDbRow = Record<string, unknown>;

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function mapReservationRow(row: ReservationDbRow): MembershipCheckoutReservation {
  return {
    id: String(row.id),
    clerkUserId: String(row.clerk_user_id),
    stripeCustomerId: String(row.stripe_customer_id),
    planId: String(row.plan_id) as MembershipCheckoutReservation["planId"],
    stripeProductId: String(row.stripe_product_id),
    stripePriceId: String(row.stripe_price_id),
    unitAmount: Number(row.unit_amount),
    currency: String(row.currency) as "usd",
    interval: String(row.billing_interval) as "month",
    intervalCount: Number(row.interval_count) as 1,
    requestFingerprint: String(row.request_fingerprint),
    fingerprintKeyVersion: Number(row.fingerprint_key_version),
    state: String(row.state) as MembershipCheckoutReservationState,
    stripeIdempotencyKey: String(row.stripe_idempotency_key),
    paymentCreationRequestId: String(row.payment_creation_request_id),
    stripeCheckoutSessionId: row.stripe_checkout_session_id
      ? String(row.stripe_checkout_session_id)
      : null,
    stripeSubscriptionId: row.stripe_subscription_id
      ? String(row.stripe_subscription_id)
      : null,
    stripeSessionExpiresAt: asDate(row.stripe_session_expires_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseExpiresAt: asDate(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
    reconciliationEvidence: (row.reconciliation_evidence ??
      []) as MembershipCheckoutReconciliationEvidence[],
    createdAt: asDate(row.created_at)!,
    updatedAt: asDate(row.updated_at)!,
    expiresAt: asDate(row.expires_at)!,
    retentionExpiresAt: asDate(row.retention_expires_at)!,
  };
}

const postgresMembershipCheckoutReservationStore: MembershipCheckoutReservationStore =
  {
    async withPrincipalTransaction<T>(
      clerkUserId: string,
      callback: (tx: MembershipCheckoutTransaction) => Promise<T>,
    ) {
      const database = db as unknown as SqlDatabase;
      return database.transaction(async (rawTx) => {
        const lock = sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}, hashtext(${clerkUserId}))`;
        await rawTx.execute(lock);

        const tx: MembershipCheckoutTransaction = {
          async findUnresolvedForPrincipal(userId) {
            const result = await rawTx.execute(sql`
              SELECT *
              FROM membership_checkout_reservations
              WHERE clerk_user_id = ${userId}
                AND state IN ('processing', 'session_created', 'reconciling', 'manual_review')
              ORDER BY created_at ASC
              FOR UPDATE
            `);
            return result.rows.map(mapReservationRow);
          },
          async create(reservation, snapshot) {
            const requestPrincipalHash = hmac(
              reservation.clerkUserId,
              "payment-principal-v1",
            );
            const idempotencyKeyRef = hmac(
              reservation.stripeIdempotencyKey,
              "stripe-idempotency-ref-v1",
            );
            await rawTx.execute(sql`
              INSERT INTO payment_creation_requests (
                id, operation, principal_type, principal_hmac,
                principal_hmac_version, idempotency_key_hash,
                idempotency_key_hash_version, request_hash,
                request_hash_version, transaction_fingerprint,
                fingerprint_key_version, state, plan_id,
                stripe_idempotency_key_ref, lease_owner, lease_expires_at,
                attempt_count, expires_at, retention_class
              ) VALUES (
                ${reservation.paymentCreationRequestId}::uuid,
                'subscription_checkout', 'clerk_user',
                ${requestPrincipalHash}, ${reservation.fingerprintKeyVersion},
                ${idempotencyKeyRef}, ${reservation.fingerprintKeyVersion},
                ${reservation.requestFingerprint}, ${reservation.fingerprintKeyVersion},
                ${reservation.requestFingerprint}, ${reservation.fingerprintKeyVersion},
                'processing', ${snapshot.planId}, ${idempotencyKeyRef},
                ${reservation.leaseOwner}::uuid, ${reservation.leaseExpiresAt},
                1, ${reservation.expiresAt}, 'active'
              )
            `);
            await rawTx.execute(sql`
              INSERT INTO membership_checkout_reservations (
                id, clerk_user_id, stripe_customer_id, plan_id,
                stripe_product_id, stripe_price_id, unit_amount, currency,
                billing_interval, interval_count, request_fingerprint,
                fingerprint_key_version, request_snapshot, state,
                stripe_idempotency_key, payment_creation_request_id,
                lease_owner, lease_expires_at, attempt_count, created_at,
                updated_at, expires_at, retention_expires_at
              ) VALUES (
                ${reservation.id}::uuid, ${reservation.clerkUserId},
                ${reservation.stripeCustomerId}, ${reservation.planId},
                ${reservation.stripeProductId}, ${reservation.stripePriceId},
                ${reservation.unitAmount}, ${reservation.currency},
                ${reservation.interval}, ${reservation.intervalCount},
                ${reservation.requestFingerprint},
                ${reservation.fingerprintKeyVersion},
                ${JSON.stringify(snapshot)}::jsonb, 'processing',
                ${reservation.stripeIdempotencyKey},
                ${reservation.paymentCreationRequestId}::uuid,
                ${reservation.leaseOwner}::uuid, ${reservation.leaseExpiresAt},
                1, ${reservation.createdAt}, ${reservation.updatedAt},
                ${reservation.expiresAt}, ${reservation.retentionExpiresAt}
              )
            `);
          },
          async markReconciliation(reservation, evidence) {
            const appended = [...reservation.reconciliationEvidence, evidence];
            await rawTx.execute(sql`
              UPDATE membership_checkout_reservations
              SET state = 'reconciling',
                  reconciliation_evidence = ${JSON.stringify(appended)}::jsonb,
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${new Date(evidence.observedAt)}
              WHERE id = ${reservation.id}::uuid
                AND clerk_user_id = ${reservation.clerkUserId}
            `);
            await rawTx.execute(sql`
              UPDATE payment_creation_requests
              SET state = 'reconciling',
                  last_error_category = ${evidence.errorCategory ?? "ambiguous_outcome"},
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${new Date(evidence.observedAt)},
                  retention_class = 'reconciliation_evidence',
                  retention_started_at = ${new Date(evidence.observedAt)},
                  retention_expires_at = ${new Date(
                    new Date(evidence.observedAt).getTime() + EVIDENCE_RETENTION_MS,
                  )}
              WHERE id = ${reservation.paymentCreationRequestId}::uuid
            `);
          },
          async recordStripeSession(reservation, session) {
            if (
              (reservation.stripeCheckoutSessionId !== null &&
                reservation.stripeCheckoutSessionId !== session.stripeSessionId) ||
              (reservation.stripeSubscriptionId !== null &&
                session.stripeSubscriptionId != null &&
                reservation.stripeSubscriptionId !== session.stripeSubscriptionId)
            ) {
              await tx.markReconciliation(reservation, {
                reason: "Conflicting Stripe Checkout Session or subscription identifier observed",
                observedAt: session.observedAt.toISOString(),
                stripeSessionId: session.stripeSessionId,
                stripeSubscriptionId:
                  session.stripeSubscriptionId ?? undefined,
                errorCategory: "conflicting_stripe_result",
              });
              return "reconciling";
            }
            const evidence = [
              ...reservation.reconciliationEvidence,
              {
                reason: "Stripe Checkout Session created",
                observedAt: session.observedAt.toISOString(),
                stripeSessionId: session.stripeSessionId,
                stripeSubscriptionId: session.stripeSubscriptionId ?? undefined,
              },
            ];
            const newState =
              reservation.state === "processing" ? "session_created" : "reconciling";
            await rawTx.execute(sql`
              UPDATE membership_checkout_reservations
              SET state = ${newState}::membership_checkout_reservation_state,
                  stripe_checkout_session_id = COALESCE(
                    stripe_checkout_session_id,
                    ${session.stripeSessionId}
                  ),
                  stripe_subscription_id = COALESCE(
                    stripe_subscription_id,
                    ${session.stripeSubscriptionId ?? null}
                  ),
                  stripe_session_expires_at = COALESCE(
                    stripe_session_expires_at,
                    ${session.stripeSessionExpiresAt}
                  ),
                  reconciliation_evidence = ${JSON.stringify(evidence)}::jsonb,
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${session.observedAt}
              WHERE id = ${reservation.id}::uuid
                AND clerk_user_id = ${reservation.clerkUserId}
            `);
            await rawTx.execute(sql`
              UPDATE payment_creation_requests
              SET state = ${newState === "session_created" ? "stripe_succeeded" : "reconciling"},
                  stripe_object_type = 'checkout_session',
                  stripe_object_id = ${session.stripeSessionId},
                  checkout_url_expires_at = ${session.stripeSessionExpiresAt},
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${session.observedAt}
              WHERE id = ${reservation.paymentCreationRequestId}::uuid
            `);
            return newState;
          },
          async markTerminal(reservation, state, evidence) {
            const retentionClass =
              state === "completed" ? "successful" : "failed";
            const minimumRetention =
              state === "completed"
                ? 90 * 24 * 60 * 60 * 1_000
                : 30 * 24 * 60 * 60 * 1_000;
            const observedAt = new Date(evidence.observedAt);
            const retentionExpiresAt = new Date(
              Math.max(
                reservation.retentionExpiresAt.getTime(),
                observedAt.getTime() + minimumRetention,
              ),
            );
            const appended = [...reservation.reconciliationEvidence, evidence];
            await rawTx.execute(sql`
              UPDATE membership_checkout_reservations
              SET state = ${state}::membership_checkout_reservation_state,
                   stripe_subscription_id = COALESCE(
                     stripe_subscription_id,
                     ${evidence.stripeSubscriptionId ?? null}
                   ),
                  reconciliation_evidence = ${JSON.stringify(appended)}::jsonb,
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${observedAt},
                  retention_expires_at = ${retentionExpiresAt}
              WHERE id = ${reservation.id}::uuid
                AND clerk_user_id = ${reservation.clerkUserId}
            `);
            await rawTx.execute(sql`
              UPDATE payment_creation_requests
              SET state = ${state},
                  completed_at = ${state === "completed" ? observedAt : null},
                  last_error_category = ${evidence.errorCategory ?? null},
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${observedAt},
                  retention_class = ${retentionClass},
                  retention_started_at = ${observedAt},
                  retention_expires_at = ${retentionExpiresAt}
              WHERE id = ${reservation.paymentCreationRequestId}::uuid
            `);
          },
        };
        return callback(tx);
      });
    },
  };