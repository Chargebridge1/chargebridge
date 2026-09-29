import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { stationsTable, reviewsTable, favoritesTable, externalStationReviewsTable, stationStatusReportsTable } from "@workspace/db";
import { avg, count, desc, eq, inArray, and, gte, lte, sql } from "drizzle-orm";
import { rankStations, getWeights, nrelAccessType, osmAccessType } from "../ranking/index.js";

const router = Router();
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NREL_API_KEY = process.env.NREL_API_KEY ?? null;
const NREL_URL = "https://developer.nrel.gov/api/alt-fuel-stations/v1.json";
const OCM_API_KEY = process.env.OCM_API_KEY ?? null;
const OCM_URL = "https://api.openchargemap.io/v3/poi/";

// ── Caches (5-minute TTL) ─────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const overpassCache = new Map<string, { data: any; at: number }>();
const nrelCache = new Map<string, { data: any; at: number }>();
const ocmCache = new Map<string, { data: any; at: number }>();

function cacheKey(lat: number, lng: number, radiusMeters: number) {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${radiusMeters}`;
}

async function fetchOverpass(query: string, key: string): Promise<any> {
  const hit = overpassCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ChargeBridge/1.0 (community EV finder; contact@chargebridge.app)",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(28000),
  });
  const data = await res.json();
  overpassCache.set(key, { data, at: Date.now() });
  return data;
}

async function fetchNrel(lat: number, lng: number, radiusMiles: number, key: string): Promise<any[]> {
  if (!NREL_API_KEY) return [];
  const hit = nrelCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const params = new URLSearchParams({
    api_key: NREL_API_KEY,
    fuel_type: "ELEC",
    latitude: String(lat),
    longitude: String(lng),
    radius: String(radiusMiles),
    limit: "200",
    status: "E",
  });
  const res = await fetch(`${NREL_URL}?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NREL ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const stations: any[] = (data as any).fuel_stations ?? [];
  nrelCache.set(key, { data: stations, at: Date.now() });
  return stations;
}

