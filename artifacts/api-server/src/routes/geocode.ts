import { Router } from "express";

const router = Router();

const cache = new Map<string, { data: unknown[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// ── ArcGIS World Geocoding (free, no key, best US address coverage) ──────────
// Used as first fallback when Nominatim returns 0 results (e.g. new subdivisions).
// Returns results normalised to Nominatim shape so the client needs no changes.
async function arcgisGeocode(q: string): Promise<unknown[]> {
  const url =
    `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` +
    `?SingleLine=${encodeURIComponent(q)}&outFields=Match_addr,Addr_type,City,Region,Postal,Country,CountryName` +
    `&maxLocations=6&countryCode=USA&f=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];

    type ArcCandidate = {
      address: string;
      score: number;
      location: { x: number; y: number };
      attributes: Record<string, string>;
    };
    const data = (await resp.json()) as { candidates?: ArcCandidate[] };
    const candidates = (data.candidates ?? []).filter((c) => c.score >= 80);

    return candidates.map((c, i) => {
      const attrs = c.attributes ?? {};
      const city = attrs.City ?? "";
      const state = attrs.Region ?? "";
      const zip = attrs.Postal ?? "";
      // ArcGIS returns ISO 3166-1 alpha-3 country codes (e.g. "USA", "GBR", "FRA").
      // Derive a 2-letter country_code by lowercasing; common 3-letter codes map
      // cleanly to their 2-letter prefix for the most-searched countries.
      const arcCountry = (attrs.Country ?? "").toUpperCase();
      const alpha3To2: Record<string, string> = {
        USA: "us", GBR: "gb", CAN: "ca", AUS: "au", DEU: "de", FRA: "fr",
        ITA: "it", ESP: "es", PRT: "pt", NLD: "nl", BEL: "be", CHE: "ch",
        AUT: "at", SWE: "se", NOR: "no", DNK: "dk", FIN: "fi", POL: "pl",
        CZE: "cz", HUN: "hu", ROU: "ro", GRC: "gr", TUR: "tr", ISR: "il",
        JPN: "jp", CHN: "cn", KOR: "kr", IND: "in", BRA: "br", MEX: "mx",
        ARG: "ar", CHL: "cl", ZAF: "za", NGA: "ng", EGY: "eg", SAU: "sa",
        ARE: "ae", SGP: "sg", HKG: "hk", NZL: "nz", IDN: "id", MYS: "my",
        THA: "th", VNM: "vn", PHL: "ph", PAK: "pk", BGD: "bd", IRN: "ir",
        RUS: "ru", UKR: "ua", SRB: "rs", HRV: "hr", SVK: "sk", SVN: "si",
        BGR: "bg", LTU: "lt", LVA: "lv", EST: "ee", IRL: "ie", ISL: "is",
        LUX: "lu", MCO: "mc", MLT: "mt", CYP: "cy", MKD: "mk", ALB: "al",
        BIH: "ba", MNE: "me", GEO: "ge", ARM: "am", AZE: "az", KAZ: "kz",
        UZB: "uz", TKM: "tm", KGZ: "kg", TJK: "tj", MNG: "mn", TWN: "tw",
        MMR: "mm", KHM: "kh", LAO: "la", NPL: "np", LKA: "lk",
        MAR: "ma", TUN: "tn", DZA: "dz", LBY: "ly", GHA: "gh", ETH: "et",
        TZA: "tz", KEN: "ke", UGA: "ug", ZWE: "zw", ZMB: "zm", MOZ: "mz",
        MDG: "mg", CMR: "cm", CIV: "ci", SEN: "sn", MLI: "ml", BFA: "bf",
        NER: "ne", TCD: "td", SDN: "sd", SSD: "ss", SOM: "so", DJI: "dj",
        ERI: "er", RWA: "rw", BDI: "bi", COG: "cg", COD: "cd", GAB: "ga",
        GNQ: "gq", CAF: "cf", AGO: "ao", NAM: "na", BWA: "bw", LSO: "ls",
        SWZ: "sz", MUS: "mu", SYC: "sc", CPV: "cv", STP: "st", COM: "km",
        MRT: "mr", GMB: "gm", GNB: "gw", SLE: "sl", LBR: "lr", GIN: "gn",
        COL: "co", VEN: "ve", PER: "pe", ECU: "ec", BOL: "bo", PRY: "py",
        URY: "uy", GUY: "gy", SUR: "sr", TTO: "tt", JAM: "jm", CUB: "cu",
        DOM: "do", HTI: "ht", GTM: "gt", BLZ: "bz", HND: "hn", SLV: "sv",
        NIC: "ni", CRI: "cr", PAN: "pa", JOR: "jo", IRQ: "iq", SYR: "sy",
        LBN: "lb", KWT: "kw", BHR: "bh", QAT: "qa", OMN: "om", YEM: "ye",
        AFG: "af", PSE: "ps", MDV: "mv", BTN: "bt", TLS: "tl", PNG: "pg",
        FJI: "fj", VUT: "vu", SLB: "sb", WSM: "ws", TON: "to", KIR: "ki",
      };
      const countryCode = (arcCountry && alpha3To2[arcCountry]) ? alpha3To2[arcCountry] : (arcCountry.slice(0, 2).toLowerCase() || "");
      const countryName = attrs.CountryName ?? arcCountry;
      const parts = c.address.split(",").map((s) => s.trim());
      return {
        place_id: `arcgis-${i}-${c.location.x.toFixed(5)}-${c.location.y.toFixed(5)}`,
        display_name: c.address,
        lat: String(c.location.y),
        lon: String(c.location.x),
        address: {
          road: parts[0] ?? "",
          city,
          state,
          postcode: zip,
          country: countryName || countryCode.toUpperCase(),
          country_code: countryCode,
        },
        _source: "arcgis",
      };
    });
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// ── Google Geocoding API (deepest address database, incl. brand-new streets) ─
// Used as final fallback when both Nominatim and ArcGIS return 0 results.
async function googleGeocode(q: string): Promise<unknown[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(q)}&components=country:US&key=${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];

    type GoogleAddressComponent = {
      long_name: string;
      short_name: string;
      types: string[];
    };
    type GoogleGeocodeResult = {
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
      address_components: GoogleAddressComponent[];
      place_id: string;
    };
    const data = (await resp.json()) as {
      status: string;
      results: GoogleGeocodeResult[];
    };
    if (data.status !== "OK" || !data.results?.length) return [];

    return data.results.slice(0, 5).map((r) => {
      const get = (type: string) =>
        r.address_components.find((c) => c.types.includes(type))?.long_name ?? "";
      const streetNum = get("street_number");
      const route = get("route");
      // Google address_components have a "country" component whose short_name
      // is the ISO 3166-1 alpha-2 code (e.g. "GB", "JP", "FR") — use it directly.
      const countryShort = r.address_components.find((c) => c.types.includes("country"))?.short_name ?? "";
      return {
        place_id: `google-${r.place_id}`,
        display_name: r.formatted_address,
        lat: String(r.geometry.location.lat),
        lon: String(r.geometry.location.lng),
        address: {
          road: [streetNum, route].filter(Boolean).join(" "),
          city:
            get("locality") ||
            get("sublocality") ||
            get("administrative_area_level_2"),
          state: get("administrative_area_level_1"),
          postcode: get("postal_code"),
          country: get("country"),
          country_code: countryShort.toLowerCase(),
        },
        _source: "google",
      };
    });
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// ── Country name → ISO 3166-1 alpha-2 detection ──────────────────────────────
// When the user's query explicitly names a country (e.g. "Paris, France",
// "Berlin Germany", "Sydney, Australia") we pass &countrycodes=XX to Nominatim
// so it only returns results from that country, and we skip the GPS-anchored
// viewbox (which would otherwise bias towards the user's physical location).
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // North America
  "united states": "us", "usa": "us", "u.s.a": "us", "u.s": "us", "america": "us",
  "canada": "ca", "mexico": "mx",
  // Europe
  "united kingdom": "gb", "uk": "gb", "u.k": "gb", "great britain": "gb",
  "england": "gb", "scotland": "gb", "wales": "gb", "northern ireland": "gb",
  "france": "fr", "germany": "de", "deutschland": "de",
  "spain": "es", "espana": "es", "españa": "es",
  "italy": "it", "italia": "it",
  "portugal": "pt", "netherlands": "nl", "holland": "nl",
  "belgium": "be", "switzerland": "ch", "austria": "at",
  "sweden": "se", "norway": "no", "denmark": "dk", "finland": "fi",
  "poland": "pl", "czech republic": "cz", "czechia": "cz",
  "hungary": "hu", "romania": "ro", "bulgaria": "bg",
  "greece": "gr", "turkey": "tr", "turkiye": "tr",
  "ireland": "ie", "luxembourg": "lu", "iceland": "is",
  "serbia": "rs", "croatia": "hr", "slovenia": "si", "slovakia": "sk",
  "ukraine": "ua", "russia": "ru", "belarus": "by",
  "estonia": "ee", "latvia": "lv", "lithuania": "lt",
  "albania": "al", "north macedonia": "mk", "montenegro": "me",
  "bosnia": "ba", "moldova": "md",
  // Middle East
  "israel": "il", "jordan": "jo", "lebanon": "lb", "syria": "sy",
  "iraq": "iq", "iran": "ir", "saudi arabia": "sa", "uae": "ae",
  "united arab emirates": "ae", "qatar": "qa", "kuwait": "kw",
  "bahrain": "bh", "oman": "om", "yemen": "ye",
  // Asia
  "china": "cn", "japan": "jp", "south korea": "kr", "korea": "kr",
  "india": "in", "pakistan": "pk", "bangladesh": "bd",
  "singapore": "sg", "malaysia": "my", "indonesia": "id",
  "thailand": "th", "vietnam": "vn", "philippines": "ph",
  "hong kong": "hk", "taiwan": "tw", "mongolia": "mn",
  "myanmar": "mm", "cambodia": "kh", "laos": "la",
  "nepal": "np", "sri lanka": "lk", "afghanistan": "af",
  "kazakhstan": "kz", "uzbekistan": "uz",
  // Oceania
  "australia": "au", "new zealand": "nz",
  // Africa
  "south africa": "za", "egypt": "eg", "nigeria": "ng",
  "kenya": "ke", "ethiopia": "et", "ghana": "gh",
  "tanzania": "tz", "morocco": "ma", "tunisia": "tn",
  "algeria": "dz", "senegal": "sn", "cameroon": "cm",
  // South America
  "brazil": "br", "argentina": "ar", "chile": "cl",
  "colombia": "co", "peru": "pe", "venezuela": "ve",
  "ecuador": "ec", "bolivia": "bo", "paraguay": "py",
  "uruguay": "uy",
};

function detectCountryCode(q: string): string | null {
  const lower = q.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  // Sort by descending length so "united kingdom" is checked before "kingdom"
  const names = Object.keys(COUNTRY_NAME_TO_CODE).sort((a, b) => b.length - a.length);
  for (const name of names) {
    // Match as a whole word/phrase (not mid-word)
    const re = new RegExp(`(?:^|[\\s,])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[\\s,]|$)`, "i");
    if (re.test(lower)) return COUNTRY_NAME_TO_CODE[name];
  }
  return null;
}

router.get("/geocode", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) {
    res.json([]);
    return;
  }

  const rawLat = typeof req.query.lat === "string" ? parseFloat(req.query.lat) : NaN;
  const rawLng = typeof req.query.lng === "string" ? parseFloat(req.query.lng) : NaN;
  const hasLocation = !isNaN(rawLat) && !isNaN(rawLng);

  // Detect an explicit country in the query (e.g. "Paris, France" → "fr").
  // When found: restrict Nominatim to that country and drop the GPS viewbox so
  // the user's physical location in the US cannot bias results toward US places.
  const detectedCountry = detectCountryCode(q);
  const countryParam = `&countrycodes=${detectedCountry ?? "us"}`;

  const key = hasLocation && !detectedCountry
    ? `${q.toLowerCase()}|${rawLat.toFixed(2)},${rawLng.toFixed(2)}`
    : q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    res.json(hit.data);
    return;
  }

  // Only apply the GPS viewbox when the query has no explicit country.
  // If the user typed "Paris, France" but is physically in Idaho, the viewbox
  // would otherwise nudge Nominatim toward US results even with bounded=0.
  const viewboxParam = (hasLocation && !detectedCountry)
    ? `&viewbox=${rawLng - 0.5},${rawLat + 0.5},${rawLng + 0.5},${rawLat - 0.5}&bounded=0`
    : "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1&dedupe=1${viewboxParam}${countryParam}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)",
        "Accept-Language": "en",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      res.status(502).json([]);
      return;
    }
    const nominatimData = (await resp.json()) as unknown[];

    // Priority: Nominatim → ArcGIS → Google.
    // For ArcGIS results: when we detected a country in the query, filter out
    // any candidates whose country_code doesn't match to prevent US bias.
    let data: unknown[];
    if (nominatimData.length > 0) {
      data = nominatimData;
    } else {
      let arcData = await arcgisGeocode(q);
      if (detectedCountry && arcData.length > 0) {
        type WithAddress = { address?: { country_code?: string } };
        const filtered = arcData.filter((r) => {
          const cc = (r as WithAddress).address?.country_code ?? "";
          return !cc || cc.toLowerCase() === detectedCountry;
        });
        if (filtered.length > 0) arcData = filtered;
      }
      data = arcData.length > 0 ? arcData : await googleGeocode(q);
    }

    cache.set(key, { data, ts: Date.now() });
    res.json(data);
  } catch {
    clearTimeout(timer);
    // Nominatim timed out — try ArcGIS then Google
    try {
      let arcData = await arcgisGeocode(q);
      if (detectedCountry && arcData.length > 0) {
        type WithAddress = { address?: { country_code?: string } };
        const filtered = arcData.filter((r) => {
          const cc = (r as WithAddress).address?.country_code ?? "";
          return !cc || cc.toLowerCase() === detectedCountry;
        });
        if (filtered.length > 0) arcData = filtered;
      }
      const data = arcData.length > 0 ? arcData : await googleGeocode(q);
      if (data.length > 0) {
        cache.set(key, { data, ts: Date.now() });
        res.json(data);
      } else {
        res.status(502).json([]);
      }
    } catch {
      res.status(502).json([]);
    }
  }
});

// ── Reverse geocode ───────────────────────────────────────────────────────────
router.get("/geocode/reverse", async (req, res) => {
  const lat = typeof req.query.lat === "string" ? parseFloat(req.query.lat) : NaN;
  const lng = typeof req.query.lng === "string" ? parseFloat(req.query.lng) : NaN;
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng required" });
    return;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ChargeBridge/1.0 (contact@chargebridgeapp.com)",
        "Accept-Language": "en",
      },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) { res.status(502).json({ error: "Reverse geocode failed" }); return; }
    type NominatimReverse = { display_name?: string; address?: Record<string, string> };
    const data = await resp.json() as NominatimReverse;
    const addr = data.address ?? {};
    const short = [
      addr.house_number && addr.road ? `${addr.house_number} ${addr.road}` : addr.road,
      addr.city ?? addr.town ?? addr.village ?? addr.suburb,
      addr.state,
    ].filter(Boolean).join(", ");
    res.json({
      display_name: short || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      lat: String(lat),
      lon: String(lng),
      place_id: `rev_${lat.toFixed(4)}_${lng.toFixed(4)}`,
    });
  } catch {
    clearTimeout(t);
    res.status(502).json({ error: "Reverse geocode timeout" });
  }
});

export default router;
