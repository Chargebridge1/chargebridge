import { Router } from "express";
import { db } from "@workspace/db";
import { stationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  addSseClient,
  getOcppLiveStatus,
  remoteStartTransaction,
  remoteStopTransaction,
} from "../lib/ocppCsms";
import { requireStationOwnerOrAdmin } from "../middlewares/requireAuth";

const router = Router();

// Public: live OCPP status stream (read-only, no sensitive data returned)
router.get("/stations/:id/live", (req, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station ID" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send: (event: string, data: object) => void = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const existing = getOcppLiveStatus(stationId);
  if (existing) {
    send("status", { ...existing, connected: true });
  }

  const removeSse = addSseClient(stationId, send);

  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    removeSse();
  });
});

// Public: OCPP connection status snapshot (no sensitive data)
router.get("/stations/:id/ocpp-status", (req, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station ID" }); return; }
  const status = getOcppLiveStatus(stationId);
  if (!status) {
    res.json({ connected: false });
    return;
  }
  res.json(status);
});

// Protected: manual remote start — station owner or admin only
router.post("/stations/:id/remote-start", requireStationOwnerOrAdmin, async (req, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station ID" }); return; }
  const result = await remoteStartTransaction(stationId);
  req.log.info({ stationId, result }, "Manual remote start");
  res.json(result);
});

// Protected: manual remote stop — station owner or admin only
router.post("/stations/:id/remote-stop", requireStationOwnerOrAdmin, async (req, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station ID" }); return; }
  const result = await remoteStopTransaction(stationId);
  req.log.info({ stationId, result }, "Manual remote stop");
  res.json(result);
});

// Protected: OCPP configuration — station owner or admin only
// OCPP password is NEVER returned in the response.
router.patch("/stations/:id/ocpp", requireStationOwnerOrAdmin, async (req, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station ID" }); return; }

  const { chargePointId, password } = req.body as { chargePointId?: string; password?: string };
  if (!chargePointId || typeof chargePointId !== "string") {
    res.status(400).json({ error: "chargePointId is required" }); return;
  }

  const [station] = await db
    .update(stationsTable)
    .set({
      ocppChargePointId: chargePointId.trim(),
      ...(password !== undefined && { ocppPassword: password || null }),
    })
    .where(eq(stationsTable.id, stationId))
    // Never return the password field in the response
    .returning({ id: stationsTable.id, ocppChargePointId: stationsTable.ocppChargePointId });

  if (!station) { res.status(404).json({ error: "Station not found" }); return; }

  req.log.info({ stationId, chargePointId }, "OCPP charger registered");
  res.json({ ok: true, ocppChargePointId: station.ocppChargePointId });
});

export default router;
