import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { ocpiPartiesTable } from "@workspace/db";
import { stationsTable } from "@workspace/db";
import type { Station } from "@workspace/db";
import { eq } from "drizzle-orm";
import type {
  OcpiResponse, Location, EVSE, Connector, ConnectorStatus, ConnectorType,
  ConnectorFormat, PowerType, Capability,
} from "./ocpiTypes";

export const OCPI_COUNTRY_CODE = "US";
export const OCPI_PARTY_ID = "CBR";
export const OCPI_VERSION = "2.2.1";

export function getOcpiBaseUrl(req?: Request): string {
  if (process.env.REPLIT_DOMAINS) {
    const domain = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    return `https://${domain}`;
  }
  if (req) {
    return `${req.protocol}://${req.get("host")}`;
  }
  return "http://localhost:80";
}

export function ocpiResponse<T>(
  data: T,
  status_code = 1000,
  status_message = "Success",
): OcpiResponse<T> {
  return { data, status_code, status_message, timestamp: new Date().toISOString() };
}

export function ocpiError(
  res: Response,
  httpStatus: number,
  status_code: number,
  message: string,
): void {
  res.status(httpStatus).json(ocpiResponse(null, status_code, message));
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const match = auth.match(/^Token\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function requireOcpiAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    ocpiError(res, 401, 2010, "Missing Authorization Token");
    return;
  }
  const [party] = await db
    .select()
    .from(ocpiPartiesTable)
    .where(eq(ocpiPartiesTable.inboundToken, token))
    .limit(1);
  if (!party) {
    ocpiError(res, 401, 2010, "Invalid or unknown Authorization Token");
    return;
  }
  res.locals.ocpiParty = party;
  next();
}

function stationStatusToOcpi(status: string): ConnectorStatus {
  switch (status) {
    case "available": return "AVAILABLE";
    case "busy":      return "CHARGING";
    case "offline":   return "INOPERATIVE";
    case "pending":   return "PLANNED";
    default:          return "UNKNOWN";
  }
}

interface ConnectorSpec {
  standard: ConnectorType;
  format: ConnectorFormat;
  power_type: PowerType;
  max_voltage: number;
  max_amperage: number;
}

function connectorSpecsForType(chargerType: string, powerKw: number): ConnectorSpec[] {
  switch (chargerType) {
    case "Level1":
      return [{
        standard: "IEC_62196_T1",
        format: "SOCKET",
        power_type: "AC_1_PHASE",
        max_voltage: 120,
        max_amperage: Math.max(8, Math.round((powerKw * 1000) / 120)),
      }];
    case "Level2":
      return [{
        standard: "IEC_62196_T1",
        format: "SOCKET",
        power_type: "AC_3_PHASE",
        max_voltage: 240,
        max_amperage: Math.max(16, Math.round((powerKw * 1000) / 240)),
      }];
    case "DCFC":
    default:
      return [
        {
          standard: "IEC_62196_T1_COMBO",
          format: "CABLE",
          power_type: "DC",
          max_voltage: 800,
          max_amperage: Math.max(50, Math.round((powerKw * 1000) / 400)),
        },
        {
          standard: "CHADEMO",
          format: "CABLE",
          power_type: "DC",
          max_voltage: 500,
          max_amperage: Math.max(50, Math.round(Math.min(powerKw * 1000, 62500) / 400)),
        },
      ];
  }
}

export function stationToLocation(station: Station): Location {
  const specs = connectorSpecsForType(station.chargerType, station.powerKw);
  const lastUpdated = station.createdAt.toISOString();
  const chargingCount = Math.max(0, station.totalPorts - station.availablePorts);
  const capabilities: Capability[] = station.ocppChargePointId
    ? ["REMOTE_START_STOP_CAPABLE", "RFID_READER"]
    : [];

  const evses: EVSE[] = Array.from({ length: Math.min(station.totalPorts, 20) }, (_, i) => {
    const portIndex = i + 1;
    let evseStatus: ConnectorStatus;
    if (station.status === "offline") {
      evseStatus = "INOPERATIVE";
    } else if (station.status === "pending") {
      evseStatus = "PLANNED";
    } else if (station.status === "busy") {
      evseStatus = portIndex <= chargingCount ? "CHARGING" : "AVAILABLE";
    } else {
      evseStatus = "AVAILABLE";
    }

    const connectors: Connector[] = specs.map((spec, ci) => ({
      id: String(ci + 1),
      standard: spec.standard,
      format: spec.format,
      power_type: spec.power_type,
      max_voltage: spec.max_voltage,
      max_amperage: spec.max_amperage,
      max_electric_power: Math.round(station.powerKw * 1000),
      tariff_ids: [`${OCPI_COUNTRY_CODE}*${OCPI_PARTY_ID}*T${station.id}`],
      last_updated: lastUpdated,
    }));

    return {
      uid: `${station.id}-${portIndex}`,
      evse_id: `${OCPI_COUNTRY_CODE}*${OCPI_PARTY_ID}*E${station.id}${portIndex > 1 ? portIndex : ""}`,
      status: evseStatus,
      capabilities,
      connectors,
      coordinates: {
        latitude: station.lat.toFixed(6),
        longitude: station.lng.toFixed(6),
      },
      last_updated: lastUpdated,
    };
  });

  const countryIso3 = station.country.toLowerCase().includes("united states") ? "USA" : "USA";

  return {
    country_code: OCPI_COUNTRY_CODE,
    party_id: OCPI_PARTY_ID,
    id: String(station.id),
    publish: station.status !== "pending",
    name: station.name,
    address: station.address,
    city: station.city,
    state: station.state || undefined,
    country: countryIso3,
    coordinates: {
      latitude: station.lat.toFixed(6),
      longitude: station.lng.toFixed(6),
    },
    evses,
    operator: {
      name: station.network ?? "ChargeBridge Community",
    },
    time_zone: "America/Chicago",
    opening_times: { twentyfourseven: true },
    charging_when_closed: false,
    last_updated: lastUpdated,
  };
}

export function applyOcpiPagination<T>(
  items: T[],
  req: Request,
  res: Response,
): T[] {
  const limit = Math.min(parseInt(String(req.headers["x-limit"] ?? req.query.limit ?? "100"), 10) || 100, 1000);
  const offset = parseInt(String(req.headers["x-offset"] ?? req.query.offset ?? "0"), 10) || 0;
  const slice = items.slice(offset, offset + limit);
  res.setHeader("X-Total-Count", items.length);
  res.setHeader("X-Limit", limit);
  res.setHeader("X-Offset", offset);
  if (offset + limit < items.length) {
    const next = offset + limit;
    const base = `${req.protocol}://${req.get("host")}${req.path}`;
    res.setHeader("Link", `<${base}?offset=${next}&limit=${limit}>; rel="next"`);
  }
  return slice;
}

export async function getStationByLocationId(locationId: string): Promise<Station | null> {
  const id = parseInt(locationId, 10);
  if (isNaN(id)) return null;
  const [station] = await db.select().from(stationsTable).where(eq(stationsTable.id, id)).limit(1);
  return station ?? null;
}
