import type {
  ChargingAttemptState,
  ChargingReconciliationState,
} from "./chargingAttempt";
import type {
  MembershipCheckoutReservationState,
} from "./membershipCheckoutReservation";

export type RecoveryStripeObjectType = "payment_intent" | "checkout_session";

export type PaymentCreationRequestState =
  | "processing"
  | "stripe_succeeded"
  | "completed"
  | "retryable_failure"
  | "reconciling"
  | "terminal_failure"
  | "expired"
  | "superseded"
  | "manual_review";

export type StripeRecoveryEvidence = Readonly<{
  event:
    | "operation_created"
    | "operation_definitely_failed"
    | "operation_timed_out"
    | "operation_ambiguous"
    | "retry_after_ambiguity_existing"
    | "retry_after_ambiguity_absent"
    | "retry_after_ambiguity_unresolved"
    | "payment_succeeded"
    | "checkout_completed_paid"
    | "checkout_expired";
  observedAt: string;
  evidenceRef: string;
  summary: string;
  stripeObjectType?: RecoveryStripeObjectType;
  stripeObjectId?: string;
  responseDelivered?: boolean;
}>;

/**
 * The caller must construct observations only after verifying the Stripe
 * response, signed event, or authoritative reconciliation evidence. This pure
 * contract deliberately performs no Stripe request and is not a verifier.
 */
export type VerifiedStripeObservation =
  | {
      kind: "operation_created";
      verified: true;
      observedAt: string;
      evidenceRef: string;
      objectType: RecoveryStripeObjectType;
      objectId: string;
      responseDelivered: boolean;
    }
  | {
      kind: "definite_failure";
      verified: true;
      observedAt: string;
      evidenceRef: string;
      errorCategory: string;
      provesNoObjectCreated: true;
      retryable: boolean;
    }
  | {
      kind: "timeout" | "ambiguous";
      observedAt: string;
      evidenceRef: string;
      summary: string;
    }
  | {
      kind: "retry_after_ambiguous";
      disposition: "existing_object";
      verified: true;
      observedAt: string;
      evidenceRef: string;
      objectType: RecoveryStripeObjectType;
      objectId: string;
    }
  | {
      kind: "retry_after_ambiguous";
      disposition: "confirmed_absent";
      verified: true;
      observedAt: string;
      evidenceRef: string;
      provesSameIdempotencyKeyReplaySafe: true;
    }
  | {
      kind: "retry_after_ambiguous";
      disposition: "unresolved";
      observedAt: string;
      evidenceRef: string;
      summary: string;
    }
  | {
      kind: "payment_succeeded";
      verified: true;
      operationAssociationVerified: true;
      observedAt: string;
      evidenceRef: string;
      objectType: RecoveryStripeObjectType;
      objectId: string;
    }
  | {
      kind: "checkout_completed_paid";
      verified: true;
      operationAssociationVerified: true;
      observedAt: string;
      evidenceRef: string;
      objectType: "checkout_session";
      objectId: string;
    }
  | {
      kind: "checkout_expired";
      verified: true;
      operationAssociationVerified: true;
      observedAt: string;
      evidenceRef: string;
      objectType: "checkout_session";
      objectId: string;
    };

export type ChargingRecoverySnapshot = Readonly<{
  operation: "charging_checkout" | "charging_payment_intent";
  attempt: Readonly<{
    state: ChargingAttemptState;
    reconciliationState: ChargingReconciliationState;
    stripePaymentIntentId: string | null;
    stripeCheckoutSessionId: string | null;
  }>;
  paymentRequest: Readonly<{
    state: PaymentCreationRequestState;
    stripeObjectType: RecoveryStripeObjectType | null;
    stripeObjectId: string | null;
  }>;
}>;

export type ChargingRecoveryDecision =
  | "recover_existing_operation"
  | "retry_same_operation_same_idempotency_key"
  | "reconcile_before_any_retry"
  | "manual_review_no_retry"
  | "no_retry_terminal";

export type ChargingRecoveryTransition = Readonly<{
  attemptState: ChargingAttemptState;
  reconciliationState: ChargingReconciliationState;
  paymentRequestState: PaymentCreationRequestState;
  stripeObjectType: RecoveryStripeObjectType | null;
  stripeObjectId: string | null;
  decision: ChargingRecoveryDecision;
  manualReviewRequired: boolean;
  evidence: StripeRecoveryEvidence;
}>;

