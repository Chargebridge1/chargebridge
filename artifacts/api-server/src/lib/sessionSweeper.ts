import { db } from "@workspace/db";
import { chargingSessionsTable, stripeRefundJobsTable } from "@workspace/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { getOcppLiveStatus } from "./ocppCsms";
import { logger } from "./logger";

// Sessions that remain `pending` longer than SESSION_TTL_MS were never
// successfully started (e.g. payment succeeded but start-charging was never
// called, or the client crashed before the OCPP remote-start handshake).
// Marking them `failed` clears them from the DB so they don't accumulate.
//
// Sessions in `stopping` status are intentionally excluded from sweeping.
// When an admin or driver calls POST /sessions/:id/stop-charging the route
// transitions the session to `stopping` before sending the OCPP command. That
// intermediate state signals that a manual stop is already in progress and the
// session should not be swept as orphaned while waiting for the OCPP
// StopTransaction confirmation.
//
// chargingState-aware sweep rules (Phase 2B):
//   remote_stop_sent  — a stop is already in progress; never auto-terminate
//   remote_start_sent — give an extra REMOTE_START_GRACE_MS before sweeping,
//                       since the charger may still be acking the RemoteStart
//   charging          — only terminate if live OCPP confirms no active transaction
//                       (same guard as the legacy `ocppStatus.transactionId` check)
//   not_started / null — standard TTL sweep with live OCPP guard (existing behaviour)
//
// Refund behaviour:
//   When a session is marked failed by the sweeper AND its paymentState is
//   "captured", a stripe_refund_job is inserted so the driver is automatically
//   refunded. The idempotency key "orphan_sweep_refund_session_{id}" prevents
//   double-queuing if the sweeper runs multiple times before the row is cleaned up.
//
// NOTE: We do NOT issue a station-wide remote stop here. A `pending` session
// has not been confirmed as the source of any active OCPP transaction, and
// `remoteStopTransaction` is station-scoped — firing it speculatively could
// terminate a legitimate, currently-running charge from a different session
// on the same station.  If the station shows an active OCPP transaction at
// sweep time, we log a warning so an admin can investigate and use
// POST /sessions/:id/stop-charging (with station-owner credentials) to
// terminate the session safely and intentionally.

// SESSION_ORPHAN_TTL_HOURS controls how long a pending session is kept before
// it is considered orphaned. Default is 4 hours. Set SESSION_ORPHAN_TTL_HOURS
// in the environment to override (e.g. SESSION_ORPHAN_TTL_HOURS=8 for stations
// that serve long overnight top-ups).
const TTL_HOURS = Math.max(1, parseFloat(process.env.SESSION_ORPHAN_TTL_HOURS ?? "4") || 4);
export const SESSION_TTL_MS = TTL_HOURS * 60 * 60 * 1000;

