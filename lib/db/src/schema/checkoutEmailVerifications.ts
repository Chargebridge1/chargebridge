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
import {
  checkoutVerificationStatusEnum,
  paymentRequestOperationEnum,
} from "./phase1bEnums";
import { paymentCreationRequestsTable } from "./paymentCreationRequests";

export const checkoutEmailVerificationsTable = pgTable(
  "checkout_email_verifications",
  {
    id: uuid("id").primaryKey(),
    purpose: paymentRequestOperationEnum("purpose").notNull(),
    emailHmac: text("email_hmac").notNull(),
    emailHmacVersion: integer("email_hmac_version").notNull(),
    purchaseDraftHash: text("purchase_draft_hash").notNull(),
    purchaseDraftHashVersion: integer("purchase_draft_hash_version").notNull(),
    otpHash: text("otp_hash").notNull(),
    otpHashVersion: integer("otp_hash_version").notNull(),
    status: checkoutVerificationStatusEnum("status")
      .notNull()
      .default("pending"),
    sendCount: integer("send_count").notNull().default(1),
    failedAttemptCount: integer("failed_attempt_count").notNull().default(0),
    lastDeliveryState: text("last_delivery_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    grantHash: text("grant_hash"),
    grantHashVersion: integer("grant_hash_version"),
    grantExpiresAt: timestamp("grant_expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByRequestId: uuid("consumed_by_request_id"),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "checkout_email_verifications_consumed_request_fk",
      columns: [t.consumedByRequestId],
      foreignColumns: [paymentCreationRequestsTable.id],
    }).onDelete("restrict"),
    check(
      "checkout_email_verifications_email_hmac_version_check",
      sql`${t.emailHmacVersion} > 0`,
    ),
    check(
      "checkout_email_verifications_purchase_hash_version_check",
      sql`${t.purchaseDraftHashVersion} > 0`,
    ),
    check(
      "checkout_email_verifications_otp_hash_version_check",
      sql`${t.otpHashVersion} > 0`,
    ),
    check(
      "checkout_email_verifications_grant_hash_version_check",
      sql`${t.grantHashVersion} IS NULL OR ${t.grantHashVersion} > 0`,
    ),
    check(
      "checkout_email_verifications_send_count_check",
      sql`${t.sendCount} >= 1`,
    ),
    check(
      "checkout_email_verifications_failed_attempt_count_check",
      sql`${t.failedAttemptCount} >= 0`,
    ),
    check(
      "checkout_email_verifications_delivery_state_check",
      sql`${t.lastDeliveryState} IN ('accepted', 'failed', 'unknown')`,
    ),
    check(
      "checkout_email_verifications_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      "checkout_email_verifications_last_delivery_check",
      sql`${t.lastDeliveryAt} >= ${t.createdAt}`,
    ),
    check(
      "checkout_email_verifications_verified_chronology_check",
      sql`${t.verifiedAt} IS NULL OR ${t.verifiedAt} >= ${t.createdAt}`,
    ),
    check(
      "checkout_email_verifications_locked_chronology_check",
      sql`${t.lockedAt} IS NULL OR ${t.lockedAt} >= ${t.createdAt}`,
    ),
    check(
      "checkout_email_verifications_grant_chronology_check",
      sql`${t.grantExpiresAt} IS NULL OR (
        ${t.verifiedAt} IS NOT NULL
        AND ${t.grantExpiresAt} > ${t.verifiedAt}
      )`,
    ),
    check(
      "checkout_email_verifications_consumed_chronology_check",
      sql`${t.consumedAt} IS NULL OR (
        ${t.verifiedAt} IS NOT NULL
        AND ${t.consumedAt} >= ${t.verifiedAt}
      )`,
    ),
    check(
      "checkout_email_verifications_retention_check",
      sql`${t.retentionExpiresAt} >= ${t.expiresAt}
      AND (
        ${t.grantExpiresAt} IS NULL
        OR ${t.retentionExpiresAt} >= ${t.grantExpiresAt}
      )
      AND (
        ${t.consumedAt} IS NULL
        OR ${t.retentionExpiresAt} >= ${t.consumedAt}
      )`,
    ),
    check(
      "checkout_email_verifications_pending_check",
      sql`${t.status} <> 'pending' OR (
        ${t.verifiedAt} IS NULL
        AND ${t.lockedAt} IS NULL
        AND ${t.consumedAt} IS NULL
        AND ${t.consumedByRequestId} IS NULL
      )`,
    ),
    check(
      "checkout_email_verifications_verified_check",
      sql`${t.status} <> 'verified' OR (
        ${t.verifiedAt} IS NOT NULL
        AND ${t.grantHash} IS NOT NULL
        AND ${t.grantHashVersion} IS NOT NULL
        AND ${t.grantExpiresAt} IS NOT NULL
        AND ${t.consumedAt} IS NULL
        AND ${t.consumedByRequestId} IS NULL
      )`,
    ),
    check(
      "checkout_email_verifications_locked_check",
      sql`${t.status} <> 'locked' OR ${t.lockedAt} IS NOT NULL`,
    ),
    check(
      "checkout_email_verifications_consumed_check",
      sql`${t.status} <> 'consumed' OR (
        ${t.verifiedAt} IS NOT NULL
        AND ${t.grantHash} IS NOT NULL
        AND ${t.grantHashVersion} IS NOT NULL
        AND ${t.grantExpiresAt} IS NOT NULL
        AND ${t.consumedAt} IS NOT NULL
        AND ${t.consumedByRequestId} IS NOT NULL
      )`,
    ),
    check(
      "checkout_email_verifications_grant_fields_check",
      sql`(
        ${t.grantHash} IS NULL
        AND ${t.grantHashVersion} IS NULL
        AND ${t.grantExpiresAt} IS NULL
      ) OR (
        ${t.grantHash} IS NOT NULL
        AND ${t.grantHashVersion} IS NOT NULL
        AND ${t.grantExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "checkout_email_verifications_consumption_fields_check",
      sql`(
        ${t.consumedAt} IS NULL
        AND ${t.consumedByRequestId} IS NULL
      ) OR (
        ${t.consumedAt} IS NOT NULL
        AND ${t.consumedByRequestId} IS NOT NULL
      )`,
    ),
    uniqueIndex("checkout_email_verifications_grant_hash_uq")
      .on(t.grantHashVersion, t.grantHash)
      .where(sql`${t.grantHash} IS NOT NULL`),
    index("checkout_email_verifications_expiry_idx").on(t.expiresAt),
    index("checkout_email_verifications_email_recent_idx").on(
      t.emailHmacVersion,
      t.emailHmac,
      t.createdAt.desc(),
    ),
    index("checkout_email_verifications_status_expiry_idx").on(
      t.status,
      t.expiresAt,
    ),
    index("checkout_email_verifications_retention_idx").on(
      t.retentionExpiresAt,
    ),
  ],
);

export const checkoutEmailVerificationsRelations = relations(
  checkoutEmailVerificationsTable,
  ({ one }) => ({
    consumedByRequest: one(paymentCreationRequestsTable, {
      fields: [checkoutEmailVerificationsTable.consumedByRequestId],
      references: [paymentCreationRequestsTable.id],
    }),
  }),
);

export type CheckoutEmailVerification =
  typeof checkoutEmailVerificationsTable.$inferSelect;
export type InsertCheckoutEmailVerification =
  typeof checkoutEmailVerificationsTable.$inferInsert;
