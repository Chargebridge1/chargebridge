import { Router } from "express";
import { db } from "@workspace/db";
import { stationPhotosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, { data: LocationPhoto[]; at: number }>();

export interface LocationPhoto {
  url: string;
  thumbUrl: string;
  title: string;
  source: "wikimedia" | "ocm" | "community" | "google" | "mapillary" | "streetview";
  sourceUrl?: string;
  attribution?: string;
  distanceM?: number;
}

// ── Wikimedia Commons geosearch ────────────────────────────────────────────────
// Tight 150 m radius only — wider fallbacks returned general-area shots that
// had nothing to do with the actual charging station.
const SKIP_EXT = /\.(svg|pdf|ogg|ogv|mp3|wav|webm|tiff|xcf|djvu|stl|gif)$/i;
const SKIP_TITLE = /\b(map|diagram|logo|icon|flag|coat.of.arms|seal|emblem|chart|graph|locator|plan|schema|blueprint|template)\b/i;

async function wikimediaGeoSearch(lat: number, lng: number, radius: number): Promise<LocationPhoto[]> {
  const geoUrl =
    `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${lat}|${lng}&gsradius=${radius}&gsnamespace=6&gslimit=20&format=json&origin=*`;
  const geoRes = await fetch(geoUrl, {
    headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridge.app)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!geoRes.ok) return [];
  const geoData = await geoRes.json() as { query?: { geosearch?: { pageid: number; title: string; dist?: number }[] } };
  const pages = geoData.query?.geosearch ?? [];
  if (pages.length === 0) return [];

  const distMap = new Map<number, number>(pages.map((p) => [p.pageid, p.dist ?? 0]));
  const pageIds = pages.map((p) => p.pageid).join("|");
  const infoUrl =
    `https://commons.wikimedia.org/w/api.php?action=query&pageids=${pageIds}` +
    `&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=640&format=json&origin=*`;
  const infoRes = await fetch(infoUrl, {
    headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridge.app)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!infoRes.ok) return [];
  const infoData = await infoRes.json() as { query?: { pages?: Record<string, any> } };
  const pagesInfo = infoData.query?.pages ?? {};

  const photos: LocationPhoto[] = [];
  for (const page of Object.values(pagesInfo)) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl) continue;
    const thumb = info.thumburl as string;
    const fullUrl = info.url as string;
    if (SKIP_EXT.test(thumb)) continue;
    const rawTitle = page.title as string;
    const title = rawTitle.replace(/^File:/, "").replace(/_/g, " ").replace(/\.[a-z]+$/i, "");
    if (SKIP_TITLE.test(title)) continue;
    const author = info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "") ?? null;
    const pageId = parseInt(String(page.pageid), 10);
    photos.push({
      url: fullUrl,
      thumbUrl: thumb,
      title,
      source: "wikimedia",
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(rawTitle)}`,
      attribution: author ?? undefined,
      distanceM: distMap.get(pageId),
    });
  }
  return photos;
}

async function fetchWikimediaPhotos(lat: number, lng: number): Promise<LocationPhoto[]> {
  try {
    // Tight 150 m only — no wide fallbacks that pull in general neighbourhood shots
    return await wikimediaGeoSearch(lat, lng, 150);
  } catch {
    return [];
  }
}

// ── OpenChargeMap photos ───────────────────────────────────────────────────────
async function fetchOcmPhotos(lat: number, lng: number): Promise<LocationPhoto[]> {
  const apiKey = process.env.OCM_API_KEY;
  if (!apiKey) return [];
  try {
    const url =
      `https://api.openchargemap.io/v3/poi/?output=json&latitude=${lat}&longitude=${lng}` +
      `&distance=0.1&distanceunit=KM&maxresults=1&includecomments=true&compact=false&verbose=true&key=${apiKey}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ChargeBridge/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    const poi = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!poi) return [];
    return (poi.MediaItems ?? [])
      .map((m: any): LocationPhoto => ({
        url: m.ItemURL ?? "",
        thumbUrl: m.ItemThumbnailURL ?? m.ItemURL ?? "",
        title: m.Comment ?? "Charging station photo",
        source: "ocm",
        sourceUrl: `https://openchargemap.org/site/poi/details/${poi.ID}`,
        distanceM: 0,
      }))
      .filter((p: LocationPhoto) => !!p.url);
  } catch {
    return [];
  }
}

