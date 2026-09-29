import { Router } from "express";

const TL_BASE = "https://transit.land/api/v2";
const TL_KEY = process.env.TRANSITLAND_API_KEY ?? "";

// ── TTL cache ─────────────────────────────────────────────────────────────────
const cache = new Map<string, { data: unknown; exp: number }>();
async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data as T;
  const data = await fn();
  cache.set(key, { data, exp: Date.now() + ttlMs });
  return data;
}

// Evict stale cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.exp < now) cache.delete(k);
}, 5 * 60_000);

// ── Helpers ──────────────────────────────────────────────────────────────────
export type TlDeparture = {
  route: string;        // short name, e.g. "14" or "BART"
  headsign: string;     // e.g. "Mission & Balboa Park"
  departureTime: string; // "HH:MM" 24h
  minutesAway: number;
};

function parseGtfsTime(timeStr: string, baseDate: Date): Date {
  const parts = timeStr.split(":").map(Number);
  const [hh = 0, mm = 0, ss = 0] = parts;
  const d = new Date(baseDate);
  d.setHours(hh, mm, ss, 0);
  return d;
}

async function fetchDeparturesForStop(
  stopKey: string,
  serviceDate: string,
  serviceAfter: string,
  serviceBefore: string,
  now: Date,
  perPage = 6,
): Promise<TlDeparture[]> {
  const url = `${TL_BASE}/stop_times?stop_key=${encodeURIComponent(stopKey)}&service_date=${serviceDate}&service_after=${encodeURIComponent(serviceAfter)}&service_before=${encodeURIComponent(serviceBefore)}&apikey=${TL_KEY}&per_page=${perPage}`;
  const timesData = await withCache<{ stop_times?: Record<string, unknown>[] }>(
    `tl:times:${stopKey}:${serviceDate}:${serviceAfter.slice(0, 16)}`,
    60_000,
    async () => {
      const r = await fetch(url, {
        headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
      });
      if (!r.ok) return { stop_times: [] };
      return r.json() as Promise<{ stop_times?: Record<string, unknown>[] }>;
    },
  );

  return (timesData.stop_times ?? [])
    .map((st) => {
      const trip = st.trip as Record<string, unknown> | undefined;
      const route = trip?.route as Record<string, unknown> | undefined;
      const deptStr = ((st.departure_time ?? st.arrival_time ?? "") as string);
      const deptDate = parseGtfsTime(deptStr, now);
      const minutesAway = Math.round((deptDate.getTime() - now.getTime()) / 60_000);
      return {
        route: ((route?.route_short_name ?? route?.route_long_name ?? "") as string).trim(),
        headsign: ((trip?.trip_headsign ?? "") as string).trim(),
        departureTime: deptStr.length >= 5 ? deptStr.slice(0, 5) : "",
        minutesAway,
      };
    })
    .filter((d) => d.minutesAway >= 0 && d.minutesAway <= 120);
}

const router = Router();

// ── GET /api/transit/nearby ───────────────────────────────────────────────────
// Returns Transitland stops near a point, each with their next departures.
// Used to enrich the "Transit Near You" stop list in the mobile panel.
router.get("/transit/nearby", async (req, res) => {
  const { lat, lng, radius = "600" } = req.query as Record<string, string>;

  if (!lat || !lng) {
    res.status(400).json({ error: "lat and lng required" });
    return;
  }
  if (!TL_KEY) {
    res.status(503).json({ error: "Transitland API key not configured" });
    return;
  }

  try {
    const now = new Date();
    const serviceDate = now.toISOString().slice(0, 10);
    const serviceAfter = now.toISOString();
    const serviceBefore = new Date(now.getTime() + 90 * 60_000).toISOString();

    const stopsData = await withCache<{ stops?: Record<string, unknown>[] }>(
      `tl:stops:${lat}:${lng}:${radius}`,
      120_000,
      async () => {
        const url = `${TL_BASE}/stops?lat=${lat}&lon=${lng}&radius=${radius}&apikey=${TL_KEY}&per_page=10`;
        const r = await fetch(url, {
          headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
        });
        if (!r.ok) throw new Error(`Transitland stops ${r.status}`);
        return r.json() as Promise<{ stops?: Record<string, unknown>[] }>;
      },
    );

    const stops = stopsData.stops ?? [];

    const results = await Promise.all(
      stops.map(async (stop) => {
        const stopKey = stop.id as string;
        const coords = (stop.geometry as { coordinates?: number[] })?.coordinates ?? [];
        const departures = await fetchDeparturesForStop(
          stopKey, serviceDate, serviceAfter, serviceBefore, now, 5,
        );
        return {
          id: stopKey,
          name: (stop.stop_name as string) ?? "",
          lat: coords[1] ?? null,
          lng: coords[0] ?? null,
          departures,
        };
      }),
    );

    res.json({ stops: results });
  } catch (err: unknown) {
    req.log.error({ err }, "transit/nearby failed");
    res.status(502).json({ error: "Transit data unavailable" });
  }
});

// ── GET /api/transit/departures ───────────────────────────────────────────────
// Returns next departures at the closest Transitland stop to a lat/lng.
// Used to show the next bus/train time on the transit leg of an itinerary.
router.get("/transit/departures", async (req, res) => {
  const { lat, lng } = req.query as Record<string, string>;

  if (!lat || !lng) {
    res.status(400).json({ error: "lat and lng required" });
    return;
  }
  if (!TL_KEY) {
    res.status(503).json({ error: "Transitland API key not configured" });
    return;
  }

  try {
    const now = new Date();
    const serviceDate = now.toISOString().slice(0, 10);
    const serviceAfter = now.toISOString();
    const serviceBefore = new Date(now.getTime() + 120 * 60_000).toISOString();

    const stopsData = await withCache<{ stops?: Record<string, unknown>[] }>(
      `tl:stops:${lat}:${lng}:150`,
      120_000,
      async () => {
        const url = `${TL_BASE}/stops?lat=${lat}&lon=${lng}&radius=150&apikey=${TL_KEY}&per_page=1`;
        const r = await fetch(url, {
          headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
        });
        if (!r.ok) throw new Error(`Transitland stops ${r.status}`);
        return r.json() as Promise<{ stops?: Record<string, unknown>[] }>;
      },
    );

    const stop = (stopsData.stops ?? [])[0];
    if (!stop) {
      res.json({ departures: [], stopName: "" });
      return;
    }

    const stopKey = stop.id as string;
    const departures = await fetchDeparturesForStop(
      stopKey, serviceDate, serviceAfter, serviceBefore, now, 6,
    );

    res.json({ departures, stopName: (stop.stop_name as string) ?? "" });
  } catch (err: unknown) {
    req.log.error({ err }, "transit/departures failed");
    res.status(502).json({ error: "Transit data unavailable" });
  }
});

export default router;
