import { Router } from "express";

const router = Router();

interface NRELStation {
  id: number;
  station_name: string;
  street_address: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  ev_connector_types: string[] | null;
  ev_level2_evse_num: number | null;
  ev_dc_fast_num: number | null;
  access_code: string;
  status_code: string;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function interpolatePoints(coords: [number, number][], stepKm: number): [number, number][] {
  const pts: [number, number][] = [];
  let accumulated = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const d = haversineKm(lat1, lng1, lat2, lng2);
    accumulated += d;
    if (accumulated >= stepKm) {
      pts.push([lat1, lng1]);
      accumulated = 0;
    }
  }
  return pts;
}

async function fetchOverpassEv(lat: number, lng: number, radiusM: number, limitPer: number): Promise<{ id: string; name: string; lat: number; lng: number; connectors: string[] }[]> {
  const query = `[out:json][timeout:20];(node["amenity"="charging_station"](around:${radiusM},${lat},${lng});way["amenity"="charging_station"](around:${radiusM},${lat},${lng}););out center ${limitPer};`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ChargeBridge/1.0" },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const d = await r.json() as { elements: any[] };
    return (d.elements ?? []).flatMap((el: any) => {
      const elLat: number | undefined = el.lat ?? el.center?.lat;
      const elLng: number | undefined = el.lon ?? el.center?.lon;
      if (!elLat || !elLng) return [];
      const tags = el.tags ?? {};
      const connectors: string[] = [];
      if (tags["socket:type2"]) connectors.push("J1772");
      if (tags["socket:chademo"]) connectors.push("CHADEMO");
      if (tags["socket:ccs2"] || tags["socket:type2_combo"]) connectors.push("CCS");
      if (tags["socket:tesla_supercharger"]) connectors.push("TESLA");
      return [{
        id: `osm-${el.type}-${el.id}`,
        name: tags.name ?? tags.operator ?? tags.brand ?? "Charging Station",
        lat: elLat,
        lng: elLng,
        connectors,
      }];
    });
  } catch {
    clearTimeout(t);
    return [];
  }
}

