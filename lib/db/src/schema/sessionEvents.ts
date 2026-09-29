import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { chargingSessionsTable } from "./chargingSessions";

/**
 * Phase 2B: audit trail for every state transition across payment, charging,
 * and OCPP state machines. One row per event; never updated or deleted.
 */
export const sessionEventsTable = pgTable("session_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => chargingSessionsTable.id, { onDelete: "cascade" }),
  // e.g. "payment_captured", "charging_started", "remote_start_rejected", "session_recovered"
  eventType: text("event_type").notNull(),
  // Structured context for this event (transactionId, connectorId, stripeEventId, etc.)
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessionEventsRelations = relations(sessionEventsTable, ({ one }) => ({
  session: one(chargingSessionsTable, {
    fields: [sessionEventsTable.sessionId],
    references: [chargingSessionsTable.id],
  }),
}));

export type SessionEvent = typeof sessionEventsTable.$inferSelect;
export type InsertSessionEvent = typeof sessionEventsTable.$inferInsert;
