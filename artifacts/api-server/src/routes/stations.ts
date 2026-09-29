import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { stationsTable, reviewsTable, favoritesTable, stationStatusReportsTable } from "@workspace/db";
import { eq, ilike, avg, count, sql, inArray, desc, and, gte, lte } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  ListStationsQueryParams,
  CreateStationBody,
  GetNearbyStationsQueryParams,
  GetStationParams,
  UpdateStationBody,
  UpdateStationParams,
} from "@workspace/api-zod";
import { requireStationOwnerOrAdmin } from "../middlewares/requireAuth";

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

// POST /stations: 20 submissions per hour per IP
const postStationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many station submissions. Please wait before submitting again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Sensitive field sanitization ─────────────────────────────────────────────
// ocppPassword must never be returned in any public API response.
type StationRow = typeof stationsTable.$inferSelect;
function sanitizeStation<T extends Partial<StationRow>>(station: T): Omit<T, "ocppPassword"> {
  const { ocppPassword: _omit, ...safe } = station as any;
  return safe;
}

function computeDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getStationWithMeta(stationId: number, includeRemoved = false) {
  const station = await db.query.stationsTable.findFirst({
    where: eq(stationsTable.id, stationId),
  });
  if (!station) return null;
  if (!includeRemoved && (station.status === "removed" || station.status === "pending")) return null;

  const [reviewStats] = await db
    .select({ avg: avg(reviewsTable.rating), count: count(reviewsTable.id) })
    .from(reviewsTable)
    .where(eq(reviewsTable.stationId, stationId));

  const favorite = await db.query.favoritesTable.findFirst({
    where: eq(favoritesTable.stationId, stationId),
  });

  return {
    ...sanitizeStation(station),
    averageRating: reviewStats.avg ? parseFloat(reviewStats.avg) : null,
    reviewCount: Number(reviewStats.count),
    isFavorited: !!favorite,
    ownerClerkUserId: station.ownerClerkUserId ?? null,
    createdAt: station.createdAt.toISOString(),
  };
}

async function getMetaBatch(stationIds: number[]) {
  if (stationIds.length === 0) return { reviewMap: new Map(), favSet: new Set<number>() };

  const [reviewRows, favRows] = await Promise.all([
    db
      .select({
        stationId: reviewsTable.stationId,
        avgRating: avg(reviewsTable.rating),
        reviewCount: count(reviewsTable.id),
      })
      .from(reviewsTable)
      .where(inArray(reviewsTable.stationId, stationIds))
      .groupBy(reviewsTable.stationId),
    db.select({ stationId: favoritesTable.stationId }).from(favoritesTable),
  ]);

  const reviewMap = new Map(reviewRows.map((r) => [r.stationId, r]));
  const favSet = new Set(favRows.map((f) => f.stationId));
  return { reviewMap, favSet };
}

async function getLatestReportsBatch(stationIds: number[]) {
  if (stationIds.length === 0) return new Map<number, { id: number; reportType: string; confirmations: number; createdAt: Date }>();
  const textIds = stationIds.flatMap((id) => [String(id), `db-${id}`]);
  const rows = await db
    .select()
    .from(stationStatusReportsTable)
    .where(inArray(stationStatusReportsTable.stationId, textIds))
    .orderBy(desc(stationStatusReportsTable.createdAt));
  const map = new Map<number, (typeof rows)[0]>();
  for (const row of rows) {
    const numId = parseInt(row.stationId.replace(/^db-/, ""), 10);
    if (!isNaN(numId) && !map.has(numId)) map.set(numId, row);
  }
  return map;
}

// EXCLUSION CONTRACT: All public station list/search/detail endpoints must
// never return stations with status="removed" (soft-deleted) or status="pending"
// (awaiting admin review) to unauthenticated or regular callers.
//
// Enforcement summary:
//   GET /stations              — Zod schema blocks status=removed; default adds NOT IN ('pending','removed')
//   GET /stations/nearby       — hardcoded NOT IN ('pending','removed')
//   GET /stations/chargeable   — hardcoded NOT IN ('pending','removed')
//   GET /stations/:id          — getStationWithMeta(id, includeRemoved=false) returns null→404
//   GET /stations/:id/amenities — removed check before serving amenity data
//
// Any new public query path MUST include an equivalent exclusion filter.

