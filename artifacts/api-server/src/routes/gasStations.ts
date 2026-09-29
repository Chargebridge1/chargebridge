import { Router } from "express";
import { db } from "@workspace/db";
import { gasStationReviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getLatestPricesForIds } from "./gasPrices";
import { getEiaPricesForLocation } from "../lib/eiaFuelPrices";
import { getFredPricesForLocation } from "../lib/fredFuelPrices";
import { getAaaPricesForState } from "../lib/aaaFuelPrices";

const router = Router();

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// In-memory Overpass cache for gas stations (5-minute TTL)
// Community prices are always fetched fresh from the DB on top of this.
const GAS_OVERPASS_CACHE_TTL_MS = 5 * 60 * 1000;
const gasOverpassCache = new Map<string, { data: any[]; at: number }>();

// Processed-result cache — stores the final normalized+enriched response so the
// catch-block fallback can return properly shaped data instead of raw Overpass elements.
const gasResultCache = new Map<string, { data: any[]; at: number }>();

function gasOverpassCacheKey(lat: number, lng: number, radiusMeters: number): string {
  // ~1.1 km grid so nearby requests share a cache entry
  return `${Math.round(lat * 100) / 100}:${Math.round(lng * 100) / 100}:${radiusMeters}`;
}

// Reverse geocode cache — keyed to ~0.5° grid (~55 km), 24-hour TTL
const reverseGeoCache = new Map<string, { state: string | null; at: number }>();
const REVERSE_GEO_TTL_MS = 24 * 60 * 60 * 1000;