async function fetchOcm(lat: number, lng: number, radiusMiles: number, key: string): Promise<any[]> {
  if (!OCM_API_KEY) return [];
  const hit = ocmCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const params = new URLSearchParams({
    output: "json",
    latitude: String(lat),
    longitude: String(lng),
    distance: String(radiusMiles),
    distanceunit: "Miles",
    maxresults: "400",
    compact: "false",
    verbose: "false",
    key: OCM_API_KEY,
  });
  const res = await fetch(`${OCM_URL}?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OCM ${res.status}`);
  const data = (await res.json()) as any[];
  ocmCache.set(key, { data, at: Date.now() });
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function osmChargerType(tags: Record<string, string>): "Level1" | "Level2" | "DCFC" {
  if (tags["socket:chademo"] || tags["socket:type2_combo"] || tags["socket:tesla_supercharger"])
    return "DCFC";
  if (tags["socket:type2"] || tags["socket:type1_cable"]) return "Level2";
  if (tags["socket:type1"] || tags["socket:schuko"]) return "Level1";
  const kw = parseFloat(tags["charging_station:output"] ?? tags["maxpower"] ?? "");
  if (!isNaN(kw)) {
    if (kw >= 50) return "DCFC";
    if (kw >= 7) return "Level2";
    return "Level1";
  }
  return "Level2";
}

function osmPowerKw(tags: Record<string, string>): number | null {
  const raw = tags["charging_station:output"] ?? tags["maxpower"] ?? tags["capacity:kw"] ?? "";
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

function osmCapacity(tags: Record<string, string>): number | null {
  const n = parseInt(tags["capacity"] ?? tags["charging_station:capacity"] ?? "", 10);
  return isNaN(n) || n <= 0 ? null : n;
}

const NREL_CONNECTOR_MAP: Record<string, string> = {
  J1772: "J1772",
  CHADEMO: "CHAdeMO",
  J1772COMBO: "CCS",
  TESLA: "NACS",
  NEMA520: "NEMA 5-20",
  NEMA1450: "NEMA 14-50",
  NEMA630: "NEMA 6-30",
};

function nrelConnectorTypes(s: any): string[] {
  const raw: string[] = s.ev_connector_types ?? [];
  return [...new Set(raw.map((c) => NREL_CONNECTOR_MAP[c] ?? c).filter(Boolean))];
}

function osmConnectorTypes(tags: Record<string, string>): string[] {
  const types: string[] = [];
  if (tags["socket:chademo"]) types.push("CHAdeMO");
  if (tags["socket:type2_combo"] || tags["socket:type2_ccs"]) types.push("CCS");
  if (tags["socket:tesla_supercharger"]) types.push("NACS");
  if (tags["socket:tesla_ccs"]) types.push("CCS");
  if (tags["socket:type2"] || tags["socket:type1_cable"]) { if (!types.includes("J1772")) types.push("J1772"); }
  if (tags["socket:type1"] || tags["socket:schuko"]) { if (!types.includes("J1772")) types.push("J1772"); }
  return [...new Set(types)];
}

// ── OCM helpers ───────────────────────────────────────────────────────────────

function ocmChargerType(connections: any[]): "Level1" | "Level2" | "DCFC" {
  let maxLevel = 1;
  for (const c of connections ?? []) {
    const title = (c.Level?.Title ?? "").toLowerCase();
    const kw = c.PowerKW ?? 0;
    if (title.includes("level 3") || kw >= 40) { maxLevel = 3; break; }
    if ((title.includes("level 2") || kw >= 7) && maxLevel < 3) maxLevel = 2;
  }
  if (maxLevel === 3) return "DCFC";
  if (maxLevel === 2) return "Level2";
  return "Level1";
}

function ocmConnectorTypes(connections: any[]): string[] {
  const types: string[] = [];
  for (const c of connections ?? []) {
    const title = (c.ConnectionType?.Title ?? "").toLowerCase();
    if (title.includes("chademo")) { types.push("CHAdeMO"); continue; }
    if (title.includes("ccs") || title.includes("combo")) { types.push("CCS"); continue; }
    if (title.includes("supercharger") || title.includes("nacs") || (title.includes("tesla") && !title.includes("roadster"))) { types.push("NACS"); continue; }
    if (title.includes("j1772") || title.includes("type 1") || title.includes("iec 62196-2 type 1")) { types.push("J1772"); continue; }
    if (title.includes("type 2") || title.includes("iec 62196-2 type 2") || title.includes("mennekes")) { types.push("J1772"); continue; }
    if (title.includes("14-50") || title.includes("nema 14")) { types.push("NEMA 14-50"); continue; }
    if (title.includes("5-20") || title.includes("nema 5")) { types.push("NEMA 5-20"); continue; }
  }
  return [...new Set(types)];
}

function ocmPriceText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === "free" || lower === "0" || lower === "$0") return "Free";
  if (raw.length > 0 && raw.length <= 80) return raw;
  return null;
}

function ocmTotalPorts(connections: any[]): number | null {
  let total = 0;
  for (const c of connections ?? []) {
    const qty = c.Quantity ?? 1;
    total += typeof qty === "number" && qty > 0 ? qty : 1;
  }
  return total > 0 ? total : null;
}

function communityConnectorTypes(chargerType: "Level1" | "Level2" | "DCFC"): string[] {
  if (chargerType === "DCFC") return ["CCS", "CHAdeMO"];
  return ["J1772"];
}

/** Map NREL ev_connector_types to our charger type enum */
function nrelChargerType(s: any): "Level1" | "Level2" | "DCFC" {
  if ((s.ev_dc_fast_num ?? 0) > 0) return "DCFC";
  if ((s.ev_level2_evse_num ?? 0) > 0) return "Level2";
  if ((s.ev_level1_evse_num ?? 0) > 0) return "Level1";
  const connectors: string[] = s.ev_connector_types ?? [];
  if (connectors.some((c) => ["CHADEMO", "J1772COMBO", "TESLA"].includes(c))) return "DCFC";
  return "Level2";
}

function nrelTotalPorts(s: any): number | null {
  const total =
    (s.ev_level1_evse_num ?? 0) +
    (s.ev_level2_evse_num ?? 0) +
    (s.ev_dc_fast_num ?? 0);
  return total > 0 ? total : null;
}

