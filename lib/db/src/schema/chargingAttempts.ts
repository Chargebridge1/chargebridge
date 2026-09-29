import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chargingSessionsTable } from "./chargingSessions";
import { paymentCreationRequestsTable } from "./paymentCreationRequests";
import { paymentPrincipalTypeEnum } from "./phase1bEnums";
import { stationsTable } from "./stations";

export const chargingAttemptStateEnum = pgEnum("charging_attempt_state", [
  "issued",
  "processing",
  "succeeded",
  "failed",
  "reconciling",
  "manual_review",
]);

export const chargingAttemptReconciliationStateEnum = pgEnum(
  "charging_attempt_reconciliation_state",
  ["none", "required", "in_progress", "resolved", "manual_review"],
);

/**
 * A durable charging attempt and the complete immutable server quote used by
 * its payment operation. Existing charging_sessions remain independently
 * usable; this table is additive and does not backfill or merge legacy rows.
 */
export const chargingAttemptsTable = pgTable(
  "charging_attempts",
  {
    id: uuid("id").primaryKey(),
    principalType: paymentPrincipalTypeEnum("principal_type").notNull(),
    principalHmac: text("principal_hmac").notNull(),
    principalHmacVersion: integer("principal_hmac_version").notNull(),
    operation: text("operation").notNull(),
    stationId: integer("station_id").notNull(),
    paymentCreationRequestId: uuid("payment_creation_request_id"),
    chargingSessionId: integer("charging_session_id"),
    requestHash: text("request_hash").notNull(),
    requestHashVersion: integer("request_hash_version").notNull(),
    transactionFingerprint: text("transaction_fingerprint").notNull(),
    fingerprintKeyVersion: integer("fingerprint_key_version").notNull(),
    quoteVersion: integer("quote_version").notNull(),
    quoteCreatedAt: timestamp("quote_created_at", { withTimezone: true }).notNull(),
    quote: jsonb("quote").$type<Record<string, unknown>>().notNull(),
    currency: text("currency").notNull(),
    chargeMode: text("charge_mode").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4, mode: "number" }).notNull(),
    unit: text("unit").notNull(),
    energyCents: integer("energy_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    receiptEmailHmac: text("receipt_email_hmac"),
    receiptEmailHmacVersion: integer("receipt_email_hmac_version"),
    planId: text("plan_id"),
    priceId: text("price_id"),
    pricingVersion: text("pricing_version").notNull(),
    state: chargingAttemptStateEnum("state").notNull().default("issued"),
    reconciliationState: chargingAttemptReconciliationStateEnum(
      "reconciliation_state",
    )
      .notNull()
      .default("none"),
    reconciliationReason: text("reconciliation_reason"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Deliberately nullable: unresolved attempts are never expired by TTL.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "charging_attempts_station_fk",
      columns: [t.stationId],
      foreignColumns: [stationsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "charging_attempts_payment_request_fk",
      columns: [t.paymentCreationRequestId],
      foreignColumns: [paymentCreationRequestsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "charging_attempts_session_fk",
      columns: [t.chargingSessionId],
      foreignColumns: [chargingSessionsTable.id],
    }).onDelete("restrict"),
    check(
      "charging_attempts_principal_hmac_version_check",
      sql`${t.principalHmacVersion} > 0`,
    ),
    check(
      "charging_attempts_request_hash_version_check",
      sql`${t.requestHashVersion} > 0`,
    ),
    check(
      "charging_attempts_fingerprint_version_check",
      sql`${t.fingerprintKeyVersion} > 0`,
    ),
    check(
      "charging_attempts_quote_version_check",
      sql`${t.quoteVersion} > 0`,
    ),
    check(
      "charging_attempts_operation_check",
      sql`${t.operation} IN ('charging_checkout', 'charging_payment_intent')`,
    ),
    check(
      "charging_attempts_currency_check",
      sql`${t.currency} = lower(${t.currency}) AND length(${t.currency}) = 3`,
    ),
    check(
      "charging_attempts_quantity_check",
      sql`${t.quantity} > 0`,
    ),
    check(
      "charging_attempts_amount_check",
      sql`${t.energyCents} >= 0
        AND ${t.platformFeeCents} >= 0
        AND ${t.totalCents} = ${t.energyCents} + ${t.platformFeeCents}`,
    ),
    check(
      "charging_attempts_email_reference_check",
      sql`(
        ${t.receiptEmailHmac} IS NULL
        AND ${t.receiptEmailHmacVersion} IS NULL
      ) OR (
        ${t.receiptEmailHmac} IS NOT NULL
        AND ${t.receiptEmailHmacVersion} IS NOT NULL
        AND ${t.receiptEmailHmacVersion} > 0
      )`,
    ),
    check(
      "charging_attempts_reconciliation_fields_check",
      sql`(
        ${t.reconciliationState} IN ('none', 'resolved')
        AND ${t.reconciliationReason} IS NULL
      ) OR (
        ${t.reconciliationState} IN ('required', 'in_progress', 'manual_review')
        AND ${t.reconciliationReason} IS NOT NULL
      )`,
    ),
    check(
      "charging_attempts_state_reconciliation_check",
      sql`(
        ${t.state} NOT IN ('reconciling', 'manual_review')
      ) OR ${t.reconciliationState} IN ('required', 'in_progress', 'manual_review')`,
    ),
    check(
      "charging_attempts_updated_chronology_check",
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
    check(
      "charging_attempts_completed_chronology_check",
      sql`${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.createdAt}`,
    ),
    check(
      "charging_attempts_expiry_chronology_check",
      sql`${t.expiresAt} IS NULL OR ${t.expiresAt} >= ${t.createdAt}`,
    ),
    uniqueIndex("charging_attempts_payment_request_uq")
      .on(t.paymentCreationRequestId)
      .where(sql`${t.paymentCreationRequestId} IS NOT NULL`),
    uniqueIndex("charging_attempts_payment_intent_uq")
      .on(t.stripePaymentIntentId)
      .where(sql`${t.stripePaymentIntentId} IS NOT NULL`),
    uniqueIndex("charging_attempts_checkout_session_uq")
      .on(t.stripeCheckoutSessionId)
      .where(sql`${t.stripeCheckoutSessionId} IS NOT NULL`),
    index("charging_attempts_equivalent_lookup_idx").on(
      t.principalHmacVersion,
      t.principalHmac,
      t.transactionFingerprint,
      t.createdAt.desc(),
    ),
    index("charging_attempts_state_created_idx").on(t.state, t.createdAt),
    index("charging_attempts_session_idx")
      .on(t.chargingSessionId)
      .where(sql`${t.chargingSessionId} IS NOT NULL`),
  ],
);

export const chargingAttemptsRelations = relations(
  chargingAttemptsTable,
  ({ one }) => ({
    station: one(stationsTable, {
      fields: [chargingAttemptsTable.stationId],
      references: [stationsTable.id],
    }),
    paymentCreationRequest: one(paymentCreationRequestsTable, {
      fields: [chargingAttemptsTable.paymentCreationRequestId],
      references: [paymentCreationRequestsTable.id],
    }),
    chargingSession: one(chargingSessionsTable, {
      fields: [chargingAttemptsTable.chargingSessionId],
      references: [chargingSessionsTable.id],
    }),
  }),
);

export type ChargingAttempt = typeof chargingAttemptsTable.$inferSelect;
export type InsertChargingAttempt = typeof chargingAttemptsTable.$inferInsert;