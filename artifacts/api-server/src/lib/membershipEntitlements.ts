import {
  getMembershipPlan,
  type MembershipPlanId,
} from "./membershipCatalog";

export type MembershipPlan = MembershipPlanId;

export type MembershipEntitlement = {
  plan: MembershipPlan;
  personalVehicleLimit: 0 | 1 | 3;
  features: readonly string[];
};

const PERSONAL_VEHICLE_LIMITS: Record<MembershipPlan, 0 | 1 | 3> = {
  explorer: 0,
  driver: 1,
  family: 3,
  // Fleet vehicles are managed through fleet endpoints and separately billed
  // against active organization vehicles. No personal-profile allowance is
  // specified by the launch contract, so personal vehicle creation fails closed.
  fleet: 0,
};

function entitlementForPlan(plan: MembershipPlan): MembershipEntitlement {
  const catalogPlan = getMembershipPlan(plan);
  if (!catalogPlan) {
    throw new Error(`Membership catalog is missing canonical plan '${plan}'`);
  }
  return {
    plan,
    personalVehicleLimit: PERSONAL_VEHICLE_LIMITS[plan],
    features: catalogPlan.entitlements,
  };
}

const EXPLORER_ENTITLEMENT = entitlementForPlan("explorer");

/**
 * Resolve the plan from Clerk's verified session claims.
 * Unknown/missing claims intentionally receive only Explorer/basic access.
 * Plan names are exact canonical IDs; display names and arbitrary metadata
 * fields are not accepted as entitlement evidence.
 */
export function resolveMembershipEntitlement(sessionClaims: unknown): MembershipEntitlement {
  if (!sessionClaims || typeof sessionClaims !== "object") {
    return EXPLORER_ENTITLEMENT;
  }

  const claims = sessionClaims as {
    publicMetadata?: { plan?: unknown };
    public_metadata?: { plan?: unknown };
  };
  const plan = claims.publicMetadata?.plan ?? claims.public_metadata?.plan;
  const canonicalPlan = getMembershipPlan(plan);
  return canonicalPlan ? entitlementForPlan(canonicalPlan.id) : EXPLORER_ENTITLEMENT;
}

export function canAddPersonalVehicle(plan: MembershipPlan, activeVehicleCount: number): boolean {
  return Number.isInteger(activeVehicleCount)
    && activeVehicleCount >= 0
    && activeVehicleCount < getPersonalVehicleLimit(plan);
}

export function getPersonalVehicleLimit(plan: MembershipPlan): 0 | 1 | 3 {
  return PERSONAL_VEHICLE_LIMITS[plan];
}