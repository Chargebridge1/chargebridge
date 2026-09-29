import { Router } from "express";
import { db } from "@workspace/db";
import { chargingSessionsTable, stationsTable } from "@workspace/db";
import { eq, gte, and, lte } from "drizzle-orm";
import {
  ocpiResponse, requireOcpiAuth, applyOcpiPagination,
  OCPI_COUNTRY_CODE, OCPI_PARTY_ID,
} from "../../lib/ocpiHelpers";
import type { Session, CdrToken, SessionStatus } from "../../lib/ocpiTypes";

const router = Router();

router.get("/sessions", requireOcpiAuth, async (req, res) => {
  const conditions = [];
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;
  if (dateFrom) conditions.push(gte(chargingSessionsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(chargingSessionsTable.createdAt, new Date(dateTo)));

  const rows = await db
    .select({
      session: chargingSessionsTable,
      station: stationsTable,
    })
    .from(chargingSessionsTable)
    .leftJoin(stationsTable, eq(chargingSessionsTable.stationId, stationsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(chargingSessionsTable.createdAt);

  const sessions: Session[] = rows.map(({ session, station }) => {
    const token: CdrToken = {
      country_code: OCPI_COUNTRY_CODE,
      party_id: OCPI_PARTY_ID,
      uid: session.driverEmail,
      type: "APP_USER",
      contract_id: session.driverEmail,
    };

    const statusMap: Record<string, SessionStatus> = {
      pending: "ACTIVE",
      completed: "COMPLETED",
      failed: "INVALID",
      refunded: "INVALID",
    };

    return {
      country_code: OCPI_COUNTRY_CODE,
      party_id: OCPI_PARTY_ID,
      id: String(session.id),
      start_date_time: session.createdAt.toISOString(),
      end_date_time: session.completedAt?.toISOString(),
      kwh: session.kwh,
      cdr_token: token,
      auth_method: "AUTH_REQUEST",
      location_id: String(session.stationId),
      evse_uid: `${session.stationId}-1`,
      connector_id: "1",
      currency: session.currency.toUpperCase(),
      total_cost: session.status === "completed"
        ? { excl_vat: session.amountCents / 100 }
        : undefined,
      status: statusMap[session.status] ?? "INVALID",
      last_updated: (session.completedAt ?? session.createdAt).toISOString(),
    };
  });

  const page = applyOcpiPagination(sessions, req, res);
  res.json(ocpiResponse(page));
});

router.get("/sessions/:sessionId", requireOcpiAuth, async (req, res) => {
  const id = parseInt(String(req.params.sessionId), 10);
  if (isNaN(id)) { res.status(404).json(ocpiResponse(null, 2003, "Not found")); return; }

  const [row] = await db
    .select({ session: chargingSessionsTable })
    .from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json(ocpiResponse(null, 2003, "Session not found")); return; }

  const s = row.session;
  const statusMap: Record<string, SessionStatus> = {
    pending: "ACTIVE", completed: "COMPLETED", failed: "INVALID", refunded: "INVALID",
  };

  res.json(ocpiResponse({
    country_code: OCPI_COUNTRY_CODE,
    party_id: OCPI_PARTY_ID,
    id: String(s.id),
    start_date_time: s.createdAt.toISOString(),
    end_date_time: s.completedAt?.toISOString(),
    kwh: s.kwh,
    cdr_token: {
      country_code: OCPI_COUNTRY_CODE,
      party_id: OCPI_PARTY_ID,
      uid: s.driverEmail,
      type: "APP_USER",
      contract_id: s.driverEmail,
    } satisfies CdrToken,
    auth_method: "AUTH_REQUEST",
    location_id: String(s.stationId),
    evse_uid: `${s.stationId}-1`,
    connector_id: "1",
    currency: s.currency.toUpperCase(),
    total_cost: s.status === "completed" ? { excl_vat: s.amountCents / 100 } : undefined,
    status: statusMap[s.status] ?? "INVALID",
    last_updated: (s.completedAt ?? s.createdAt).toISOString(),
  } satisfies Session));
});

export default router;
