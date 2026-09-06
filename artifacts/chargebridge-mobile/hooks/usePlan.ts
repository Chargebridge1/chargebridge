import { useAuth, useUser } from "@clerk/expo";

export type MobilePlan = "free" | "explorer" | "driver" | "fleet";

const PLAN_RANK: Record<MobilePlan, number> = { free: 0, explorer: 1, driver: 2, fleet: 3 };

const PLAN_DISPLAY: Record<MobilePlan, string> = {
  free: "Free",
  explorer: "Explorer",
  driver: "Driver Pro",
  fleet: "Fleet Pro",
};

const INVOICE_LIMITS: Record<MobilePlan, number | null> = {
  free: 0,
  explorer: 5,
  driver: 10,
  fleet: null, // unlimited
};

export function usePlan() {
  const { sessionClaims, isSignedIn } = useAuth();
  const { isLoaded } = useUser();

  const rawPlan = (sessionClaims?.publicMetadata as { plan?: string } | undefined)?.plan;
  const plan: MobilePlan =
    rawPlan === "explorer" ? "explorer" :
    rawPlan === "driver"   ? "driver"   :
    rawPlan === "fleet"    ? "fleet"    :
    "free";

  const rank = PLAN_RANK[plan];
  const invoiceLimit = INVOICE_LIMITS[plan];

  return {
    plan,
    planName: PLAN_DISPLAY[plan],
    isLoaded,
    isSignedIn: !!isSignedIn,
    hasInvoiceAccess: rank >= 1,
    invoiceLimit,               // null = unlimited, 0 = no access
    invoiceMonthLabel:
      invoiceLimit === null ? "Unlimited" :
      invoiceLimit === 0    ? "No access" :
      `${invoiceLimit}/month`,
    isExplorer: rank >= 1,
    isDriver:   rank >= 2,
    isFleet:    rank >= 3,
  };
}