// ── Google Places Photos ───────────────────────────────────────────────────────
// Finds the nearest place within 30 m and fetches user-contributed photos.
async function fetchGooglePlacesPhotos(lat: number, lng: number): Promise<LocationPhoto[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];
  try {
    const searchUrl =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=30&key=${apiKey}`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json() as {
      results?: { place_id: string; name: string }[];
    };
    const places = searchData.results ?? [];
    if (places.length === 0) return [];

    const placeId = places[0].place_id;
    const placeName = places[0].name;

    const detailsUrl =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${placeId}&fields=name,photos&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(8000) });
    if (!detailsRes.ok) return [];
    const detailsData = await detailsRes.json() as {
      result?: {
        name?: string;
        photos?: { photo_reference: string; html_attributions?: string[] }[];
      };
    };
    const placePhotos = detailsData.result?.photos ?? [];
    const resolvedName = detailsData.result?.name ?? placeName;

    const photos: LocationPhoto[] = [];
    for (const photo of placePhotos.slice(0, 5)) {
      const refUrl =
        `https://maps.googleapis.com/maps/api/place/photo` +
        `?maxwidth=1024&photo_reference=${photo.photo_reference}&key=${apiKey}`;
      try {
        const photoRes = await fetch(refUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(6000),
        });
        if (!photoRes.ok) continue;
        const cdnUrl = photoRes.url;
        if (!cdnUrl || cdnUrl.startsWith("https://maps.googleapis.com")) continue;
        const attribution = photo.html_attributions?.[0]?.replace(/<[^>]+>/g, "") ?? undefined;
        photos.push({
          url: cdnUrl,
          thumbUrl: cdnUrl,
          title: resolvedName,
          source: "google",
          sourceUrl: `https://maps.google.com/?place_id=${placeId}`,
          attribution,
          distanceM: 0,
        });
      } catch {
        continue;
      }
    }
    return photos;
  } catch {
    return [];
  }
}

// ── Google Street View ─────────────────────────────────────────────────────────
// Uses the Street View Metadata API (free) to check coverage and obtain the
// pano_id, then constructs a keyless thumbnail URL from Google's own CDN.
// Prioritised first because it shows the exact street-level view of the address.
async function fetchStreetViewPhoto(lat: number, lng: number, address?: string): Promise<LocationPhoto[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];
  try {
    // Prefer address-based lookup when available — much more accurate for chargers
    // that sit in a parking lot or behind a building (GPS coords alone may miss the street).
    const location = address
      ? encodeURIComponent(address)
      : `${lat},${lng}`;

    const metaUrl =
      `https://maps.googleapis.com/maps/api/streetview/metadata` +
      `?location=${location}&key=${apiKey}`;
    const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(6000) });
    if (!metaRes.ok) return [];
    const meta = await metaRes.json() as {
      status: string;
      pano_id?: string;
      location?: { lat: number; lng: number };
    };
    if (meta.status !== "OK" || !meta.pano_id) return [];

    const panoId = meta.pano_id;
    const svLat = meta.location?.lat ?? lat;
    const svLng = meta.location?.lng ?? lng;

    // Distance of the street-view pano from the station coords
    const dLat = (svLat - lat) * 111000;
    const dLng = (svLng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
    const distM = Math.round(Math.sqrt(dLat ** 2 + dLng ** 2));

    // Keyless CDN thumbnail — same URL format Google Maps uses internally.
    // No API key in the client-visible URL; metadata call (free) is the only
    // billed operation.
    const thumbUrl =
      `https://streetviewpixels-pa.googleapis.com/v1/thumbnail` +
      `?panoid=${panoId}&cb_client=maps_sv&w=600&h=400&yaw=0&pitch=0&thumbfov=90`;

    return [{
      url: thumbUrl,
      thumbUrl,
      title: "Street view",
      source: "streetview",
      sourceUrl:
        `https://www.google.com/maps/@${svLat},${svLng},3a,90y,0h,90t` +
        `/data=!3m7!1e1!3m5!1s${panoId}`,
      distanceM: distM,
    }];
  } catch {
    return [];
  }
}

