import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import type { Duplex } from "stream";
import { db } from "@workspace/db";
import { stationsTable, chargingSessionsTable } from "@workspace/db";
import { eq, and, desc, inArray, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { recordSessionEvent } from "./sessionEvents";
import { track, hashId } from "./analyticsServer";

const CALL = 2;
const CALL_RESULT = 3;
const CALL_ERROR = 4;

export interface OcppLiveStatus {
  chargePointId: string;
  connected: boolean;
  connectorStatus: string;
  meterWh: number;
  meterKwh: number;
  transactionId: number | null;
  lastHeartbeat: string;
  errorCode?: string;
}

interface ConnectedCharger {
  ws: WebSocket;
  chargePointId: string;
  stationId: number | null;
  connectorStatus: string;
  meterWh: number;
  transactionId: number | null;
  lastHeartbeat: Date;
  errorCode: string;
  pendingCalls: Map<string, { resolve: (p: any) => void; reject: (e: Error) => void }>;
  /** DB session ID for the currently active charging session (set by StartTransaction handler). */
  currentSessionId?: number | null;
  /** kWh value at the last session_telemetry_update event (rate-limit: Δ ≥ 0.1 kWh). */
  lastAnalyticsKwhSent?: number;
}

type SseSend = (event: string, data: object) => void;

const connectedChargers = new Map<string, ConnectedCharger>();
const sseClients = new Map<number, Set<SseSend>>();

export function addSseClient(stationId: number, send: SseSend): () => void {
  if (!sseClients.has(stationId)) sseClients.set(stationId, new Set());
  sseClients.get(stationId)!.add(send);
  return () => sseClients.get(stationId)?.delete(send);
}

export function getChargerForStation(stationId: number): ConnectedCharger | undefined {
  for (const c of connectedChargers.values()) {
    if (c.stationId === stationId) return c;
  }
  return undefined;
}

export function getOcppLiveStatus(stationId: number): OcppLiveStatus | null {
  const c = getChargerForStation(stationId);
  if (!c) return null;
  return {
    chargePointId: c.chargePointId,
    connected: c.ws.readyState === WebSocket.OPEN,
    connectorStatus: c.connectorStatus,
    meterWh: c.meterWh,
    meterKwh: +(c.meterWh / 1000).toFixed(3),
    transactionId: c.transactionId,
    lastHeartbeat: c.lastHeartbeat.toISOString(),
    errorCode: c.errorCode,
  };
}

function broadcast(stationId: number, event: string, data: object) {
  const clients = sseClients.get(stationId);
  if (clients) clients.forEach((send) => send(event, data));
}

export function broadcastStationEvent(stationId: number, event: string, data: object) {
  broadcast(stationId, event, data);
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function sendCall(charger: ConnectedCharger, action: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const uid = genId();
    charger.pendingCalls.set(uid, { resolve, reject });
    charger.ws.send(JSON.stringify([CALL, uid, action, payload]));
    const timer = setTimeout(() => {
      charger.pendingCalls.delete(uid);
      reject(new Error(`OCPP ${action} timed out`));
    }, 30_000);
    const orig = charger.pendingCalls.get(uid)!;
    charger.pendingCalls.set(uid, {
      resolve: (p) => { clearTimeout(timer); orig.resolve(p); },
      reject: (e) => { clearTimeout(timer); orig.reject(e); },
    });
  });
}

// ── Test helpers (exported for unit tests only — do not use in production) ───

/** @internal Only exported for unit testing */
export function _test_setConnectedCharger(chargePointId: string, charger: Omit<ConnectedCharger, "ws"> & { ws: any }): void {
  connectedChargers.set(chargePointId, charger as ConnectedCharger);
}

/** @internal Only exported for unit testing */
export function _test_removeConnectedCharger(chargePointId: string): void {
  connectedChargers.delete(chargePointId);
}

// ── Exported DB helpers ───────────────────────────────────────────────────────

/**
 * Persist chargingState=charging and ocppTransactionId once a StartTransaction
 * OCPP message is received from the charger.
 *
 * Lookup priority:
 *   1. chargingState IN (remote_start_sent, charging) — covers the normal flow and
 *      the duplicate-after-restart case where the session is already charging
 *   2. status=pending — backward compat for sessions without chargingState set yet
 *
 * Idempotency guard: if session is already in `charging` state, the update is
 * skipped regardless of the transactionId in the message (duplicate StartTransaction
 * from a buggy charger or retry after CSMS restart is always a no-op).
 *
 * Exported so it can be unit-tested without a live WebSocket connection.
 *
 * Returns { sessionId, skipped } — skipped=true when the idempotency guard fired.
 */
