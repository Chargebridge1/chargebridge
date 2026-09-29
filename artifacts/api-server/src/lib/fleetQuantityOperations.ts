import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { getMembershipPlanForPrice } from "./membershipCatalog";
import {
  FleetBillingSafetyError,
  prepareFinalFleetVehicleTransition,
  prepareFleetQuantityChange,
  type FleetBillingAccountSnapshot,
  type FleetOrganizationSnapshot,
  type FleetQuantityOperationDraft,
  type FleetQuantityOperationState,
  type FleetStripeSubscriptionSnapshot,
} from "./fleetBilling";

const FLEET_SUBSCRIPTION_LOCK_NAMESPACE = 731_015;

export type FleetQuantityOperationServiceErrorCode =
  | "FLEET_BILLING_ACCOUNT_NOT_FOUND"
  | "FLEET_QUANTITY_OPERATION_NOT_FOUND"
  | "FLEET_QUANTITY_OPERATION_PENDING"
  | "FLEET_QUANTITY_OPERATION_STATE_INVALID"
  | "FLEET_QUANTITY_OPERATION_CONFLICT";

export class FleetQuantityOperationServiceError extends Error {
  constructor(
    message: string,
    readonly code: FleetQuantityOperationServiceErrorCode,
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "FleetQuantityOperationServiceError";
  }
}

export type FleetQuantityOperationSummary = {
  id: string;
  state: FleetQuantityOperationState;
};

export type FleetQuantityOperationForReconciliation =
  FleetQuantityOperationSummary & {
    stripeSubscriptionId: string;
    evidence: Record<string, unknown>;
    reconciliationReason: string | null;
  };

export type FleetQuantityOperationTransaction = {
  getBillingContext(
    organizationId: number,
  ): Promise<{
    organization: FleetOrganizationSnapshot;
    account: FleetBillingAccountSnapshot;
  } | null>;
  countAuthoritativeActiveVehicles(organizationId: number): Promise<number>;
  findUnresolvedOperations(
    stripeSubscriptionId: string,
  ): Promise<FleetQuantityOperationSummary[]>;
  insertOperation(operation: FleetQuantityOperationDraft): Promise<void>;
  getOperationForUpdate(
    operationId: string,
  ): Promise<FleetQuantityOperationForReconciliation | null>;
  markReconciling(
    operation: FleetQuantityOperationForReconciliation,
    event: FleetQuantityReconciliationEvent,
  ): Promise<void>;
};

export type FleetQuantityOperationsStore = {
  getSubscriptionIdForOrganization(organizationId: number): Promise<string | null>;
  getOperationSubscriptionId(operationId: string): Promise<string | null>;
  withSubscriptionTransaction<T>(
    stripeSubscriptionId: string,
    callback: (tx: FleetQuantityOperationTransaction) => Promise<T>,
  ): Promise<T>;
};

export type ReserveFleetQuantityOperationInput = {
  /** Server-authenticated Clerk principal; the billing owner is required. */
  requesterClerkId: string;
  organizationId: number;
} & (
  | {
      operationType: "quantity_change";
      desiredDelta: number;
    }
  | {
      operationType: "final_vehicle_transition";
      desiredDelta: -1;
      explicitlyRequested: true;
    }
);

/**
 * Build the validation snapshot only from the persisted, previously verified
 * billing link and the server-owned catalog. This service deliberately does
 * not accept Stripe IDs, Price terms, or quantities supplied by callers.
 */
function persistedVerifiedSubscription(
  account: FleetBillingAccountSnapshot,
): FleetStripeSubscriptionSnapshot {
  const plan = getMembershipPlanForPrice(account.stripePriceId);
  if (
    !plan
    || plan.id !== "fleet"
    || !plan.priceId
    || !plan.productId
  ) {
    throw new FleetBillingSafetyError(
      "Persisted billing relationship does not use the approved Fleet Price",
      "FLEET_PRICE_UNMAPPED",
    );
  }
  if (
    !/^cus_[A-Za-z0-9]+$/.test(account.stripeCustomerId)
    || !/^sub_[A-Za-z0-9]+$/.test(account.stripeSubscriptionId)
  ) {
    throw new FleetBillingSafetyError(
      "Persisted Fleet billing relationship has an invalid Stripe customer or subscription ID",
      "FLEET_SUBSCRIPTION_MISMATCH",
    );
  }
  return {
    id: account.stripeSubscriptionId,
    customerId: account.stripeCustomerId,
    status: account.stripeSubscriptionStatus ?? "",
    items: [{
      priceId: plan.priceId,
      productId: plan.productId,
      unitAmount: plan.unitAmount,
      currency: plan.currency,
      interval: plan.interval,
      intervalCount: 1,
      // An active persisted billing link is written only after the Price is
      // independently verified by its provisioning flow.
      active: true,
      quantity: account.currentQuantity,
    }],
  };
}

export type FleetQuantityReconciliationEvent = {
  reason: string;
  observedAt: string;
  errorCategory?: string;
};

export type FleetQuantityConfirmationState =
  | "pending"
  | "confirmed"
  | "failed"
  | "unknown";
