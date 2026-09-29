import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stationsTable } from "./stations";
import {
  paymentPrincipalTypeEnum,
  paymentRequestOperationEnum,
  paymentRequestStateEnum,
  paymentRetentionClassEnum,
  stripeObjectTypeEnum,
} from "./phase1bEnums";

export const paymentCreationRequestsTable = pgTable(
  "payment_creation_requests",
  {
    id: uuid("id").primaryKey(),
    operation: paymentRequestOperationEnum("operation").notNull(),
    principalType: paymentPrincipalTypeEnum("principal_type").notNull(),
    principalHmac: text("principal_hmac").notNull(),
    principalHmacVersion: integer("principal_hmac_version").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    idempotencyKeyHashVersion: integer(
      "idempotency_key_hash_version",
    ).notNull(),
    requestHash: text("request_hash").notNull(),
    requestHashVersion: integer("request_hash_version").notNull(),
    transactionFingerprint: text("transaction_fingerprint").notNull(),
    fingerprintKeyVersion: integer("fingerprint_key_version").notNull(),
    state: paymentRequestStateEnum("state").notNull().default("processing"),
    stationId: integer("station_id"),
    planId: text("plan_id"),
    stripeObjectType: stripeObjectTypeEnum("stripe_object_type"),
    stripeObjectId: text("stripe_object_id"),
    stripeIdempotencyKeyRef: text("stripe_idempotency_key_ref").notNull(),
    checkoutUrlExpiresAt: timestamp("checkout_url_expires_at", {
      withTimezone: true,
    }),
    leaseOwner: uuid("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCategory: text("last_error_category"),
    supersedesRequestId: uuid("supersedes_request_id"),
    supersededByRequestId: uuid("superseded_by_request_id"),
    clientProtocol: integer("client_protocol"),
    clientPlatform: text("client_platform"),
    clientVersion: text("client_version"),
    clientBuild: text("client_build"),
    runtimeVersion: text("runtime_version"),
    otaUpdateId: text("ota_update_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    retentionClass: paymentRetentionClassEnum("retention_class")
      .notNull()
      .default("active"),
    retentionStartedAt: timestamp("retention_started_at", {
      withTimezone: true,
    }),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }),
    retentionHoldAt: timestamp("retention_hold_at", { withTimezone: true }),
    retentionHoldReason: text("retention_hold_reason"),
    retentionHoldCaseId: text("retention_hold_case_id"),
  },
  (t) => [
    foreignKey({
      name: "payment_creation_requests_station_fk",
      columns: [t.stationId],
      foreignColumns: [stationsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_creation_requests_supersedes_fk",
      columns: [t.supersedesRequestId],
      foreignColumns: [t.id],
    }).onDelete("set null"),
    foreignKey({
      name: "payment_creation_requests_superseded_by_fk",
      columns: [t.supersededByRequestId],
      foreignColumns: [t.id],
    }).onDelete("set null"),
    check(
      "payment_creation_requests_principal_hmac_version_check",
      sql`${t.principalHmacVersion} > 0`,
    ),
    check(
      "payment_creation_requests_idempotency_hash_version_check",
      sql`${t.idempotencyKeyHashVersion} > 0`,
    ),
    check(
      "payment_creation_requests_request_hash_version_check",
      sql`${t.requestHashVersion} > 0`,
    ),
    check(
      "payment_creation_requests_fingerprint_key_version_check",
      sql`${t.fingerprintKeyVersion} > 0`,
    ),
    check(
      "payment_creation_requests_attempt_count_check",
      sql`${t.attemptCount} >= 0`,
    ),
    check(
      "payment_creation_requests_client_protocol_check",
      sql`${t.clientProtocol} IS NULL OR ${t.clientProtocol} > 0`,
    ),
    check(
      "payment_creation_requests_charging_checkout_station_check",
      sql`${t.operation} <> 'charging_checkout' OR ${t.stationId} IS NOT NULL`,
    ),
    check(
      "payment_creation_requests_payment_intent_station_check",
      sql`${t.operation} <> 'charging_payment_intent' OR ${t.stationId} IS NOT NULL`,
    ),
    check(
      "payment_creation_requests_subscription_plan_check",
      sql`${t.operation} <> 'subscription_checkout' OR ${t.planId} IS NOT NULL`,
    ),
    check(
      "payment_creation_requests_stripe_fields_check",
      sql`(
        ${t.stripeObjectType} IS NULL
        AND ${t.stripeObjectId} IS NULL
      ) OR (
        ${t.stripeObjectType} IS NOT NULL
        AND ${t.stripeObjectId} IS NOT NULL
      )`,
    ),
    check(
      "payment_creation_requests_lease_fields_check",
      sql`(
        ${t.leaseOwner} IS NULL
        AND ${t.leaseExpiresAt} IS NULL
      ) OR (
        ${t.leaseOwner} IS NOT NULL
        AND ${t.leaseExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "payment_creation_requests_supersedes_self_check",
      sql`${t.supersedesRequestId} IS NULL OR ${t.supersedesRequestId} <> ${t.id}`,
    ),
    check(
      "payment_creation_requests_superseded_by_self_check",
      sql`${t.supersededByRequestId} IS NULL OR ${t.supersededByRequestId} <> ${t.id}`,
    ),
    check(
      "payment_creation_requests_updated_chronology_check",
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
    check(
      "payment_creation_requests_completed_chronology_check",
      sql`${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.createdAt}`,
    ),
    check(
      "payment_creation_requests_expiry_chronology_check",
      sql`${t.expiresAt} IS NULL OR ${t.expiresAt} >= ${t.createdAt}`,
    ),
    check(
      "payment_creation_requests_retention_fields_check",
      sql`(
        ${t.retentionClass} = 'active'
        AND ${t.retentionStartedAt} IS NULL
        AND ${t.retentionExpiresAt} IS NULL
      ) OR (
        ${t.retentionClass} <> 'active'
        AND ${t.retentionStartedAt} IS NOT NULL
        AND ${t.retentionExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "payment_creation_requests_retention_chronology_check",
      sql`${t.retentionExpiresAt} IS NULL OR (
        ${t.retentionStartedAt} IS NOT NULL
        AND ${t.retentionStartedAt} >= ${t.createdAt}
        AND ${t.retentionExpiresAt} >= ${t.retentionStartedAt}
        AND (
          ${t.completedAt} IS NULL
          OR ${t.retentionExpiresAt} >= ${t.completedAt}
        )
        AND (
          ${t.expiresAt} IS NULL
          OR ${t.retentionExpiresAt} >= ${t.expiresAt}
        )
      )`,
    ),
    check(
      "payment_creation_requests_successful_retention_check",
      sql`${t.retentionClass} <> 'successful' OR ${t.retentionExpiresAt} >= ${t.retentionStartedAt} + INTERVAL '90 days'`,
    ),
    check(
      "payment_creation_requests_failed_retention_check",
      sql`${t.retentionClass} <> 'failed' OR ${t.retentionExpiresAt} >= ${t.retentionStartedAt} + INTERVAL '30 days'`,
    ),
    check(
      "payment_creation_requests_reconciliation_retention_check",
      sql`${t.retentionClass} <> 'reconciliation_evidence' OR ${t.retentionExpiresAt} >= ${t.retentionStartedAt} + INTERVAL '180 days'`,
    ),
    check(
      "payment_creation_requests_hold_fields_check",
      sql`(
        ${t.retentionHoldAt} IS NULL
        AND ${t.retentionHoldReason} IS NULL
        AND ${t.retentionHoldCaseId} IS NULL
      ) OR (
        ${t.retentionHoldAt} IS NOT NULL
        AND ${t.retentionHoldReason} IS NOT NULL
        AND ${t.retentionHoldCaseId} IS NOT NULL
      )`,
    ),
    uniqueIndex("payment_creation_requests_idempotency_uq").on(
      t.operation,
      t.idempotencyKeyHashVersion,
      t.idempotencyKeyHash,
    ),
    index("payment_creation_requests_active_fingerprint_idx").on(
      t.principalHmacVersion,
      t.principalHmac,
      t.transactionFingerprint,
      t.createdAt.desc(),
    ),
    index("payment_creation_requests_lease_idx").on(t.state, t.leaseExpiresAt),
    index("payment_creation_requests_retention_idx").on(
      t.retentionClass,
      t.retentionExpiresAt,
    ),
    index("payment_creation_requests_hold_idx")
      .on(t.retentionHoldAt)
      .where(sql`${t.retentionHoldAt} IS NOT NULL`),
  ],
);

export const paymentCreationRequestsRelations = relations(
  paymentCreationRequestsTable,
  ({ one }) => ({
    station: one(stationsTable, {
      fields: [paymentCreationRequestsTable.stationId],
      references: [stationsTable.id],
    }),
    supersedesRequest: one(paymentCreationRequestsTable, {
      fields: [paymentCreationRequestsTable.supersedesRequestId],
      references: [paymentCreationRequestsTable.id],
      relationName: "paymentRequestSupersedes",
    }),
    supersededByRequest: one(paymentCreationRequestsTable, {
      fields: [paymentCreationRequestsTable.supersededByRequestId],
      references: [paymentCreationRequestsTable.id],
      relationName: "paymentRequestSupersededBy",
    }),
  }),
);

export type PaymentCreationRequest =
  typeof paymentCreationRequestsTable.$inferSelect;
export type InsertPaymentCreationRequest =
  typeof paymentCreationRequestsTable.$inferInsert;