router.get("/trip/plan", async (req, res) => {
  const { olat, olng, dlat, dlng, rangeKm, connectorType, waypoints: waypointsParam } = req.query;
  if (!olat || !olng || !dlat || !dlng) {
    res.status(400).json({ error: "Missing required params: olat, olng, dlat, dlng" });
    return;
  }

  const range = parseFloat(rangeKm as string) || 250;
  const stopInterval = range * 0.75;

  // Parse optional intermediate waypoints
  let midpoints: { lat: number; lng: number }[] = [];
  if (waypointsParam) {
    try { midpoints = JSON.parse(waypointsParam as string); } catch {}
  }

  // Build multi-leg OSRM coordinate string: lng,lat pairs joined by ;
  const allCoords = [
    { lat: parseFloat(olat as string), lng: parseFloat(olng as string) },
    ...midpoints,
    { lat: parseFloat(dlat as string), lng: parseFloat(dlng as string) },
  ];
  const coordStr = allCoords.map(p => `${p.lng},${p.lat}`).join(";");
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;

  let routeData: any;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(osrmUrl, { headers: { "User-Agent": "ChargeBridge/1.0" }, signal: ctrl.signal });
    clearTimeout(t);
    routeData = await r.json();
  } catch {
    res.status(502).json({ error: "Routing failed" });
    return;
  }

  if (!routeData?.routes?.[0]) {
    res.status(400).json({ error: "No route found" });
    return;
  }

  const route = routeData.routes[0];
  const coords: [number, number][] = route.geometry.coordinates;
  const distanceKm = route.distance / 1000;
  const durationSec = route.duration;

  // Extract turn-by-turn steps per leg
  const legs = (route.legs ?? []).map((leg: any) => {
    const steps = (leg.steps ?? [])
      .filter((s: any) => (s.distance ?? 0) > 30 || s.maneuver?.type === "arrive" || s.maneuver?.type === "depart")
      .map((s: any) => ({
        type: s.maneuver?.type ?? "continue",
        modifier: s.maneuver?.modifier ?? undefined,
        name: (s.name ?? "").trim(),
        distanceM: Math.round(s.distance ?? 0),
        durationSec: Math.round(s.duration ?? 0),
      }));
    return {
      distanceKm: Math.round((leg.distance ?? 0) / 1000),
      durationSec: Math.round(leg.duration ?? 0),
      steps,
    };
  });

  const samplePoints = interpolatePoints(coords, stopInterval);

  const nrelKey = process.env.NREL_API_KEY;
  const stops: any[] = [];
  const seen = new Set<string>();

  // ── Phase 1: NREL (US coverage) ──────────────────────────────────────────
  const nrelHitPoints = new Set<number>();
  for (let i = 0; i < Math.min(samplePoints.length, 8); i++) {
    const [lat, lng] = samplePoints[i];
    if (!nrelKey) break;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const url = `https://developer.nrel.gov/api/alt-fuel-stations/v1.json?api_key=${nrelKey}&fuel_type=ELEC&latitude=${lat}&longitude=${lng}&radius=15&limit=3&status=E`;
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const d = await r.json() as { fuel_stations: NRELStation[] };
      const stations = d.fuel_stations ?? [];
      let addedThisPoint = 0;
      for (const s of stations) {
        const sid = String(s.id);
        const distToSample = haversineKm(lat, lng, s.latitude, s.longitude);
        if (distToSample > 40) continue;
        if (seen.has(sid)) continue;
        if (connectorType && s.ev_connector_types && !s.ev_connector_types.includes(connectorType as string)) continue;
        seen.add(sid);
        const distFromOrigin = haversineKm(parseFloat(olat as string), parseFloat(olng as string), s.latitude, s.longitude);
        stops.push({
          id: sid,
          name: s.station_name,
          address: `${s.street_address}, ${s.city}, ${s.state}`,
          lat: s.latitude,
          lng: s.longitude,
          connectors: s.ev_connector_types ?? [],
          level2Ports: s.ev_level2_evse_num ?? 0,
          dcFastPorts: s.ev_dc_fast_num ?? 0,
          distanceFromOriginKm: Math.round(distFromOrigin),
          access: s.access_code,
        });
        addedThisPoint++;
      }
      if (addedThisPoint > 0) nrelHitPoints.add(i);
    } catch { continue; }
  }

  // ── Phase 2: Overpass fallback ────────────────────────────────────────────
  const overpassPoints = samplePoints
    .slice(0, 8)
    .map((pt, i) => ({ pt, i }))
    .filter(({ i }) => !nrelHitPoints.has(i));

  for (const { pt: [lat, lng] } of overpassPoints) {
    try {
      const osm = await fetchOverpassEv(lat, lng, 20000, 5);
      for (const s of osm) {
        if (seen.has(s.id)) continue;
        if (connectorType && s.connectors.length > 0 && !s.connectors.includes(connectorType as string)) continue;
        seen.add(s.id);
        const distFromOrigin = haversineKm(parseFloat(olat as string), parseFloat(olng as string), s.lat, s.lng);
        stops.push({
          id: s.id,
          name: s.name,
          address: null,
          lat: s.lat,
          lng: s.lng,
          connectors: s.connectors,
          level2Ports: 0,
          dcFastPorts: 0,
          distanceFromOriginKm: Math.round(distFromOrigin),
        });
      }
    } catch { continue; }
  }

  stops.sort((a, b) => a.distanceFromOriginKm - b.distanceFromOriginKm);

  res.json({
    route: { distanceKm: Math.round(distanceKm), durationSec: Math.round(durationSec), geometry: route.geometry },
    stops,
    legs,
    rangeKm: range,
    waypoints: midpoints,
  });
});

export default router;
