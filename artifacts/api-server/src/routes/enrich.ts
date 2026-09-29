import { Router } from "express";

const router = Router();

// ── In-memory cache (6h TTL for external enrichment data) ─────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ocmCache = new Map<string, { data: OcmResult; at: number }>();
const yelpCache = new Map<string, { data: YelpResult; at: number }>();

interface OcmPhoto { url: string; title: string | null; dateCreated: string | null; }
interface OcmComment { id: number; userName: string; rating: number | null; comment: string; dateCreated: string; }
interface OcmResult { photos: OcmPhoto[]; comments: OcmComment[]; }
interface YelpReview { id: string; text: string; rating: number; time_created: string; url: string; user: { name: string; image_url: string | null }; }
interface YelpResult { name: string | null; url: string | null; rating: number | null; reviewCount: number | null; photos: string[]; reviews: YelpReview[]; }

// ── OCM enrichment ─────────────────────────────────────────────────────────────
async function fetchOcm(lat: number, lng: number): Promise<OcmResult> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = ocmCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const apiKey = process.env.OCM_API_KEY;
  if (!apiKey) return { photos: [], comments: [] };

  try {
    const url =
      `https://api.openchargemap.io/v3/poi/?output=json&latitude=${lat}&longitude=${lng}` +
      `&distance=0.1&distanceunit=KM&maxresults=1&includecomments=true&compact=false&verbose=true` +
      `&key=${apiKey}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ChargeBridge/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { photos: [], comments: [] };
    const data = await res.json();
    const poi = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!poi) return { photos: [], comments: [] };

    const photos: OcmPhoto[] = (poi.MediaItems ?? []).map((m: any) => ({
      url: m.ItemURL ?? m.ItemThumbnailURL ?? "",
      title: m.Comment ?? null,
      dateCreated: m.DateCreated ?? null,
    })).filter((p: OcmPhoto) => p.url);

    const comments: OcmComment[] = (poi.UserComments ?? []).map((c: any) => ({
      id: c.ID,
      userName: c.UserName ?? "Anonymous",
      rating: typeof c.Rating === "number" ? c.Rating : null,
      comment: c.Comment ?? "",
      dateCreated: c.DateCreated ?? new Date().toISOString(),
    }));

    const result: OcmResult = { photos, comments };
    ocmCache.set(key, { data: result, at: Date.now() });
    return result;
  } catch {
    return { photos: [], comments: [] };
  }
}

// ── Yelp enrichment ────────────────────────────────────────────────────────────
async function fetchYelp(name: string, lat: number, lng: number): Promise<YelpResult> {
  const key = `${name.slice(0, 30)},${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = yelpCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) return { name: null, url: null, rating: null, reviewCount: null, photos: [], reviews: [] };

  const empty: YelpResult = { name: null, url: null, rating: null, reviewCount: null, photos: [], reviews: [] };

  try {
    // Search for the business
    const searchUrl =
      `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(name)}` +
      `&latitude=${lat}&longitude=${lng}&radius=50&limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "ChargeBridge/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return empty;
    const searchData = await searchRes.json() as { businesses?: any[] };
    const biz = searchData.businesses?.[0];
    if (!biz) return empty;

    // Fetch reviews for matched business
    const revUrl = `https://api.yelp.com/v3/businesses/${biz.id}/reviews?limit=10&sort_by=newest`;
    const revRes = await fetch(revUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "ChargeBridge/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const revData = revRes.ok ? await revRes.json() as { reviews?: any[] } : { reviews: [] };

    const result: YelpResult = {
      name: biz.name,
      url: biz.url,
      rating: biz.rating ?? null,
      reviewCount: biz.review_count ?? null,
      photos: (biz.photos ?? []).slice(0, 6),
      reviews: (revData.reviews ?? []).map((r: any) => ({
        id: r.id,
        text: r.text,
        rating: r.rating,
        time_created: r.time_created,
        url: r.url,
        user: { name: r.user?.name ?? "Anonymous", image_url: r.user?.image_url ?? null },
      })),
    };
    yelpCache.set(key, { data: result, at: Date.now() });
    return result;
  } catch {
    return empty;
  }
}

// ── GET /api/stations/:id/enrich?name=...&lat=...&lng=... ──────────────────────
router.get("/stations/:id/enrich", async (req, res) => {
  const { name, lat, lng } = req.query as Record<string, string>;
  if (!lat || !lng || !name) {
    res.status(400).json({ error: "name, lat, lng required" });
    return;
  }
  const latN = parseFloat(lat);
  const lngN = parseFloat(lng);
  if (isNaN(latN) || isNaN(lngN)) {
    res.status(400).json({ error: "Invalid lat/lng" });
    return;
  }

  const [ocm, yelp] = await Promise.all([
    fetchOcm(latN, lngN),
    fetchYelp(name, latN, lngN),
  ]);

  res.json({
    ocm,
    yelp,
    hasOcm: process.env.OCM_API_KEY ? true : false,
    hasYelp: process.env.YELP_API_KEY ? true : false,
  });
});

export default router;