export async function applyStartTransaction(
  stationId: number,
  chargePointId: string,
  transactionId: number,
  meterStart: number,
  startedAt: Date,
  connectorId?: number,
  connectorStatus?: string,
): Promise<{ sessionId: number | null; skipped: boolean }> {
  // Primary: find session in remote_start_sent OR already charging (reconnect / duplicate)
  let [target] = await db
    .select({
      id: chargingSessionsTable.id,
      chargingState: chargingSessionsTable.chargingState,
      ocppTransactionId: chargingSessionsTable.ocppTransactionId,
    })
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.stationId, stationId),
        inArray(chargingSessionsTable.chargingState, ["remote_start_sent", "charging"]),
      )
    )
    .orderBy(desc(chargingSessionsTable.createdAt))
    .limit(1);

  // Backward-compat fallback: pending sessions without chargingState set yet
  if (!target) {
    [target] = await db
      .select({
        id: chargingSessionsTable.id,
        chargingState: chargingSessionsTable.chargingState,
        ocppTransactionId: chargingSessionsTable.ocppTransactionId,
      })
      .from(chargingSessionsTable)
      .where(
        and(
          eq(chargingSessionsTable.stationId, stationId),
          eq(chargingSessionsTable.status, "pending"),
        )
      )
      .orderBy(desc(chargingSessionsTable.createdAt))
      .limit(1);
  }

  if (!target) {
    logger.warn(
      { stationId, chargePointId, transactionId },
      "OCPP StartTransaction: no matching session found to record chargingState",
    );
    return { sessionId: null, skipped: false };
  }

  // Idempotency guard: if the session is already charging AND ocppTransactionId is already
  // recorded, this is a confirmed no-op duplicate.
  // If ocppTransactionId is null, a previous write was partial — fall through to recover it.
  if (target.chargingState === "charging" && target.ocppTransactionId != null) {
    logger.warn(
      { sessionId: target.id, persistedTransactionId: target.ocppTransactionId, newTransactionId: transactionId, stationId, chargePointId },
      "OCPP StartTransaction: duplicate — session already charging with persisted transactionId, skipping DB update",
    );
    return { sessionId: target.id, skipped: true };
  }

  await db
    .update(chargingSessionsTable)
    .set({ startedAt, chargingState: "charging", ocppTransactionId: transactionId })
    .where(eq(chargingSessionsTable.id, target.id));

  await recordSessionEvent(db, target.id, "charging_started", {
    transactionId,
    meterStart,
    stationId,
    chargePointId,
    connectorId,
    connectorStatus,
  });

  track("session_charging_confirmed", target.id, {
    station_id: String(stationId),
    session_id_hash: hashId(target.id),
    ocpp_transaction_id: String(transactionId),
    connector_type: connectorStatus ?? "Unknown",
    payment_method_type: "stripe",
  });

  logger.info(
    { sessionId: target.id, stationId, chargePointId, transactionId, startedAt, connectorStatus },
    "OCPP StartTransaction: chargingState=charging + ocppTransactionId recorded",
  );

  return { sessionId: target.id, skipped: false };
}

/**
 * Persist chargingState=stopped when a StopTransaction OCPP message is received.
 *
 * Matching priority:
 *   1. ocppTransactionId exact match (most precise — covers normal flow)
 *   2. chargingState IN (charging, remote_stop_sent) for the station (reconnect/timeout fallback)
 *   3. Legacy `stopping` status without chargingState (backward compat for old sessions)
 *
 * Idempotency: if the session is already `stopped`, the update is skipped.
 *
 * Exported so it can be unit-tested without a live WebSocket connection.
 *
 * Returns { sessionId, skipped } — skipped=true when the idempotency guard fired.
 */
