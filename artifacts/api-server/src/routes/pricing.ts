import { Router } from "express";
import { db } from "@workspace/db";
import { pricingAuditTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

export interface PricingConfig {
  platformFeePercent: number;
  platformFeeFlatCents: number;
  platformFeeEnabled: boolean;
  subscriptionMonthlyUsd: number;
  subscriptionAnnualUsd: number;
  subscriptionEnabled: boolean;
  listingFeeOneTimeUsd: number;
  listingFeeMonthlyUsd: number;
  listingFeeEnabled: boolean;
  currency: string;
  updatedAt: string | null;
}

const DEFAULTS: Omit<PricingConfig, "updatedAt"> = {
  platformFeePercent: 5,
  platformFeeFlatCents: 0,
  platformFeeEnabled: false,
  subscriptionMonthlyUsd: 9.99,
  subscriptionAnnualUsd: 89.99,
  subscriptionEnabled: false,
  listingFeeOneTimeUsd: 0,
  listingFeeMonthlyUsd: 14.99,
  listingFeeEnabled: false,
  currency: "usd",
};

export async function ensurePricingTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS platform_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getPricingConfig(): Promise<PricingConfig> {
  const rows = await db.execute(sql`SELECT key, value, updated_at FROM platform_config`);
  const map = new Map<string, string>();
  let updatedAt: string | null = null;
  for (const row of rows.rows as any[]) {
    map.set(row.key, row.value);
    if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
  }

  function get<T>(key: string, def: T): T {
    const v = map.get(key);
    if (v === undefined) return def;
    if (typeof def === "boolean") return (v === "true") as unknown as T;
    if (typeof def === "number") return (parseFloat(v) || 0) as unknown as T;
    return v as unknown as T;
  }

  return {
    platformFeePercent: get("platformFeePercent", DEFAULTS.platformFeePercent),
    platformFeeFlatCents: get("platformFeeFlatCents", DEFAULTS.platformFeeFlatCents),
    platformFeeEnabled: get("platformFeeEnabled", DEFAULTS.platformFeeEnabled),
    subscriptionMonthlyUsd: get("subscriptionMonthlyUsd", DEFAULTS.subscriptionMonthlyUsd),
    subscriptionAnnualUsd: get("subscriptionAnnualUsd", DEFAULTS.subscriptionAnnualUsd),
    subscriptionEnabled: get("subscriptionEnabled", DEFAULTS.subscriptionEnabled),
    listingFeeOneTimeUsd: get("listingFeeOneTimeUsd", DEFAULTS.listingFeeOneTimeUsd),
    listingFeeMonthlyUsd: get("listingFeeMonthlyUsd", DEFAULTS.listingFeeMonthlyUsd),
    listingFeeEnabled: get("listingFeeEnabled", DEFAULTS.listingFeeEnabled),
    currency: get("currency", DEFAULTS.currency),
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
  };
}

async function setPricingConfig(
  updates: Partial<Omit<PricingConfig, "updatedAt">>,
  changedByClerkId: string,
  currentConfig: PricingConfig
) {
  for (const [key, value] of Object.entries(updates)) {
    const previousValue = String((currentConfig as any)[key] ?? "");
    const newValue = String(value);

    await db.execute(sql`
      INSERT INTO platform_config (key, value, updated_at)
      VALUES (${key}, ${newValue}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);

    // Audit log every field change
    await db.insert(pricingAuditTable).values({
      changedByClerkId,
      field: key,
      previousValue,
      newValue,
    });
  }
}

// GET /api/pricing — public, returns only public pricing configuration
router.get("/pricing", async (req, res) => {
  try {
    const config = await getPricingConfig();
    return res.json(config);
  } catch (err: any) {
    req.log.error({ err }, "Failed to get pricing config");
    return res.status(500).json({ error: "Failed to load pricing config" });
  }
});

// PUT /api/pricing — admin only; all changes are audit-logged
router.put("/pricing", requireAdmin, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;

  const {
    platformFeePercent, platformFeeFlatCents, platformFeeEnabled,
    subscriptionMonthlyUsd, subscriptionAnnualUsd, subscriptionEnabled,
    listingFeeOneTimeUsd, listingFeeMonthlyUsd, listingFeeEnabled,
    currency,
  } = req.body;

  const updates: Record<string, any> = {};

  if (platformFeePercent !== undefined) {
    const v = parseFloat(platformFeePercent);
    if (isNaN(v) || v < 0 || v > 50) return res.status(400).json({ error: "platformFeePercent must be 0–50" });
    updates.platformFeePercent = v;
  }
  if (platformFeeFlatCents !== undefined) {
    const v = parseInt(platformFeeFlatCents);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: "platformFeeFlatCents must be >= 0" });
    updates.platformFeeFlatCents = v;
  }
  if (platformFeeEnabled !== undefined) updates.platformFeeEnabled = Boolean(platformFeeEnabled);
  if (subscriptionMonthlyUsd !== undefined) {
    const v = parseFloat(subscriptionMonthlyUsd);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: "subscriptionMonthlyUsd must be >= 0" });
    updates.subscriptionMonthlyUsd = v;
  }
  if (subscriptionAnnualUsd !== undefined) {
    const v = parseFloat(subscriptionAnnualUsd);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: "subscriptionAnnualUsd must be >= 0" });
    updates.subscriptionAnnualUsd = v;
  }
  if (subscriptionEnabled !== undefined) updates.subscriptionEnabled = Boolean(subscriptionEnabled);
  if (listingFeeOneTimeUsd !== undefined) {
    const v = parseFloat(listingFeeOneTimeUsd);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: "listingFeeOneTimeUsd must be >= 0" });
    updates.listingFeeOneTimeUsd = v;
  }
  if (listingFeeMonthlyUsd !== undefined) {
    const v = parseFloat(listingFeeMonthlyUsd);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: "listingFeeMonthlyUsd must be >= 0" });
    updates.listingFeeMonthlyUsd = v;
  }
  if (listingFeeEnabled !== undefined) updates.listingFeeEnabled = Boolean(listingFeeEnabled);
  if (currency) updates.currency = currency;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields provided" });

  try {
    const currentConfig = await getPricingConfig();
    await setPricingConfig(updates, clerkUserId, currentConfig);
    const config = await getPricingConfig();
    req.log.info({ ...updates, changedBy: clerkUserId }, "Pricing config updated by admin");
    return res.json(config);
  } catch (err: any) {
    req.log.error({ err }, "Failed to update pricing config");
    return res.status(500).json({ error: "Failed to save pricing config" });
  }
});

export default router;
