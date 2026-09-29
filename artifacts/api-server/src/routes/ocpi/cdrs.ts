import { Router } from "express";
import { db } from "@workspace/db";
import { ocpiCdrsTable, chargingSessionsTable, stationsTable } from "@workspace/db";
import { eq, gte, lte, and } from "drizzle-orm";
import type { OcpiParty } from "@workspace/db";
import {
  ocpiResponse, ocpiError, requireOcpiAuth,
  applyOcpiPagination, stationToLocation,
  OCPI_COUNTRY_CODE, OCPI_PARTY_ID,
} from "../../lib/ocpiHelpers";
import type { CDR, CdrLocation } from "../../lib/ocpiTypes";

const router = Router();

async function sessionToCdr(sessionId: number): Promise<CDR | null> {
  const [row] = await db
    .select({ session: chargingSessionsTable, station: stationsTable })
    .from(chargingSessionsTable)
    .leftJoin(stationsTable, eq(chargingSessionsTable.stationId, stationsTable.id))
    .where(eq(chargingSessionsTable.id, sessionId))
    .limit(1);

  if (!row || !row.station) return null;
  const { session, station } = row;
  const location = stationToLocation(station);
  const evse = location.evses?.[0];
  const connector = evse?.connectors[0];
  if (!evse || !connector) return null;

  const cdrLocation: CdrLocation = {
    id: String(station.id),
    name: station.name,
    address: station.address,
    city: station.city,
    state: station.state || undefined,
    country: "USA",
    coordinates: location.coordinates,
    evse_uid: evse.uid,
    evse_id: evse.evse_id,
    connector_id: connector.id,
    connector_standard: connector.standard,
    connector_format: connector.format,
    connector_power_type: connector.power_type,
  };

  return {
    country_code: OCPI_COUNTRY_CODE,
    party_id: OCPI_PARTY_ID,
    id: `CBR-CDR-${session.id}`,
    start_date_time: session.createdAt.toISOString(),
    end_date_time: (session.completedAt ?? session.createdAt).toISOString(),
    session_id: String(session.id),
    cdr_token: {
      country_code: OCPI_COUNTRY_CODE,
      party_id: OCPI_PARTY_ID,
      uid: session.driverEmail,
      type: "APP_USER",
      contract_id: session.driverEmail,
    },
    auth_method: "AUTH_REQUEST",
    cdr_location: cdrLocation,
    currency: session.currency.toUpperCase(),
    charging_periods: [{
      start_date_time: session.createdAt.toISOString(),
      dimensions: [{ type: "ENERGY", volume: session.kwh }],
    }],
    total_cost: { excl_vat: session.amountCents / 100 },
    total_energy: session.kwh,
    total_time: session.completedAt
      ? (session.completedAt.getTime() - session.createdAt.getTime()) / 3_600_000
      : 0,
    last_updated: (session.completedAt ?? session.createdAt).toISOString(),
  };
}

router.get("/cdrs", requireOcpiAuth, async (req, res) => {
  const conditions = [];
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;
  if (dateFrom) conditions.push(gte(ocpiCdrsTable.startDateTime, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(ocpiCdrsTable.startDateTime, new Date(dateTo)));

  const stored = await db
    .select()
    .from(ocpiCdrsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(ocpiCdrsTable.startDateTime);

  const completedSessions = await db
    .select({ id: chargingSessionsTable.id })
    .from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.status, "completed"));

  const storedSessionIds = new Set(stored.map(r => r.sessionId));
  const builtCdrs: CDR[] = [];

  for (const { id } of completedSessions) {
    if (!storedSessionIds.has(id)) {
      const cdr = await sessionToCdr(id);
      if (cdr) builtCdrs.push(cdr);
    }
  }

  const fromStored: CDR[] = stored.map(r => (r.raw as unknown as CDR) ?? {
    country_code: r.countryCode,
    party_id: r.partyId,
    id: r.cdrId,
    start_date_time: r.startDateTime.toISOString(),
    end_date_time: r.endDateTime.toISOString(),
    cdr_token: r.cdrToken as CDR["cdr_token"],
    auth_method: r.authMethod as CDR["auth_method"],
    cdr_location: { id: r.locationId } as CDR["cdr_location"],
    currency: r.currency,
    charging_periods: r.chargingPeriods as CDR["charging_periods"],
    total_cost: r.totalCost as CDR["total_cost"],
    total_energy: r.totalEnergy,
    total_time: r.totalTime,
    last_updated: r.createdAt.toISOString(),
  } satisfies CDR);

  const all = [...fromStored, ...builtCdrs];
  const page = applyOcpiPagination(all, req, res);
  res.json(ocpiResponse(page));
});

router.get("/cdrs/:cdrId", requireOcpiAuth, async (req, res) => {
  const cdrId = String(req.params.cdrId);
  const [stored] = await db
    .select()
    .from(ocpiCdrsTable)
    .where(eq(ocpiCdrsTable.cdrId, cdrId))
    .limit(1);

  if (stored) {
    res.json(ocpiResponse(stored.raw ?? stored));
    return;
  }

  const match = cdrId.match(/^CBR-CDR-(\d+)$/);
  if (!match) { ocpiError(res, 404, 2003, "CDR not found"); return; }
  const cdr = await sessionToCdr(parseInt(match[1], 10));
  if (!cdr) { ocpiError(res, 404, 2003, "CDR not found"); return; }
  res.json(ocpiResponse(cdr));
});

router.post("/cdrs", requireOcpiAuth, async (req, res) => {
  const party = res.locals.ocpiParty as OcpiParty;
  const body = req.body as Partial<CDR>;
  if (!body.id || !body.start_date_time || !body.end_date_time || !body.cdr_token) {
    ocpiError(res, 400, 2001, "id, start_date_time, end_date_time, cdr_token are required");
    return;
  }

  const existing = await db
    .select({ id: ocpiCdrsTable.id })
    .from(ocpiCdrsTable)
    .where(eq(ocpiCdrsTable.cdrId, body.id))
    .limit(1);

  if (existing.length > 0) { ocpiError(res, 409, 2001, "CDR already exists"); return; }

  await db.insert(ocpiCdrsTable).values({
    cdrId: body.id,
    countryCode: party.countryCode,
    partyId: party.partyId,
    startDateTime: new Date(body.start_date_time),
    endDateTime: new Date(body.end_date_time),
    cdrToken: body.cdr_token,
    authMethod: body.auth_method ?? "AUTH_REQUEST",
    locationId: body.cdr_location?.id ?? "",
    evseUid: body.cdr_location?.evse_uid ?? "",
    connectorId: body.cdr_location?.connector_id ?? "",
    currency: body.currency ?? "USD",
    chargingPeriods: body.charging_periods ?? [],
    totalCost: body.total_cost ?? { excl_vat: 0 },
    totalEnergy: body.total_energy ?? 0,
    totalTime: body.total_time ?? 0,
    raw: body as Record<string, unknown>,
  });

  res.status(201).json(ocpiResponse(null, 1000, "CDR received"));
});

export default router;
