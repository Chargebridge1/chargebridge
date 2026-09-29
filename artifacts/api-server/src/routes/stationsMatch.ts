import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { stationsTable, evChargingProfilesTable } from "@workspace/db/schema";
import { and, gte, lte, ne, eq } from "drizzle-orm";
import { scoreVehicleMatch } from "../ranking/vehicleMatch.js";
import { nrelAccessType, osmAccessType } from "../ranking/index.js";
import { loadConnectorAffinity } from "../lib/connectorAffinity.js";
import type { VehicleMatchSpec, MatchableStation } from "../ranking/vehicleMatch.js";

const router = Router();

// ── External API config ───────────────────────────────────────────────────────
const NREL_API_KEY = process.env.NREL_API_KEY ?? null;
const NREL_URL = "https://developer.nrel.gov/api/alt-fuel-stations/v1.json";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// ── Caches (5-minute TTL) ─────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const nrelMatchCache = new Map<string, { data: any[]; at: number }>();
const osmMatchCache  = new Map<string, { data: any;  at: number }>();

function matchCacheKey(lat: number, lng: number, radiusMiles: number) {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${radiusMiles}`;
}

// ── NREL fetch ────────────────────────────────────────────────────────────────

async function fetchNrelForMatch(lat: number, lng: number, radiusMiles: number): Promise<any[]> {
  if (!NREL_API_KEY) return [];
  const key = matchCacheKey(lat, lng, radiusMiles);
  const hit = nrelMatchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  try {
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
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json() as { fuel_stations?: any[] };
    const stations: any[] = json.fuel_stations ?? [];
    nrelMatchCache.set(key, { data: stations, at: Date.now() });
    return stations;
  } catch {
    return [];
  }
}

// ── OSM fetch (short 5 s timeout — score latency must stay low) ───────────────

async function fetchOsmForMatch(lat: number, lng: number, radiusMeters: number, key: string): Promise<any> {
  const hit = osmMatchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  try {
    const q = `[out:json][timeout:5];(node["amenity"="charging_station"](around:${radiusMeters},${lat},${lng});way["amenity"="charging_station"](around:${radiusMeters},${lat},${lng}););out center 300;`;
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ChargeBridge/1.0 (community EV finder; contact@chargebridge.app)",
      },
      body: new URLSearchParams({ data: q }).toString(),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    osmMatchCache.set(key, { data, at: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ── NREL normalization helpers (mirrors evStations.ts) ───────────────────────

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

// ── OSM normalization helpers (mirrors evStations.ts) ────────────────────────

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

function osmConnectorTypes(tags: Record<string, string>): string[] {
  const types: string[] = [];
  if (tags["socket:chademo"]) types.push("CHAdeMO");
  if (tags["socket:type2_combo"] || tags["socket:type2_ccs"]) types.push("CCS");
  if (tags["socket:tesla_supercharger"]) types.push("NACS");
  if (tags["socket:tesla_ccs"]) types.push("CCS");
  if (tags["socket:type2"] || tags["socket:type1_cable"]) {
    if (!types.includes("J1772")) types.push("J1772");
  }
  if (tags["socket:type1"] || tags["socket:schuko"]) {
    if (!types.includes("J1772")) types.push("J1772");
  }
  return [...new Set(types)];
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

// ── Haversine ─────────────────────────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function chargerTypeConnectors(chargerType: string): string[] {
  switch (chargerType) {
    case "DCFC":   return ["CCS", "NACS", "CHAdeMO"];
    case "Level2": return ["J1772"];
    case "Level1": return ["J1772"];
    default:       return [];
  }
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

const matchRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  // No custom keyGenerator — use express-rate-limit's default, which handles
  // IPv6 correctly. A naive (req) => req.ip implementation triggers
  // ERR_ERL_KEY_GEN_IPV6 on startup when the library's IPv6 guard runs.
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many match requests, please try again later." },
});

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/stations/match", matchRateLimit, async (req, res) => {
  const {
    lat,
    lng,
    radiusMiles = 10,
    vehicleTrimId,
    connectorType,
    plugTypes,
    batteryKwh,
    rangeMiles,
    dcMaxKw,
    acMaxKw,
    currentSocPercent,
    minArrivalSocPercent,
    limit = 20,
  } = req.body as {
    lat?: number;
    lng?: number;
    radiusMiles?: number;
    vehicleTrimId?: number | null;
    connectorType?: string | null;
    plugTypes?: string[] | null;
    batteryKwh?: number | null;
    rangeMiles?: number | null;
    dcMaxKw?: number | null;
    acMaxKw?: number | null;
    currentSocPercent?: number | null;
    minArrivalSocPercent?: number | null;
    limit?: number;
  };

  if (lat == null || lng == null) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const latN = Number(lat);
  const lngN = Number(lng);
  if (isNaN(latN) || isNaN(lngN)) {
    return res.status(400).json({ error: "Invalid lat/lng" });
  }

  const radiusN = Math.min(50, Number(radiusMiles) || 10);
  const limitN  = Math.min(50, Number(limit) || 20);

  // ── Vehicle spec ──────────────────────────────────────────────────────────
  // If vehicleTrimId provided, look up ev_charging_profiles for precise specs.
  // Otherwise use inline fields from the request body.
  let spec: VehicleMatchSpec = {
    connectorType: connectorType ?? null,
    plugTypes: plugTypes ?? null,
    batteryKwh: batteryKwh ?? null,
    rangeMiles: rangeMiles ?? null,
    dcMaxKw: dcMaxKw ?? null,
    acMaxKw: acMaxKw ?? null,
    currentSocPercent: currentSocPercent ?? null,
    minArrivalSocPercent: minArrivalSocPercent ?? null,
  };

  if (vehicleTrimId != null) {
    const [profile] = await db
      .select()
      .from(evChargingProfilesTable)
      .where(eq(evChargingProfilesTable.trimId, vehicleTrimId))
      .limit(1);

    if (profile) {
      const primaryConnector = profile.dcConnector ?? profile.acConnector ?? null;
      const plugTypeList: string[] = [];
      if (profile.dcConnector) plugTypeList.push(profile.dcConnector);
      if (profile.acConnector && profile.acConnector !== profile.dcConnector) {
        plugTypeList.push(profile.acConnector);
      }

      spec = {
        connectorType: primaryConnector,
        plugTypes: plugTypeList.length > 0 ? plugTypeList : null,
        batteryKwh: profile.batteryKwh ?? spec.batteryKwh,
        rangeMiles: profile.rangeMiles ?? spec.rangeMiles,
        dcMaxKw: profile.dcMaxKw ?? null,
        acMaxKw: profile.acMaxKw ?? null,
        currentSocPercent: currentSocPercent ?? null,
        minArrivalSocPercent: minArrivalSocPercent ?? null,
      };
    }
  }

  // ── Connector affinity — look up the user's charging history preferences ──
  const auth = getAuth(req);
  const clerkUserId = auth?.userId ?? null;

  // ── Spatial pre-filter (bounding box) ─────────────────────────────────────
  const latOffset = radiusN / 69;
  const lngOffset = radiusN / (69 * Math.cos((latN * Math.PI) / 180));
  const radiusMeters = Math.round(radiusN * 1609.34);
  const osmKey = matchCacheKey(latN, lngN, radiusN);

  // Fetch community DB, NREL, OSM, and connector affinity in parallel.
  const [dbRows, nrelRows, osmData, affinity] = await Promise.all([
    db
      .select()
      .from(stationsTable)
      .where(
        and(
          gte(stationsTable.lat, latN - latOffset),
          lte(stationsTable.lat, latN + latOffset),
          gte(stationsTable.lng, lngN - lngOffset),
          lte(stationsTable.lng, lngN + lngOffset),
          ne(stationsTable.status, "offline"),
          ne(stationsTable.status, "pending"),
          ne(stationsTable.status, "removed"),
        ),
      ),
    fetchNrelForMatch(latN, lngN, radiusN),
    fetchOsmForMatch(latN, lngN, radiusMeters, osmKey),
    loadConnectorAffinity(clerkUserId),
  ]);

  // ── Scored-station shape ───────────────────────────────────────────────────
  type ScoredStation = {
    id: string;
    source: "community" | "nrel" | "osm";
    name: string;
    address: string | null;
    city: string | null;
    lat: number;
    lng: number;
    chargerType: string;
    connectorTypes: string[];
    powerKw: number | null;
    pricePerKwh: number | null;
    isFree: boolean;
    status: string;
    distanceMiles: number;
    availablePorts: number | null;
    totalPorts: number | null;
    network: string | null;
    matchScore: number;
    matchGrade: string;
    matchReasons: string[];
    connectorCompatible: boolean;
  };

  const allScored: ScoredStation[] = [];

  // ── Community DB ──────────────────────────────────────────────────────────
  const coveredPositions: Array<{ lat: number; lng: number }> = [];

  for (const s of dbRows) {
    const distanceMiles = haversineMiles(latN, lngN, s.lat, s.lng);
    if (distanceMiles > radiusN) continue;

    coveredPositions.push({ lat: s.lat, lng: s.lng });

    const matchable: MatchableStation = {
      connectorTypes: chargerTypeConnectors(s.chargerType),
      chargerType: s.chargerType,
      powerKw: s.powerKw,
      distanceMiles,
      isFree: s.pricePerKwh === 0,
      pricePerKwh: s.pricePerKwh > 0 ? s.pricePerKwh : null,
      availablePorts: s.availablePorts,
      totalPorts: s.totalPorts,
      status: s.status as "available" | "busy" | "offline" | "unknown",
      accessType: "public",
    };

    allScored.push({
      id: `db-${s.id}`,
      source: "community",
      name: s.name,
      address: s.address,
      city: s.city,
      lat: s.lat,
      lng: s.lng,
      chargerType: s.chargerType,
      connectorTypes: matchable.connectorTypes,
      powerKw: s.powerKw,
      pricePerKwh: matchable.pricePerKwh,
      isFree: matchable.isFree,
      status: s.status,
      distanceMiles,
      availablePorts: s.availablePorts,
      totalPorts: s.totalPorts,
      network: s.network,
      ...scoreVehicleMatch(matchable, spec, affinity),
    });
  }

  // ── NREL (skip private access; deduplicate against community ~100 m) ───────
  for (const s of nrelRows) {
    if (s.access_code === "private") continue;

    const sLat = parseFloat(s.latitude);
    const sLng = parseFloat(s.longitude);
    if (isNaN(sLat) || isNaN(sLng)) continue;

    const distanceMiles = haversineMiles(latN, lngN, sLat, sLng);
    if (distanceMiles > radiusN) continue;

    if (coveredPositions.some((p) => haversineMiles(sLat, sLng, p.lat, p.lng) < 0.062)) continue;
    coveredPositions.push({ lat: sLat, lng: sLng });

    const connectorTypes = nrelConnectorTypes(s);
    const chargerType = nrelChargerType(s);
    const accessType = nrelAccessType(s.access_code ?? null, s.access_detail_code ?? null);

    const matchable: MatchableStation = {
      connectorTypes,
      chargerType,
      powerKw: null,
      distanceMiles,
      isFree: false,
      pricePerKwh: null,
      availablePorts: null,
      totalPorts: nrelTotalPorts(s),
      status: "unknown",
      accessType,
    };

    allScored.push({
      id: `nrel-${s.id}`,
      source: "nrel",
      name: s.station_name ?? "EV Charging Station",
      address: s.street_address ?? null,
      city: s.city ?? null,
      lat: sLat,
      lng: sLng,
      chargerType,
      connectorTypes,
      powerKw: null,
      pricePerKwh: null,
      isFree: false,
      status: "unknown",
      distanceMiles,
      availablePorts: null,
      totalPorts: matchable.totalPorts,
      network: s.ev_network ?? null,
      ...scoreVehicleMatch(matchable, spec, affinity),
    });
  }

  // ── OSM (fill gaps not covered by community or NREL ~100 m) ──────────────
  const osmElements: any[] = (osmData as any)?.elements ?? [];
  for (const el of osmElements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;
    if (!elLat || !elLng) continue;

    const distanceMiles = haversineMiles(latN, lngN, elLat, elLng);
    if (distanceMiles > radiusN) continue;

    if (coveredPositions.some((p) => haversineMiles(elLat, elLng, p.lat, p.lng) < 0.062)) continue;
    coveredPositions.push({ lat: elLat, lng: elLng });

    const tags: Record<string, string> = el.tags ?? {};
    const chargerType = osmChargerType(tags);
    const connectorTypes = osmConnectorTypes(tags);
    const powerKw = osmPowerKw(tags);
    const isFree = tags.fee === "no";
    const network = tags.network || tags.operator || tags.brand || null;
    const accessType = osmAccessType(tags);

    const matchable: MatchableStation = {
      connectorTypes,
      chargerType,
      powerKw,
      distanceMiles,
      isFree,
      pricePerKwh: isFree ? 0 : null,
      availablePorts: null,
      totalPorts: osmCapacity(tags),
      status: "unknown",
      accessType,
    };

    allScored.push({
      id: `osm-${el.type}-${el.id}`,
      source: "osm",
      name: tags.name || tags.operator || tags.network || tags.brand || "EV Charging Station",
      address:
        [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null,
      city: tags["addr:city"] || null,
      lat: elLat,
      lng: elLng,
      chargerType,
      connectorTypes,
      powerKw,
      pricePerKwh: matchable.pricePerKwh,
      isFree,
      status: "unknown",
      distanceMiles,
      availablePorts: null,
      totalPorts: matchable.totalPorts,
      network,
      ...scoreVehicleMatch(matchable, spec, affinity),
    });
  }

  // ── Sort & slice ──────────────────────────────────────────────────────────
  // Compatible stations precede incompatible ones; within each group sort by
  // matchScore descending.
  const result = allScored
    .sort((a, b) => {
      const compatDiff = (b.connectorCompatible ? 1 : 0) - (a.connectorCompatible ? 1 : 0);
      if (compatDiff !== 0) return compatDiff;
      return b.matchScore - a.matchScore;
    })
    .slice(0, limitN);

  return res.json(result);
});

export default router;