router.get("/stations", async (req, res) => {
  const parsed = ListStationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }
  const { chargerType, status, search } = parsed.data;

  let query = db.select().from(stationsTable).$dynamic();

  // Note: `status` is validated by ListStationsQueryParams to only allow
  // "available" | "busy" | "offline" — "removed" and "pending" are excluded
  // from the enum, so they can never be requested by external callers.
  // When no status filter is provided, the NOT IN clause below enforces the
  // exclusion contract as a defense-in-depth measure.
  const conditions = [];
  if (chargerType) conditions.push(eq(stationsTable.chargerType, chargerType));
  if (status) conditions.push(eq(stationsTable.status, status));
  else conditions.push(sql`${stationsTable.status} NOT IN ('pending', 'removed')`);
  if (search) conditions.push(ilike(stationsTable.name, `%${search}%`));

  if (conditions.length > 0) {
    query = query.where(sql`${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}`);
  }

  const stations = await query.orderBy(stationsTable.createdAt);
  if (stations.length === 0) return res.json([]);

  const stationIds = stations.map((s) => s.id);
  const [{ reviewMap, favSet }, latestReportMap] = await Promise.all([
    getMetaBatch(stationIds),
    getLatestReportsBatch(stationIds),
  ]);

  return res.json(
    stations.map((s) => {
      const rv = reviewMap.get(s.id);
      const lr = latestReportMap.get(s.id) ?? null;
      return {
        ...sanitizeStation(s),
        averageRating: rv?.avgRating ? parseFloat(rv.avgRating) : null,
        reviewCount: rv?.reviewCount ? Number(rv.reviewCount) : 0,
        isFavorited: favSet.has(s.id),
        createdAt: s.createdAt.toISOString(),
        latestReport: lr
          ? { id: lr.id, reportType: lr.reportType, confirmations: lr.confirmations, createdAt: lr.createdAt.toISOString() }
          : null,
      };
    })
  );
});

// POST /stations — intentionally allows anonymous submissions.
// New stations are always created in "pending" status and go through admin review
// before becoming visible. Anonymous submitters do NOT receive management authority
// over the station — ownerClerkUserId is only set for authenticated callers.
router.post("/stations", postStationRateLimit, async (req, res) => {
  const parsed = CreateStationBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error });
  }

  const clerkUserId = getAuth(req)?.userId ?? null;

  const [station] = await db
    .insert(stationsTable)
    .values({
      ...parsed.data,
      availablePorts: parsed.data.totalPorts,
      status: "pending",
      ownerClerkUserId: clerkUserId,
    })
    .returning();

  // Pass includeRemoved=true so the newly created pending station is still
  // returned to the submitter — the public-visibility filter must not hide
  // the station from the creator's own creation response.
  const full = await getStationWithMeta(station.id, true);
  return res.status(201).json(full);
});

router.get("/stations/nearby", async (req, res) => {
  const parsed = GetNearbyStationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }
  const { lat, lng, radiusMiles = 25 } = parsed.data;

  // Bounding-box pre-filter: 1° lat ≈ 69 mi, 1° lng ≈ 69*cos(lat) mi.
  // Reduces full-table scan to a tiny geographic slice before in-memory Haversine.
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  const stations = await db.select().from(stationsTable)
    .where(
      and(
        sql`${stationsTable.status} NOT IN ('pending', 'removed')`,
        gte(stationsTable.lat, lat - latDelta),
        lte(stationsTable.lat, lat + latDelta),
        gte(stationsTable.lng, lng - lngDelta),
        lte(stationsTable.lng, lng + lngDelta),
      )
    );
  const nearby = stations
    .map((s) => ({ ...sanitizeStation(s), distanceMiles: computeDistance(lat, lng, s.lat, s.lng) }))
    .filter((s) => s.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  if (nearby.length === 0) return res.json([]);

  const nearbyIds = nearby.map((s) => s.id);
  const [{ reviewMap, favSet }, latestReportMap] = await Promise.all([
    getMetaBatch(nearbyIds),
    getLatestReportsBatch(nearbyIds),
  ]);

  return res.json(
    nearby.map((s) => {
      const rv = reviewMap.get(s.id);
      const lr = latestReportMap.get(s.id) ?? null;
      return {
        ...s,
        averageRating: rv?.avgRating ? parseFloat(rv.avgRating) : null,
        reviewCount: rv?.reviewCount ? Number(rv.reviewCount) : 0,
        isFavorited: favSet.has(s.id),
        distanceMiles: s.distanceMiles,
        createdAt: s.createdAt.toISOString(),
        latestReport: lr
          ? { id: lr.id, reportType: lr.reportType, confirmations: lr.confirmations, createdAt: lr.createdAt.toISOString() }
          : null,
      };
    })
  );
});

