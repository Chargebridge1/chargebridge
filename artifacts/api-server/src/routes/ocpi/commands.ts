import { Router } from "express";
import { db } from "@workspace/db";
import { stationsTable, chargingSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  remoteStartTransaction,
  remoteStopTransaction,
  getChargerForStation,
} from "../../lib/ocppCsms";
import {
  ocpiResponse, ocpiError, requireOcpiAuth, getStationByLocationId,
} from "../../lib/ocpiHelpers";
import type {
  CommandResponse, StartSession, StopSession,
  ReserveNow, CancelReservation, UnlockConnector,
} from "../../lib/ocpiTypes";

const router = Router();

async function sendAsyncResult(url: string, result: CommandResponse): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  } catch {
  }
}

router.post("/commands/START_SESSION", requireOcpiAuth, async (req, res) => {
  const body = req.body as Partial<StartSession>;
  if (!body.response_url || !body.token || !body.location_id) {
    ocpiError(res, 400, 2001, "response_url, token, location_id are required"); return;
  }

  const station = await getStationByLocationId(body.location_id);
  if (!station) {
    const reply: CommandResponse = { result: "UNKNOWN_RESERVATION", timeout: 30 };
    res.json(ocpiResponse(reply));
    return;
  }

  if (station.status === "offline") {
    const reply: CommandResponse = { result: "EVSE_INOPERATIVE", timeout: 30 };
    res.json(ocpiResponse(reply));
    return;
  }

  if (station.availablePorts === 0) {
    const reply: CommandResponse = { result: "EVSE_OCCUPIED", timeout: 30 };
    res.json(ocpiResponse(reply));
    return;
  }

  res.json(ocpiResponse({ result: "ACCEPTED", timeout: 30 } satisfies CommandResponse));

  setImmediate(async () => {
    const { accepted: startAccepted } = await remoteStartTransaction(station.id);
    const async_result: CommandResponse = {
      result: startAccepted ? "ACCEPTED" : "FAILED",
      timeout: 30,
      message: startAccepted ? undefined : [{ language: "en", text: "Charger did not respond" }],
    };
    await sendAsyncResult(body.response_url!, async_result);
  });
});

router.post("/commands/STOP_SESSION", requireOcpiAuth, async (req, res) => {
  const body = req.body as Partial<StopSession>;
  if (!body.response_url || !body.session_id) {
    ocpiError(res, 400, 2001, "response_url and session_id are required"); return;
  }

  const sessionId = parseInt(body.session_id, 10);
  if (isNaN(sessionId)) {
    const reply: CommandResponse = { result: "UNKNOWN_RESERVATION", timeout: 30 };
    res.json(ocpiResponse(reply));
    return;
  }

  const [session] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, sessionId)).limit(1);

  if (!session) {
    const reply: CommandResponse = { result: "UNKNOWN_RESERVATION", timeout: 30 };
    res.json(ocpiResponse(reply));
    return;
  }

  res.json(ocpiResponse({ result: "ACCEPTED", timeout: 30 } satisfies CommandResponse));

  setImmediate(async () => {
    let stopAccepted = false;
    if (session.stationId != null) {
      ({ accepted: stopAccepted } = await remoteStopTransaction(session.stationId, session.id));
    }
    const async_result: CommandResponse = {
      result: stopAccepted ? "ACCEPTED" : "FAILED",
      timeout: 30,
    };
    await sendAsyncResult(body.response_url!, async_result);
  });
});

router.post("/commands/RESERVE_NOW", requireOcpiAuth, async (req, res) => {
  const body = req.body as Partial<ReserveNow>;
  if (!body.response_url || !body.location_id) {
    ocpiError(res, 400, 2001, "response_url and location_id are required"); return;
  }
  const reply: CommandResponse = {
    result: "NOT_SUPPORTED",
    timeout: 30,
    message: [{ language: "en", text: "Reservations are not supported on this network" }],
  };
  res.json(ocpiResponse(reply));
});

router.post("/commands/CANCEL_RESERVATION", requireOcpiAuth, async (req, res) => {
  const body = req.body as Partial<CancelReservation>;
  if (!body.response_url) {
    ocpiError(res, 400, 2001, "response_url is required"); return;
  }
  const reply: CommandResponse = { result: "NOT_SUPPORTED", timeout: 30 };
  res.json(ocpiResponse(reply));
});

router.post("/commands/UNLOCK_CONNECTOR", requireOcpiAuth, async (req, res) => {
  const body = req.body as Partial<UnlockConnector>;
  if (!body.response_url || !body.location_id || !body.evse_uid) {
    ocpiError(res, 400, 2001, "response_url, location_id, evse_uid are required"); return;
  }

  const station = await getStationByLocationId(body.location_id);
  if (!station) {
    const reply: CommandResponse = { result: "UNKNOWN_RESERVATION", timeout: 30 };
    res.json(ocpiResponse(reply));
    return;
  }

  const charger = getChargerForStation(station.id);
  if (!charger) {
    const reply: CommandResponse = {
      result: "NOT_SUPPORTED", timeout: 30,
      message: [{ language: "en", text: "Charger is not connected via OCPP" }],
    };
    res.json(ocpiResponse(reply));
    return;
  }

  const reply: CommandResponse = { result: "ACCEPTED", timeout: 30 };
  res.json(ocpiResponse(reply));
});

export default router;