export async function applyStopTransaction(
  stationId: number,
  chargePointId: string,
  transactionId: number,
  meterStop: number,
  kwhDelivered: number,
  reason: string | undefined,
  connectorStatus?: string,
): Promise<{ sessionId: number | null; skipped: boolean }> {
  // Primary: match by ocppTransactionId (most precise)
  let [target] = await db
    .select({
      id: chargingSessionsTable.id,
      chargingState: chargingSessionsTable.chargingState,
      status: chargingSessionsTable.status,
    })
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.stationId, stationId),
        eq(chargingSessionsTable.ocppTransactionId, transactionId),
      )
    )
    .limit(1);

  // Secondary: match by chargingState (reconnect / missing transactionId scenarios)
  if (!target) {
    [target] = await db
      .select({
        id: chargingSessionsTable.id,
        chargingState: chargingSessionsTable.chargingState,
        status: chargingSessionsTable.status,
      })
      .from(chargingSessionsTable)
      .where(
        and(
          eq(chargingSessionsTable.stationId, stationId),
          inArray(chargingSessionsTable.chargingState, ["charging", "remote_stop_sent"]),
        )
      )
      .orderBy(desc(chargingSessionsTable.createdAt))
      .limit(1);
  }

  if (target) {
    // Idempotency: duplicate StopTransaction for an already-stopped session
    if (target.chargingState === "stopped") {
      logger.warn(
        { sessionId: target.id, transactionId, stationId, chargePointId },
        "OCPP StopTransaction: duplicate — session already stopped, idempotent no-op",
      );
      return { sessionId: target.id, skipped: true };
    }

    // `stopping` status means a driver/admin-initiated stop; mark failed (existing semantics)
    const statusUpdate: Record<string, unknown> = { chargingState: "stopped" };
    if (target.status === "stopping") statusUpdate.status = "failed";

    await db
      .update(chargingSessionsTable)
      .set(statusUpdate as any)
      .where(eq(chargingSessionsTable.id, target.id));

    await recordSessionEvent(db, target.id, "charging_stopped", {
      transactionId,
      meterStop,
      kwhDelivered,
      reason,
      stationId,
      chargePointId,
      connectorStatus,
    });

    track("session_completed", target.id, {
      station_id: String(stationId),
      session_id_hash: hashId(target.id),
      kwh_delivered: kwhDelivered,
      duration_s: 0,
      cost_usd: 0,
      stop_reason: reason === "Remote" ? "user" : "charger",
    });

    logger.info(
      { sessionId: target.id, stationId, chargePointId, transactionId, kwhDelivered, reason, connectorStatus },
      "OCPP StopTransaction: chargingState=stopped recorded",
    );

    return { sessionId: target.id, skipped: false };
  }

  // Tertiary: backward-compat for legacy `stopping` sessions without chargingState set
  const [resolved] = await db
    .update(chargingSessionsTable)
    .set({ status: "failed", chargingState: "stopped" })
    .where(
      and(
        eq(chargingSessionsTable.stationId, stationId),
        eq(chargingSessionsTable.status, "stopping"),
      )
    )
    .returning({ id: chargingSessionsTable.id });

  if (resolved) {
    await recordSessionEvent(db, resolved.id, "charging_stopped", {
      transactionId,
      meterStop,
      kwhDelivered,
      reason,
      stationId,
      chargePointId,
      connectorStatus,
      path: "legacy_stopping",
    });
    logger.info(
      { sessionId: resolved.id, stationId, chargePointId, transactionId, connectorStatus },
      "OCPP StopTransaction: legacy stopping session resolved to failed (admin/driver-initiated stop confirmed)",
    );
    return { sessionId: resolved.id, skipped: false };
  }

  logger.warn(
    { stationId, chargePointId, transactionId },
    "OCPP StopTransaction: no matching session found to record chargingState",
  );
  return { sessionId: null, skipped: false };
}

/**
 * Handle charger disconnect: mark any session that was charging (or waiting for
 * a start confirmation) as failed, and record a charger_disconnected event.
 *
 * Called from ws.on("close") and ws.on("error") via the disconnect path.
 * Exported for unit testing.
 */
export async function handleChargerDisconnect(
  stationId: number,
  chargePointId: string,
  transactionId: number | null,
  connectorStatus: string,
): Promise<void> {
  // Mark any active session as failed — charger disappeared without sending StopTransaction
  const [session] = await db
    .update(chargingSessionsTable)
    .set({ chargingState: "failed" })
    .where(
      and(
        eq(chargingSessionsTable.stationId, stationId),
        inArray(chargingSessionsTable.chargingState, ["charging", "remote_start_sent", "remote_stop_sent"]),
      )
    )
    .returning({ id: chargingSessionsTable.id });

  if (session) {
    await recordSessionEvent(db, session.id, "charger_disconnected", {
      stationId,
      chargePointId,
      transactionId,
      connectorStatus,
    });
    logger.warn(
      { sessionId: session.id, stationId, chargePointId, transactionId },
      "OCPP disconnect: active session marked failed (charger disconnected without StopTransaction)",
    );
  }
}

// ── Session recovery ──────────────────────────────────────────────────────────

/**
 * Query the DB for an active session on reconnect and restore in-memory state.
 *
 * Called immediately after a charger WebSocket connects. If the server restarted
 * while a session was in progress, the transactionId is lost from in-memory state
 * but persisted in the DB. This function restores it so that:
 *   - `remoteStopTransaction`'s DB fallback path is never needed for normal reconnects
 *   - StartTransaction duplicate guard (Guard 2) finds the correct state
 *   - The session sweeper sees a live charger with an active in-memory transaction
 *
 * A `session_recovered` event is recorded when recovery fires, making post-incident
 * analysis easier.
 *
 * Returns the recovered session's { id, chargingState, ocppTransactionId } or null
 * if no active session was found.
 *
 * Exported for unit testing.
 */
