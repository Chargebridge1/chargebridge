import { createHash, randomUUID } from "node:crypto";
import {
  getMembershipPlanForPrice,
  type MembershipPlan,
} from "./membershipCatalog";

export type FleetBillingAccountSnapshot = {
  id: string;
  organizationId: number;
  billingOwnerClerkId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  state: "pending" | "active" | "reconciling" | "cancellation_pending" | "canceled" | "manual_review";
  currentQuantity: number;
  lastVerifiedAt: Date | null;
  stripeSubscriptionStatus: string | null;
};

export type FleetOrganizationSnapshot = {
  id: number;
  ownerClerkId: string;
};

export type FleetStripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  status: string;
  items: Array<{
    priceId: string;
    productId: string;
    unitAmount: number | null;
    currency: string;
    interval: string | null;
    intervalCount: number | null;
    active: boolean;
    quantity: number | null;
  }>;
};

export type FleetQuantityOperationState =
  | "reserved"
  | "processing"
  | "stripe_succeeded"
  | "completed"
  | "retryable_failure"
  | "reconciling"
  | "terminal_failure"
  | "cancelled"
  | "manual_review";

export type FleetQuantityOperationDraft = {
  id: string;
  billingAccountId: string;
  organizationId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  operationType: "quantity_change" | "final_vehicle_transition";
  fromQuantity: number;
  targetQuantity: number | null;
  prorationBehavior: "create_prorations";
  applyImmediately: true;
  requestHash: string;
  stripeIdempotencyKeyRef: string;
  state: "reserved";
  evidence: Record<string, unknown>;
};

const UNRESOLVED_OPERATION_STATES = new Set<FleetQuantityOperationState>([
  "reserved",
  "processing",
  "stripe_succeeded",
  "reconciling",
  "manual_review",
]);

export class FleetBillingSafetyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "FLEET_BILLING_NOT_VERIFIED"
      | "FLEET_BILLING_OWNERSHIP_MISMATCH"
      | "FLEET_SUBSCRIPTION_MISMATCH"
      | "FLEET_PRICE_UNMAPPED"
      | "FLEET_QUANTITY_MISMATCH"
       | "FLEET_VEHICLE_COUNT_MISMATCH"
      | "FLEET_QUANTITY_INVALID"
      | "FLEET_OPERATION_PENDING"
      | "FLEET_FINAL_VEHICLE_TRANSITION_REQUIRED"
       | "FLEET_QUANTITY_CHANGE_NOT_READY"
       | "FLEET_QUANTITY_ALREADY_MATCHED",
  ) {
    super(message);
    this.name = "FleetBillingSafetyError";
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FleetBillingSafetyError(
      `${field} must be a positive integer`,
      "FLEET_QUANTITY_INVALID",
    );
  }
}

function assertFleetOwnershipAndLiveSubscription(input: {
  organization: FleetOrganizationSnapshot;
  account: FleetBillingAccountSnapshot;
  subscription: FleetStripeSubscriptionSnapshot;
}): MembershipPlan {
  const { organization, account, subscription } = input;
  if (
    !Number.isSafeInteger(organization.id)
    || organization.id !== account.organizationId
    || organization.ownerClerkId !== account.billingOwnerClerkId
  ) {
    throw new FleetBillingSafetyError(
      "Organization owner does not match the persisted Fleet billing owner",
      "FLEET_BILLING_OWNERSHIP_MISMATCH",
    );
  }
  if (
    account.state !== "active"
    || !account.lastVerifiedAt
    || !["active", "trialing"].includes(account.stripeSubscriptionStatus ?? "")
  ) {
    throw new FleetBillingSafetyError(
      "Fleet billing relationship is not verified and active",
      "FLEET_BILLING_NOT_VERIFIED",
    );
  }
  if (
    subscription.id !== account.stripeSubscriptionId
    || subscription.customerId !== account.stripeCustomerId
    || !["active", "trialing"].includes(subscription.status)
  ) {
    throw new FleetBillingSafetyError(
      "Retrieved Stripe subscription does not match its verified Fleet billing owner",
      "FLEET_SUBSCRIPTION_MISMATCH",
    );
  }

  const plan = getMembershipPlanForPrice(account.stripePriceId);
  if (
    !plan
    || plan.id !== "fleet"
    || subscription.items.length !== 1
    || subscription.items[0]?.priceId !== plan.priceId
    || subscription.items[0]?.productId !== plan.productId
    || subscription.items[0]?.unitAmount !== plan.unitAmount
    || subscription.items[0]?.currency.toLowerCase() !== plan.currency
    || subscription.items[0]?.interval !== plan.interval
    || subscription.items[0]?.intervalCount !== 1
    || subscription.items[0]?.active !== true
  ) {
    throw new FleetBillingSafetyError(
      "Fleet subscription does not contain exactly the approved Fleet Price",
      "FLEET_PRICE_UNMAPPED",
    );
  }

  const liveQuantity = subscription.items[0]?.quantity;
  requirePositiveInteger(account.currentQuantity, "Stored Fleet quantity");
  if (
    !Number.isSafeInteger(liveQuantity)
    || liveQuantity !== account.currentQuantity
  ) {
    throw new FleetBillingSafetyError(
      "Stored Fleet quantity does not match the retrieved Stripe subscription",
      "FLEET_QUANTITY_MISMATCH",
    );
  }
  return plan;
}

