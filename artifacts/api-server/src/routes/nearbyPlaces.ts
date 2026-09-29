import { Router } from "express";

const router = Router();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const cache = new Map<string, { data: NearbyPlace[]; at: number }>();

export interface NearbyPlace {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  distanceM: number;
  address?: string;
  phone?: string;
  website?: string;
  openNow?: boolean | null;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Map category slug → Overpass tag filter(s)
const CATEGORY_FILTERS: Record<string, string[]> = {
  restaurant: ['node["amenity"~"^(restaurant|fast_food|food_court)$"]', 'way["amenity"~"^(restaurant|fast_food|food_court)$"]'],
  hotel:      ['node["tourism"~"^(hotel|motel|hostel|guest_house)$"]', 'way["tourism"~"^(hotel|motel|hostel|guest_house)$"]'],
  cafe:       ['node["amenity"="cafe"]', 'way["amenity"="cafe"]'],
  parking:    ['node["amenity"="parking"]', 'way["amenity"="parking"]'],
  hospital:   ['node["amenity"~"^(hospital|clinic|pharmacy|doctors)$"]', 'way["amenity"~"^(hospital|clinic|pharmacy|doctors)$"]'],
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchNearbyPlaces(lat: number, lng: number, category: string, radius: number): Promise<NearbyPlace[]> {
  const cacheKey = `${category}|${lat.toFixed(3)}|${lng.toFixed(3)}|${radius}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const filters = CATEGORY_FILTERS[category];
  if (!filters) return [];

  const aroundClause = `(around:${radius},${lat},${lng})`;
  const parts = filters.map((f) => `  ${f}${aroundClause};`).join("\n");
  const query = `[out:json][timeout:10];\n(\n${parts}\n);\nout center 15;`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ChargeBridge/1.0" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];

  const data = await res.json() as { elements?: any[] };
  const elements = data.elements ?? [];

  const places: NearbyPlace[] = elements
    .filter((el) => el.tags?.name)
    .map((el) => {
      const placeLat = el.type === "way" ? (el.center?.lat ?? el.lat) : el.lat;
      const placeLng = el.type === "way" ? (el.center?.lon ?? el.lon) : el.lon;
      return {
        id: `${el.type}/${el.id}`,
        name: el.tags.name,
        category,
        lat: placeLat,
        lng: placeLng,
        distanceM: Math.round(haversineM(lat, lng, placeLat, placeLng)),
        address: [el.tags["addr:housenumber"], el.tags["addr:street"]].filter(Boolean).join(" ") || undefined,
        phone: el.tags.phone || el.tags["contact:phone"] || undefined,
        website: el.tags.website || el.tags["contact:website"] || undefined,
        openNow: null,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 10);

  cache.set(cacheKey, { data: places, at: Date.now() });
  return places;
}

// GET /api/nearby-places?lat=&lng=&category=restaurant&radius=500
router.get("/nearby-places", async (req, res) => {
  const { lat, lng, category, radius } = req.query as Record<string, string>;
  if (!lat || !lng || !category) {
    res.status(400).json({ error: "lat, lng, category required" });
    return;
  }
  const latN = parseFloat(lat);
  const lngN = parseFloat(lng);
  const radiusN = Math.min(parseInt(radius ?? "500", 10), 2000);
  if (isNaN(latN) || isNaN(lngN) || !CATEGORY_FILTERS[category]) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  try {
    const places = await fetchNearbyPlaces(latN, lngN, category, radiusN);
    res.json({ places, category });
  } catch {
    res.status(502).json({ error: "Overpass unavailable" });
  }
});

export default router;