router.get("/stations/chargeable/filters", async (req, res) => {
  const rows = await db
    .selectDistinct({
      country: stationsTable.country,
      state:   stationsTable.state,
      city:    stationsTable.city,
    })
    .from(stationsTable)
    .where(sql`(${stationsTable.ocppChargePointId} IS NOT NULL OR ${stationsTable.pricePerKwh} IS NOT NULL) AND ${stationsTable.status} NOT IN ('pending', 'removed')`)
    .orderBy(stationsTable.country, stationsTable.state, stationsTable.city);

  const countries = [...new Set(rows.map((r) => r.country))].sort();
  const countryStates: Record<string, string[]> = {};
  const stateCities:   Record<string, string[]> = {};

  for (const row of rows) {
    if (!countryStates[row.country]) countryStates[row.country] = [];
    if (!countryStates[row.country].includes(row.state)) countryStates[row.country].push(row.state);
    const key = `${row.country}|${row.state}`;
    if (!stateCities[key]) stateCities[key] = [];
    if (!stateCities[key].includes(row.city)) stateCities[key].push(row.city);
  }

  return res.json({ countries, countryStates, stateCities });
});

router.get("/stations/chargeable", async (req, res) => {
  const lat     = req.query.lat     != null ? parseFloat(req.query.lat     as string) : null;
  const lng     = req.query.lng     != null ? parseFloat(req.query.lng     as string) : null;
  const country = typeof req.query.country === "string" && req.query.country ? req.query.country : null;
  const state   = typeof req.query.state   === "string" && req.query.state   ? req.query.state   : null;
  const city    = typeof req.query.city    === "string" && req.query.city    ? req.query.city    : null;

  let whereClause = sql`(${stationsTable.ocppChargePointId} IS NOT NULL OR ${stationsTable.pricePerKwh} IS NOT NULL) AND ${stationsTable.status} NOT IN ('pending', 'removed')`;
  if (country) whereClause = sql`${whereClause} AND ${stationsTable.country} = ${country}`;
  if (state)   whereClause = sql`${whereClause} AND ${stationsTable.state}   = ${state}`;
  if (city)    whereClause = sql`${whereClause} AND ${stationsTable.city}    = ${city}`;

  const stations = await db
    .select()
    .from(stationsTable)
    .where(whereClause)
    .orderBy(stationsTable.name);


  if (stations.length === 0) return res.json([]);

  const stationIds = stations.map((s) => s.id);
  const [{ reviewMap, favSet }, latestReportMap] = await Promise.all([
    getMetaBatch(stationIds),
    getLatestReportsBatch(stationIds),
  ]);

  const withMeta = stations.map((s) => {
    const rv = reviewMap.get(s.id);
    const lr = latestReportMap.get(s.id) ?? null;
    const distanceMiles =
      lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
        ? computeDistance(lat, lng, s.lat, s.lng)
        : null;
    return {
      ...sanitizeStation(s),
      averageRating: rv?.avgRating ? parseFloat(rv.avgRating) : null,
      reviewCount: rv?.reviewCount ? Number(rv.reviewCount) : 0,
      isFavorited: favSet.has(s.id),
      createdAt: s.createdAt.toISOString(),
      distanceMiles,
      latestReport: lr
        ? { id: lr.id, reportType: lr.reportType, confirmations: lr.confirmations, createdAt: lr.createdAt.toISOString() }
        : null,
    };
  });

  if (lat != null && lng != null) {
    withMeta.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  }

  return res.json(withMeta);
});