export async function recoverActiveSession(
  stationId: number,
  chargePointId: string,
): Promise<{ sessionId: number; chargingState: string; transactionId: number | null } | null> {
  const [activeSession] = await db
    .select({
      id: chargingSessionsTable.id,
      chargingState: chargingSessionsTable.chargingState,
      ocppTransactionId: chargingSessionsTable.ocppTransactionId,
    })
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.stationId, stationId),
        inArray(chargingSessionsTable.chargingState, ["charging", "remote_start_sent", "remote_stop_sent"]),
        // Defensive guard: exclude sessions the sweeper already terminated (status=failed/completed/refunded).
        // The sweeper now sets chargingState=failed when it sweeps, but this guard protects against
        // any stale rows that pre-date that fix or were swept by other code paths.
        notInArray(chargingSessionsTable.status, ["failed", "completed", "refunded"]),
      )
    )
    .orderBy(desc(chargingSessionsTable.createdAt))
    .limit(1);

  if (!activeSession) return null;

  const recoveredTransactionId = activeSession.ocppTransactionId ?? null;

  await recordSessionEvent(db, activeSession.id, "session_recovered", {
    chargePointId,
    stationId,
    preRestartState: activeSession.chargingState,
    recoveredTransactionId,
  });

  track("session_recovered", activeSession.id, {
    station_id: String(stationId),
    session_id_hash: hashId(activeSession.id),
    pre_restart_charging_state: activeSession.chargingState ?? "unknown",
  });

  logger.warn(
    {
      sessionId: activeSession.id,
      stationId,
      chargePointId,
      preRestartState: activeSession.chargingState,
      recoveredTransactionId,
    },
    "OCPP connect: active session found after restart — in-memory transactionId restored from DB",
  );

  return {
    sessionId: activeSession.id,
    chargingState: activeSession.chargingState ?? "unknown",
    transactionId: recoveredTransactionId,
  };
}

// ── Public OCPP command functions ─────────────────────────────────────────────

/**
 * Send a RemoteStartTransaction OCPP call to the charger for a given station.
 *
 * Double-start guard: refuses to send if another session on this station is
 * already in `remote_start_sent` or `charging` state, preventing concurrent
 * charge starts from payment webhook retries or manual triggers.
 *
 * When `sessionId` is provided:
 *   - Sets chargingState=remote_start_sent before sending (always visible in DB)
 *   - On OCPP Rejected: sets chargingState=failed + records remote_start_rejected event
 *   - On timeout/error: sets chargingState=failed + records remote_start_timeout event
 *   (On Accepted: chargingState is left as remote_start_sent; the StartTransaction
 *    handler advances it to charging once the charger begins delivering power.)
 */
export async function remoteStartTransaction(
  stationId: number,
  idTag = "CHARGEBRIDGE",
  connectorId = 1,
  sessionId?: number,
): Promise<{ accepted: boolean; message: string }> {
  const charger = getChargerForStation(stationId);
  if (!charger) return { accepted: false, message: "Charger not connected" };
  if (charger.ws.readyState !== WebSocket.OPEN) return { accepted: false, message: "Charger WebSocket not open" };

  // Double-start guard: prevent sending RemoteStart when another session is already
  // active on this station. Concurrent starts (payment webhook retry, manual trigger)
  // would interfere with each other and produce duplicate StopTransaction confusion.
  //
  // notInArray guard on status is essential: sessions the sweeper terminated
  // (status=failed) might retain a stale chargingState (charging/remote_start_sent)
  // if they pre-date the sweeper fix. Without this guard, a swept session would
  // permanently block the station from accepting new charges.
  try {
    const [conflicting] = await db
      .select({ id: chargingSessionsTable.id, chargingState: chargingSessionsTable.chargingState })
      .from(chargingSessionsTable)
      .where(
        and(
          eq(chargingSessionsTable.stationId, stationId),
          inArray(chargingSessionsTable.chargingState, ["remote_start_sent", "charging"]),
          notInArray(chargingSessionsTable.status, ["failed", "completed", "refunded"]),
        )
      )
      .limit(1);

    if (conflicting && conflicting.id !== sessionId) {
      logger.warn(
        { stationId, existingSessionId: conflicting.id, existingState: conflicting.chargingState, newSessionId: sessionId },
        "remoteStartTransaction: station already has an active session — refusing duplicate RemoteStartTransaction",
      );
      return { accepted: false, message: "Station already has an active charging session" };
    }
  } catch (err) {
    logger.error({ err, stationId }, "remoteStartTransaction: double-start guard query failed (continuing)");
  }

  // Persist remote_start_sent before the call so state is always current
  if (sessionId != null) {
    try {
      await db
        .update(chargingSessionsTable)
        .set({ chargingState: "remote_start_sent" })
        .where(eq(chargingSessionsTable.id, sessionId));
      await recordSessionEvent(db, sessionId, "remote_start_sent", {
        stationId,
        connectorId,
        idTag,
        connectorStatus: charger.connectorStatus,
      });
    } catch (err) {
      logger.error({ err, sessionId, stationId }, "remoteStartTransaction: failed to persist remote_start_sent (non-fatal)");
    }
  }

  const _ocppStartAt = Date.now();
  track("ocpp_start_sent", sessionId, {
    station_id: String(stationId),
    session_id_hash: hashId(sessionId),
    connector_id: connectorId,
  });

  try {
    const result = await sendCall(charger, "RemoteStartTransaction", { connectorId, idTag });
    const accepted = result.status === "Accepted";
    const _responseMs = Date.now() - _ocppStartAt;

    track("ocpp_start_result", sessionId, {
      station_id: String(stationId),
      session_id_hash: hashId(sessionId),
      accepted,
      response_ms: _responseMs,
    });

    if (accepted) {
      track("session_started", sessionId, {
        station_id: String(stationId),
        session_id_hash: hashId(sessionId),
        ocpp_response: "Accepted",
      });
    }

    if (!accepted && sessionId != null) {
      try {
        await db
          .update(chargingSessionsTable)
          .set({ chargingState: "failed" })
          .where(eq(chargingSessionsTable.id, sessionId));
        await recordSessionEvent(db, sessionId, "remote_start_rejected", {
          stationId,
          reason: result.status,
          connectorId,
          connectorStatus: charger.connectorStatus,
        });
      } catch (err) {
        logger.error({ err, sessionId, stationId }, "remoteStartTransaction: failed to persist rejection state (non-fatal)");
      }
    }

    return { accepted, message: result.status };
  } catch (err: any) {
    // Timeout or WebSocket error
    track("ocpp_start_timeout", sessionId, {
      station_id: String(stationId),
      session_id_hash: hashId(sessionId),
    });
    if (sessionId != null) {
      try {
        await db
          .update(chargingSessionsTable)
          .set({ chargingState: "failed" })
          .where(eq(chargingSessionsTable.id, sessionId));
        await recordSessionEvent(db, sessionId, "remote_start_timeout", {
          stationId,
          error: err.message,
          connectorId,
          connectorStatus: charger.connectorStatus,
        });
      } catch (dbErr) {
        logger.error({ dbErr, sessionId, stationId }, "remoteStartTransaction: failed to persist timeout state (non-fatal)");
      }
    }
    return { accepted: false, message: err.message };
  }
}

