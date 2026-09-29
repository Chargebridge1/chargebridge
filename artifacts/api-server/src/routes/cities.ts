import { Router } from "express";
import { db } from "@workspace/db";
import { stationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

const CACHE = { data: null as unknown, ts: 0 };
const TTL = 10 * 60 * 1000;

router.get("/cities", async (_req, res) => {
  if (CACHE.data && Date.now() - CACHE.ts < TTL) { res.json(CACHE.data); return; }

  const rows = await db
    .select({
      city: stationsTable.city,
      state: stationsTable.state,
      count: sql<number>`count(*)::int`,
      availableCount: sql<number>`sum(case when ${stationsTable.status} = 'available' then 1 else 0 end)::int`,
      lat: sql<number>`avg(${stationsTable.lat})`,
      lng: sql<number>`avg(${stationsTable.lng})`,
    })
    .from(stationsTable)
    .groupBy(stationsTable.city, stationsTable.state)
    .orderBy(sql`count(*) desc`)
    .limit(100);

  CACHE.data = rows;
  CACHE.ts = Date.now();
  res.json(rows);
});

export default router;