function assertNoUnresolvedOperation(
  state: FleetQuantityOperationState | null,
): void {
  if (state && UNRESOLVED_OPERATION_STATES.has(state)) {
    throw new FleetBillingSafetyError(
      "A Fleet quantity operation is pending or requires reconciliation",
      "FLEET_OPERATION_PENDING",
    );
  }
}

function createOperationDraft(input: {
  organization: FleetOrganizationSnapshot;
  account: FleetBillingAccountSnapshot;
  subscription: FleetStripeSubscriptionSnapshot;
  targetQuantity: number | null;
  operationType: FleetQuantityOperationDraft["operationType"];
}): FleetQuantityOperationDraft {
  const plan = assertFleetOwnershipAndLiveSubscription(input);
  const id = randomUUID();
  const requestBody = JSON.stringify({
    organizationId: input.organization.id,
    billingAccountId: input.account.id,
    stripeSubscriptionId: input.subscription.id,
    stripeCustomerId: input.subscription.customerId,
    stripePriceId: plan.priceId,
    operationType: input.operationType,
    fromQuantity: input.account.currentQuantity,
    targetQuantity: input.targetQuantity,
    prorationBehavior: "create_prorations",
    applyImmediately: true,
  });
  const requestHash = createHash("sha256").update(requestBody).digest("hex");

  return {
    id,
    billingAccountId: input.account.id,
    organizationId: input.organization.id,
    stripeSubscriptionId: input.subscription.id,
    stripeCustomerId: input.subscription.customerId,
    stripePriceId: plan.priceId!,
    operationType: input.operationType,
    fromQuantity: input.account.currentQuantity,
    targetQuantity: input.targetQuantity,
    prorationBehavior: "create_prorations",
    applyImmediately: true,
    requestHash,
    // The key is server-owned and deterministic from the persisted operation ID.
    stripeIdempotencyKeyRef: `fleet-quantity:${id}`,
    state: "reserved",
    evidence: {
      intent: "development_only_no_stripe_mutation",
      source: "authoritative_active_vehicle_count",
    },
  };
}

/**
 * Build (but never execute) the durable intent to synchronize quantity from
 * the authoritative active-vehicle count. Persistence/locking is performed by
 * the route layer after the schema is exported by the owning integration.
 */
export function prepareFleetQuantityChange(input: {
  organization: FleetOrganizationSnapshot;
  account: FleetBillingAccountSnapshot;
  subscription: FleetStripeSubscriptionSnapshot;
  currentActiveVehicleCount: number;
  authoritativeActiveVehicleCount: number;
  unresolvedOperationState?: FleetQuantityOperationState | null;
}): FleetQuantityOperationDraft {
  assertNoUnresolvedOperation(input.unresolvedOperationState ?? null);
  const target = input.authoritativeActiveVehicleCount;
  const current = input.currentActiveVehicleCount;
  if (
    !Number.isSafeInteger(target)
    || target < 0
    || !Number.isSafeInteger(current)
    || current < 0
  ) {
    throw new FleetBillingSafetyError(
      "Authoritative active vehicle counts must be non-negative integers",
      "FLEET_QUANTITY_INVALID",
    );
  }
  if (current !== input.account.currentQuantity) {
    throw new FleetBillingSafetyError(
      "Current active vehicle inventory does not match the verified Fleet subscription quantity",
      "FLEET_VEHICLE_COUNT_MISMATCH",
    );
  }
  if (target === 0) {
    throw new FleetBillingSafetyError(
      "The final active vehicle requires an explicit cancellation/transition operation",
      "FLEET_FINAL_VEHICLE_TRANSITION_REQUIRED",
    );
  }
  if (target === input.account.currentQuantity) {
    throw new FleetBillingSafetyError(
      "Fleet quantity already matches the authoritative active vehicle count",
      "FLEET_QUANTITY_ALREADY_MATCHED",
    );
  }
  return createOperationDraft({
    organization: input.organization,
    account: input.account,
    subscription: input.subscription,
    targetQuantity: target,
    operationType: "quantity_change",
  });
}

