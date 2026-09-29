import { Router } from "express";

const router = Router();

// ── Route cache (2 min) — avoids duplicate Google API charges ────────────────
const routeCache = new Map<string, { data: object; ts: number }>();
const ROUTE_CACHE_TTL = 2 * 60 * 1000;

// ── Encoded-polyline decoder → GeoJSON [lng, lat] pairs ──────────────────────
function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function googleManeuverToOsrm(m?: string): { type: string; modifier: string } {
  switch (m) {
    case "turn-left":         return { type: "turn",      modifier: "left" };
    case "turn-right":        return { type: "turn",      modifier: "right" };
    case "turn-sharp-left":   return { type: "turn",      modifier: "sharp left" };
    case "turn-sharp-right":  return { type: "turn",      modifier: "sharp right" };
    case "turn-slight-left":  return { type: "turn",      modifier: "slight left" };
    case "turn-slight-right": return { type: "turn",      modifier: "slight right" };
    case "uturn-left":
    case "uturn-right":       return { type: "turn",      modifier: "uturn" };
    case "keep-left":
    case "fork-left":         return { type: "fork",      modifier: "slight left" };
    case "keep-right":
    case "fork-right":        return { type: "fork",      modifier: "slight right" };
    case "merge":             return { type: "merge",     modifier: "straight" };
    case "ramp-left":         return { type: "off ramp",  modifier: "left" };
    case "ramp-right":        return { type: "off ramp",  modifier: "right" };
    case "roundabout-left":   return { type: "roundabout", modifier: "left" };
    case "roundabout-right":  return { type: "roundabout", modifier: "right" };
    case "straight":          return { type: "continue",  modifier: "straight" };
    default:                  return { type: "depart",    modifier: "straight" };
  }
}

type GoogleStep = {
  html_instructions: string;
  maneuver?: string;
  distance: { value: number };
  duration: { value: number };
  polyline: { points: string };
  end_location: { lat: number; lng: number };
  start_location: { lat: number; lng: number };
};

type GoogleLeg = {
  steps: GoogleStep[];
  distance: { value: number };
  duration: { value: number };
};

type GoogleRoute = {
  legs: GoogleLeg[];
  overview_polyline: { points: string };
  summary: string;
};

type GoogleDirectionsResponse = {
  status: string;
  routes: GoogleRoute[];
};

function normalizeGoogleToOsrm(data: GoogleDirectionsResponse): object {
  if (data.status !== "OK" || !data.routes?.length) return { code: "NoRoute", routes: [] };

  const routes = data.routes.map((r) => {
    const overviewCoords = decodePolyline(r.overview_polyline.points);
    const totalDuration = r.legs.reduce((s, l) => s + l.duration.value, 0);
    const totalDistance = r.legs.reduce((s, l) => s + l.distance.value, 0);

    const legs = r.legs.map((leg) => {
      const steps = leg.steps.map((step) => {
        const stepCoords = decodePolyline(step.polyline.points);
        const { type, modifier } = googleManeuverToOsrm(step.maneuver);
        const endLoc = step.end_location;
        const startLoc = step.start_location;
        const instruction = stripHtml(step.html_instructions);
        return {
          maneuver: {
            instruction,
            type,
            modifier,
            location: [endLoc.lng, endLoc.lat],
            bearing_before: 0,
            bearing_after: 0,
          },
          name: instruction,
          distance: step.distance.value,
          duration: step.duration.value,
          geometry: {
            type: "LineString",
            coordinates: stepCoords.length > 0
              ? stepCoords
              : [[startLoc.lng, startLoc.lat], [endLoc.lng, endLoc.lat]],
          },
          intersections: [],
          _source: "google",
        };
      });
      return { steps, distance: leg.distance.value, duration: leg.duration.value, summary: "" };
    });

    return {
      geometry: { type: "LineString", coordinates: overviewCoords },
      legs,
      duration: totalDuration,
      distance: totalDistance,
      weight: totalDuration,
      weight_name: "duration",
      _source: "google",
    };
  });

  return { code: "Ok", routes };
}

async function googleRoute(
  olat: string, olng: string,
  dlat: string, dlng: string,
  mode: string,
  avoid?: string
): Promise<object | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const googleMode =
    mode === "walking" ? "walking" :
    mode === "cycling" ? "bicycling" : "driving";

  // Real-time traffic: departure_time=now + traffic_model=best_guess tells Google
  // to factor live congestion into route selection and duration estimates.
  const trafficParams = googleMode === "driving"
    ? `&departure_time=${Math.floor(Date.now() / 1000)}&traffic_model=best_guess`
    : "";

  const avoidParam = avoid ? `&avoid=${encodeURIComponent(avoid)}` : "";

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${olat},${olng}&destination=${dlat},${dlng}` +
    `&mode=${googleMode}&alternatives=true&steps=true${trafficParams}${avoidParam}&key=${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = (await resp.json()) as GoogleDirectionsResponse;
    if (data.status !== "OK") return null;
    return normalizeGoogleToOsrm(data);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

router.get("/route", async (req, res) => {
  const { olat, olng, dlat, dlng, mode, avoid } = req.query;
  if (!olat || !olng || !dlat || !dlng) {
    res.status(400).json({ error: "Missing required params: olat, olng, dlat, dlng" });
    return;
  }

  const safeMode =
    mode === "walking" ? "walking" : mode === "cycling" ? "cycling" : "driving";

  // live=1 bypasses cache — used by active-navigation recalculation calls so they
  // always get fresh real-time traffic data rather than a 2-min stale response.
  const isLive = req.query.live === "1" || req.query.live === "true";

  const avoidStr = typeof avoid === "string" ? avoid : undefined;
  const cacheKey = `${olat},${olng}->${dlat},${dlng}|${safeMode}|${avoidStr ?? ""}`;

  if (!isLive) {
    const cached = routeCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ROUTE_CACHE_TTL) {
      res.json(cached.data);
      return;
    }
  }

  // ── Primary: Google Directions API (real-time traffic, new roads) ───────────
  const googleResult = await googleRoute(
    String(olat), String(olng), String(dlat), String(dlng), safeMode, avoidStr
  );
  if (googleResult) {
    if (!isLive) routeCache.set(cacheKey, { data: googleResult, ts: Date.now() });
    res.json(googleResult);
    return;
  }

  // ── Fallback: OSRM public demo server ────────────────────────────────────────
  const osrmMode = safeMode === "cycling" ? "cycling" : safeMode;
  const osrmUrl =
    `https://router.project-osrm.org/route/v1/${osrmMode}/${olng},${olat};${dlng},${dlat}` +
    `?overview=full&geometries=geojson&steps=true&alternatives=true`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(osrmUrl, {
      headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      res.status(502).json({ error: "Routing service error" });
      return;
    }
    const data = await resp.json() as object;
    if (!isLive) routeCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch {
    clearTimeout(timer);
    res.status(502).json({ error: "Routing request timed out or failed" });
  }
});

export default router;
