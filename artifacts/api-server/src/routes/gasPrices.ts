import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

export async function ensureGasPricesTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gas_prices (
      id SERIAL PRIMARY KEY,
      osm_id TEXT NOT NULL,
      regular_cents INTEGER,
      mid_cents INTEGER,
      premium_cents INTEGER,
      diesel_cents INTEGER,
      reporter_name TEXT,
      reported_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS gas_prices_osm_id_idx ON gas_prices (osm_id);
  `);
}

export interface GasPriceRow {
  osmId: string;
  regularCents: number | null;
  midCents: number | null;
  premiumCents: number | null;
  dieselCents: number | null;
  reporterName: string | null;
  reportedAt: string;
}

export async function getLatestPricesForIds(osmIds: string[]): Promise<Map<string, GasPriceRow>> {
  if (osmIds.length === 0) return new Map();
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (osm_id)
      osm_id, regular_cents, mid_cents, premium_cents, diesel_cents, reporter_name, reported_at
    FROM gas_prices
    WHERE osm_id IN (${sql.join(osmIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY osm_id, reported_at DESC
  `);
  const map = new Map<string, GasPriceRow>();
  for (const r of rows.rows as any[]) {
    map.set(r.osm_id, {
      osmId: r.osm_id,
      regularCents: r.regular_cents,
      midCents: r.mid_cents,
      premiumCents: r.premium_cents,
      dieselCents: r.diesel_cents,
      reporterName: r.reporter_name,
      reportedAt: new Date(r.reported_at).toISOString(),
    });
  }
  return map;
}

router.get("/gas-prices/:osmId", async (req, res) => {
  const { osmId } = req.params;
  const rows = await db.execute(sql`
    SELECT id, osm_id, regular_cents, mid_cents, premium_cents, diesel_cents, reporter_name, reported_at
    FROM gas_prices WHERE osm_id = ${osmId}
    ORDER BY reported_at DESC LIMIT 10
  `);
  return res.json(
    (rows.rows as any[]).map((r) => ({
      id: r.id,
      osmId: r.osm_id,
      regularCents: r.regular_cents,
      midCents: r.mid_cents,
      premiumCents: r.premium_cents,
      dieselCents: r.diesel_cents,
      reporterName: r.reporter_name,
      reportedAt: new Date(r.reported_at).toISOString(),
    }))
  );
});

router.post("/gas-prices", async (req, res) => {
  const { osmId, regularCents, midCents, premiumCents, dieselCents, reporterName } = req.body;
  if (!osmId) return res.status(400).json({ error: "osmId is required" });

  const validate = (v: any): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = parseInt(v);
    if (isNaN(n) || n < 0 || n > 100000) return null;
    return n;
  };

  const reg = validate(regularCents);
  const mid = validate(midCents);
  const pre = validate(premiumCents);
  const die = validate(dieselCents);

  if (reg === null && mid === null && pre === null && die === null) {
    return res.status(400).json({ error: "At least one price must be provided" });
  }

  await db.execute(sql`
    INSERT INTO gas_prices (osm_id, regular_cents, mid_cents, premium_cents, diesel_cents, reporter_name, reported_at)
    VALUES (${osmId}, ${reg}, ${mid}, ${pre}, ${die}, ${reporterName || null}, NOW())
  `);

  req.log.info({ osmId, reg, mid, pre, die }, "Gas price reported");
  return res.json({ success: true });
});

export default router;