/** Normalize network name for display */
function normalizeNetworkName(raw: string | null): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    CKCHR: "Circle K Easy Charge",
    CIRCLEK: "Circle K Easy Charge",
    SHELL_RECHARGE: "Shell Recharge",
    CHARGEPOINT: "ChargePoint",
    EVGO: "EVgo",
    ELECTRIFY_AMERICA: "Electrify America",
    BLINK: "Blink",
    TESLA: "Tesla Supercharger",
    RIVIAN: "Rivian",
    VOLTA: "Volta",
    IONNA: "Ionna",
    SEMACHARGE: "SemaCharge",
    GREENLOTS: "Greenlots",
    EVCS: "EVCS",
    NON_NETWORKED: null as any,
  };
  if (raw in map) return map[raw];
  if (raw.match(/circle\s*k/i)) return "Circle K Easy Charge";
  return raw;
}

const NETWORK_PRICING_URLS: Array<[string, string]> = [
  ["circle k", "https://www.circlek.com/electric-vehicle-charging"],
  ["easy charge", "https://www.circlek.com/electric-vehicle-charging"],
  ["tesla", "https://www.tesla.com/support/supercharger-pricing"],
  ["supercharger", "https://www.tesla.com/support/supercharger-pricing"],
  ["evgo", "https://www.evgo.com/pricing/"],
  ["chargepoint", "https://www.chargepoint.com/pricing/"],
  ["electrify america", "https://www.electrifyamerica.com/rates/"],
  ["blink", "https://www.blinkcharging.com/pricing/"],
  ["volta", "https://voltacharging.com/"],
  ["shell recharge", "https://shellrecharge.com/en-us/pricing"],
  ["flo ", "https://flo.com/pricing"],
  ["rivian", "https://rivian.com/support/article/charging"],
  ["ionna", "https://ionnacharging.com/pricing/"],
  ["semaconnect", "https://semaconnect.com/pricing/"],
  ["greenlots", "https://greenlots.com/"],
  ["clipper creek", "https://clippercreek.com/charging-products/"],
  ["evcs", "https://evcs.com/pricing"],
];

function networkPricingUrl(network: string | null, nameHint?: string | null): string | null {
  const candidates = [network, nameHint].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    for (const [key, url] of NETWORK_PRICING_URLS) {
      if (lower.includes(key)) return url;
    }
  }
  return null;
}