export type FleetQuantityReconciliationState =
  | "none"
  | "required"
  | "resolved"
  | "manual_review";

export type FleetQuantityOperationTransitionSnapshot = {
  operationId: string;
  operationType: FleetQuantityOperationDraft["operationType"];
  state: FleetQuantityOperationState;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  currentKnownStripeQuantity: number;
  requestedQuantity: number | null;
  requestHash: string;
  stripeOperationId: string | null;
  confirmationState: FleetQuantityConfirmationState;
  reconciliationState: FleetQuantityReconciliationState;
  billingAccountState: FleetBillingAccountSnapshot["state"];
  evidence: Record<string, unknown>;
};

export type FleetQuantityDispositionObservation = {
  operationId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  stripeOperationId: string;
  stripeEventId?: string | null;
  resultStatus: "succeeded" | "failed" | "canceled";
  subscriptionStatus: "active" | "trialing" | "canceled";
  currentStripeQuantity: number;
  observedAt: string;
};

export type FleetQuantityOperationTransitionCommand =
  | { kind: "begin" }
  | { kind: "succeeded"; observation: FleetQuantityDispositionObservation }
  | { kind: "confirm_completion"; observation: FleetQuantityDispositionObservation }
  | { kind: "definitely_failed"; observation: FleetQuantityDispositionObservation }
  | { kind: "reconcile"; observation: FleetQuantityDispositionObservation }
  | { kind: "timed_out"; reason: string; observedAt: string }
  | { kind: "ambiguous"; reason: string; observedAt: string }
  | { kind: "response_lost"; reason: string; observedAt: string }
  | { kind: "retry" }
  | { kind: "duplicate_request"; requestHash: string }
  | { kind: "concurrent_operation"; competingOperationId?: string };

export type FleetQuantityOperationTransitionDecision = {
  snapshot: FleetQuantityOperationTransitionSnapshot;
  action:
    | "ready_to_submit_once"
    | "recover_existing_operation"
    | "reconcile_before_retry"
    | "operation_confirmed"
    | "operation_failed"
    | "blocked";
  mayCreateAnotherOperation: boolean;
};

const IN_FLIGHT_FLEET_QUANTITY_STATES = new Set<FleetQuantityOperationState>([
  "reserved",
  "processing",
  "stripe_succeeded",
  "reconciling",
]);

function operationSnapshotFromDraft(
  operation: FleetQuantityOperationDraft,
): FleetQuantityOperationTransitionSnapshot {
  const lifecycle = operation.evidence.lifecycle;
  const previous = lifecycle && typeof lifecycle === "object" && !Array.isArray(lifecycle)
    ? lifecycle as Record<string, unknown>
    : {};
  return {
    operationId: operation.id,
    operationType: operation.operationType,
    state: operation.state,
    stripeSubscriptionId: operation.stripeSubscriptionId,
    stripeCustomerId: operation.stripeCustomerId,
    stripePriceId: operation.stripePriceId,
    currentKnownStripeQuantity:
      Number(previous.currentKnownStripeQuantity ?? operation.fromQuantity),
    requestedQuantity: operation.targetQuantity,
    requestHash: operation.requestHash,
    stripeOperationId: typeof previous.stripeOperationId === "string"
      ? previous.stripeOperationId
      : null,
    confirmationState: (previous.confirmationState as FleetQuantityConfirmationState | undefined)
      ?? "pending",
    reconciliationState: (previous.reconciliationState as FleetQuantityReconciliationState | undefined)
      ?? "none",
    billingAccountState: (previous.billingAccountState as FleetBillingAccountSnapshot["state"] | undefined)
      ?? "active",
    evidence: {
      ...operation.evidence,
      lifecycle: {
        ...previous,
        currentKnownStripeQuantity: Number(
          previous.currentKnownStripeQuantity ?? operation.fromQuantity,
        ),
        requestedQuantity: operation.targetQuantity,
        confirmationState: (previous.confirmationState as FleetQuantityConfirmationState | undefined)
          ?? "pending",
        reconciliationState: (previous.reconciliationState as FleetQuantityReconciliationState | undefined)
          ?? "none",
        billingAccountState: (previous.billingAccountState as FleetBillingAccountSnapshot["state"] | undefined)
          ?? "active",
        stripeOperationId: typeof previous.stripeOperationId === "string"
          ? previous.stripeOperationId
          : null,
      },
      currentKnownStripeQuantity: Number(
        previous.currentKnownStripeQuantity ?? operation.fromQuantity,
      ),
      requestedQuantity: operation.targetQuantity,
      events: Array.isArray(operation.evidence.events) ? operation.evidence.events : [],
    },
  };
}