// Additional grace period for sessions in remote_start_sent state.
// The charger ack timeout is 30 s, so 30 min is conservative enough to avoid
// false-positive sweeping while still cleaning up truly stuck sessions.
export const REMOTE_START_GRACE_MS = 30 * 60 * 1000;

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function sweepOrphanedSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);

  // Use COALESCE(started_at, created_at) so that once the OCPP StartTransaction
  // confirmation sets started_at, the TTL is measured from first kWh rather
  // than from payment-intent creation. Sessions that never received a
  // StartTransaction (truly stuck pending) still fall back to created_at.
  let sessions: Array<{
    id: number;
    stationId: number | null;
    startedAt: Date | null;
    createdAt: Date;
    chargingState: string | null;
    paymentState: string | null;
    stripePaymentIntentId: string | null;
  }> = [];
  try {
    sessions = await db
      .select({
        id: chargingSessionsTable.id,
        stationId: chargingSessionsTable.stationId,
        startedAt: chargingSessionsTable.startedAt,
        createdAt: chargingSessionsTable.createdAt,
        chargingState: chargingSessionsTable.chargingState,
        paymentState: chargingSessionsTable.paymentState,
        stripePaymentIntentId: chargingSessionsTable.stripePaymentIntentId,
      })
      .from(chargingSessionsTable)
      .where(
        and(
          eq(chargingSessionsTable.status, "pending"),
          lt(sql`COALESCE(${chargingSessionsTable.startedAt}, ${chargingSessionsTable.createdAt})`, cutoff)
        )
      );
  } catch (err) {
    logger.error({ err }, "Session sweeper: failed to query orphaned sessions");
    return;
  }

  if (sessions.length === 0) return;

  logger.warn(
    { count: sessions.length, cutoff },
    "Session sweeper: orphaned pending sessions found (never started)"
  );

  for (const session of sessions) {
    // remote_stop_sent: a system-level stop is already in progress. Do not terminate —
    // the StopTransaction handler will close the session when the charger responds.
    if (session.chargingState === "remote_stop_sent") {
      logger.info(
        { sessionId: session.id, stationId: session.stationId },
        "Session sweeper: skipping remote_stop_sent session (stop in progress)"
      );
      continue;
    }

    // remote_start_sent: the RemoteStartTransaction was sent and we are waiting for the
    // charger to respond with StartTransaction. Extend the deadline by REMOTE_START_GRACE_MS
    // so that chargers with slow ack don't get falsely swept as orphans.
    if (session.chargingState === "remote_start_sent") {
      const sessionTime = session.startedAt ?? session.createdAt;
      const ageMs = Date.now() - sessionTime.getTime();
      if (ageMs < SESSION_TTL_MS + REMOTE_START_GRACE_MS) {
        logger.info(
          { sessionId: session.id, stationId: session.stationId, ageMs },
          "Session sweeper: skipping remote_start_sent session (within extended grace period)"
        );
        continue;
      }
    }

    // charging: DB says this session is actively delivering power. Only terminate
    // if the live OCPP check confirms no active transaction on this charger. This
    // prevents sweeping a session that is legitimately still running (e.g. the
    // sweeper TTL is shorter than a long overnight charge).
    if (session.chargingState === "charging") {
      const ocppStatus = session.stationId != null ? getOcppLiveStatus(session.stationId) : undefined;
      if (ocppStatus?.transactionId != null) {
        logger.warn(
          {
            sessionId: session.id,
            stationId: session.stationId,
            ocppTransactionId: ocppStatus.transactionId,
            connectorStatus: ocppStatus.connectorStatus,
            ttlHours: TTL_HOURS,
          },
          "Session sweeper: chargingState=charging with live OCPP transaction — skipping termination. " +
          "Use POST /sessions/:id/stop-charging to force-stop."
        );
        continue;
      }
      // Charger not connected or no live transaction — fall through to mark failed.
      // handleChargerDisconnect should have caught this already, but sweeper acts
      // as a safety net.
    }

    // Standard OCPP live check for all remaining states (not_started, null, or
    // charging without a connected charger).
    const ocppStatus = session.stationId != null ? getOcppLiveStatus(session.stationId) : undefined;
    if (ocppStatus?.transactionId !== null && ocppStatus?.transactionId !== undefined) {
      logger.warn(
        {
          sessionId: session.id,
          stationId: session.stationId,
          ocppTransactionId: ocppStatus.transactionId,
          connectorStatus: ocppStatus.connectorStatus,
          ttlHours: TTL_HOURS,
        },
        "Session sweeper: station has an active OCPP transaction — " +
          "session is still charging, skipping termination. " +
          "Increase SESSION_ORPHAN_TTL_HOURS if sessions legitimately exceed the current TTL, " +
          "or use POST /sessions/:id/stop-charging to force-stop once charging is complete."
      );
      // Do NOT mark failed — the charger is still actively transacting.
      continue;
    }

    try {
      // Set both status and chargingState so the row is fully terminal.
      // If only status is set, a stale chargingState (e.g. "charging") will be seen
      // as active by recoverActiveSession and the remoteStartTransaction guard, blocking
      // new sessions on this station.
      await db
        .update(chargingSessionsTable)
        .set({ status: "failed", chargingState: "failed" })
        .where(eq(chargingSessionsTable.id, session.id));
      logger.info(
        { sessionId: session.id, stationId: session.stationId, chargingState: session.chargingState },
        "Session sweeper: pending session marked failed"
      );
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Session sweeper: failed to update session status");
      continue;
    }

    // If payment was already captured, queue a refund job so the driver is not
    // charged for energy that was never delivered (e.g. app crash after capture
    // but before OCPP start confirmation).
    if (session.paymentState === "captured" && session.stripePaymentIntentId) {
      const idempotencyKey = `orphan_sweep_refund_session_${session.id}`;
      try {
        await db
          .insert(stripeRefundJobsTable)
          .values({
            sessionId: session.id,
            paymentIntentId: session.stripePaymentIntentId,
            idempotencyKey,
            reason: "session orphaned by sweeper after TTL — payment captured but charging never started",
          })
          .onConflictDoNothing();
        logger.warn(
          {
            sessionId: session.id,
            stationId: session.stationId,
            paymentIntentId: session.stripePaymentIntentId,
            idempotencyKey,
          },
          "Session sweeper: orphaned captured session — refund job queued"
        );
      } catch (err) {
        logger.error(
          { err, sessionId: session.id, paymentIntentId: session.stripePaymentIntentId },
          "Session sweeper: failed to queue refund job for orphaned captured session — MANUAL REFUND REQUIRED"
        );
      }
    }
  }
}

/** @internal Only exported for unit testing — do not call in production */
export const _test_sweepOnce = sweepOrphanedSessions;

export function startSessionSweeper(): NodeJS.Timeout {
  logger.info(
    { ttlHours: TTL_HOURS, intervalMinutes: SWEEP_INTERVAL_MS / 60_000 },
    "Session sweeper started"
  );

  // Run once immediately so orphaned sessions from a previous server run
  // are cleaned up without waiting for the first interval.
  sweepOrphanedSessions().catch((err) =>
    logger.error({ err }, "Session sweeper: initial sweep error")
  );

  return setInterval(() => {
    sweepOrphanedSessions().catch((err) =>
      logger.error({ err }, "Session sweeper: periodic sweep error")
    );
  }, SWEEP_INTERVAL_MS);
}
