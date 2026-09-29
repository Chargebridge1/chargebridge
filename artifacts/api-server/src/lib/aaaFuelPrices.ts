/**
 * AAA Fuel Gauge Report — daily state-level gas price service.
 *
 * Fetches daily retail gasoline averages by US state from https://gasprices.aaa.com/
 * Data updates once per day. No API key required.
 *
 * robots.txt: allows all paths (only /wp-admin/ is blocked), crawl-delay: 10s.
 * We cache each state for 6 hours, so repeat fetches are infrequent.
 *
 * Covers all 50 US states + DC. Prices include Regular, Mid-Grade, Premium, Diesel.
 */
import { logger } from "./logger";

const AAA_BASE = "https://gasprices.aaa.com/";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface AaaStatePrices {
  regularCents: number | null;
  midCents: number | null;
  premiumCents: number | null;
  dieselCents: number | null;
  e85Cents: number | null;
  period: string;
  stateName: string;
}

interface CacheEntry {
  prices: AaaStatePrices;
  fetchedAt: number;
}

const stateCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AaaStatePrices | null>>();

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DC: "Washington D.C.", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

function parseCents(str: string | undefined): number | null {
  if (!str) return null;
  const n = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n <= 0 || n > 20) return null;
  return Math.round(n * 100);
}

/**
 * Parse the "Current Avg." row from AAA HTML.
 * Strategy: find the text anchor, take the next 700 chars, extract $ amounts.
 */
function parseAaaHtml(html: string, stateCode: string): AaaStatePrices | null {
  const idx = html.search(/Current\s+Avg/i);
  if (idx === -1) return null;

  const window = html.slice(idx, idx + 700);
  const priceMatches = [...window.matchAll(/\$([\d]{1,2}\.[\d]{2,4})/g)].map((m) => m[1]);
  if (priceMatches.length < 4) return null;

  const dateMatch = html.match(/[Pp]rice\s+as\s+of\s+([\d]{1,2}\/[\d]{1,2}\/[\d]{2,4})/);
  const period = dateMatch ? dateMatch[1] : "";

  const stateName = STATE_NAMES[stateCode] ?? stateCode;

  return {
    regularCents: parseCents(priceMatches[0]),
    midCents: parseCents(priceMatches[1]),
    premiumCents: parseCents(priceMatches[2]),
    dieselCents: parseCents(priceMatches[3]),
    e85Cents: priceMatches.length >= 5 ? parseCents(priceMatches[4]) : null,
    period,
    stateName,
  };
}

async function fetchStateFromAaa(stateCode: string): Promise<AaaStatePrices | null> {
  const url =
    stateCode === "US"
      ? AAA_BASE
      : `${AAA_BASE}?state=${encodeURIComponent(stateCode)}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "ChargeBridge/1.0 (community EV charger finder; contact@chargebridge.app)",
      "Accept": "text/html,application/xhtml+xml,*/*",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    throw new Error(`AAA gas prices [${stateCode}] returned HTTP ${resp.status}`);
  }

  const html = await resp.text();
  const parsed = parseAaaHtml(html, stateCode);
  if (!parsed) {
    throw new Error(`AAA gas prices [${stateCode}]: could not parse price table`);
  }
  return parsed;
}

/**
 * Returns AAA daily state-average gas prices for a US state abbreviation (e.g. "CA").
 * Returns null if the fetch fails or prices cannot be parsed — callers should fall
 * through to EIA/FRED in that case.
 */
export async function getAaaPricesForState(
  stateCode: string | null | undefined,
): Promise<AaaStatePrices | null> {
  if (!stateCode) return null;
  const code = stateCode.trim().toUpperCase();
  if (code.length !== 2) return null;

  const cached = stateCache.get(code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.prices;

  const existing = inFlight.get(code);
  if (existing) return existing;

  const promise = fetchStateFromAaa(code)
    .then((prices) => {
      if (prices) stateCache.set(code, { prices, fetchedAt: Date.now() });
      inFlight.delete(code);
      return prices;
    })
    .catch((err: Error) => {
      logger.warn({ err: err.message, stateCode: code }, "AAA fuel price fetch failed — falling through to EIA/FRED");
      inFlight.delete(code);
      return cached?.prices ?? null;
    });

  inFlight.set(code, promise);
  return promise;
}

/**
 * Warm the AAA cache for the highest-traffic US states at server startup.
 * Staggers requests by 2 s each to stay within crawl-delay spirit.
 */
export function warmAaaCache(): void {
  const TOP_STATES = ["CA", "TX", "FL", "NY", "WA", "CO", "NV", "AZ", "OR", "GA"];
  let delay = 0;
  for (const state of TOP_STATES) {
    setTimeout(() => {
      getAaaPricesForState(state).catch(() => {});
    }, delay);
    delay += 2000;
  }
}