function requireMatchingDisposition(
  snapshot: FleetQuantityOperationTransitionSnapshot,
  observation: FleetQuantityDispositionObservation,
): void {
  if (
    observation.operationId !== snapshot.operationId
    || observation.stripeSubscriptionId !== snapshot.stripeSubscriptionId
    || observation.stripeCustomerId !== snapshot.stripeCustomerId
    || observation.stripePriceId !== snapshot.stripePriceId
    || !/^sub_[A-Za-z0-9]+$/.test(observation.stripeSubscriptionId)
    || !/^cus_[A-Za-z0-9]+$/.test(observation.stripeCustomerId)
    || !observation.stripePriceId
    || !observation.stripeOperationId.trim()
    || !["active", "trialing", "canceled"].includes(observation.subscriptionStatus)
    || !Number.isSafeInteger(observation.currentStripeQuantity)
    || observation.currentStripeQuantity < 1
    || !Number.isFinite(Date.parse(observation.observedAt))
  ) {
    throw new FleetQuantityOperationServiceError(
      "A verified Stripe disposition matching the reserved operation is required",
      "FLEET_QUANTITY_OPERATION_CONFLICT",
      snapshot.operationId,
    );
  }
}

function appendOperationEvent(
  snapshot: FleetQuantityOperationTransitionSnapshot,
  event: Record<string, unknown>,
  fields: Partial<FleetQuantityOperationTransitionSnapshot>,
): FleetQuantityOperationTransitionSnapshot {
  const events = Array.isArray(snapshot.evidence.events) ? snapshot.evidence.events : [];
  const nextLifecycle = {
    operationId: snapshot.operationId,
    operationType: snapshot.operationType,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripePriceId: snapshot.stripePriceId,
    currentKnownStripeQuantity: snapshot.currentKnownStripeQuantity,
    requestedQuantity: snapshot.requestedQuantity,
    requestHash: snapshot.requestHash,
    stripeOperationId: snapshot.stripeOperationId,
    confirmationState: snapshot.confirmationState,
    reconciliationState: snapshot.reconciliationState,
    billingAccountState: snapshot.billingAccountState,
    ...(snapshot.evidence.lifecycle && typeof snapshot.evidence.lifecycle === "object"
      ? snapshot.evidence.lifecycle as Record<string, unknown>
      : {}),
    ...fields,
  };
  const next = {
    ...snapshot,
    ...fields,
    evidence: {
      ...snapshot.evidence,
      lifecycle: nextLifecycle,
      ...fields,
      events: [...events, event],
    },
  };
  return next;
}

function requireVerifiedDisposition(
  snapshot: FleetQuantityOperationTransitionSnapshot,
  observation: FleetQuantityDispositionObservation,
  verifyDisposition?: (
    observation: FleetQuantityDispositionObservation,
  ) => Promise<boolean>,
): Promise<void> {
  return (async () => {
    requireMatchingDisposition(snapshot, observation);
    if (!verifyDisposition || !await verifyDisposition(observation)) {
      throw new FleetQuantityOperationServiceError(
        "Fleet Stripe disposition could not be verified",
        "FLEET_QUANTITY_OPERATION_CONFLICT",
        snapshot.operationId,
      );
    }
  })();
}

function requireOriginalStripeOperationId(
  snapshot: FleetQuantityOperationTransitionSnapshot,
  observation: FleetQuantityDispositionObservation,
): FleetQuantityOperationTransitionDecision | null {
  if (
    snapshot.stripeOperationId
    && snapshot.stripeOperationId !== observation.stripeOperationId
  ) {
    const next = appendOperationEvent(
      snapshot,
      {
        type: "stripe_operation_identity_conflict",
        expectedStripeOperationId: snapshot.stripeOperationId,
        observedStripeOperationId: observation.stripeOperationId,
        observedAt: observation.observedAt,
      },
      {
        state: "manual_review",
        confirmationState: "unknown",
        reconciliationState: "manual_review",
      },
    );
    return {
      // The first verified Stripe operation remains the identity of record.
      snapshot: next,
      action: "blocked",
      mayCreateAnotherOperation: false,
    };
  }
  return null;
}

/**
 * Pure development-side transition contract for the persisted Fleet operation
 * ledger. It performs no Stripe request. Definitive outcomes require a
 * verifier-produced observation; timeout/ambiguity conservatively blocks all
 * later operations until an explicit reconciliation supplies evidence.
 */
