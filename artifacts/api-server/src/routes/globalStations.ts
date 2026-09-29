import { Router } from "express";

const router = Router();

const OCM_URL = "https://api.openchargemap.io/v3/poi/";

function mapStatus(poi: any): "available" | "busy" | "offline" {
  const s = poi.StatusType;
  if (!s) return "available";
  if (s.IsOperational === false) return "offline";
  if (s.IsOperational === true) return "available";
  return "available";
}

function mapChargerType(connections: any[]): "Level1" | "Level2" | "DCFC" {
  if (!connections || connections.length === 0) return "Level2";
  const maxKw = Math.max(...connections.map((c: any) => c.PowerKW ?? 0));
  if (maxKw >= 50) return "DCFC";
  if (maxKw >= 7) return "Level2";
  return "Level1";
}

function mapPowerKw(connections: any[]): number {
  if (!connections || connections.length === 0) return 7.2;
  return Math.max(...connections.map((c: any) => c.PowerKW ?? 0)) || 7.2;
}

router.get("/global-stations", async (req, res) => {
  const { lat, lng, search, maxresults = "20", countrycode } = req.query as Record<string, string>;

  const params = new URLSearchParams({
    output: "json",
    maxresults: String(Math.min(Number(maxresults) || 20, 100)),
    compact: "true",
    verbose: "false",
  });

  if (lat && lng) {
    params.set("latitude", lat);
    params.set("longitude", lng);
    params.set("distance", "50");
    params.set("distanceunit", "Miles");
  }
  if (search) params.set("locationtitle", search);
  if (countrycode) params.set("countrycode", countrycode);
  if (!lat && !lng && !search && !countrycode) {
    params.set("countrycode", "US");
  }

  try {
    const response = await fetch(`${OCM_URL}?${params.toString()}`, {
      headers: { "User-Agent": "ChargeBridge/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Failed to fetch from Open Charge Map" });
    }

    const pois = (await response.json()) as any[];

    const stations = pois
      .filter((p: any) => p.AddressInfo?.Latitude && p.AddressInfo?.Longitude)
      .map((p: any) => {
        const addr = p.AddressInfo;
        const connections: any[] = p.Connections ?? [];
        return {
          id: `ocm-${p.ID}`,
          source: "ocm",
          name: addr.Title || "EV Charging Station",
          address: addr.AddressLine1 || addr.AddressLine2 || "",
          city: addr.Town || addr.StateOrProvince || "",
          state: addr.StateOrProvince || addr.Country?.ISOCode || "",
          country: addr.Country?.Title || "",
          lat: addr.Latitude,
          lng: addr.Longitude,
          chargerType: mapChargerType(connections),
          powerKw: mapPowerKw(connections),
          pricePerKwh: 0,
          totalPorts: p.NumberOfPoints ?? connections.length ?? 1,
          availablePorts: p.NumberOfPoints ?? connections.length ?? 1,
          status: mapStatus(p),
          network: p.OperatorInfo?.Title ?? null,
          connectorTypes: connections.map((c: any) => c.ConnectionType?.Title).filter(Boolean),
          ocmUrl: `https://openchargemap.org/site/poi/details/${p.ID}`,
        };
      });

    return res.json(stations);
  } catch (err: any) {
    return res.status(502).json({ error: "Failed to reach Open Charge Map: " + err.message });
  }
});

export default router;