export type MembershipRecoverySnapshot = Readonly<{
  state: MembershipCheckoutReservationState;
  stripeCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  paymentRequestState: PaymentCreationRequestState;
  stripeObjectType: RecoveryStripeObjectType | null;
  stripeObjectId: string | null;
}>;

export type MembershipRecoveryDecision =
  | "recover_existing_operation"
  | "retry_same_operation_same_idempotency_key"
  | "reconcile_before_any_retry"
  | "manual_review_no_retry"
  | "no_retry_terminal";

export type MembershipRecoveryTransition = Readonly<{
  reservationState: MembershipCheckoutReservationState;
  paymentRequestState: PaymentCreationRequestState;
  stripeCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  stripeObjectType: RecoveryStripeObjectType | null;
  stripeObjectId: string | null;
  decision: MembershipRecoveryDecision;
  manualReviewRequired: boolean;
  evidence: StripeRecoveryEvidence;
}>;

/**
 * Development-only recovery contract (pure; no Stripe calls):
 *
 * | Observation | Charging Attempt / request | Membership reservation / request | Next operation |
 * | --- | --- | --- | --- |
 * | Stripe returned a created object | processing / stripe_succeeded | session_created / stripe_succeeded | Recover that exact object; never create another |
 * | Object was created but response was lost | Same as created; retain the observed ID | Same as created; retain the Session ID | Recover that exact object |
 * | Verified definite failure, no object, retryable | issued / retryable_failure | processing / retryable_failure | Replay the same request using its original idempotency key only |
 * | Verified definite failure, no object, terminal | failed / terminal_failure | terminal_failure / terminal_failure | No retry on this request |
 * | Timeout or ambiguous result | reconciling / reconciling | reconciling / reconciling | Recover/query existing operation before any retry |
 * | Ambiguous retry finds existing object | processing / stripe_succeeded | session_created / stripe_succeeded | Recover existing object |
 * | Ambiguous retry proves absence | issued / retryable_failure | processing / retryable_failure | Replay same idempotency key only |
 * | Ambiguous retry stays unresolved | manual_review / manual_review | manual_review / manual_review | No Stripe operation; operator reconciliation |
 * | Verified payment completion | succeeded / completed | completed / completed only for paid Checkout | Terminal; never create another operation |
 *
 * Evidence is appended for each observation. A conflicting Stripe object ID
 * or disagreement between Attempt and payment-request links enters manual
 * review and preserves the first known object ID. A timeout is automatically
 * recoverable only by finding the same object; otherwise it cannot authorize
 * an operation. A verified "absent" disposition authorizes only an identical
 * idempotent replay, never a fresh key or a second logical purchase.
 */
function validateEvidence(observation: VerifiedStripeObservation): void {
  if (
    !Number.isFinite(Date.parse(observation.observedAt))
    || !observation.evidenceRef.trim()
  ) {
    throw new TypeError("A timestamped, referenced Stripe observation is required.");
  }
  if (
    observation.kind === "operation_created"
    || observation.kind === "retry_after_ambiguous"
    && observation.disposition === "existing_object"
    || observation.kind === "payment_succeeded"
    || observation.kind === "checkout_completed_paid"
    || observation.kind === "checkout_expired"
  ) {
    if (!observation.objectId.trim()) {
      throw new TypeError("A verified Stripe object ID is required.");
    }
  }
}