export async function transitionFleetQuantityOperation(input: {
  operation: FleetQuantityOperationDraft;
  current?: FleetQuantityOperationTransitionSnapshot;
  command: FleetQuantityOperationTransitionCommand;
  verifyDisposition?: (
    observation: FleetQuantityDispositionObservation,
  ) => Promise<boolean>;
}): Promise<FleetQuantityOperationTransitionDecision> {
  const current = input.current ?? operationSnapshotFromDraft(input.operation);
  const eventAt = (observedAt: string) => {
    if (!Number.isFinite(Date.parse(observedAt))) {
      throw new TypeError("Fleet quantity operation observation time is invalid");
    }
    return observedAt;
  };
  const blocked = (
    snapshot: FleetQuantityOperationTransitionSnapshot,
    action: FleetQuantityOperationTransitionDecision["action"],
    mayCreateAnotherOperation = false,
  ): FleetQuantityOperationTransitionDecision => ({
    snapshot,
    action,
    mayCreateAnotherOperation,
  });

  switch (input.command.kind) {
    case "begin": {
      if (current.state !== "reserved" || current.confirmationState !== "pending") {
        throw new FleetQuantityOperationServiceError(
          "Only a reserved Fleet operation can begin processing",
          "FLEET_QUANTITY_OPERATION_STATE_INVALID",
          current.operationId,
        );
      }
      const next = appendOperationEvent(
        current,
        { type: "processing_started" },
        { state: "processing" },
      );
      return blocked(next, "ready_to_submit_once");
    }
    case "reconcile": {
      const observation = input.command.observation;
      await requireVerifiedDisposition(current, observation, input.verifyDisposition);
      if (current.state !== "reconciling") {
        throw new FleetQuantityOperationServiceError(
          "Only an operation requiring reconciliation can accept reconciliation evidence",
          "FLEET_QUANTITY_OPERATION_STATE_INVALID",
          current.operationId,
        );
      }
      const identityConflict = requireOriginalStripeOperationId(current, observation);
      if (identityConflict) return identityConflict;

      const isFinalVehicle = current.operationType === "final_vehicle_transition";
      const unchangedQuantity =
        observation.currentStripeQuantity === current.currentKnownStripeQuantity;
      if (
        observation.resultStatus === "failed"
        && ["active", "trialing"].includes(observation.subscriptionStatus)
        && unchangedQuantity
      ) {
        const next = appendOperationEvent(
          current,
          {
            type: "reconciliation_verified_failure",
            stripeOperationId: observation.stripeOperationId,
            stripeEventId: observation.stripeEventId ?? null,
            resultStatus: observation.resultStatus,
            subscriptionStatus: observation.subscriptionStatus,
            observedAt: eventAt(observation.observedAt),
            currentStripeQuantity: observation.currentStripeQuantity,
          },
          {
            state: "terminal_failure",
            stripeOperationId: observation.stripeOperationId,
            confirmationState: "failed",
            reconciliationState: "resolved",
          },
        );
        return blocked(next, "operation_failed", true);
      }

      const targetMatches = isFinalVehicle
        ? observation.resultStatus === "canceled"
          && observation.subscriptionStatus === "canceled"
          && unchangedQuantity
        : observation.resultStatus === "succeeded"
          && ["active", "trialing"].includes(observation.subscriptionStatus)
          && observation.currentStripeQuantity === current.requestedQuantity;
      if (!targetMatches) {
        const next = appendOperationEvent(
          current,
          {
            type: "reconciliation_evidence_conflict",
            stripeOperationId: observation.stripeOperationId,
            resultStatus: observation.resultStatus,
            subscriptionStatus: observation.subscriptionStatus,
            currentStripeQuantity: observation.currentStripeQuantity,
            observedAt: eventAt(observation.observedAt),
          },
          {
            state: "manual_review",
            confirmationState: "unknown",
            reconciliationState: "manual_review",
          },
        );
        return blocked(next, "blocked");
      }

      const next = appendOperationEvent(
        current,
        {
          type: "reconciliation_verified_success",
          stripeOperationId: observation.stripeOperationId,
          stripeEventId: observation.stripeEventId ?? null,
          resultStatus: observation.resultStatus,
          subscriptionStatus: observation.subscriptionStatus,
          observedAt: eventAt(observation.observedAt),
          currentStripeQuantity: observation.currentStripeQuantity,
        },
        {
          state: "stripe_succeeded",
          currentKnownStripeQuantity: isFinalVehicle
            ? current.currentKnownStripeQuantity
            : observation.currentStripeQuantity,
          stripeOperationId: observation.stripeOperationId,
          confirmationState: "confirmed",
          reconciliationState: "resolved",
          ...(isFinalVehicle
            ? { billingAccountState: "cancellation_pending" as const }
            : {}),
        },
      );
      return blocked(next, "recover_existing_operation");
    }
    case "succeeded":
    case "confirm_completion": {
      const observation = input.command.observation;
      await requireVerifiedDisposition(current, observation, input.verifyDisposition);
      const identityConflict = requireOriginalStripeOperationId(current, observation);
      if (identityConflict) return identityConflict;
      if (current.state !== "processing" && current.state !== "stripe_succeeded") {
        throw new FleetQuantityOperationServiceError(
          "A verified Stripe success cannot resolve this operation state",
          "FLEET_QUANTITY_OPERATION_STATE_INVALID",
          current.operationId,
        );
      }
      const isFinalVehicle = current.operationType === "final_vehicle_transition";
      const targetMatches = isFinalVehicle
        ? observation.resultStatus === "canceled"
          && observation.subscriptionStatus === "canceled"
          && observation.currentStripeQuantity === current.currentKnownStripeQuantity
        : observation.resultStatus === "succeeded"
          && ["active", "trialing"].includes(observation.subscriptionStatus)
          && observation.currentStripeQuantity === current.requestedQuantity;
      if (!targetMatches) {
        throw new FleetQuantityOperationServiceError(
          "Verified Stripe result does not match the requested Fleet operation",
          "FLEET_QUANTITY_OPERATION_CONFLICT",
          current.operationId,
        );
      }
      if (
        input.command.kind === "confirm_completion"
        && current.state !== "stripe_succeeded"
      ) {
        throw new FleetQuantityOperationServiceError(
          "Only a Stripe-succeeded operation can be locally completed",
          "FLEET_QUANTITY_OPERATION_STATE_INVALID",
          current.operationId,
        );
      }
      const terminal = input.command.kind === "confirm_completion";
      const next = appendOperationEvent(
        current,
        {
          type: terminal ? "operation_completed" : "stripe_operation_succeeded",
          stripeOperationId: observation.stripeOperationId,
          stripeEventId: observation.stripeEventId ?? null,
          resultStatus: observation.resultStatus,
          subscriptionStatus: observation.subscriptionStatus,
          observedAt: eventAt(observation.observedAt),
          currentStripeQuantity: observation.currentStripeQuantity,
        },
        {
          state: terminal ? "completed" : "stripe_succeeded",
          currentKnownStripeQuantity: isFinalVehicle
            ? current.currentKnownStripeQuantity
            : observation.currentStripeQuantity,
          stripeOperationId: observation.stripeOperationId,
          confirmationState: "confirmed",
          reconciliationState: "resolved",
          ...(isFinalVehicle && terminal
            ? { billingAccountState: "canceled" as const }
            : isFinalVehicle
              ? { billingAccountState: "cancellation_pending" as const }
              : {}),
        },
      );
      return blocked(
        next,
        terminal ? "operation_confirmed" : "recover_existing_operation",
        terminal && !isFinalVehicle,
      );
    }
    case "definitely_failed": {
      const observation = input.command.observation;
      await requireVerifiedDisposition(current, observation, input.verifyDisposition);
      const identityConflict = requireOriginalStripeOperationId(current, observation);
      if (identityConflict) return identityConflict;
      if (
        current.state !== "processing"
        || observation.resultStatus !== "failed"
        || !["active", "trialing"].includes(observation.subscriptionStatus)
        || observation.currentStripeQuantity !== current.currentKnownStripeQuantity
      ) {
        throw new FleetQuantityOperationServiceError(
          "A failed operation can be released only after verified unchanged Stripe quantity",
          "FLEET_QUANTITY_OPERATION_CONFLICT",
          current.operationId,
        );
      }
      const next = appendOperationEvent(
        current,
        {
          type: "verified_operation_failure",
          stripeOperationId: observation.stripeOperationId,
          stripeEventId: observation.stripeEventId ?? null,
          resultStatus: observation.resultStatus,
          subscriptionStatus: observation.subscriptionStatus,
          observedAt: eventAt(observation.observedAt),
          currentStripeQuantity: observation.currentStripeQuantity,
        },
        {
          state: "terminal_failure",
          stripeOperationId: observation.stripeOperationId,
          confirmationState: "failed",
          reconciliationState: "resolved",
        },
      );
      return blocked(next, "operation_failed", true);
    }
    case "timed_out":
    case "ambiguous":
    case "response_lost": {
      if (!IN_FLIGHT_FLEET_QUANTITY_STATES.has(current.state)) {
        throw new FleetQuantityOperationServiceError(
          "Only an in-flight Fleet operation can enter reconciliation",
          "FLEET_QUANTITY_OPERATION_STATE_INVALID",
          current.operationId,
        );
      }
      const observedAt = eventAt(input.command.observedAt);
      const next = appendOperationEvent(
        current,
        {
          type: input.command.kind,
          reason: input.command.reason,
          observedAt,
        },
        {
          state: "reconciling",
          confirmationState: "unknown",
          reconciliationState: "required",
        },
      );
      return blocked(next, "reconcile_before_retry");
    }
    case "retry":
      if (
        current.state === "reconciling"
        || current.state === "manual_review"
        || current.state === "stripe_succeeded"
      ) {
        return blocked(current, "recover_existing_operation");
      }
      if (current.state === "processing" || current.state === "reserved") {
        return blocked(current, "recover_existing_operation");
      }
      return blocked(current, "operation_confirmed", false);
    case "duplicate_request":
      if (input.command.requestHash !== current.requestHash) {
        throw new FleetQuantityOperationServiceError(
          "Duplicate Fleet request does not match the existing operation",
          "FLEET_QUANTITY_OPERATION_CONFLICT",
          current.operationId,
        );
      }
      return blocked(
        current,
        IN_FLIGHT_FLEET_QUANTITY_STATES.has(current.state)
          || current.state === "manual_review"
          ? "recover_existing_operation"
          : current.state === "terminal_failure"
            ? "operation_failed"
            : "operation_confirmed",
        false,
      );
    case "concurrent_operation":
      return blocked(current, "blocked");
  }
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function mapBillingContext(row: Record<string, unknown>) {
  return {
    organization: {
      id: Number(row.organization_id),
      ownerClerkId: String(row.organization_owner_clerk_id),
    },
    account: {
      id: String(row.billing_account_id),
      organizationId: Number(row.account_organization_id),
      billingOwnerClerkId: String(row.billing_owner_clerk_id),
      stripeCustomerId: String(row.stripe_customer_id),
      stripeSubscriptionId: String(row.stripe_subscription_id),
      stripePriceId: String(row.stripe_price_id),
      state: String(row.account_state) as FleetBillingAccountSnapshot["state"],
      currentQuantity: Number(row.current_quantity),
      lastVerifiedAt: asDate(row.last_verified_at),
      stripeSubscriptionStatus: row.stripe_subscription_status
        ? String(row.stripe_subscription_status)
        : null,
    },
  };
}

function mapOperationForReconciliation(
  row: Record<string, unknown>,
): FleetQuantityOperationForReconciliation {
  const evidence =
    row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
      ? row.evidence as Record<string, unknown>
      : {};
  return {
    id: String(row.id),
    state: String(row.state) as FleetQuantityOperationState,
    stripeSubscriptionId: String(row.stripe_subscription_id),
    evidence,
    reconciliationReason: row.reconciliation_reason
      ? String(row.reconciliation_reason)
      : null,
  };
}

function appendReconciliationEvent(
  evidence: Record<string, unknown>,
  event: FleetQuantityReconciliationEvent,
): Record<string, unknown> {
  const existingEvents = Array.isArray(evidence.reconciliationEvents)
    ? evidence.reconciliationEvents
    : [];
  return {
    ...evidence,
    reconciliationEvents: [...existingEvents, event],
  };
}

function isUnresolvedOperationUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth++) {
    const record = candidate as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      record.code === "23505"
      && record.constraint === "fleet_quantity_operations_one_unresolved_per_subscription_uq"
    ) {
      return true;
    }
    candidate = record.cause;
  }
  return false;
}