router.get("/stations/:id", async (req, res) => {
  const parsed = GetStationParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const station = await getStationWithMeta(parsed.data.id);
  if (!station) return res.status(404).json({ error: "Station not found" });
  return res.json(station);
});

// PATCH /stations/:id — station owner or admin only
router.patch("/stations/:id", requireStationOwnerOrAdmin, async (req, res) => {
  const paramsParsed = UpdateStationParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateStationBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const updates: Record<string, unknown> = {};
  if (bodyParsed.data.status !== undefined) updates.status = bodyParsed.data.status;
  if (bodyParsed.data.availablePorts !== undefined) updates.availablePorts = bodyParsed.data.availablePorts;
  if (bodyParsed.data.description !== undefined) updates.description = bodyParsed.data.description;

  await db.update(stationsTable).set(updates).where(eq(stationsTable.id, paramsParsed.data.id));

  // Pass includeRemoved=true so setting status:"removed" still returns the updated station
  // (rather than 404) — the caller needs confirmation that the soft-delete succeeded.
  const station = await getStationWithMeta(paramsParsed.data.id, true);
  if (!station) return res.status(404).json({ error: "Station not found" });
  return res.json(station);
});

// ── Nearby amenities ─────────────────────────────────────────────────────────
interface NearbyAmenity { name: string; type: string; icon: string; distanceM: number; walkMins: number; }
const amenitiesCache = new Map<string, { data: NearbyAmenity[]; expires: number }>();

router.get("/stations/:id/amenities", async (req, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) return res.status(400).json({ error: "Invalid id" });

  const station = await db.query.stationsTable.findFirst({ where: eq(stationsTable.id, stationId) });
  // Exclusion contract: removed and pending stations must not leak location data via amenities.
  if (!station || station.status === "removed" || station.status === "pending") return res.status(404).json({ error: "Station not found" });

  const cacheKey = `${station.lat.toFixed(4)},${station.lng.toFixed(4)}`;
  const cached = amenitiesCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.json(cached.data);

  const { lat, lng } = station;
  const query = `[out:json][timeout:10];(node["amenity"~"^(cafe|restaurant|fast_food|toilets|pharmacy|supermarket|convenience)$"](around:400,${lat},${lng});node["tourism"~"^(hotel|motel)$"](around:400,${lat},${lng}););out body;`;

  const ICON: Record<string, string> = { cafe:"☕", restaurant:"🍽️", fast_food:"🍔", toilets:"🚻", pharmacy:"💊", supermarket:"🛒", convenience:"🛍️", hotel:"🏨", motel:"🏨" };
  const LABEL: Record<string, string> = { cafe:"Café", restaurant:"Restaurant", fast_food:"Fast food", toilets:"Restrooms", pharmacy:"Pharmacy", supermarket:"Grocery", convenience:"Convenience store", hotel:"Hotel", motel:"Motel" };

  let amenities: NearbyAmenity[] = [];
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok) {
      const data = await r.json() as { elements: Array<{ lat: number; lon: number; tags?: Record<string, string> }> };
      const seen = new Set<string>();
      for (const el of data.elements) {
        const tags = el.tags ?? {};
        const key = tags.amenity ?? tags.tourism ?? "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const distM = computeDistance(lat, lng, el.lat, el.lon) * 1609.34;
        amenities.push({ name: tags.name ?? LABEL[key] ?? key, type: LABEL[key] ?? key, icon: ICON[key] ?? "📍", distanceM: Math.round(distM), walkMins: Math.max(1, Math.ceil(distM / 80)) });
      }
      amenities.sort((a, b) => a.distanceM - b.distanceM);
      amenities = amenities.slice(0, 8);
    }
  } catch { /* return empty list on network error */ }

  amenitiesCache.set(cacheKey, { data: amenities, expires: Date.now() + 60 * 60 * 1000 });
  return res.json(amenities);
});

export default router;