function evidenceFor(
  observation: VerifiedStripeObservation,
): StripeRecoveryEvidence {
  validateEvidence(observation);
  switch (observation.kind) {
    case "operation_created":
      return {
        event: "operation_created",
        observedAt: observation.observedAt,
        evidenceRef: observation.evidenceRef,
        summary: observation.responseDelivered
          ? "Stripe created the operation; payment is not yet confirmed."
          : "Stripe created the operation, but the client did not receive the response.",
        stripeObjectType: observation.objectType,
        stripeObjectId: observation.objectId,
        responseDelivered: observation.responseDelivered,
      };
    case "definite_failure":
      if (!observation.errorCategory.trim()) {
        throw new TypeError("A classified definite Stripe failure is required.");
      }
      return {
        event: "operation_definitely_failed",
        observedAt: observation.observedAt,
        evidenceRef: observation.evidenceRef,
        summary: `Verified no-object-created failure (${observation.errorCategory}); retryable=${observation.retryable}.`,
      };
    case "timeout":
    case "ambiguous":
      return {
        event: observation.kind === "timeout"
          ? "operation_timed_out"
          : "operation_ambiguous",
        observedAt: observation.observedAt,
        evidenceRef: observation.evidenceRef,
        summary: observation.summary,
      };
    case "retry_after_ambiguous":
      if (observation.disposition === "existing_object") {
        return {
          event: "retry_after_ambiguity_existing",
          observedAt: observation.observedAt,
          evidenceRef: observation.evidenceRef,
          summary: "Reconciliation found the existing Stripe object; recover it without creating another.",
          stripeObjectType: observation.objectType,
          stripeObjectId: observation.objectId,
        };
      }
      if (observation.disposition === "confirmed_absent") {
        return {
          event: "retry_after_ambiguity_absent",
          observedAt: observation.observedAt,
          evidenceRef: observation.evidenceRef,
          summary: "Verified absence permits replay of the original operation with its original idempotency key only.",
        };
      }
      return {
        event: "retry_after_ambiguity_unresolved",
        observedAt: observation.observedAt,
        evidenceRef: observation.evidenceRef,
        summary: observation.summary,
      };
    case "payment_succeeded":
    case "checkout_completed_paid":
    case "checkout_expired":
      return {
        event: observation.kind,
        observedAt: observation.observedAt,
        evidenceRef: observation.evidenceRef,
        summary: observation.kind === "payment_succeeded"
          ? "Verified payment completion associated with this operation."
          : observation.kind === "checkout_completed_paid"
            ? "Verified paid Checkout completion associated with this reservation."
            : "Verified unpaid Checkout expiration associated with this reservation.",
        stripeObjectType: observation.objectType,
        stripeObjectId: observation.objectId,
      };
  }
}

function attemptObject(snapshot: ChargingRecoverySnapshot): {
  type: RecoveryStripeObjectType;
  id: string | null;
} {
  return snapshot.operation === "charging_checkout"
    ? { type: "checkout_session", id: snapshot.attempt.stripeCheckoutSessionId }
    : { type: "payment_intent", id: snapshot.attempt.stripePaymentIntentId };
}

function linkedObject(snapshot: ChargingRecoverySnapshot): {
  type: RecoveryStripeObjectType | null;
  id: string | null;
} {
  const attempt = attemptObject(snapshot);
  const request = snapshot.paymentRequest;
  if (
    attempt.id
    && request.stripeObjectId
    && (attempt.id !== request.stripeObjectId || attempt.type !== request.stripeObjectType)
  ) {
    return { type: null, id: "__conflict__" };
  }
  return attempt.id
    ? attempt
    : { type: request.stripeObjectType, id: request.stripeObjectId };
}

function chargingManualReview(
  snapshot: ChargingRecoverySnapshot,
  evidence: StripeRecoveryEvidence,
): ChargingRecoveryTransition {
  const linked = linkedObject(snapshot);
  return {
    attemptState: "manual_review",
    reconciliationState: "manual_review",
    paymentRequestState: "manual_review",
    stripeObjectType: linked.id === "__conflict__" ? null : linked.type,
    stripeObjectId: linked.id === "__conflict__" ? null : linked.id,
    decision: "manual_review_no_retry",
    manualReviewRequired: true,
    evidence,
  };
}

/**
 * Pure Charging Attempt/payment-request recovery reducer.
 *
 * A Stripe object creation is not proof that the customer paid: it leaves the
 * Attempt processing and records payment_request=stripe_succeeded. A verified
 * payment completion is the only transition to succeeded/completed.
 *
 * New financial operations are forbidden after a timeout/ambiguous outcome.
 * A replay is allowed only after verified no-side-effect evidence and must use
 * the existing payment request's original server-generated idempotency key.
 */