function validateReconciliationEvent(
  reason: string,
  errorCategory?: string,
): FleetQuantityReconciliationEvent {
  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 1000) {
    throw new Error("A reconciliation reason between 1 and 1000 characters is required");
  }
  if (
    errorCategory !== undefined
    && !/^[a-z][a-z0-9_]{0,63}$/.test(errorCategory)
  ) {
    throw new Error("Invalid reconciliation error category");
  }
  return {
    reason: trimmedReason,
    observedAt: new Date().toISOString(),
    ...(errorCategory ? { errorCategory } : {}),
  };
}

/**
 * Reserve an operation record only. This service does not call Stripe and does
 * not activate, deactivate, or otherwise mutate Fleet vehicles.
 *
 * Billing identifiers and the last-verified quantity are loaded from the
 * persisted owner link; no Stripe fields are accepted from the caller.
 */
export async function reserveFleetQuantityOperation(
  input: ReserveFleetQuantityOperationInput,
  options: {
    store?: FleetQuantityOperationsStore;
  } = {},
): Promise<FleetQuantityOperationDraft> {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0) {
    throw new FleetBillingSafetyError(
      "A valid organization ID is required",
      "FLEET_QUANTITY_INVALID",
    );
  }
  if (!input.requesterClerkId.trim()) {
    throw new FleetBillingSafetyError(
      "An authenticated Fleet billing owner is required",
      "FLEET_BILLING_OWNERSHIP_MISMATCH",
    );
  }
  if (
    input.operationType === "quantity_change"
    && (!Number.isSafeInteger(input.desiredDelta) || input.desiredDelta === 0)
  ) {
    throw new FleetBillingSafetyError(
      "A non-zero integer quantity delta is required",
      "FLEET_QUANTITY_INVALID",
    );
  }

  const store = options.store ?? postgresFleetQuantityOperationsStore;
  const linkedSubscriptionId = await store.getSubscriptionIdForOrganization(
    input.organizationId,
  );
  if (!linkedSubscriptionId) {
    throw new FleetQuantityOperationServiceError(
      "No Fleet billing account exists for this organization",
      "FLEET_BILLING_ACCOUNT_NOT_FOUND",
    );
  }

  try {
    return await store.withSubscriptionTransaction(linkedSubscriptionId, async (tx) => {
      const context = await tx.getBillingContext(input.organizationId);
      if (!context) {
        throw new FleetQuantityOperationServiceError(
          "No Fleet billing account exists for this organization",
          "FLEET_BILLING_ACCOUNT_NOT_FOUND",
        );
      }
      const { organization, account } = context;
      if (account.stripeSubscriptionId !== linkedSubscriptionId) {
        throw new FleetBillingSafetyError(
          "Organization and persisted Fleet billing subscription changed during reservation",
          "FLEET_SUBSCRIPTION_MISMATCH",
        );
      }
      if (
        input.requesterClerkId !== organization.ownerClerkId
        || input.requesterClerkId !== account.billingOwnerClerkId
      ) {
        throw new FleetBillingSafetyError(
          "Only the verified organization billing owner may reserve a quantity operation",
          "FLEET_BILLING_OWNERSHIP_MISMATCH",
        );
      }

      const activeVehicleCount = await tx.countAuthoritativeActiveVehicles(
        input.organizationId,
      );
      const unresolved = await tx.findUnresolvedOperations(
        account.stripeSubscriptionId,
      );
      if (unresolved.length > 0) {
        throw new FleetQuantityOperationServiceError(
          "A Fleet quantity operation is already unresolved; reconcile it before creating another",
          "FLEET_QUANTITY_OPERATION_PENDING",
          unresolved[0]?.id,
        );
      }

      let operation: FleetQuantityOperationDraft;
      const subscription = persistedVerifiedSubscription(account);
      if (input.operationType === "final_vehicle_transition") {
        if (activeVehicleCount !== 1) {
          throw new FleetBillingSafetyError(
            "An explicit final-vehicle transition requires exactly one currently active vehicle",
            "FLEET_FINAL_VEHICLE_TRANSITION_REQUIRED",
          );
        }
        operation = prepareFinalFleetVehicleTransition({
          organization,
          account,
          subscription,
          priorActiveVehicleCount: activeVehicleCount,
          authoritativeActiveVehicleCount: activeVehicleCount + input.desiredDelta,
          explicitlyRequested: input.explicitlyRequested,
        });
      } else {
        const targetQuantity = activeVehicleCount + input.desiredDelta;
        operation = prepareFleetQuantityChange({
          organization,
          account,
          subscription,
          currentActiveVehicleCount: activeVehicleCount,
          authoritativeActiveVehicleCount: targetQuantity,
        });
      }

      operation.evidence = operationSnapshotFromDraft(operation).evidence;
      await tx.insertOperation(operation);
      return operation;
    });
  } catch (error) {
    if (isUnresolvedOperationUniqueViolation(error)) {
      throw new FleetQuantityOperationServiceError(
        "A Fleet quantity operation is already unresolved; reconcile it before creating another",
        "FLEET_QUANTITY_OPERATION_CONFLICT",
      );
    }
    throw error;
  }
}