/**
 * Send a RemoteStopTransaction OCPP call to the charger for a given station.
 *
 * DB fallback: if the charger's in-memory transactionId is null (charger
 * reconnected after a server restart), the ocppTransactionId is recovered from
 * the database by finding the most recent session in charging or remote_stop_sent
 * state for this station.
 *
 * When `sessionId` is provided (or resolved from the DB fallback):
 *   - Sets chargingState=remote_stop_sent before sending
 *   - On error/rejection: records remote_stop_failed event
 *   (On Accepted: chargingState is left as remote_stop_sent; the StopTransaction
 *    handler advances it to stopped once the charger confirms the session end.)
 */
export async function remoteStopTransaction(
  stationId: number,
  sessionId?: number,
): Promise<{ accepted: boolean; message: string }> {
  const charger = getChargerForStation(stationId);
  if (!charger) return { accepted: false, message: "No active transaction" };
  if (charger.ws.readyState !== WebSocket.OPEN) return { accepted: false, message: "Charger not open" };

  let txId = charger.transactionId;
  let resolvedSessionId = sessionId;

  // DB fallback: recover transactionId when charger reconnected after restart
  if (txId === null) {
    try {
      const [activeSession] = await db
        .select({
          id: chargingSessionsTable.id,
          ocppTransactionId: chargingSessionsTable.ocppTransactionId,
        })
        .from(chargingSessionsTable)
        .where(
          and(
            eq(chargingSessionsTable.stationId, stationId),
            inArray(chargingSessionsTable.chargingState, ["charging", "remote_stop_sent"]),
          )
        )
        .orderBy(desc(chargingSessionsTable.createdAt))
        .limit(1);

      if (activeSession?.ocppTransactionId != null) {
        txId = activeSession.ocppTransactionId;
        if (resolvedSessionId == null) resolvedSessionId = activeSession.id;
        logger.info(
          { stationId, transactionId: txId, sessionId: activeSession.id },
          "remoteStopTransaction: transactionId recovered from DB (charger reconnected after restart)",
        );
      } else {
        logger.warn({ stationId }, "remoteStopTransaction: no in-memory transactionId and no DB fallback found");
        return { accepted: false, message: "No active transaction" };
      }
    } catch (err) {
      logger.error({ err, stationId }, "remoteStopTransaction: DB fallback query failed");
      return { accepted: false, message: "No active transaction" };
    }
  }

  // Session resolution: when the caller doesn't supply sessionId (e.g. manual remote-stop,
  // OCPI START_SESSION path), resolve via ocppTransactionId so every stop transition is
  // always audited regardless of the call site.
  if (resolvedSessionId == null && txId !== null) {
    try {
      // Primary: match by exact ocppTransactionId (most precise)
      const [byTxId] = await db
        .select({ id: chargingSessionsTable.id })
        .from(chargingSessionsTable)
        .where(
          and(
            eq(chargingSessionsTable.stationId, stationId),
            eq(chargingSessionsTable.ocppTransactionId, txId),
          )
        )
        .limit(1);

      if (byTxId) {
        resolvedSessionId = byTxId.id;
      } else {
        // Secondary: match by active chargingState (handles txId-less sessions)
        const [byState] = await db
          .select({ id: chargingSessionsTable.id })
          .from(chargingSessionsTable)
          .where(
            and(
              eq(chargingSessionsTable.stationId, stationId),
              inArray(chargingSessionsTable.chargingState, ["charging", "remote_stop_sent"]),
            )
          )
          .orderBy(desc(chargingSessionsTable.createdAt))
          .limit(1);

        if (byState) resolvedSessionId = byState.id;
      }

      if (resolvedSessionId != null) {
        logger.info(
          { stationId, transactionId: txId, sessionId: resolvedSessionId },
          "remoteStopTransaction: session resolved from DB by transactionId/state for audit trail",
        );
      } else {
        logger.warn(
          { stationId, transactionId: txId },
          "remoteStopTransaction: could not resolve sessionId from DB — remote_stop_sent will not be persisted",
        );
      }
    } catch (err) {
      logger.error({ err, stationId, transactionId: txId }, "remoteStopTransaction: session resolution failed (audit may be incomplete)");
    }
  }

  // Persist remote_stop_sent before the call
  if (resolvedSessionId != null) {
    try {
      await db
        .update(chargingSessionsTable)
        .set({ chargingState: "remote_stop_sent" })
        .where(eq(chargingSessionsTable.id, resolvedSessionId));
      await recordSessionEvent(db, resolvedSessionId, "remote_stop_sent", {
        stationId,
        transactionId: txId,
        connectorStatus: charger.connectorStatus,
      });
    } catch (err) {
      logger.error({ err, sessionId: resolvedSessionId, stationId }, "remoteStopTransaction: failed to persist remote_stop_sent (non-fatal)");
    }
  }

  const _ocppStopAt = Date.now();
  track("ocpp_stop_sent", resolvedSessionId, {
    station_id: String(stationId),
    session_id_hash: hashId(resolvedSessionId),
    transaction_id: String(txId ?? ""),
  });

  try {
    const result = await sendCall(charger, "RemoteStopTransaction", { transactionId: txId });
    const accepted = result.status === "Accepted";
    const _stopResponseMs = Date.now() - _ocppStopAt;

    track("ocpp_stop_result", resolvedSessionId, {
      station_id: String(stationId),
      session_id_hash: hashId(resolvedSessionId),
      accepted,
      response_ms: _stopResponseMs,
    });

    if (!accepted && resolvedSessionId != null) {
      await recordSessionEvent(db, resolvedSessionId, "remote_stop_failed", {
        stationId,
        transactionId: txId,
        reason: result.status,
        connectorStatus: charger.connectorStatus,
      });
    }

    return { accepted, message: result.status };
  } catch (err: any) {
    if (resolvedSessionId != null) {
      await recordSessionEvent(db, resolvedSessionId, "remote_stop_failed", {
        stationId,
        transactionId: txId,
        error: err.message,
        connectorStatus: charger.connectorStatus,
      });
    }
    return { accepted: false, message: err.message };
  }
}