// ── Mapillary street-level imagery ────────────────────────────────────────────
async function fetchMapillaryPhotos(lat: number, lng: number): Promise<LocationPhoto[]> {
  const token = process.env.MAPILLARY_ACCESS_TOKEN;
  if (!token) return [];
  try {
    const d = 0.001;
    const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
    const url =
      `https://graph.mapillary.com/images` +
      `?access_token=${token}` +
      `&fields=id,thumb_1024_url,geometry,captured_at,creator` +
      `&bbox=${bbox}&limit=8`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as {
      data?: {
        id: string;
        thumb_1024_url?: string;
        geometry?: { coordinates?: [number, number] };
        captured_at?: string;
        creator?: { username?: string };
      }[];
    };
    const images = data.data ?? [];
    return images
      .filter((img) => !!img.thumb_1024_url)
      .map((img): LocationPhoto => {
        const coords = img.geometry?.coordinates;
        const dLat = coords ? (coords[1] - lat) * 111000 : 0;
        const dLng = coords ? (coords[0] - lng) * 111000 * Math.cos((lat * Math.PI) / 180) : 0;
        const distM = Math.round(Math.sqrt(dLat ** 2 + dLng ** 2));
        return {
          url: img.thumb_1024_url!,
          thumbUrl: img.thumb_1024_url!,
          title: "Street-level photo",
          source: "mapillary",
          sourceUrl: `https://www.mapillary.com/app/?image_key=${img.id}`,
          attribution: img.creator?.username ?? undefined,
          distanceM: distM,
        };
      })
      .sort((a, b) => (a.distanceM ?? 999) - (b.distanceM ?? 999));
  } catch {
    return [];
  }
}

// ── GET /location-photos?lat=&lng=[&stationId=][&address=] ─────────────────────
router.get("/location-photos", async (req, res) => {
  const lat = parseFloat(String(req.query.lat ?? ""));
  const lng = parseFloat(String(req.query.lng ?? ""));
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  // Optional street address — improves Street View accuracy when the charger
  // sits inside a parking lot or building (GPS coords alone can miss the street).
  const address = String(req.query.address ?? "").trim() || undefined;

  // Optional numeric stationId for community stations — fetches DB photos first
  const rawStationId = String(req.query.stationId ?? "");
  const numericStationId = rawStationId && !isNaN(Number(rawStationId)) ? Number(rawStationId) : null;

  const key = numericStationId
    ? `${numericStationId}:${lat.toFixed(3)},${lng.toFixed(3)}`
    : `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.json(cached.data);
    return;
  }

  // Build base URL for resolving relative DB photo paths ("/station-photos/...")
  const proto = req.protocol || "https";
  const host = req.get("host") || "";
  const baseUrl = host ? `${proto}://${host}` : "";

  const [streetViewPhotos, wikiPhotos, ocmPhotos, dbPhotos, googlePhotos, mapillaryPhotos] = await Promise.all([
    fetchStreetViewPhoto(lat, lng, address),
    fetchWikimediaPhotos(lat, lng),
    fetchOcmPhotos(lat, lng),
    numericStationId
      ? db.select().from(stationPhotosTable).where(eq(stationPhotosTable.stationId, numericStationId))
          .then((rows) => rows.map((p): LocationPhoto => {
            const absUrl = p.photoUrl.startsWith("/") ? `${baseUrl}${p.photoUrl}` : p.photoUrl;
            return {
              url: absUrl,
              thumbUrl: absUrl,
              title: p.caption ?? "Station photo",
              source: "community",
              distanceM: 0,
            };
          }))
          .catch(() => [] as LocationPhoto[])
      : Promise.resolve([] as LocationPhoto[]),
    fetchGooglePlacesPhotos(lat, lng),
    fetchMapillaryPhotos(lat, lng),
  ]);

  // Priority order:
  //   1. Street View — exact street-level view of the address (most location-specific)
  //   2. Community — user-submitted photos of the actual charger
  //   3. OCM — charger-specific community photos from OpenChargeMap
  //   4. Mapillary — geotagged street-level imagery within ~110 m
  //   5. Google Places — nearby-place user photos (within 30 m)
  //   6. Wikimedia — tight 150 m radius only (no wide neighbourhood fallbacks)
  const sortedWiki = wikiPhotos.slice().sort((a, b) => (a.distanceM ?? 999) - (b.distanceM ?? 999));
  const photos = [
    ...streetViewPhotos,
    ...dbPhotos,
    ...ocmPhotos,
    ...mapillaryPhotos,
    ...googlePhotos,
    ...sortedWiki,
  ].slice(0, 12);

  cache.set(key, { data: photos, at: Date.now() });
  res.json(photos);
});

export default router;
