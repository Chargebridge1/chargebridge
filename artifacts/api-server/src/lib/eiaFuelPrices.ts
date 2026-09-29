/**
 * EIA (U.S. Energy Information Administration) regional fuel price service.
 *
 * Fetches weekly retail gasoline & diesel averages by PADD region (5 U.S. regions).
 * Data is free, public, and updates every Monday.
 *
 * To enable: set EIA_API_KEY in your environment.
 * Free key registration: https://www.eia.gov/opendata/register.php
 *
 * Upgrade path:
 *   - Swap fetchEia() to call a different provider (OPIS, CollectAPI, etc.)
 *   - Add state-level resolution by extending STATE_PADD with individual state queries
 *   - Store prices in DB for historical trending
 */
import { logger } from "./logger";

const EIA_URL = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface EiaRegionPrices {
  regularCents: number | null;
  midCents: number | null;
  premiumCents: number | null;
  dieselCents: number | null;
  period: string;
  regionName: string;
}

const PADD_REGIONS = [
  { code: "R10", name: "East Coast" },
  { code: "R20", name: "Midwest" },
  { code: "R30", name: "Gulf Coast" },
  { code: "R40", name: "Rocky Mountain" },
  { code: "R50", name: "West Coast" },
] as const;

export const STATE_PADD: Record<string, string> = {
  CT: "R10", ME: "R10", MA: "R10", NH: "R10", RI: "R10", VT: "R10",
  DE: "R10", MD: "R10", NJ: "R10", NY: "R10", PA: "R10", DC: "R10",
  FL: "R10", GA: "R10", NC: "R10", SC: "R10", VA: "R10", WV: "R10",
  IL: "R20", IN: "R20", IA: "R20", KS: "R20", KY: "R20", MI: "R20",
  MN: "R20", MO: "R20", NE: "R20", ND: "R20", OH: "R20", SD: "R20",
  TN: "R20", WI: "R20",
  AL: "R30", AR: "R30", LA: "R30", MS: "R30", NM: "R30", TX: "R30",
  CO: "R40", ID: "R40", MT: "R40", UT: "R40", WY: "R40",
  AK: "R50", AZ: "R50", CA: "R50", HI: "R50", NV: "R50", OR: "R50", WA: "R50",
};

interface PriceRow {
  period: string;
  duoarea: string;
  product: string;
  value: number;
}

interface CacheEntry {
  paddPrices: Map<string, EiaRegionPrices>;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

async function fetchEia(): Promise<CacheEntry> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    logger.warn("EIA_API_KEY not configured — regional gas price fallback disabled. Get a free key at https://www.eia.gov/opendata/register.php");
    return { paddPrices: new Map(), fetchedAt: Date.now() };
  }

  const url = new URL(EIA_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("frequency", "weekly");
  url.searchParams.set("data[0]", "value");
  url.searchParams.set("sort[0][column]", "period");
  url.searchParams.set("sort[0][direction]", "desc");
  url.searchParams.set("length", "80"); // 4 products × 5 regions × a couple of weeks

  for (const { code } of PADD_REGIONS) {
    url.searchParams.append("facets[duoarea][]", code);
  }
  url.searchParams.append("facets[product][]", "EPM0");  // Regular (Total)
  url.searchParams.append("facets[product][]", "EPMM");  // Midgrade
  url.searchParams.append("facets[product][]", "EPMP");  // Premium
  url.searchParams.append("facets[product][]", "EPD2D"); // Diesel

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridge.app)" },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`EIA API ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await resp.json();
  const rows: PriceRow[] = json?.response?.data ?? [];

  const latest = new Map<string, PriceRow>();
  for (const row of rows) {
    const key = `${row.duoarea}:${row.product}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  const paddPrices = new Map<string, EiaRegionPrices>();
  for (const { code, name } of PADD_REGIONS) {
    const regular = latest.get(`${code}:EPM0`);
    const mid = latest.get(`${code}:EPMM`);
    const premium = latest.get(`${code}:EPMP`);
    const diesel = latest.get(`${code}:EPD2D`);
    paddPrices.set(code, {
      regularCents: regular ? Math.round(regular.value * 100) : null,
      midCents: mid ? Math.round(mid.value * 100) : null,
      premiumCents: premium ? Math.round(premium.value * 100) : null,
      dieselCents: diesel ? Math.round(diesel.value * 100) : null,
      period: regular?.period ?? mid?.period ?? diesel?.period ?? "",
      regionName: name,
    });
  }

  logger.info({ regions: paddPrices.size, samplePeriod: [...paddPrices.values()][0]?.period }, "EIA regional fuel prices refreshed");
  return { paddPrices, fetchedAt: Date.now() };
}

async function getCache(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = fetchEia()
    .then((c) => {
      cache = c;
      inFlight = null;
      return c;
    })
    .catch((err) => {
      logger.error({ err }, "EIA fetch failed — using stale cache or empty");
      inFlight = null;
      return cache ?? { paddPrices: new Map(), fetchedAt: Date.now() };
    });

  return inFlight;
}

/**
 * Returns EIA weekly-average prices for the PADD region covering a given US state abbreviation.
 * Returns null if state is unknown, key is missing, or the fetch fails.
 */
export async function getEiaPricesForState(stateAbbr: string | null | undefined): Promise<EiaRegionPrices | null> {
  if (!stateAbbr) return null;
  const paddCode = STATE_PADD[stateAbbr.trim().toUpperCase()];
  if (!paddCode) return null;
  const { paddPrices } = await getCache();
  return paddPrices.get(paddCode) ?? null;
}

/**
 * Approximate PADD region from lat/lng bounding boxes — used as a fallback
 * when an OSM node has no addr:state tag but we know the search coordinates.
 *
 * Boxes are rough but good enough for regional price buckets.
 */
function paddFromLatLng(lat: number, lng: number): string | null {
  if (lng < -113) {
    // West Coast (R50): WA/OR/CA/NV/AZ/AK/HI rough bounds
    if (lat > 31 && lat < 50 && lng > -125) return "R50";
    if (lat > 58) return "R50";
    if (lat < 22) return "R50";
  }
  if (lng >= -113 && lng < -104) {
    // Rocky Mountain (R40): CO/ID/MT/UT/WY
    return "R40";
  }
  if (lng >= -104 && lng < -88) {
    if (lat < 37) return "R30"; // Gulf Coast southern tier
    return "R20"; // Midwest
  }
  if (lng >= -88 && lng < -67) {
    if (lat < 37) return "R30"; // AL/MS/LA lower East
    return "R10"; // East Coast
  }
  return null;
}

/**
 * Returns EIA weekly-average prices using coordinates as a fallback when no state tag is available.
 * Tries state first, then falls back to lat/lng bounding box.
 */
export async function getEiaPricesForLocation(
  stateAbbr: string | null | undefined,
  lat: number,
  lng: number,
): Promise<EiaRegionPrices | null> {
  // Try exact state match first
  const byState = await getEiaPricesForState(stateAbbr);
  if (byState) return byState;

  // Fallback: infer PADD region from coordinates
  const paddCode = paddFromLatLng(lat, lng);
  if (!paddCode) return null;
  const { paddPrices } = await getCache();
  return paddPrices.get(paddCode) ?? null;
}

/**
 * Warm the EIA cache on server startup (non-blocking).
 * Call once during app init so first requests don't stall.
 */
export function warmEiaCache(): void {
  getCache().catch(() => {});
}
