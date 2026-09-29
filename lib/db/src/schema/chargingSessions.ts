import { relations, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { paymentCreationRequestsTable } from "./paymentCreationRequests";
import { stationsTable } from "./stations";

export const sessionStatusEnum = pgEnum("session_status", [
  "pending",
  "stopping",
  "completed",
  "failed",
  "refunded",
]);

// Phase 2B: independent payment state machine
export const paymentStateEnum = pgEnum("payment_state", [
  "pending", // session created, payment not yet initiated
  "authorized", // PaymentIntent created, awaiting confirmation
  "captured", // payment confirmed and captured
  "refunded", // payment fully or partially refunded
  "failed", // payment failed, cancelled, or expired
]);

// Phase 2B: independent charging lifecycle state machine
export const chargingStateEnum = pgEnum("charging_state", [
  "not_started", // no remote start has been issued yet
  "remote_start_sent", // RemoteStartTransaction sent, awaiting charger ack
  "charging", // StartTransaction received, power flowing
  "remote_stop_sent", // RemoteStopTransaction sent, awaiting charger ack
  "stopped", // StopTransaction received, charging ended cleanly
  "failed", // charger rejected start, timed out, or disconnected
]);

export const chargingSessionsTable = pgTable(
  "charging_sessions",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id").references(() => stationsTable.id, {
      onDelete: "set null",
    }),
    stationName: text("station_name"),
    driverEmail: text("driver_email").notNull(),
    driverName: text("driver_name").notNull(),
    kwh: real("kwh").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    // Legacy combined status — preserved for backward compatibility
    status: sessionStatusEnum("status").notNull().default("pending"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripeRefundId: text("stripe_refund_id"),
    clerkUserId: text("clerk_user_id"),
    guestTokenHash: text("guest_token_hash"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    stopInitiatedAt: timestamp("stop_initiated_at"),
    // Phase 2B: independent state machines (nullable — existing rows unaffected)
    paymentState: paymentStateEnum("payment_state"),
    chargingState: chargingStateEnum("charging_state"),
    ocppTransactionId: integer("ocpp_transaction_id"),
    // Phase 1B: canonical nullable association; legacy rows remain unaffected.
    paymentCreationRequestId: uuid("payment_creation_request_id"),
  },
  (t) => [
    foreignKey({
      name: "charging_sessions_payment_request_fk",
      columns: [t.paymentCreationRequestId],
      foreignColumns: [paymentCreationRequestsTable.id],
    }).onDelete("restrict"),
    uniqueIndex("charging_sessions_payment_request_uq")
      .on(t.paymentCreationRequestId)
      .where(sql`${t.paymentCreationRequestId} IS NOT NULL`),
    index("charging_sessions_stripe_payment_intent_idx")
      .using("btree", t.stripePaymentIntentId.asc().nullsLast())
      .where(sql`${t.stripePaymentIntentId} IS NOT NULL`)
      .concurrently(),
  ],
);

export const chargingSessionsRelations = relations(
  chargingSessionsTable,
  ({ one }) => ({
    station: one(stationsTable, {
      fields: [chargingSessionsTable.stationId],
      references: [stationsTable.id],
    }),
    paymentCreationRequest: one(paymentCreationRequestsTable, {
      fields: [chargingSessionsTable.paymentCreationRequestId],
      references: [paymentCreationRequestsTable.id],
    }),
  }),
);

export type ChargingSession = typeof chargingSessionsTable.$inferSelect;
export type InsertChargingSession = typeof chargingSessionsTable.$inferInsert;