export function transitionChargingRecovery(
  snapshot: ChargingRecoverySnapshot,
  observation: VerifiedStripeObservation,
): ChargingRecoveryTransition {
  const evidence = evidenceFor(observation);
  const linked = linkedObject(snapshot);
  if (linked.id === "__conflict__") {
    return chargingManualReview(snapshot, evidence);
  }
  const expected = attemptObject(snapshot);
  const currentType = linked.type;
  const currentId = linked.id;

  const attachVerifiedObject = (
    objectType: RecoveryStripeObjectType,
    objectId: string,
    requestState: PaymentCreationRequestState,
    attemptState: ChargingAttemptState,
    reconciliationState: ChargingReconciliationState,
    decision: ChargingRecoveryDecision,
  ): ChargingRecoveryTransition => {
    if (
      objectType !== expected.type
      || (currentType !== null && currentType !== objectType)
      || (currentId !== null && currentId !== objectId)
      || snapshot.attempt.state === "failed"
      || snapshot.attempt.state === "manual_review"
      || snapshot.attempt.reconciliationState === "manual_review"
    ) {
      return chargingManualReview(snapshot, evidence);
    }
    if (snapshot.attempt.state === "succeeded") {
      return {
        attemptState: "succeeded",
        reconciliationState: "resolved",
        paymentRequestState: "completed",
        stripeObjectType: objectType,
        stripeObjectId: objectId,
        decision: "no_retry_terminal",
        manualReviewRequired: false,
        evidence,
      };
    }
    return {
      attemptState,
      reconciliationState,
      paymentRequestState: requestState,
      stripeObjectType: objectType,
      stripeObjectId: objectId,
      decision,
      manualReviewRequired: false,
      evidence,
    };
  };

  if (observation.kind === "operation_created") {
    return attachVerifiedObject(
      observation.objectType,
      observation.objectId,
      "stripe_succeeded",
      snapshot.attempt.state === "succeeded" ? "succeeded" : "processing",
      snapshot.attempt.state === "succeeded" ? "resolved" : "none",
      "recover_existing_operation",
    );
  }

  if (observation.kind === "definite_failure") {
    if (
      currentId !== null
      || snapshot.attempt.state === "succeeded"
      || snapshot.attempt.state === "failed"
      || snapshot.attempt.state === "manual_review"
      || snapshot.attempt.reconciliationState === "manual_review"
    ) {
      return chargingManualReview(snapshot, evidence);
    }
    return observation.retryable
      ? {
          attemptState: "issued",
          reconciliationState: "none",
          paymentRequestState: "retryable_failure",
          stripeObjectType: null,
          stripeObjectId: null,
          decision: "retry_same_operation_same_idempotency_key",
          manualReviewRequired: false,
          evidence,
        }
      : {
          attemptState: "failed",
          reconciliationState: "resolved",
          paymentRequestState: "terminal_failure",
          stripeObjectType: null,
          stripeObjectId: null,
          decision: "no_retry_terminal",
          manualReviewRequired: false,
          evidence,
        };
  }

  if (observation.kind === "timeout" || observation.kind === "ambiguous") {
    if (snapshot.attempt.state === "succeeded") {
      return {
        attemptState: "succeeded",
        reconciliationState: "resolved",
        paymentRequestState: "completed",
        stripeObjectType: currentType,
        stripeObjectId: currentId,
        decision: "no_retry_terminal",
        manualReviewRequired: false,
        evidence,
      };
    }
    if (snapshot.attempt.state === "failed") {
      return {
        attemptState: "failed",
        reconciliationState: "resolved",
        paymentRequestState: "terminal_failure",
        stripeObjectType: currentType,
        stripeObjectId: currentId,
        decision: "no_retry_terminal",
        manualReviewRequired: false,
        evidence,
      };
    }
    if (
      snapshot.attempt.state === "manual_review"
      || snapshot.attempt.reconciliationState === "manual_review"
    ) {
      return chargingManualReview(snapshot, evidence);
    }
    if (currentId !== null) {
      return {
        attemptState: "reconciling",
        reconciliationState: "required",
        paymentRequestState: "reconciling",
        stripeObjectType: currentType,
        stripeObjectId: currentId,
        decision: "recover_existing_operation",
        manualReviewRequired: false,
        evidence,
      };
    }
    return {
      attemptState: "reconciling",
      reconciliationState: "required",
      paymentRequestState: "reconciling",
      stripeObjectType: null,
      stripeObjectId: null,
      decision: "reconcile_before_any_retry",
      manualReviewRequired: false,
      evidence,
    };
  }

  if (observation.kind === "retry_after_ambiguous") {
    if (observation.disposition === "existing_object") {
      return attachVerifiedObject(
        observation.objectType,
        observation.objectId,
        "stripe_succeeded",
        "processing",
        "resolved",
        "recover_existing_operation",
      );
    }
    if (observation.disposition === "confirmed_absent") {
      if (
        currentId !== null
        || snapshot.attempt.state === "succeeded"
        || snapshot.attempt.state === "failed"
        || snapshot.attempt.state === "manual_review"
        || snapshot.attempt.reconciliationState === "manual_review"
      ) {
        return chargingManualReview(snapshot, evidence);
      }
      return {
        attemptState: "issued",
        reconciliationState: "resolved",
        paymentRequestState: "retryable_failure",
        stripeObjectType: null,
        stripeObjectId: null,
        decision: "retry_same_operation_same_idempotency_key",
        manualReviewRequired: false,
        evidence,
      };
    }
    return chargingManualReview(snapshot, evidence);
  }

  if (observation.kind === "payment_succeeded") {
    if (!observation.operationAssociationVerified) {
      return chargingManualReview(snapshot, evidence);
    }
    return attachVerifiedObject(
      observation.objectType,
      observation.objectId,
      "completed",
      "succeeded",
      "resolved",
      "no_retry_terminal",
    );
  }

  return chargingManualReview(snapshot, evidence);
}

