import { db } from "@workspace/db";
import { sessionEventsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Insert a row into `session_events` for every paymentState / chargingState
 * transition. Errors are non-fatal: we log and continue so that a logging
 * failure never aborts a payment flow.
 *
 * Accepts either the bare `db` client or a Drizzle transaction object — both
 * expose the same `.insert()` API at runtime. Pass the transaction (`tx`) so
 * the event row is committed atomically with the state update (all-or-nothing
 * semantics). The `unknown` parameter type avoids a TS2352 error when casting
 * the opaque PgTransaction type; the internal cast is safe because both share
 * the same structural `.insert()` interface.
 */
export async function recordSessionEvent(
  dbOrTx: unknown,
  sessionId: number,
  eventType: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await (dbOrTx as typeof db).insert(sessionEventsTable).values({
      sessionId,
      eventType,
      payload: payload ?? null,
    });
  } catch (err) {
    logger.error({ err, sessionId, eventType }, "Failed to record session_event (non-fatal)");
  }
}
