import type Stripe from "stripe";
import stagingSubstitution from "../../../../lib/db/migrations/staging/membership-substitution.json";

export type MembershipPlanId = "explorer" | "driver" | "family" | "fleet";

export type MembershipPlan = {
  id: MembershipPlanId;
  name: string;
  description: string;
  unitAmount: number;
  currency: "usd";
  interval: "month";
  productId: string | null;
  priceId: string | null;
  maxActiveVehicles: number | null;
  quantityFromActiveFleetVehicles: boolean;
  entitlements: readonly string[];
};

/**
 * Server-authoritative development catalog. Checkout code must use this map;
 * request-body prices, names, quantities, and Stripe IDs are never authoritative.
 */
const DEVELOPMENT_MEMBERSHIP_CATALOG: Readonly<Record<MembershipPlanId, MembershipPlan>> = {
  explorer: {
    id: "explorer",
    name: "Explorer",
    description: "Basic station discovery and navigation",
    unitAmount: 0,
    currency: "usd",
    interval: "month",
    productId: null,
    priceId: null,
    maxActiveVehicles: null,
    quantityFromActiveFleetVehicles: false,
    entitlements: ["station_browsing", "station_search", "station_details", "basic_navigation"],
  },
  driver: {
    id: "driver",
    name: "Driver",
    description: "Driver membership",
    unitAmount: 499,
    currency: "usd",
    interval: "month",
    productId: "prod_UXygFuoApjQQVQ",
    priceId: "price_1U7jIjDItJjjt34XXl9sC071",
    maxActiveVehicles: 1,
    quantityFromActiveFleetVehicles: false,
    entitlements: [
      "station_browsing",
      "station_search",
      "station_details",
      "basic_navigation",
      "saved_stations",
      "charging_history",
      "receipts",
    ],
  },
  family: {
    id: "family",
    name: "Family",
    description: "Family membership",
    unitAmount: 999,
    currency: "usd",
    interval: "month",
    productId: "prod_VJb52POYyOYpQH",
    priceId: "price_1UIxt0DItJjjt34XP9YjcDJV",
    maxActiveVehicles: 3,
    quantityFromActiveFleetVehicles: false,
    entitlements: [
      "station_browsing",
      "station_search",
      "station_details",
      "basic_navigation",
      "saved_stations",
      "charging_history",
      "receipts",
      "household",
    ],
  },
  fleet: {
    id: "fleet",
    name: "Fleet",
    description: "Fleet membership billed per active vehicle",
    unitAmount: 1999,
    currency: "usd",
    interval: "month",
    productId: "prod_UXygLCNEL5xuLc",
    priceId: "price_1U7jIjDItJjjt34XIIyFnQrH",
    maxActiveVehicles: null,
    quantityFromActiveFleetVehicles: true,
    entitlements: [
      "station_browsing",
      "station_search",
      "station_details",
      "basic_navigation",
      "saved_stations",
      "charging_history",
      "receipts",
      "fleet_vehicle_management",
      "organization_management",
      "dashboard_analytics",
      "invoice_export",
    ],
  },
};

/**
 * Staging selects the independently verified catalog through the existing
 * CHARGEBRIDGE_ENVIRONMENT switch. All other environments retain the original
 * development catalog; an unverified staging manifest must fail closed.
 */
export function selectMembershipCatalog(
  environment: string | undefined,
): Readonly<Record<MembershipPlanId, MembershipPlan>> {
  if (environment !== "staging") return DEVELOPMENT_MEMBERSHIP_CATALOG;
  if (stagingSubstitution.status !== "verified-test-catalog" ||
      stagingSubstitution.providerVerification.status !== "passed" ||
      stagingSubstitution.providerVerification.accountId !== "acct_1TUeJWDItJjjt34X" ||
      stagingSubstitution.providerVerification.mode !== "test") {
    throw new Error("Staging membership catalog is not verified for the intended TEST account");
  }
  const { driver, family, fleet } = stagingSubstitution.catalog;
  return {
    ...DEVELOPMENT_MEMBERSHIP_CATALOG,
    driver: { ...DEVELOPMENT_MEMBERSHIP_CATALOG.driver, productId: driver.productId, priceId: driver.priceId },
    family: { ...DEVELOPMENT_MEMBERSHIP_CATALOG.family, productId: family.productId, priceId: family.priceId },
    fleet: { ...DEVELOPMENT_MEMBERSHIP_CATALOG.fleet, productId: fleet.productId, priceId: fleet.priceId },
  };
}

export const MEMBERSHIP_CATALOG = selectMembershipCatalog(process.env.CHARGEBRIDGE_ENVIRONMENT);

export function getMembershipPlan(value: unknown): MembershipPlan | null {
  if (typeof value !== "string" || !Object.hasOwn(MEMBERSHIP_CATALOG, value)) return null;
  return MEMBERSHIP_CATALOG[value as MembershipPlanId];
}

export function getMembershipPlanForPrice(priceId: unknown): MembershipPlan | null {
  if (typeof priceId !== "string") return null;
  return Object.values(MEMBERSHIP_CATALOG).find((plan) => plan.priceId === priceId) ?? null;
}

export function getMembershipPlanForSubscriptionPrices(priceIds: unknown): MembershipPlan | null {
  if (!Array.isArray(priceIds) || priceIds.length !== 1) return null;
  const plan = getMembershipPlanForPrice(priceIds[0]);
  return plan && plan.id !== "explorer" ? plan : null;
}

export function getPublicMembershipCatalog() {
  return Object.values(MEMBERSHIP_CATALOG).map((plan) => ({
    plan: plan.id,
    name: plan.name,
    description: plan.description,
    productId: plan.productId,
    priceId: plan.priceId,
    unitAmount: plan.unitAmount,
    currency: plan.currency,
    interval: plan.interval,
    maxActiveVehicles: plan.maxActiveVehicles,
    quantityFromActiveFleetVehicles: plan.quantityFromActiveFleetVehicles,
    entitlements: plan.entitlements,
  }));
}

/**
 * Verify Stripe's live object against the server catalog before starting a
 * paid checkout. This is especially important for Fleet: a Stripe Price is
 * immutable, so an old $14.99 Price must never be treated as the new $19.99
 * Fleet offer just because metadata or its display name looks similar.
 */
export function assertStripePriceMatchesCatalog(
  price: Stripe.Price,
  plan: MembershipPlan,
): void {
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  const intervalCount = price.recurring?.interval_count ?? 1;
  if (
    !plan.priceId ||
    !plan.productId ||
    price.id !== plan.priceId ||
    price.active !== true ||
    price.unit_amount !== plan.unitAmount ||
    price.currency.toLowerCase() !== plan.currency ||
    price.recurring?.interval !== plan.interval ||
    intervalCount !== 1 ||
    productId !== plan.productId
  ) {
    throw new Error(`Stripe Price verification failed for membership plan '${plan.id}'`);
  }
}