import {
  canAddPersonalVehicle,
  getPersonalVehicleLimit,
  type MembershipPlan,
} from "./membershipEntitlements";

/**
 * Persistence adapter for the shared personal-vehicle allowance.
 *
 * Both /me/vehicles and legacy personal Fleet writes use this service from
 * inside their own database transaction. The adapter must acquire the same
 * per-Clerk-user transaction lock before reading either inventory.
 */
export type PersonalVehicleLimitStore = {
  lockUser(clerkUserId: string): Promise<void>;
  countProfileVehicles(clerkUserId: string): Promise<number>;
  countPersonalFleetVehicles(clerkUserId: string): Promise<number>;
};

export type PersonalVehicleUsage = Readonly<{
  plan: MembershipPlan;
  limit: 0 | 1 | 3;
  profileVehicleCount: number;
  personalFleetVehicleCount: number;
  activeVehicleCount: number;
  allowed: boolean;
  reconciliationRequired: boolean;
}>;

export type PersonalVehicleAllowanceFailure = Readonly<{
  status: 403 | 409;
  code:
    | "PLAN_VEHICLE_ACCESS_REQUIRED"
    | "PLAN_VEHICLE_LIMIT_REACHED"
    | "PERSONAL_VEHICLE_RECONCILIATION_REQUIRED";
  error: string;
  plan: MembershipPlan;
  activeVehicleCount: number;
  maxActiveVehicles: 0 | 1 | 3;
  reconciliationRequired: boolean;
}>;

/**
 * Serialize and read the complete personal inventory before allowing a new
 * active vehicle. Profile rows have no inactive state; only active legacy
 * Fleet rows without an organization count toward this shared allowance.
 * Existing over-limit rows are reported, never modified or deleted here.
 */
export async function inspectPersonalVehicleAllowance(
  store: PersonalVehicleLimitStore,
  clerkUserId: string,
  plan: MembershipPlan,
): Promise<PersonalVehicleUsage> {
  await store.lockUser(clerkUserId);
  const profileVehicleCount = await store.countProfileVehicles(clerkUserId);
  const personalFleetVehicleCount =
    await store.countPersonalFleetVehicles(clerkUserId);
  const activeVehicleCount = profileVehicleCount + personalFleetVehicleCount;
  const limit = getPersonalVehicleLimit(plan);

  return {
    plan,
    limit,
    profileVehicleCount,
    personalFleetVehicleCount,
    activeVehicleCount,
    allowed: canAddPersonalVehicle(plan, activeVehicleCount),
    reconciliationRequired: activeVehicleCount > limit,
  };
}

export function personalVehicleAllowanceFailure(
  usage: PersonalVehicleUsage,
): PersonalVehicleAllowanceFailure {
  if (usage.reconciliationRequired) {
    return {
      status: 409,
      code: "PERSONAL_VEHICLE_RECONCILIATION_REQUIRED",
      error:
        "Existing personal vehicle records exceed the current allowance; preserve them and reconcile before adding another.",
      plan: usage.plan,
      activeVehicleCount: usage.activeVehicleCount,
      maxActiveVehicles: usage.limit,
      reconciliationRequired: true,
    };
  }

  return {
    status: 403,
    code:
      usage.limit === 0
        ? "PLAN_VEHICLE_ACCESS_REQUIRED"
        : "PLAN_VEHICLE_LIMIT_REACHED",
    error:
      usage.limit === 0
        ? "Your current membership does not include personal vehicle profiles."
        : `Your ${usage.plan} membership allows up to ${usage.limit} active personal vehicle${usage.limit === 1 ? "" : "s"}.`,
    plan: usage.plan,
    activeVehicleCount: usage.activeVehicleCount,
    maxActiveVehicles: usage.limit,
    reconciliationRequired: false,
  };
}