import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { favoritesTable, stationsTable, reviewsTable } from "@workspace/db";
import { eq, avg, count, and, inArray } from "drizzle-orm";
import { AddFavoriteBody, RemoveFavoriteParams } from "@workspace/api-zod";

const router = Router();

function getClerkUserId(req: any): string | null {
  const auth = getAuth(req);
  return auth?.userId ?? null;
}

async function getCommunityStationWithMeta(stationId: number, isFavorited = true) {
  const station = await db.query.stationsTable.findFirst({
    where: eq(stationsTable.id, stationId),
  });
  if (!station) return null;

  const [reviewStats] = await db
    .select({ avg: avg(reviewsTable.rating), count: count(reviewsTable.id) })
    .from(reviewsTable)
    .where(eq(reviewsTable.stationId, stationId));

  return {
    id: String(stationId),
    source: "community" as const,
    name: station.name,
    address: station.address,
    city: station.city,
    state: station.state,
    lat: station.lat,
    lng: station.lng,
    chargerType: station.chargerType,
    powerKw: station.powerKw,
    pricePerKwh: station.pricePerKwh,
    priceText: null,
    isFree: station.pricePerKwh === 0,
    totalPorts: station.totalPorts,
    availablePorts: station.availablePorts,
    status: station.status,
    network: station.network ?? null,
    ocppChargePointId: station.ocppChargePointId ?? null,
    website: null,
    externalStationId: null,
    averageRating: reviewStats.avg ? parseFloat(reviewStats.avg) : null,
    reviewCount: reviewStats.count,
    isFavorited,
    createdAt: station.createdAt.toISOString(),
  };
}