async function getStateForCoords(lat: number, lng: number): Promise<string | null> {
  const key = `${Math.round(lat * 2) / 2}:${Math.round(lng * 2) / 2}`;
  const cached = reverseGeoCache.get(key);
  if (cached && Date.now() - cached.at < REVERSE_GEO_TTL_MS) return cached.state;

  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=5`,
      {
        headers: {
          "User-Agent": "ChargeBridge/1.0 (community EV finder; contact@chargebridge.app)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: any = await resp.json();
    // Prefer ISO 3166-2 subdivision code (e.g. "US-CA") → strip prefix
    const iso = (data.address?.["ISO3166-2-lvl4"] as string | undefined) ?? "";
    const stateCode = iso.startsWith("US-") ? iso.slice(3) : null;
    reverseGeoCache.set(key, { state: stateCode, at: Date.now() });
    return stateCode;
  } catch {
    reverseGeoCache.set(key, { state: null, at: Date.now() });
    return null;
  }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Parse OSM price string like "3.499", "$3.49", "3.49 USD" → cents
function parseOsmPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n <= 0 || n > 20) return null;
  // OSM prices are per litre in many countries, but per gallon in US (typically 3–6)
  // Heuristic: if < 3, assume per litre → convert to per gallon
  const perGallon = n < 3 ? n * 3.78541 : n;
  return Math.round(perGallon * 100);
}

router.get("/gas-stations", async (req, res) => {
  const { lat, lng, radius = "10", name, sortBy } = req.query as Record<string, string>;

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const radiusMiles = Math.min(parseFloat(radius) || 10, 50);
  const radiusMeters = Math.round(radiusMiles * 1609.34);

  const overpassQuery = `[out:json][timeout:20];(node["amenity"="fuel"](around:${radiusMeters},${parsedLat},${parsedLng});way["amenity"="fuel"](around:${radiusMeters},${parsedLat},${parsedLng}););out center 60;`;

  try {
    const cacheKey = gasOverpassCacheKey(parsedLat, parsedLng, radiusMeters);
    const cached = gasOverpassCache.get(cacheKey);

    // Run Overpass fetch and reverse-geocode state lookup in parallel
    const [elements, areaState] = await Promise.all([
      (async (): Promise<any[]> => {
        if (cached && Date.now() - cached.at < GAS_OVERPASS_CACHE_TTL_MS) {
          return cached.data;
        }
        const body = new URLSearchParams({ data: overpassQuery });
        const response = await fetch(OVERPASS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "ChargeBridge/1.0 (community EV finder; contact@chargebridge.app)",
            "Accept": "*/*",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(25000),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          req.log.warn({ status: response.status, body: text.slice(0, 300) }, "Overpass API error for gas stations — using fallback");
          return cached ? cached.data : [];
        }
        const json: any = await response.json();
        const els = json.elements ?? [];
        gasOverpassCache.set(cacheKey, { data: els, at: Date.now() });
        return els;
      })(),
      getStateForCoords(parsedLat, parsedLng),
    ]);

    let stations = elements.map((el: any) => {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      const tags = el.tags ?? {};
      const osmId = `osm-${el.type}-${el.id}`;

      // Extract OSM price tags (per gallon or per litre)
      const osmRegular =
        parseOsmPrice(tags["fuel:octane_87:price"]) ??
        parseOsmPrice(tags["fuel:octane_89:price"] ? undefined : undefined) ??
        null;
      const osmMid = parseOsmPrice(tags["fuel:octane_89:price"]) ?? null;
      const osmPremium =
        parseOsmPrice(tags["fuel:octane_91:price"]) ??
        parseOsmPrice(tags["fuel:octane_95:price"]) ??
        parseOsmPrice(tags["fuel:octane_98:price"]) ??
        null;
      const osmDiesel = parseOsmPrice(tags["fuel:diesel:price"]) ?? null;

      return {
        id: osmId,
        source: "osm",
        name: tags.name || tags.brand || tags.operator || "Gas Station",
        brand: tags.brand || null,
        address: [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null,
        city: tags["addr:city"] || null,
        state: tags["addr:state"] || areaState || null,
        country: tags["addr:country"] || null,
        lat: elLat,
        lng: elLng,
        distanceMiles: elLat && elLng ? Math.round(haversineMiles(parsedLat, parsedLng, elLat, elLng) * 10) / 10 : null,
        fuelTypes: [
          tags["fuel:diesel"] === "yes" ? "Diesel" : null,
          tags["fuel:octane_91"] === "yes" || tags["fuel:octane_95"] === "yes" ? "Premium" : null,
          tags["fuel:e85"] === "yes" ? "E85" : null,
          tags["fuel:lpg"] === "yes" ? "LPG" : null,
        ].filter(Boolean) as string[],
        hasCarWash: tags.car_wash === "yes" || tags["service:car_wash"] === "yes",
        hasConvenienceStore: tags.shop === "convenience" || tags["service:shop"] === "yes",
        opening_hours: tags.opening_hours || null,
        phone: tags.phone || tags["contact:phone"] || null,
        website: tags.website || tags["contact:website"] || null,
        osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        // OSM-sourced prices (often absent)
        prices: {
          regularCents: osmRegular,
          midCents: osmMid,
          premiumCents: osmPremium,
          dieselCents: osmDiesel,
          source: (osmRegular || osmMid || osmPremium || osmDiesel) ? "osm" : null as "osm" | "community" | "aaa" | "eia" | "fred" | null,
          reporterName: null as string | null,
          reportedAt: null as string | null,
          regionName: null as string | null,
          eiaWeek: null as string | null,
        },
      };
    });

    if (name) {
      const q = name.toLowerCase();
      stations = stations.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.brand?.toLowerCase() ?? "").includes(q)
      );
    }

    // Merge community-reported prices from DB (these override OSM prices)
    const osmIds = stations.map((s) => s.id);
    const dbPrices = await getLatestPricesForIds(osmIds);
    for (const station of stations) {
      const db = dbPrices.get(station.id);
      if (db) {
        station.prices = {
          regularCents: db.regularCents ?? station.prices.regularCents,
          midCents: db.midCents ?? station.prices.midCents,
          premiumCents: db.premiumCents ?? station.prices.premiumCents,
          dieselCents: db.dieselCents ?? station.prices.dieselCents,
          source: "community",
          reporterName: db.reporterName,
          reportedAt: db.reportedAt,
          regionName: null,
          eiaWeek: null,
        };
      }
    }

    // Tier 2: AAA state-level baseline — daily prices for all 50 US states
    // Covers Regular, Mid-Grade, Premium, and Diesel. No API key required.
    // Priority: community > AAA state > OSM price tags > FRED metro > EIA regional
    const aaaStateCache = new Map<string, Awaited<ReturnType<typeof getAaaPricesForState>>>();
    for (const station of stations) {
      if (station.prices.source === "community") continue;
      if (!station.state) continue; // AAA requires a state code
      if (!aaaStateCache.has(station.state)) {
        aaaStateCache.set(station.state, await getAaaPricesForState(station.state));
      }
      const aaa = aaaStateCache.get(station.state);
      if (!aaa) continue;
      station.prices = {
        regularCents: aaa.regularCents,
        midCents: aaa.midCents,
        premiumCents: aaa.premiumCents,
        dieselCents: aaa.dieselCents,
        source: "aaa",
        reporterName: null,
        reportedAt: null,
        regionName: aaa.stateName,
        eiaWeek: aaa.period,
      };
    }

    // Tier 4: FRED metro-area baseline — city-level weekly regular gasoline prices
    // Covers ~15 major US metros. Diesel falls back to EIA since FRED has no metro diesel series.
    // Fallback for stations whose OSM state tag is missing (coordinates-only lookup).
    const fredCache = new Map<string, Awaited<ReturnType<typeof getFredPricesForLocation>>>();
    for (const station of stations) {
      if (station.prices.source !== null) continue;
      const coordKey = `${Math.round(station.lat * 4) / 4}:${Math.round(station.lng * 4) / 4}`;
      if (!fredCache.has(coordKey)) {
        fredCache.set(coordKey, await getFredPricesForLocation(station.lat, station.lng));
      }
      const fred = fredCache.get(coordKey);
      if (!fred) continue;
      // Supplement mid, premium, diesel from EIA (FRED only publishes regular for metros)
      const eia = await getEiaPricesForLocation(station.state, station.lat, station.lng);
      station.prices = {
        regularCents: fred.regularCents,
        midCents: eia?.midCents ?? null,
        premiumCents: eia?.premiumCents ?? null,
        dieselCents: eia?.dieselCents ?? null,
        source: "fred",
        reporterName: null,
        reportedAt: null,
        regionName: fred.metroName,
        eiaWeek: fred.period,
      };
    }

    // Tier 4: EIA regional baseline — 5 PADD regions, weekly, Regular + Diesel
    // Final fallback for stations outside covered FRED metros.
    const eiaCache = new Map<string, Awaited<ReturnType<typeof getEiaPricesForLocation>>>();
    for (const station of stations) {
      if (station.prices.source !== null) continue; // already has prices
      const cacheKey = station.state ?? `${Math.round(station.lat * 2) / 2}:${Math.round(station.lng * 2) / 2}`;
      if (!eiaCache.has(cacheKey)) {
        eiaCache.set(cacheKey, await getEiaPricesForLocation(station.state, station.lat, station.lng));
      }
      const eia = eiaCache.get(cacheKey);
      if (!eia) continue;
      station.prices = {
        regularCents: eia.regularCents,
        midCents: eia.midCents,
        premiumCents: eia.premiumCents,
        dieselCents: eia.dieselCents,
        source: "eia",
        reporterName: null,
        reportedAt: null,
        regionName: eia.regionName,
        eiaWeek: eia.period,
      };
    }

    // Sort
    const LARGE = 999999;
    if (sortBy === "price_regular") {
      stations.sort((a, b) => (a.prices.regularCents ?? LARGE) - (b.prices.regularCents ?? LARGE));
    } else if (sortBy === "price_diesel") {
      stations.sort((a, b) => (a.prices.dieselCents ?? LARGE) - (b.prices.dieselCents ?? LARGE));
    } else if (sortBy === "price_premium") {
      stations.sort((a, b) => (a.prices.premiumCents ?? LARGE) - (b.prices.premiumCents ?? LARGE));
    } else {
      stations.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
    }

    // Batch-fetch review summaries for all stations
    const reviewSummaries = await getReviewSummaries(stations.map((s) => s.id));
    const stationsWithReviews = stations.map((s) => {
      const rev = reviewSummaries.get(s.id);
      return {
        ...s,
        averageRating: rev?.averageRating ?? null,
        reviewCount: rev?.reviewCount ?? 0,
      };
    });

    // Store the fully-normalized result for use as a stale fallback if Overpass
    // becomes unreachable on a subsequent request.
    gasResultCache.set(cacheKey, { data: stationsWithReviews, at: Date.now() });
    return res.json(stationsWithReviews);
  } catch (err: any) {
    // Overpass unreachable (timeout, network failure) — return the last processed
    // result (correct shape) if available, otherwise an empty array.
    // Never surface a 502 for a network blip on an optional data source.
    const cacheKey = gasOverpassCacheKey(parsedLat, parsedLng, Math.round(radiusMiles * 1_609.34));
    const stale = gasResultCache.get(cacheKey);
    req.log.warn({ err: err.message }, "Overpass unreachable for gas-stations — returning cached/empty fallback");
    return res.json(stale ? stale.data : []);
  }
});

// ── Review summary helper ─────────────────────────────────────────────────────

async function getReviewSummaries(osmIds: string[]): Promise<Map<string, { averageRating: number; reviewCount: number }>> {
  if (osmIds.length === 0) return new Map();
  const { sql: drizzleSql } = await import("drizzle-orm");
  const rows = await db.execute(drizzleSql`
    SELECT osm_id, COUNT(*)::int AS review_count, ROUND(AVG(rating)::numeric, 1)::float AS average_rating
    FROM gas_station_reviews
    WHERE osm_id = ANY(ARRAY[${drizzleSql.raw(osmIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(","))}]::text[])
    GROUP BY osm_id
  `);
  const map = new Map<string, { averageRating: number; reviewCount: number }>();
  for (const r of rows.rows as any[]) {
    map.set(r.osm_id, { averageRating: parseFloat(r.average_rating), reviewCount: r.review_count });
  }
  return map;
}

// ── Gas station reviews ───────────────────────────────────────────────────────

router.get("/gas-stations/:osmId/reviews", async (req, res) => {
  const { osmId } = req.params;
  try {
    const reviews = await db
      .select()
      .from(gasStationReviewsTable)
      .where(eq(gasStationReviewsTable.osmId, osmId))
      .orderBy(gasStationReviewsTable.createdAt);
    return res.json(reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    req.log.warn({ err }, "gas station reviews GET: DB error");
    return res.json([]);
  }
});

router.post("/gas-stations/:osmId/reviews", async (req, res) => {
  const { osmId } = req.params;
  const { authorName, rating, comment } = req.body ?? {};
  if (!authorName || typeof authorName !== "string" || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const [review] = await db
      .insert(gasStationReviewsTable)
      .values({
        osmId,
        authorName: String(authorName).trim(),
        rating: Number(rating),
        comment: comment ? String(comment).trim() : null,
      })
      .returning();
    return res.status(201).json({ ...review, createdAt: review.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "gas station reviews POST: DB error");
    return res.status(503).json({ error: "Could not save review — please try again" });
  }
});

export default router;
