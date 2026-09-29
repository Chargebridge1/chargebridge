import { Router } from "express";
import { db } from "@workspace/db";
import { stationsTable, reviewsTable, favoritesTable } from "@workspace/db";
import { eq, count, avg } from "drizzle-orm";

const router = Router();

router.get("/stats", async (req, res) => {
  const [stationCounts] = await db
    .select({ total: count(stationsTable.id) })
    .from(stationsTable);

  const [available] = await db
    .select({ count: count(stationsTable.id) })
    .from(stationsTable)
    .where(eq(stationsTable.status, "available"));

  const [busy] = await db
    .select({ count: count(stationsTable.id) })
    .from(stationsTable)
    .where(eq(stationsTable.status, "busy"));

  const [offline] = await db
    .select({ count: count(stationsTable.id) })
    .from(stationsTable)
    .where(eq(stationsTable.status, "offline"));

  const [dcfc] = await db
    .select({ count: count(stationsTable.id) })
    .from(stationsTable)
    .where(eq(stationsTable.chargerType, "DCFC"));

  const [level2] = await db
    .select({ count: count(stationsTable.id) })
    .from(stationsTable)
    .where(eq(stationsTable.chargerType, "Level2"));

  const [level1] = await db
    .select({ count: count(stationsTable.id) })
    .from(stationsTable)
    .where(eq(stationsTable.chargerType, "Level1"));

  const [reviewStats] = await db
    .select({ avg: avg(reviewsTable.rating), count: count(reviewsTable.id) })
    .from(reviewsTable);

  const [favCount] = await db
    .select({ count: count(favoritesTable.id) })
    .from(favoritesTable);

  return res.json({
    totalStations: stationCounts.total,
    availableStations: available.count,
    busyStations: busy.count,
    offlineStations: offline.count,
    totalDcfc: dcfc.count,
    totalLevel2: level2.count,
    totalLevel1: level1.count,
    averageRating: reviewStats.avg ? parseFloat(reviewStats.avg) : 0,
    totalReviews: reviewStats.count,
    favoritesCount: favCount.count,
  });
});

export default router;