async function handleOcppMessage(charger: ConnectedCharger, raw: string): Promise<void> {
  let msg: any[];
  try { msg = JSON.parse(raw); } catch { return; }

  const [type, uid, ...rest] = msg;

  if (type === CALL_RESULT || type === CALL_ERROR) {
    const pending = charger.pendingCalls.get(uid);
    if (!pending) return;
    charger.pendingCalls.delete(uid);
    if (type === CALL_RESULT) pending.resolve(rest[0]);
    else pending.reject(new Error(rest[1] ?? "OCPP error"));
    return;
  }

  if (type !== CALL) return;
  const [action, payload] = rest as [string, any];

  const reply = (result: object) => charger.ws.send(JSON.stringify([CALL_RESULT, uid, result]));
  const replyErr = (code: string, desc: string) =>
    charger.ws.send(JSON.stringify([CALL_ERROR, uid, code, desc, {}]));

  try {
    switch (action) {
      case "BootNotification": {
        logger.info({ chargePointId: charger.chargePointId, model: payload.chargePointModel }, "OCPP Boot");
        reply({ currentTime: new Date().toISOString(), interval: 60, status: "Accepted" });
        break;
      }

      case "Heartbeat": {
        charger.lastHeartbeat = new Date();
        reply({ currentTime: new Date().toISOString() });
        break;
      }

      case "Authorize": {
        reply({ idTagInfo: { status: "Accepted" } });
        break;
      }

      case "StatusNotification": {
        const { connectorId, status, errorCode } = payload;
        charger.connectorStatus = status;
        charger.errorCode = errorCode ?? "NoError";
        logger.info({ chargePointId: charger.chargePointId, connectorId, status }, "OCPP Status");

        const dbStatus =
          status === "Available" ? "available" :
          status === "Charging" || status === "Preparing" || status === "SuspendedEV" || status === "SuspendedEVSE" || status === "Finishing" ? "busy" :
          status === "Faulted" || status === "Unavailable" ? "offline" : "available";

        if (charger.stationId) {
          await db.update(stationsTable).set({ status: dbStatus as any }).where(eq(stationsTable.id, charger.stationId));
          broadcast(charger.stationId, "status", {
            connectorStatus: status, dbStatus, connectorId,
            errorCode: charger.errorCode, meterKwh: +(charger.meterWh / 1000).toFixed(3),
            transactionId: charger.transactionId, connected: true,
          });
        }
        reply({});
        break;
      }

      case "MeterValues": {
        const { connectorId, transactionId, meterValue } = payload;
        const samples: any[] = meterValue?.[0]?.sampledValue ?? [];
        const energySample = samples.find((s: any) =>
          s.measurand === "Energy.Active.Import.Register" || !s.measurand
        );
        if (energySample) {
          const val = parseFloat(energySample.value ?? "0");
          charger.meterWh = energySample.unit === "kWh" ? val * 1000 : val;
        }
        const powerSample = samples.find((s: any) => s.measurand === "Power.Active.Import");
        let powerW: number | null = null;
        if (powerSample) {
          const rawPow = parseFloat(powerSample.value ?? "0");
          powerW = powerSample.unit === "kW" ? rawPow * 1000 : rawPow;
        }
        if (charger.stationId) {
          broadcast(charger.stationId, "meter", {
            meterWh: charger.meterWh,
            meterKwh: +(charger.meterWh / 1000).toFixed(3),
            ...(powerW !== null && { powerW }),
            transactionId, connectorId,
          });
        }
        if (charger.stationId && charger.transactionId !== null) {
          const currentKwh = +(charger.meterWh / 1000).toFixed(3);
          const lastKwh = charger.lastAnalyticsKwhSent ?? 0;
          if (currentKwh - lastKwh >= 0.1) {
            charger.lastAnalyticsKwhSent = currentKwh;
            track("session_telemetry_update", charger.currentSessionId, {
              station_id: String(charger.stationId),
              session_id_hash: hashId(charger.currentSessionId),
              kwh_delivered: currentKwh,
              elapsed_s: 0,
            });
          }
        }
        reply({});
        break;
      }

      case "StartTransaction": {
        const { connectorId, meterStart, timestamp } = payload;

        // Guard 1 — in-memory: if this charger already tracks an active transaction,
        // the server has NOT restarted since the original StartTransaction. Reply with
        // the existing txId immediately — no DB access needed.
        if (charger.transactionId !== null) {
          logger.warn(
            { chargePointId: charger.chargePointId, existingTransactionId: charger.transactionId },
            "OCPP StartTransaction: duplicate (in-memory) — replying with existing transactionId",
          );
          reply({ transactionId: charger.transactionId, idTagInfo: { status: "Accepted" } });
          break;
        }

        // Guard 2 — DB: the server may have restarted since the original StartTransaction.
        // If a session is already in `charging` state with a persisted `ocppTransactionId`,
        // reuse that ID so DB and in-memory state stay authoritative and in sync.
        // This ensures `remoteStopTransaction`'s DB fallback always finds the correct txId.
        let transactionId = Math.floor(Math.random() * 999_999) + 1;
        let alreadyCharging = false;

        if (charger.stationId) {
          try {
            const [existing] = await db
              .select({
                id: chargingSessionsTable.id,
                ocppTransactionId: chargingSessionsTable.ocppTransactionId,
              })
              .from(chargingSessionsTable)
              .where(
                and(
                  eq(chargingSessionsTable.stationId, charger.stationId),
                  eq(chargingSessionsTable.chargingState, "charging"),
                )
              )
              .limit(1);

            if (existing?.ocppTransactionId != null) {
              transactionId = existing.ocppTransactionId;
              alreadyCharging = true;
              logger.warn(
                { chargePointId: charger.chargePointId, sessionId: existing.id, restoredTransactionId: transactionId },
                "OCPP StartTransaction: duplicate after restart — restored in-memory transactionId from DB, no DB write needed",
              );
            }
          } catch (err) {
            logger.error(
              { err, stationId: charger.stationId },
              "OCPP StartTransaction: DB check for existing charging session failed, proceeding with new txId",
            );
          }
        }

        charger.transactionId = transactionId;
        charger.meterWh = meterStart ?? 0;
        logger.info({ chargePointId: charger.chargePointId, transactionId, alreadyCharging }, "OCPP StartTransaction");
        reply({ transactionId, idTagInfo: { status: "Accepted" } });

        if (charger.stationId && !alreadyCharging) {
          const startedAt = timestamp && !isNaN(new Date(timestamp).getTime())
            ? new Date(timestamp)
            : new Date();

          try {
            const { sessionId: startedSessionId } = await applyStartTransaction(
              charger.stationId,
              charger.chargePointId,
              transactionId,
              meterStart ?? 0,
              startedAt,
              connectorId ?? 1,
              charger.connectorStatus,
            );
            if (startedSessionId != null) charger.currentSessionId = startedSessionId;
          } catch (err) {
            logger.error(
              { err, stationId: charger.stationId, chargePointId: charger.chargePointId },
              "OCPP StartTransaction: applyStartTransaction failed",
            );
          }

          broadcast(charger.stationId, "session_start", {
            transactionId, meterStartWh: meterStart,
            meterKwh: +(charger.meterWh / 1000).toFixed(3), startedAt: timestamp,
            connectorId,
          });
        }
        break;
      }

      case "StopTransaction": {
        const { transactionId, meterStop, timestamp, reason } = payload;
        charger.meterWh = meterStop ?? charger.meterWh;
        const kwhDelivered = +(charger.meterWh / 1000).toFixed(3);
        charger.transactionId = null;
        logger.info({ chargePointId: charger.chargePointId, transactionId, meterStop, kwhDelivered }, "OCPP StopTransaction");
        reply({ idTagInfo: { status: "Accepted" } });

        if (charger.stationId) {
          broadcast(charger.stationId, "session_stop", {
            transactionId, meterStopWh: meterStop, kwhDelivered,
            stoppedAt: timestamp, reason,
          });

          try {
            await applyStopTransaction(
              charger.stationId,
              charger.chargePointId,
              transactionId,
              meterStop ?? charger.meterWh,
              kwhDelivered,
              reason,
              charger.connectorStatus,
            );
          } catch (err) {
            logger.error(
              { err, stationId: charger.stationId, chargePointId: charger.chargePointId },
              "OCPP StopTransaction: applyStopTransaction failed",
            );
          }
        }
        break;
      }

      case "DataTransfer": {
        reply({ status: "Accepted" });
        break;
      }

      default: {
        logger.warn({ action, chargePointId: charger.chargePointId }, "OCPP unknown action");
        replyErr("NotImplemented", `Action ${action} not implemented`);
      }
    }
  } catch (err) {
    logger.error({ err, action, chargePointId: charger.chargePointId }, "OCPP message handler error");
    replyErr("InternalError", "Server error handling OCPP message");
  }
}

