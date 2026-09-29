/**
 * FRED (Federal Reserve Bank of St. Louis) metro-area fuel price service.
 *
 * Fetches weekly retail regular gasoline averages for ~15 major US metro areas.
 * Data is published by the EIA and mirrored on FRED — free, public, weekly.
 *
 * To enable: set FRED_API_KEY in your environment.
 * Free key registration (instant): https://fred.stlouisfed.org/docs/api/api_key.html
 *
 * FRED fills the gap between exact community prices and broad 5-region EIA averages,
 * providing city-level precision for major metros.
 *
 * Note: FRED only publishes regular gasoline for these metros.
 * Diesel prices fall back to EIA PADD regional data.
 */
import { logger } from "./logger";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface FredMetroPrice {
  regularCents: number | null;
  period: string;
  metroName: string;
}

/**
 * Metro areas covered by weekly FRED gasoline series.
 * Bounding boxes are generous — overlap is intentional (nearest-first wins).
 * seriesId: FRED series identifier for weekly regular gasoline.
 */
const FRED_METROS: Array<{
  seriesId: string;
  name: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}> = [
  // West Coast
  { seriesId: "GASREGLOSANGELESW", name: "Los Angeles", latMin: 33.5, latMax: 34.9, lngMin: -119.0, lngMax: -117.4 },
  { seriesId: "GASREGSANFRANCISCOW", name: "San Francisco Bay Area", latMin: 37.1, latMax: 38.1, lngMin: -123.0, lngMax: -121.7 },
  { seriesId: "GASREGSEATTLEW", name: "Seattle", latMin: 46.9, latMax: 48.2, lngMin: -122.9, lngMax: -121.4 },
  { seriesId: "GASREGPORTLANDW", name: "Portland", latMin: 45.2, latMax: 45.8, lngMin: -123.1, lngMax: -122.2 },
  // Mountain / Southwest
  { seriesId: "GASREGDENVERCOW", name: "Denver", latMin: 39.5, latMax: 40.1, lngMin: -105.3, lngMax: -104.5 },
  // South / Gulf
  { seriesId: "GASREGHOUSTON", name: "Houston", latMin: 29.4, latMax: 30.3, lngMin: -95.9, lngMax: -94.9 },
  { seriesId: "GASREGDALLASW", name: "Dallas", latMin: 32.5, latMax: 33.3, lngMin: -97.5, lngMax: -96.3 },
  { seriesId: "GASREGMIAMIW", name: "Miami", latMin: 25.3, latMax: 26.5, lngMin: -80.9, lngMax: -80.0 },
  { seriesId: "GASREGATLAW", name: "Atlanta", latMin: 33.5, latMax: 34.3, lngMin: -84.9, lngMax: -83.9 },
  // Midwest
  { seriesId: "GASREGCHICAGOW", name: "Chicago", latMin: 41.4, latMax: 42.6, lngMin: -88.6, lngMax: -87.2 },
  { seriesId: "GASREGDETROITW", name: "Detroit", latMin: 42.0, latMax: 42.8, lngMin: -83.6, lngMax: -82.7 },
  { seriesId: "GASREGMINNEAPOLISW", name: "Minneapolis", latMin: 44.7, latMax: 45.4, lngMin: -93.7, lngMax: -92.9 },
  // Northeast
  { seriesId: "GASREGNEWYORKW", name: "New York City", latMin: 40.3, latMax: 41.3, lngMin: -74.6, lngMax: -73.4 },
  { seriesId: "GASREGBOSTONW", name: "Boston", latMin: 41.9, latMax: 42.9, lngMin: -71.9, lngMax: -70.4 },
  { seriesId: "GASREGPHILADELPHIAW", name: "Philadelphia", latMin: 39.8, latMax: 40.4, lngMin: -75.5, lngMax: -74.7 },
];

interface FredObservation {
  date: string;
  value: string;
}

interface CacheEntry {
  prices: Map<string, FredMetroPrice>; // keyed by seriesId
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

async function fetchOneSeries(
  seriesId: string,
  apiKey: string,
): Promise<{ seriesId: string; regularCents: number | null; period: string } | null> {
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "2");
  url.searchParams.set("file_type", "json");

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridge.app)" },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    if (resp.status === 404) return null; // Series doesn't exist for this region
    throw new Error(`FRED ${seriesId} returned ${resp.status}`);
  }

  const json: any = await resp.json();
  const obs: FredObservation[] = json?.observations ?? [];
  // Find first non-missing observation ("." = missing in FRED)
  const latest = obs.find((o) => o.value !== "." && o.value !== "");
  if (!latest) return null;

  const value = parseFloat(latest.value);
  if (isNaN(value) || value <= 0) return null;

  return {
    seriesId,
    regularCents: Math.round(value * 100),
    period: latest.date,
  };
}

async function fetchFred(): Promise<CacheEntry> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    logger.warn(
      "FRED_API_KEY not configured — metro-area gas price data disabled. " +
        "Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html",
    );
    return { prices: new Map(), fetchedAt: Date.now() };
  }

  const results = await Promise.allSettled(
    FRED_METROS.map((m) => fetchOneSeries(m.seriesId, apiKey)),
  );

  const prices = new Map<string, FredMetroPrice>();
  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const metro = FRED_METROS[i];
    if (result.status === "fulfilled" && result.value) {
      prices.set(metro.seriesId, {
        regularCents: result.value.regularCents,
        period: result.value.period,
        metroName: metro.name,
      });
      successCount++;
    } else if (result.status === "rejected") {
      logger.warn({ seriesId: metro.seriesId, err: result.reason?.message }, "FRED series fetch failed");
    }
  }

  logger.info({ metros: successCount, total: FRED_METROS.length }, "FRED metro fuel prices refreshed");
  return { prices, fetchedAt: Date.now() };
}

async function getCache(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = fetchFred()
    .then((c) => {
      cache = c;
      inFlight = null;
      return c;
    })
    .catch((err) => {
      logger.error({ err }, "FRED fetch failed — using stale cache or empty");
      inFlight = null;
      return cache ?? { prices: new Map(), fetchedAt: Date.now() };
    });

  return inFlight;
}

/**
 * Returns FRED weekly metro-area regular gasoline price for the given coordinates.
 * Matches the first metro bounding box that contains the point.
 * Returns null if coordinates don't fall in a covered metro, or key is missing.
 */
export async function getFredPricesForLocation(
  lat: number,
  lng: number,
): Promise<FredMetroPrice | null> {
  const { prices } = await getCache();
  if (prices.size === 0) return null;

  for (const metro of FRED_METROS) {
    if (
      lat >= metro.latMin &&
      lat <= metro.latMax &&
      lng >= metro.lngMin &&
      lng <= metro.lngMax
    ) {
      return prices.get(metro.seriesId) ?? null;
    }
  }

  return null;
}

/**
 * Warm the FRED cache on server startup (non-blocking).
 */
export function warmFredCache(): void {
  getCache().catch(() => {});
}