function osmPriceText(tags: Record<string, string>): string | null {
  const raw = tags["charge"] ?? tags["fee:conditional"] ?? "";
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === "free" || lower === "no" || tags["fee"] === "no") return "Free";
  const match = raw.match(/([€$£¥]?\s*\d+[\.,]\d+)\s*(USD|EUR|GBP|CAD|AUD)?\s*\/\s*kWh/i);
  if (match) {
    const num = parseFloat(match[1].replace(/[^0-9.]/g, ""));
    if (!isNaN(num)) return `$${num.toFixed(3)}/kWh`;
  }
  if (raw.length > 0 && raw.length <= 60) return raw;
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvStation {
  id: string;
  source: "osm" | "community" | "nrel" | "ocm";
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  distanceMiles: number;
  chargerType: "Level1" | "Level2" | "DCFC";
  connectorTypes: string[];
  powerKw: number | null;
  pricePerKwh: number | null;
  priceText: string | null;
  isFree: boolean;
  pricingUrl: string | null;
  totalPorts: number | null;
  availablePorts: number | null;
  status: "available" | "busy" | "offline" | "unknown";
  network: string | null;
  ocppChargePointId: string | null;
  phone: string | null;
  website: string | null;
  osmUrl: string | null;
  averageRating: number | null;
  reviewCount: number;
  isFavorited: boolean;
  latestReport: { id: number; reportType: string; confirmations: number; createdAt: string } | null;
  facilityType: string | null;
  accessType: "public" | "restricted" | "unknown";
  rankScore: number | null;
  accessibilityLevel: "EASY" | "MODERATE" | "RESTRICTED" | "UNKNOWN" | null;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/ev-stations", async (req, res) => {
  const { lat, lng, radius = "25" } = req.query as Record<string, string>;

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  if (isNaN(parsedLat) || isNaN(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    return res.status(400).json({ error: "lat and lng must be valid coordinates" });
  }
  const radiusMiles = Math.min(parseFloat(radius) || 25, 100);
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  const key = cacheKey(parsedLat, parsedLng, radiusMeters);

  // Bounding-box deltas for community station pre-filter (mirrors stations.ts/nearby)
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((parsedLat * Math.PI) / 180));

  const overpassQuery = `[out:json][timeout:25];(node["amenity"="charging_station"](around:${radiusMeters},${parsedLat},${parsedLng});way["amenity"="charging_station"](around:${radiusMeters},${parsedLat},${parsedLng}););out center 500;`;

  // Fetch all four sources in parallel
  const [osmResult, dbResult, nrelResult, ocmResult] = await Promise.allSettled([
    fetchOverpass(overpassQuery, key),
    db.select().from(stationsTable).where(
      and(
        sql`${stationsTable.status} NOT IN ('pending', 'removed')`,
        gte(stationsTable.lat, parsedLat - latDelta),
        lte(stationsTable.lat, parsedLat + latDelta),
        gte(stationsTable.lng, parsedLng - lngDelta),
        lte(stationsTable.lng, parsedLng + lngDelta),
      )
    ),
    fetchNrel(parsedLat, parsedLng, radiusMiles, key),
    fetchOcm(parsedLat, parsedLng, radiusMiles, key),
  ]);

  const results: EvStation[] = [];

  // ── Step 1: Community DB stations (highest priority) ─────────────────────
  const communityPositions: Array<{ lat: number; lng: number }> = [];

  if (dbResult.status === "fulfilled") {
    const nearby = dbResult.value.filter(
      (s) => haversineMiles(parsedLat, parsedLng, s.lat, s.lng) <= radiusMiles
    );
    const nearbyIds = nearby.map((s) => s.id);
    const [reviewRows, favRows] =
      nearbyIds.length > 0
        ? await Promise.all([
            db
              .select({
                stationId: reviewsTable.stationId,
                avgRating: avg(reviewsTable.rating),
                reviewCount: count(reviewsTable.id),
              })
              .from(reviewsTable)
              .where(inArray(reviewsTable.stationId, nearbyIds))
              .groupBy(reviewsTable.stationId),
            db.select({ stationId: favoritesTable.stationId }).from(favoritesTable),
          ])
        : [[], []];

    const reviewMap = new Map(reviewRows.map((r) => [r.stationId, r]));
    const favSet = new Set(favRows.map((f) => f.stationId));

    // Batch-fetch latest status report per community station
    const reportTextIds = nearbyIds.flatMap((id) => [String(id), `db-${id}`]);
    const latestReportRows =
      reportTextIds.length > 0
        ? await db
            .select()
            .from(stationStatusReportsTable)
            .where(inArray(stationStatusReportsTable.stationId, reportTextIds))
            .orderBy(desc(stationStatusReportsTable.createdAt))
        : [];
    const latestReportMap = new Map<number, (typeof latestReportRows)[0]>();
    for (const row of latestReportRows) {
      const numId = parseInt(row.stationId.replace(/^db-/, ""), 10);
      if (!isNaN(numId) && !latestReportMap.has(numId)) {
        latestReportMap.set(numId, row);
      }
    }

    for (const s of nearby) {
      const dist = haversineMiles(parsedLat, parsedLng, s.lat, s.lng);
      communityPositions.push({ lat: s.lat, lng: s.lng });
      const rv = reviewMap.get(s.id);
      const dbPricePerKwh = s.pricePerKwh ? Number(s.pricePerKwh) : null;
      const dbNetwork = s.network ?? null;
      results.push({
        id: `db-${s.id}`,
        source: "community",
        name: s.name,
        address: s.address,
        city: s.city,
        state: s.state,
        lat: s.lat,
        lng: s.lng,
        distanceMiles: Math.round(dist * 10) / 10,
        chargerType: s.chargerType as "Level1" | "Level2" | "DCFC",
        connectorTypes: communityConnectorTypes(s.chargerType as "Level1" | "Level2" | "DCFC"),
        powerKw: s.powerKw,
        pricePerKwh: dbPricePerKwh,
        priceText:
          dbPricePerKwh !== null
            ? dbPricePerKwh === 0
              ? "Free"
              : `$${dbPricePerKwh.toFixed(3)}/kWh`
            : null,
        isFree: dbPricePerKwh === 0,
        pricingUrl: networkPricingUrl(dbNetwork, s.name),
        totalPorts: s.totalPorts,
        availablePorts: s.availablePorts,
        status: s.status as "available" | "busy" | "offline",
        network: dbNetwork,
        ocppChargePointId: s.ocppChargePointId ?? null,
        phone: null,
        website: null,
        osmUrl: null,
        averageRating: rv?.avgRating ? parseFloat(rv.avgRating) : null,
        reviewCount: rv?.reviewCount ? Number(rv.reviewCount) : 0,
        isFavorited: favSet.has(s.id),
        latestReport: (() => {
          const lr = latestReportMap.get(s.id);
          return lr
            ? { id: lr.id, reportType: lr.reportType, confirmations: lr.confirmations, createdAt: lr.createdAt.toISOString() }
            : null;
        })(),
        facilityType: null,
        accessType: "public" as const,
        rankScore: null,
        accessibilityLevel: null,
      });
    }
  } else {
    req.log.warn({ err: dbResult.reason }, "DB query failed");
  }

  // ── Step 2: NREL stations (second priority — richer data than OSM) ────────
  // Track positions covered by community + NREL so OSM doesn't double-add them
  const coveredPositions: Array<{ lat: number; lng: number }> = [...communityPositions];

  if (nrelResult.status === "fulfilled") {
    for (const s of nrelResult.value) {
      const sLat = parseFloat(s.latitude);
      const sLng = parseFloat(s.longitude);
      if (!sLat || !sLng) continue;

      // Skip private-access stations (fleet-only, workplace-only)
      if (s.access_code === "private") continue;

      // Deduplicate against community stations (~100m)
      const isDuplicate = coveredPositions.some(
        (pos) => haversineMiles(sLat, sLng, pos.lat, pos.lng) < 0.062
      );
      if (isDuplicate) continue;

      const dist = haversineMiles(parsedLat, parsedLng, sLat, sLng);
      const rawNetwork: string | null = s.ev_network ?? null;
      const network = normalizeNetworkName(rawNetwork);
      const priceText = s.ev_pricing ? String(s.ev_pricing).slice(0, 80) : null;

      coveredPositions.push({ lat: sLat, lng: sLng });
      results.push({
        id: `nrel-${s.id}`,
        source: "nrel",
        name: s.station_name ?? "EV Charging Station",
        address: s.street_address ?? null,
        city: s.city ?? null,
        state: s.state ?? null,
        lat: sLat,
        lng: sLng,
        distanceMiles: Math.round(dist * 10) / 10,
        chargerType: nrelChargerType(s),
        connectorTypes: nrelConnectorTypes(s),
        powerKw: null,
        pricePerKwh: null,
        priceText,
        isFree: false,
        pricingUrl: s.ev_network_web ?? networkPricingUrl(network, s.station_name),
        totalPorts: nrelTotalPorts(s),
        availablePorts: null,
        status: "unknown",
        network,
        ocppChargePointId: null,
        phone: s.station_phone ?? null,
        website: s.ev_network_web ?? null,
        osmUrl: null,
        averageRating: null,
        reviewCount: 0,
        isFavorited: false,
        latestReport: null,
        facilityType: s.facility_type ?? null,
        accessType: nrelAccessType(s.access_code ?? null, s.access_detail_code ?? null),
        rankScore: null,
        accessibilityLevel: null,
      });
    }
  } else {
    req.log.warn({ err: nrelResult.reason }, "NREL API failed");
  }

  // ── Step 3: OSM stations (fill in gaps not covered by NREL or community) ──
  if (osmResult.status === "fulfilled") {
    const elements: any[] = (osmResult.value as any)?.elements ?? [];
    for (const el of elements) {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (!elLat || !elLng) continue;
      const dist = haversineMiles(parsedLat, parsedLng, elLat, elLng);
      if (dist > radiusMiles) continue;

      // Skip if already covered by community or NREL (~100m)
      const isDuplicate = coveredPositions.some(
        (pos) => haversineMiles(elLat, elLng, pos.lat, pos.lng) < 0.062
      );
      if (isDuplicate) continue;

      const tags: Record<string, string> = el.tags ?? {};
      const rawNetwork = tags.network || tags.operator || tags.brand || null;
      const normalizedNetwork = rawNetwork?.match(/circle\s*k/i)
        ? "Circle K Easy Charge"
        : rawNetwork;
      const stationName =
        tags.name ||
        (rawNetwork?.match(/circle\s*k/i) ? "Circle K Easy Charge" : null) ||
        tags.operator ||
        tags.network ||
        tags.brand ||
        "EV Charging Station";
      const isFree = tags.fee === "no";
      const priceText = isFree ? "Free" : osmPriceText(tags);

      results.push({
        id: `osm-${el.type}-${el.id}`,
        source: "osm",
        name: stationName,
        address:
          [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null,
        city: tags["addr:city"] || null,
        state: tags["addr:state"] || null,
        lat: elLat,
        lng: elLng,
        distanceMiles: Math.round(dist * 10) / 10,
        chargerType: osmChargerType(tags),
        connectorTypes: osmConnectorTypes(tags),
        powerKw: osmPowerKw(tags),
        pricePerKwh: isFree ? 0 : null,
        priceText,
        isFree,
        pricingUrl: networkPricingUrl(normalizedNetwork, stationName),
        totalPorts: osmCapacity(tags),
        availablePorts: null,
        status: "unknown",
        network: normalizedNetwork,
        ocppChargePointId: null,
        phone: tags.phone || tags["contact:phone"] || null,
        website: tags.website || tags["contact:website"] || null,
        osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        averageRating: null,
        reviewCount: 0,
        isFavorited: false,
        latestReport: null,
        facilityType: tags.amenity === "charging_station"
          ? (tags.landuse ?? tags.shop ?? tags.building ?? null)
          : (tags.amenity ?? null),
        accessType: osmAccessType(tags),
        rankScore: null,
        accessibilityLevel: null,
      });
    }
  } else {
    req.log.warn({ err: osmResult.reason }, "Overpass API failed, falling back to DB + NREL + OCM");
  }

  // ── Step 4: OCM stations (fill remaining gaps) ─────────────────────────────
  if (ocmResult.status === "fulfilled") {
    for (const s of ocmResult.value) {
      const addr = s.AddressInfo ?? {};
      const sLat = parseFloat(addr.Latitude ?? "");
      const sLng = parseFloat(addr.Longitude ?? "");
      if (!sLat || !sLng) continue;

      const dist = haversineMiles(parsedLat, parsedLng, sLat, sLng);
      if (dist > radiusMiles) continue;

      // Skip if already covered by community, NREL, or OSM (~100m)
      const isDuplicate = coveredPositions.some(
        (pos) => haversineMiles(sLat, sLng, pos.lat, pos.lng) < 0.062
      );
      if (isDuplicate) continue;

      const connections: any[] = s.Connections ?? [];
      const rawNetwork: string | null = s.OperatorInfo?.Title ?? null;
      const network = normalizeNetworkName(rawNetwork);
      const usageCost = s.UsageCost ?? null;
      const priceText = ocmPriceText(usageCost);
      const isFree = priceText === "Free";
      const isOperational = s.StatusType?.IsOperational !== false;

      coveredPositions.push({ lat: sLat, lng: sLng });
      results.push({
        id: `ocm-${s.ID}`,
        source: "ocm",
        name: addr.Title ?? rawNetwork ?? "EV Charging Station",
        address: addr.AddressLine1 ?? null,
        city: addr.Town ?? null,
        state: addr.StateOrProvince ?? null,
        lat: sLat,
        lng: sLng,
        distanceMiles: Math.round(dist * 10) / 10,
        chargerType: ocmChargerType(connections),
        connectorTypes: ocmConnectorTypes(connections),
        powerKw: connections.find((c) => c.PowerKW)?.PowerKW ?? null,
        pricePerKwh: isFree ? 0 : null,
        priceText,
        isFree,
        pricingUrl: networkPricingUrl(network, addr.Title),
        totalPorts: s.NumberOfPoints ?? ocmTotalPorts(connections),
        availablePorts: null,
        status: isOperational ? "unknown" : "offline",
        network,
        ocppChargePointId: null,
        phone: addr.ContactTelephone1 ?? null,
        website: addr.RelatedURL ?? null,
        osmUrl: null,
        averageRating: null,
        reviewCount: 0,
        isFavorited: false,
        latestReport: null,
        facilityType: null,
        accessType: "unknown" as const,
        rankScore: null,
        accessibilityLevel: null,
      });
    }
  } else {
    req.log.warn({ err: ocmResult.reason }, "OCM API failed");
  }

  // ── Step 5: Attach external review stats to OSM + NREL + OCM stations ──────
  const externalIds = results
    .filter((s) => s.source === "osm" || s.source === "nrel" || s.source === "ocm")
    .map((s) => s.id);
  if (externalIds.length > 0) {
    try {
      const extReviews = await db
        .select({
          externalId: externalStationReviewsTable.externalId,
          avgRating: avg(externalStationReviewsTable.rating),
          reviewCount: count(externalStationReviewsTable.id),
        })
        .from(externalStationReviewsTable)
        .where(inArray(externalStationReviewsTable.externalId, externalIds))
        .groupBy(externalStationReviewsTable.externalId);

      const extMap = new Map(extReviews.map((r) => [r.externalId, r]));
      for (const station of results) {
        if (station.source === "osm" || station.source === "nrel" || station.source === "ocm") {
          const rv = extMap.get(station.id);
          if (rv) {
            station.averageRating = rv.avgRating ? parseFloat(rv.avgRating) : null;
            station.reviewCount = rv.reviewCount ? Number(rv.reviewCount) : 0;
          }
        }
      }
    } catch (err) {
      req.log.warn({ err }, "External review lookup failed");
    }
  }

  const { sortBy = "smart" } = req.query as Record<string, string>;

  if (sortBy === "distance") {
    results.sort((a, b) => a.distanceMiles - b.distanceMiles);
    return res.json(results);
  }

  const weights = await getWeights();
  const ranked = rankStations(results, weights);
  return res.json(ranked);
});