function buildExternalFavoriteStation(
  externalStationId: string,
  data: Record<string, unknown>,
  createdAt: Date,
) {
  return {
    id: externalStationId,
    source: "osm" as const,
    name: (data.name as string) ?? "Unknown Station",
    address: (data.address as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    state: (data.state as string | null) ?? null,
    lat: (data.lat as number) ?? 0,
    lng: (data.lng as number) ?? 0,
    chargerType: (data.chargerType as "Level1" | "Level2" | "DCFC") ?? "Level2",
    powerKw: (data.powerKw as number | null) ?? null,
    pricePerKwh: (data.pricePerKwh as number | null) ?? null,
    priceText: (data.priceText as string | null) ?? null,
    isFree: Boolean(data.isFree),
    totalPorts: (data.totalPorts as number | null) ?? null,
    availablePorts: (data.availablePorts as number | null) ?? null,
    status: (data.status as "available" | "busy" | "offline" | "unknown") ?? "unknown",
    network: (data.network as string | null) ?? null,
    ocppChargePointId: null,
    website: (data.website as string | null) ?? null,
    externalStationId,
    averageRating: null,
    reviewCount: 0,
    isFavorited: true,
    createdAt: createdAt.toISOString(),
  };
}

router.get("/favorites", async (req, res) => {
  const clerkUserId = getClerkUserId(req);

  if (!clerkUserId) {
    return res.json([]);
  }

  try {
    const favorites = await db
      .select()
      .from(favoritesTable)
      .where(eq(favoritesTable.clerkUserId, clerkUserId))
      .orderBy(favoritesTable.createdAt);

    // Batch-load all community stations + review stats (2 queries total, down from 2×N)
    const communityIds = favorites
      .filter((f) => f.stationId != null)
      .map((f) => f.stationId as number);

    const stationMap = new Map<number, typeof stationsTable.$inferSelect>();
    const reviewMap = new Map<number, { avg: string | null; count: number }>();

    if (communityIds.length > 0) {
      const [stationRows, reviewRows] = await Promise.all([
        db.select().from(stationsTable).where(inArray(stationsTable.id, communityIds)),
        db
          .select({
            stationId: reviewsTable.stationId,
            avgRating: avg(reviewsTable.rating),
            reviewCount: count(reviewsTable.id),
          })
          .from(reviewsTable)
          .where(inArray(reviewsTable.stationId, communityIds))
          .groupBy(reviewsTable.stationId),
      ]);
      for (const s of stationRows) stationMap.set(s.id, s);
      for (const r of reviewRows) reviewMap.set(r.stationId!, { avg: r.avgRating, count: r.reviewCount });
    }

    const result = favorites.map((f) => {
      try {
        if (f.stationId != null) {
          const station = stationMap.get(f.stationId);
          if (!station) return null;
          const rv = reviewMap.get(f.stationId);
          return {
            id: String(f.stationId),
            source: "community" as const,
            name: station.name,
            address: station.address,
            city: station.city,
            state: station.state,
            lat: station.lat,
            lng: station.lng,
            chargerType: station.chargerType,
            powerKw: station.powerKw,
            pricePerKwh: station.pricePerKwh,
            priceText: null,
            isFree: station.pricePerKwh === 0,
            totalPorts: station.totalPorts,
            availablePorts: station.availablePorts,
            status: station.status,
            network: station.network ?? null,
            ocppChargePointId: station.ocppChargePointId ?? null,
            website: null,
            externalStationId: null,
            averageRating: rv?.avg ? parseFloat(rv.avg) : null,
            reviewCount: rv?.count ?? 0,
            isFavorited: true,
            createdAt: station.createdAt.toISOString(),
          };
        }
        if (f.externalStationId && f.externalStationData) {
          return buildExternalFavoriteStation(
            f.externalStationId,
            f.externalStationData as Record<string, unknown>,
            f.createdAt,
          );
        }
      } catch {
        // Skip individual favorites that fail to resolve (e.g. deleted station)
      }
      return null;
    });

    return res.json(result.filter(Boolean));
  } catch (err) {
    // DB temporarily unavailable (e.g. environment restart) — return empty list
    // rather than 500 so the client renders cleanly without an error state.
    req.log.warn({ err }, "favorites GET: DB error, returning empty list");
    return res.json([]);
  }
});

router.post("/favorites", async (req, res) => {
  const parsed = AddFavoriteBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const clerkUserId = getClerkUserId(req);
  if (!clerkUserId) return res.status(401).json({ error: "Sign in to save favorites" });

  const { stationId, externalStationId, externalStationData } = parsed.data;

  try {
    if (stationId != null) {
      const station = await db.query.stationsTable.findFirst({
        where: eq(stationsTable.id, stationId),
      });
      if (!station) return res.status(404).json({ error: "Station not found" });

      const existing = await db.query.favoritesTable.findFirst({
        where: and(eq(favoritesTable.stationId, stationId), eq(favoritesTable.clerkUserId, clerkUserId)),
      });
      if (existing) {
        return res.status(201).json({ ...existing, createdAt: existing.createdAt.toISOString() });
      }

      const [favorite] = await db
        .insert(favoritesTable)
        .values({ stationId, clerkUserId })
        .returning();

      return res.status(201).json({ ...favorite, createdAt: favorite.createdAt.toISOString() });
    }

    if (externalStationId) {
      const existing = await db.query.favoritesTable.findFirst({
        where: and(eq(favoritesTable.externalStationId, externalStationId), eq(favoritesTable.clerkUserId, clerkUserId)),
      });
      if (existing) {
        return res.status(201).json({ ...existing, createdAt: existing.createdAt.toISOString() });
      }

      const [favorite] = await db
        .insert(favoritesTable)
        .values({
          externalStationId,
          externalStationData: externalStationData ?? {},
          clerkUserId,
        })
        .returning();

      return res.status(201).json({ ...favorite, createdAt: favorite.createdAt.toISOString() });
    }

    return res.status(400).json({ error: "Must provide stationId or externalStationId" });
  } catch (err) {
    req.log.error({ err }, "favorites POST: DB error");
    return res.status(503).json({ error: "Could not save favorite — please try again" });
  }
});

router.delete("/favorites/:stationId", async (req, res) => {
  const rawId = req.params.stationId;
  const clerkUserId = getClerkUserId(req);

  if (!clerkUserId) return res.status(401).json({ error: "Sign in to manage favorites" });

  const numericId = parseInt(rawId, 10);
  const isCommunity = !isNaN(numericId) && String(numericId) === rawId;

  try {
    if (isCommunity) {
      const parsed = RemoveFavoriteParams.safeParse({ stationId: rawId });
      if (!parsed.success) return res.status(400).json({ error: "Invalid stationId" });

      await db.delete(favoritesTable).where(
        and(eq(favoritesTable.stationId, numericId), eq(favoritesTable.clerkUserId, clerkUserId))
      );
    } else {
      await db.delete(favoritesTable).where(
        and(eq(favoritesTable.externalStationId, rawId), eq(favoritesTable.clerkUserId, clerkUserId))
      );
    }

    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "favorites DELETE: DB error");
    return res.status(503).json({ error: "Could not remove favorite — please try again" });
  }
});

export default router;