/**
 * Preserve evidence and block retries when a Stripe result or transaction
 * outcome is ambiguous. This only changes the operation ledger; it never
 * invokes Stripe or mutates the associated vehicle records.
 */
export async function markFleetQuantityOperationReconciling(
  input: {
    operationId: string;
    reason: string;
    errorCategory?: string;
    observedAt?: Date;
  },
  options: {
    store?: FleetQuantityOperationsStore;
  } = {},
): Promise<FleetQuantityOperationSummary> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.operationId)) {
    throw new Error("A valid Fleet quantity operation ID is required");
  }
  const event = validateReconciliationEvent(input.reason, input.errorCategory);
  if (input.observedAt) {
    if (!Number.isFinite(input.observedAt.getTime())) {
      throw new Error("Invalid reconciliation observation time");
    }
    event.observedAt = input.observedAt.toISOString();
  }

  const store = options.store ?? postgresFleetQuantityOperationsStore;
  const linkedSubscriptionId = await store.getOperationSubscriptionId(
    input.operationId,
  );
  if (!linkedSubscriptionId) {
    throw new FleetQuantityOperationServiceError(
      "Fleet quantity operation was not found",
      "FLEET_QUANTITY_OPERATION_NOT_FOUND",
      input.operationId,
    );
  }

  return store.withSubscriptionTransaction(linkedSubscriptionId, async (tx) => {
    const operation = await tx.getOperationForUpdate(input.operationId);
    if (
      !operation
      || operation.stripeSubscriptionId !== linkedSubscriptionId
    ) {
      throw new FleetQuantityOperationServiceError(
        "Fleet quantity operation was not found",
        "FLEET_QUANTITY_OPERATION_NOT_FOUND",
        input.operationId,
      );
    }
    if (
      !["reserved", "processing", "stripe_succeeded", "reconciling"].includes(
        operation.state,
      )
    ) {
      throw new FleetQuantityOperationServiceError(
        `Cannot reconcile a Fleet quantity operation in state '${operation.state}'`,
        "FLEET_QUANTITY_OPERATION_STATE_INVALID",
        operation.id,
      );
    }
    await tx.markReconciling(operation, event);
    return { id: operation.id, state: "reconciling" };
  });
}