// ── External station reviews ──────────────────────────────────────────────────

router.get("/ev-stations/:externalId/reviews", async (req, res) => {
  const { externalId } = req.params;
  const reviews = await db
    .select()
    .from(externalStationReviewsTable)
    .where(eq(externalStationReviewsTable.externalId, externalId))
    .orderBy(externalStationReviewsTable.createdAt);
  return res.json(reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/ev-stations/:externalId/reviews", async (req, res) => {
  const { externalId } = req.params;
  const { userId } = getAuth(req);
  const { authorName, rating, comment } = req.body ?? {};
  if (!authorName || typeof authorName !== "string" || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const [review] = await db
    .insert(externalStationReviewsTable)
    .values({
      externalId,
      authorName: String(authorName).trim(),
      clerkUserId: userId ?? null,
      rating: Number(rating),
      comment: comment ? String(comment).trim() : null,
    })
    .returning();
  return res.status(201).json({ ...review, createdAt: review.createdAt.toISOString() });
});

router.patch("/ev-stations/:externalId/reviews/:reviewId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = parseInt(req.params.reviewId, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid review ID" });
  const { rating, comment } = req.body ?? {};
  if (rating !== undefined && (Number(rating) < 1 || Number(rating) > 5)) {
    return res.status(400).json({ error: "Invalid rating" });
  }
  const [existing] = await db.select().from(externalStationReviewsTable).where(eq(externalStationReviewsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Review not found" });
  if (existing.clerkUserId !== userId) return res.status(403).json({ error: "Forbidden" });
  const updates: { rating?: number; comment?: string | null } = {};
  if (rating !== undefined) updates.rating = Number(rating);
  if (comment !== undefined) updates.comment = comment ? String(comment).trim() : null;
  const [updated] = await db.update(externalStationReviewsTable).set(updates).where(eq(externalStationReviewsTable.id, id)).returning();
  return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/ev-stations/:externalId/reviews/:reviewId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = parseInt(req.params.reviewId, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid review ID" });
  const [existing] = await db.select().from(externalStationReviewsTable).where(eq(externalStationReviewsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Review not found" });
  if (existing.clerkUserId !== userId) return res.status(403).json({ error: "Forbidden" });
  await db.delete(externalStationReviewsTable).where(eq(externalStationReviewsTable.id, id));
  return res.status(204).send();
});

export default router;