export function setupOcppCsms(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = req.url ?? "";
    const match = pathname.match(/^\/ocpp\/1\.6\/(.+)$/);
    if (!match) { socket.destroy(); return; }

    const chargePointId = decodeURIComponent(match[1]);

    wss.handleUpgrade(req, socket as any, head, async (ws) => {
      const [station] = await db
        .select({ id: stationsTable.id })
        .from(stationsTable)
        .where(eq(stationsTable.ocppChargePointId, chargePointId));

      const charger: ConnectedCharger = {
        ws, chargePointId,
        stationId: station?.id ?? null,
        connectorStatus: "Unknown",
        meterWh: 0, transactionId: null,
        lastHeartbeat: new Date(), errorCode: "NoError",
        pendingCalls: new Map(),
      };

      connectedChargers.set(chargePointId, charger);

      // Recover in-memory transaction state from DB (handles server restart mid-session).
      // Must happen before broadcasting "connected" so any SSE listeners see the correct txId.
      if (charger.stationId) {
        try {
          const recovery = await recoverActiveSession(charger.stationId, chargePointId);
          if (recovery) {
            charger.transactionId = recovery.transactionId;
          }
        } catch (err) {
          logger.error({ err, chargePointId, stationId: charger.stationId }, "OCPP connect: session recovery failed");
        }
      }

      logger.info({ chargePointId, stationId: charger.stationId, transactionId: charger.transactionId }, "OCPP charger connected");

      if (charger.stationId) {
        track("ocpp_charger_connected", null, {
          station_id: String(charger.stationId),
          protocol: "OCPP-1.6",
          recovered_session: charger.transactionId !== null,
        });
        broadcast(charger.stationId, "connected", { chargePointId, connected: true, connectorStatus: "Unknown", transactionId: charger.transactionId });
      }

      ws.on("message", (data) => { handleOcppMessage(charger, data.toString()).catch(() => {}); });

      ws.on("close", () => {
        connectedChargers.delete(chargePointId);
        logger.info({ chargePointId }, "OCPP charger disconnected");
        if (charger.stationId) {
          track("ocpp_charger_disconnected", null, {
            station_id: String(charger.stationId),
            had_active_session: charger.transactionId !== null,
          });
          broadcast(charger.stationId, "disconnected", { chargePointId, connected: false });
          // Mark any active session as failed — charger disappeared without StopTransaction
          handleChargerDisconnect(
            charger.stationId,
            charger.chargePointId,
            charger.transactionId,
            charger.connectorStatus,
          ).catch((err) =>
            logger.error({ err, chargePointId, stationId: charger.stationId }, "OCPP disconnect: failed to mark active session failed")
          );
        }
      });

      ws.on("error", (err) => logger.error({ chargePointId, err }, "OCPP WS error"));
    });
  });

  logger.info("OCPP CSMS WebSocket server ready at /ocpp/1.6/:chargePointId");
}
