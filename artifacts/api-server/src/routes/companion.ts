import { Router } from "express";

const router = Router();

interface WeatherData {
  tempC: number;
  tempF: number;
  feelsLikeC: number;
  feelsLikeF: number;
  condition: string;
  humidity: number;
  windKph: number;
}

export interface NearbyPlace {
  name: string;
  type: string;
  rating: number | null;
  distM: number;
  walkMinutes: number;
  openNow: boolean | null;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const weatherCache = new Map<string, CacheEntry<WeatherData>>();
const placesCache = new Map<string, CacheEntry<NearbyPlace[]>>();

const WEATHER_TTL = 6 * 60 * 60 * 1000;
const PLACES_TTL = 2 * 60 * 60 * 1000;

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttl: number): void {
  map.set(key, { data, expiresAt: Date.now() + ttl });
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cacheGet(weatherCache, key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://wttr.in/${lat},${lng}?format=j1`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)",
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;

    const body = await res.json() as Record<string, unknown>;
    const cond = (body.current_condition as Record<string, unknown>[] | undefined)?.[0];
    if (!cond) return null;

    const getVal = (field: string) => {
      const v = cond[field];
      if (typeof v === "number") return v;
      if (typeof v === "string") return parseFloat(v);
      return 0;
    };
    const getStr = (field: string): string => {
      const v = cond[field];
      if (typeof v === "string") return v;
      if (Array.isArray(v) && v.length > 0) {
        const first = (v as Record<string, unknown>[])[0];
        return typeof first.value === "string" ? first.value : String(first.value ?? "");
      }
      return "";
    };

    const data: WeatherData = {
      tempC: Math.round(getVal("temp_C")),
      tempF: Math.round(getVal("temp_F")),
      feelsLikeC: Math.round(getVal("FeelsLikeC")),
      feelsLikeF: Math.round(getVal("FeelsLikeF")),
      condition: getStr("weatherDesc"),
      humidity: Math.round(getVal("humidity")),
      windKph: Math.round(getVal("windspeedKmph")),
    };

    cacheSet(weatherCache, key, data, WEATHER_TTL);
    return data;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchNearbyPlaces(lat: number, lng: number): Promise<NearbyPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cacheGet(placesCache, key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=700&type=food&key=${apiKey}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];

    const body = await res.json() as Record<string, unknown>;
    const status = body.status as string | undefined;
    if (status !== "OK" && status !== "ZERO_RESULTS") return [];

    const results = (body.results as Record<string, unknown>[] | undefined) ?? [];

    const places: NearbyPlace[] = results
      .slice(0, 8)
      .map((p) => {
        const loc = (p.geometry as Record<string, unknown> | undefined)?.location as
          | Record<string, number>
          | undefined;
        const plat = loc?.lat ?? lat;
        const plng = loc?.lng ?? lng;
        const dlat = (plat - lat) * 111000;
        const dlng = (plng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
        const distM = Math.round(Math.sqrt(dlat * dlat + dlng * dlng));
        const walkMinutes = Math.max(1, Math.round(distM / 80));
        const types = (p.types as string[] | undefined) ?? [];
        const primaryType = types.find((t) =>
          ["cafe", "bakery", "restaurant", "grocery_or_supermarket", "supermarket", "bar", "food"].includes(t),
        ) ?? types[0] ?? "establishment";

        return {
          name: String(p.name ?? ""),
          type: primaryType,
          rating: typeof p.rating === "number" ? Math.round(p.rating * 10) / 10 : null,
          distM,
          walkMinutes,
          openNow:
            (p.opening_hours as Record<string, unknown> | undefined)?.open_now === true
              ? true
              : (p.opening_hours as Record<string, unknown> | undefined)?.open_now === false
                ? false
                : null,
        };
      })
      .sort((a, b) => a.walkMinutes - b.walkMinutes);

    cacheSet(placesCache, key, places, PLACES_TTL);
    return places;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

router.get("/stations/:id/companion", async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng query params are required" });
    return;
  }

  const [weatherResult, placesResult] = await Promise.allSettled([
    fetchWeather(lat, lng),
    fetchNearbyPlaces(lat, lng),
  ]);

  res.json({
    weather: weatherResult.status === "fulfilled" ? weatherResult.value : null,
    nearbyPlaces: placesResult.status === "fulfilled" ? (placesResult.value ?? []) : [],
  });
});

export default router;