/**
 * Membership Checkout uses the same recovery rule: a known Session is
 * recovered, never recreated; ambiguous outcomes retain the reservation.
 * `terminal_failure` is reached only for a verified response proving no
 * Checkout Session was created. Session expiration and paid completion require
 * verified, correctly-associated observations.
 */
export function transitionMembershipRecovery(
  snapshot: MembershipRecoverySnapshot,
  observation: VerifiedStripeObservation,
): MembershipRecoveryTransition {
  const evidence = evidenceFor(observation);
  const currentSessionId = snapshot.stripeCheckoutSessionId;
  const requestConflict = snapshot.stripeObjectId !== null
    && currentSessionId !== null
    && (
      snapshot.stripeObjectType !== "checkout_session"
      || snapshot.stripeObjectId !== currentSessionId
    );
  const manualReview = (): MembershipRecoveryTransition => ({
    reservationState: "manual_review",
    paymentRequestState: "manual_review",
    stripeCheckoutSessionId: currentSessionId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    stripeObjectType: currentSessionId ? "checkout_session" : snapshot.stripeObjectType,
    stripeObjectId: currentSessionId ?? snapshot.stripeObjectId,
    decision: "manual_review_no_retry",
    manualReviewRequired: true,
    evidence,
  });
  if (requestConflict) return manualReview();
  const isTerminalReservation = snapshot.state === "completed"
    || snapshot.state === "expired"
    || snapshot.state === "terminal_failure";
  if (snapshot.state === "manual_review") return manualReview();

  const sessionTransition = (
    sessionId: string,
    requestState: PaymentCreationRequestState = "stripe_succeeded",
    reservationState: MembershipCheckoutReservationState = "session_created",
    decision: MembershipRecoveryDecision = "recover_existing_operation",
  ): MembershipRecoveryTransition => {
    if (
      currentSessionId !== null
      && currentSessionId !== sessionId
    ) return manualReview();
    if (isTerminalReservation) {
      const sameObject = currentSessionId === sessionId;
      if (!sameObject || snapshot.state === "terminal_failure") return manualReview();
      const completed = snapshot.state === "completed";
      return {
        reservationState: snapshot.state,
        paymentRequestState: completed ? "completed" : "expired",
        stripeCheckoutSessionId: currentSessionId,
        stripeSubscriptionId: snapshot.stripeSubscriptionId,
        stripeObjectType: "checkout_session",
        stripeObjectId: sessionId,
        decision: "no_retry_terminal",
        manualReviewRequired: false,
        evidence,
      };
    }
    if (
      snapshot.stripeObjectId !== null
      && (
        snapshot.stripeObjectType !== "checkout_session"
        || snapshot.stripeObjectId !== sessionId
      )
    ) return manualReview();
    return {
      reservationState,
      paymentRequestState: requestState,
      stripeCheckoutSessionId: sessionId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      stripeObjectType: "checkout_session",
      stripeObjectId: sessionId,
      decision,
      manualReviewRequired: false,
      evidence,
    };
  };

  if (observation.kind === "operation_created") {
    if (observation.objectType !== "checkout_session") return manualReview();
    return sessionTransition(observation.objectId);
  }
  if (observation.kind === "definite_failure") {
    if (
      currentSessionId
      || snapshot.stripeObjectId
      || isTerminalReservation
      || snapshot.state === "reconciling"
    ) return manualReview();
    return observation.retryable
      ? {
          reservationState: "processing",
          paymentRequestState: "retryable_failure",
          stripeCheckoutSessionId: null,
          stripeSubscriptionId: null,
          stripeObjectType: null,
          stripeObjectId: null,
          decision: "retry_same_operation_same_idempotency_key",
          manualReviewRequired: false,
          evidence,
        }
      : {
          reservationState: "terminal_failure",
          paymentRequestState: "terminal_failure",
          stripeCheckoutSessionId: null,
          stripeSubscriptionId: null,
          stripeObjectType: null,
          stripeObjectId: null,
          decision: "no_retry_terminal",
          manualReviewRequired: false,
          evidence,
        };
  }
  if (observation.kind === "timeout" || observation.kind === "ambiguous") {
    if (isTerminalReservation) {
      return {
        reservationState: snapshot.state,
        paymentRequestState: snapshot.state === "completed"
          ? "completed"
          : snapshot.state === "expired"
            ? "expired"
            : "terminal_failure",
        stripeCheckoutSessionId: currentSessionId,
        stripeSubscriptionId: snapshot.stripeSubscriptionId,
        stripeObjectType: snapshot.stripeObjectType,
        stripeObjectId: snapshot.stripeObjectId,
        decision: "no_retry_terminal",
        manualReviewRequired: false,
        evidence,
      };
    }
    if (currentSessionId) {
      return sessionTransition(
        currentSessionId,
        "reconciling",
        "reconciling",
        "recover_existing_operation",
      );
    }
    return {
      reservationState: "reconciling",
      paymentRequestState: "reconciling",
      stripeCheckoutSessionId: null,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      stripeObjectType: snapshot.stripeObjectType,
      stripeObjectId: snapshot.stripeObjectId,
      decision: "reconcile_before_any_retry",
      manualReviewRequired: false,
      evidence,
    };
  }
  if (observation.kind === "retry_after_ambiguous") {
    if (observation.disposition === "existing_object") {
      if (observation.objectType !== "checkout_session") return manualReview();
      return sessionTransition(observation.objectId);
    }
    if (observation.disposition === "confirmed_absent") {
      if (currentSessionId || snapshot.stripeObjectId || isTerminalReservation) {
        return manualReview();
      }
      return {
        reservationState: "processing",
        paymentRequestState: "retryable_failure",
        stripeCheckoutSessionId: null,
        stripeSubscriptionId: snapshot.stripeSubscriptionId,
        stripeObjectType: null,
        stripeObjectId: null,
        decision: "retry_same_operation_same_idempotency_key",
        manualReviewRequired: false,
        evidence,
      };
    }
    return manualReview();
  }
  if (
    observation.kind === "checkout_completed_paid"
    || observation.kind === "checkout_expired"
  ) {
    if (
      !observation.operationAssociationVerified
      || observation.objectId !== currentSessionId
      || observation.objectType !== "checkout_session"
    ) return manualReview();
    const completed = observation.kind === "checkout_completed_paid";
    if (isTerminalReservation) {
      if (
        (snapshot.state === "completed" && completed)
        || (snapshot.state === "expired" && !completed)
      ) {
        return {
          reservationState: snapshot.state,
          paymentRequestState: snapshot.state === "completed" ? "completed" : "expired",
          stripeCheckoutSessionId: currentSessionId,
          stripeSubscriptionId: snapshot.stripeSubscriptionId,
          stripeObjectType: "checkout_session",
          stripeObjectId: currentSessionId,
          decision: "no_retry_terminal",
          manualReviewRequired: false,
          evidence,
        };
      }
      return manualReview();
    }
    return {
      reservationState: completed ? "completed" : "expired",
      paymentRequestState: completed ? "completed" : "expired",
      stripeCheckoutSessionId: currentSessionId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      stripeObjectType: "checkout_session",
      stripeObjectId: currentSessionId,
      decision: "no_retry_terminal",
      manualReviewRequired: false,
      evidence,
    };
  }
  return manualReview();
}