type SqlResult = { rows: Array<Record<string, unknown>> };
type SqlExecutor = {
  execute(query: SQL): Promise<SqlResult>;
};
export type FleetQuantityOperationsSqlDatabase = SqlExecutor & {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

function mapUnresolvedOperation(row: Record<string, unknown>): FleetQuantityOperationSummary {
  return {
    id: String(row.id),
    state: String(row.state) as FleetQuantityOperationState,
  };
}

/**
 * PostgreSQL-backed store. The transaction-scoped advisory lock serializes all
 * callers by Stripe subscription. The partial unique index remains the final
 * database-level protection against unresolved duplicate operations.
 */
export function createPostgresFleetQuantityOperationsStore(
  database: FleetQuantityOperationsSqlDatabase = db as unknown as FleetQuantityOperationsSqlDatabase,
): FleetQuantityOperationsStore {
  return {
    async getSubscriptionIdForOrganization(organizationId) {
      const result = await database.execute(sql`
        SELECT stripe_subscription_id
        FROM fleet_billing_accounts
        WHERE organization_id = ${organizationId}
      `);
      return result.rows[0]?.stripe_subscription_id
        ? String(result.rows[0].stripe_subscription_id)
        : null;
    },
    async getOperationSubscriptionId(operationId) {
      const result = await database.execute(sql`
        SELECT stripe_subscription_id
        FROM fleet_quantity_operations
        WHERE id = ${operationId}::uuid
      `);
      return result.rows[0]?.stripe_subscription_id
        ? String(result.rows[0].stripe_subscription_id)
        : null;
    },
    async withSubscriptionTransaction(stripeSubscriptionId, callback) {
      return database.transaction(async (rawTx) => {
        await rawTx.execute(sql`
          SELECT pg_advisory_xact_lock(
            ${FLEET_SUBSCRIPTION_LOCK_NAMESPACE},
            hashtext(${stripeSubscriptionId})
          )
        `);

        const tx: FleetQuantityOperationTransaction = {
          async getBillingContext(organizationId) {
            const result = await rawTx.execute(sql`
              SELECT
                o.id AS organization_id,
                o.owner_clerk_id AS organization_owner_clerk_id,
                a.id AS billing_account_id,
                a.organization_id AS account_organization_id,
                a.billing_owner_clerk_id,
                a.stripe_customer_id,
                a.stripe_subscription_id,
                a.stripe_price_id,
                a.state::text AS account_state,
                a.current_quantity,
                a.last_verified_at,
                a.stripe_subscription_status
              FROM organizations o
              JOIN fleet_billing_accounts a
                ON a.organization_id = o.id
              WHERE o.id = ${organizationId}
              FOR UPDATE OF o, a
            `);
            const row = result.rows[0];
            return row ? mapBillingContext(row) : null;
          },
          async countAuthoritativeActiveVehicles(organizationId) {
            const result = await rawTx.execute(sql`
              SELECT count(*)::integer AS active_count
              FROM fleet_vehicles
              WHERE organization_id = ${organizationId}
                AND status = 'active'
            `);
            return Number(result.rows[0]?.active_count ?? 0);
          },
          async findUnresolvedOperations(subscriptionId) {
            const result = await rawTx.execute(sql`
              SELECT id, state::text AS state
              FROM fleet_quantity_operations
              WHERE stripe_subscription_id = ${subscriptionId}
                AND state IN (
                  'reserved', 'processing', 'stripe_succeeded',
                  'reconciling', 'manual_review'
                )
              ORDER BY created_at ASC
              FOR UPDATE
            `);
            return result.rows.map(mapUnresolvedOperation);
          },
          async insertOperation(operation) {
            await rawTx.execute(sql`
              INSERT INTO fleet_quantity_operations (
                id,
                billing_account_id,
                organization_id,
                stripe_subscription_id,
                stripe_customer_id,
                stripe_price_id,
                operation_type,
                from_quantity,
                target_quantity,
                proration_behavior,
                apply_immediately,
                request_hash,
                stripe_idempotency_key_ref,
                state,
                evidence
              ) VALUES (
                ${operation.id}::uuid,
                ${operation.billingAccountId}::uuid,
                ${operation.organizationId},
                ${operation.stripeSubscriptionId},
                ${operation.stripeCustomerId},
                ${operation.stripePriceId},
                ${operation.operationType}::fleet_quantity_operation_type,
                ${operation.fromQuantity},
                ${operation.targetQuantity},
                ${operation.prorationBehavior},
                ${operation.applyImmediately},
                ${operation.requestHash},
                ${operation.stripeIdempotencyKeyRef},
                ${operation.state}::fleet_quantity_operation_state,
                ${JSON.stringify(operation.evidence)}::jsonb
              )
            `);
          },
          async getOperationForUpdate(operationId) {
            const result = await rawTx.execute(sql`
              SELECT
                id,
                state::text AS state,
                stripe_subscription_id,
                evidence,
                reconciliation_reason
              FROM fleet_quantity_operations
              WHERE id = ${operationId}::uuid
              FOR UPDATE
            `);
            const row = result.rows[0];
            return row ? mapOperationForReconciliation(row) : null;
          },
          async markReconciling(operation, event) {
            const evidenceWithEvent = appendReconciliationEvent(operation.evidence, event);
            const priorLifecycle =
              evidenceWithEvent.lifecycle
              && typeof evidenceWithEvent.lifecycle === "object"
              && !Array.isArray(evidenceWithEvent.lifecycle)
                ? evidenceWithEvent.lifecycle as Record<string, unknown>
                : {};
            const evidence = {
              ...evidenceWithEvent,
              lifecycle: {
                ...priorLifecycle,
                confirmationState: "unknown",
                reconciliationState: "required",
              },
            };
            await rawTx.execute(sql`
              UPDATE fleet_quantity_operations
              SET state = 'reconciling',
                  reconciliation_reason = ${event.reason},
                  last_error_category = ${event.errorCategory ?? "ambiguous_outcome"},
                  evidence = ${JSON.stringify(evidence)}::jsonb,
                  lease_owner = NULL,
                  lease_expires_at = NULL,
                  updated_at = ${new Date(event.observedAt)}
              WHERE id = ${operation.id}::uuid
            `);
          },
        };
        return callback(tx);
      });
    },
  };
}

const postgresFleetQuantityOperationsStore =
  createPostgresFleetQuantityOperationsStore();