/**
 * Build an explicit cancellation transition for a final-vehicle removal.
 * targetQuantity is NULL, never zero. This function creates no Stripe request.
 */
export function prepareFinalFleetVehicleTransition(input: {
  organization: FleetOrganizationSnapshot;
  account: FleetBillingAccountSnapshot;
  subscription: FleetStripeSubscriptionSnapshot;
  priorActiveVehicleCount: number;
  authoritativeActiveVehicleCount: number;
  explicitlyRequested: boolean;
  unresolvedOperationState?: FleetQuantityOperationState | null;
}): FleetQuantityOperationDraft {
  assertNoUnresolvedOperation(input.unresolvedOperationState ?? null);
  if (!input.explicitlyRequested || input.authoritativeActiveVehicleCount !== 0) {
    throw new FleetBillingSafetyError(
      "Final-vehicle transition requires an explicit cancellation request and zero active vehicles",
      "FLEET_FINAL_VEHICLE_TRANSITION_REQUIRED",
    );
  }
  if (
    !Number.isSafeInteger(input.priorActiveVehicleCount)
    || input.priorActiveVehicleCount <= 0
    || input.priorActiveVehicleCount !== input.account.currentQuantity
  ) {
    throw new FleetBillingSafetyError(
      "Current active vehicle inventory does not match the verified Fleet subscription quantity",
      "FLEET_VEHICLE_COUNT_MISMATCH",
    );
  }
  return createOperationDraft({
    organization: input.organization,
    account: input.account,
    subscription: input.subscription,
    targetQuantity: null,
    operationType: "final_vehicle_transition",
  });
}

/**
 * Active-vehicle mutations affect Fleet billing quantity. Until the durable
 * operation has been reconciled with Stripe, callers must not make the vehicle
 * capacity active or remove paid capacity locally.
 */
export function assertFleetVehicleMutationHasConfirmedBilling(input: {
  currentActiveVehicleCount: number;
  targetActiveVehicleCount: number;
  confirmedStripeQuantity: number | null;
  unresolvedOperationState?: FleetQuantityOperationState | null;
}): void {
  const { currentActiveVehicleCount, targetActiveVehicleCount, confirmedStripeQuantity } = input;
  if (
    !Number.isSafeInteger(currentActiveVehicleCount)
    || currentActiveVehicleCount < 0
    || !Number.isSafeInteger(targetActiveVehicleCount)
    || targetActiveVehicleCount < 0
  ) {
    throw new FleetBillingSafetyError(
      "Active vehicle counts must be non-negative integers",
      "FLEET_QUANTITY_INVALID",
    );
  }
  assertNoUnresolvedOperation(input.unresolvedOperationState ?? null);
  if (targetActiveVehicleCount === 0 && currentActiveVehicleCount > 0) {
    throw new FleetBillingSafetyError(
      "The final active vehicle requires an explicit cancellation/transition operation",
      "FLEET_FINAL_VEHICLE_TRANSITION_REQUIRED",
    );
  }
  if (targetActiveVehicleCount === currentActiveVehicleCount) return;
  if (
    !Number.isSafeInteger(confirmedStripeQuantity)
    || confirmedStripeQuantity !== targetActiveVehicleCount
  ) {
    throw new FleetBillingSafetyError(
      "Active vehicle changes remain unavailable until the matching Stripe quantity operation is confirmed",
      "FLEET_QUANTITY_CHANGE_NOT_READY",
    );
  }
}