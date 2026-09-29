import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { paymentCreationRequestsTable } from "./paymentCreationRequests";
import { usersTable } from "./users";

export const membershipCheckoutReservationStateEnum = pgEnum(
  "membership_checkout_reservation_state",
  [
    "processing",
    "session_created",
    "reconciling",
    "completed",
    "terminal_failure",
    "expired",
    "manual_review",
  ],
);

export type MembershipCheckoutRequestSnapshot = {
  clerkUserId: string;
  stripeCustomerId: string;
  planId: "driver" | "family" | "fleet";
  stripeProductId: string;
  stripePriceId: string;
  unitAmount: number;
  currency: "usd";
  interval: "month";
  intervalCount: 1;
};

export type MembershipCheckoutReconciliationEvidence = {
  reason: string;
  observedAt: string;
  stripeSessionId?: string;
  stripeSubscriptionId?: string;
  stripeStatus?: string;
  errorCategory?: string;
};

export const membershipCheckoutReservationsTable = pgTable(
  "membership_checkout_reservations",
  {
    id: uuid("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    planId: text("plan_id").notNull(),
    stripeProductId: text("stripe_product_id").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
    unitAmount: integer("unit_amount").notNull(),
    currency: text("currency").notNull(),
    interval: text("billing_interval").notNull(),
    intervalCount: integer("interval_count").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    fingerprintKeyVersion: integer("fingerprint_key_version").notNull(),
    requestSnapshot: jsonb("request_snapshot")
      .$type<MembershipCheckoutRequestSnapshot>()
      .notNull(),
    state: membershipCheckoutReservationStateEnum("state")
      .notNull()
      .default("processing"),
    stripeIdempotencyKey: text("stripe_idempotency_key").notNull(),
    paymentCreationRequestId: uuid("payment_creation_request_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSessionExpiresAt: timestamp("stripe_session_expires_at", {
      withTimezone: true,
    }),
    leaseOwner: uuid("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastErrorCategory: text("last_error_category"),
    reconciliationEvidence:
      jsonb("reconciliation_evidence").$type<
        MembershipCheckoutReconciliationEvidence[]
      >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "membership_checkout_reservations_user_fk",
      columns: [t.clerkUserId],
      foreignColumns: [usersTable.clerkId],
    }).onDelete("restrict"),
    foreignKey({
      name: "membership_checkout_reservations_payment_request_fk",
      columns: [t.paymentCreationRequestId],
      foreignColumns: [paymentCreationRequestsTable.id],
    }).onDelete("restrict"),
    check(
      "membership_checkout_reservations_plan_check",
      sql`${t.planId} IN ('driver', 'family', 'fleet')`,
    ),
    check(
      "membership_checkout_reservations_catalog_check",
      sql`(
          ${t.planId} = 'driver'
          AND ${t.stripeProductId} = 'prod_UXygFuoApjQQVQ'
          AND ${t.stripePriceId} = 'price_1U7jIjDItJjjt34XXl9sC071'
          AND ${t.unitAmount} = 499
        ) OR (
          ${t.planId} = 'family'
          AND ${t.stripeProductId} = 'prod_VJb52POYyOYpQH'
          AND ${t.stripePriceId} = 'price_1UIxt0DItJjjt34XP9YjcDJV'
          AND ${t.unitAmount} = 999
        ) OR (
          ${t.planId} = 'fleet'
          AND ${t.stripeProductId} = 'prod_UXygLCNEL5xuLc'
          AND ${t.stripePriceId} = 'price_1U7jIjDItJjjt34XIIyFnQrH'
          AND ${t.unitAmount} = 1999
        )`,
    ),
    check(
      "membership_checkout_reservations_currency_interval_check",
      sql`${t.currency} = 'usd' AND ${t.interval} = 'month' AND ${t.intervalCount} = 1`,
    ),
    check(
      "membership_checkout_reservations_fingerprint_check",
      sql`length(${t.requestFingerprint}) = 64 AND ${t.fingerprintKeyVersion} > 0`,
    ),
    check(
      "membership_checkout_reservations_idempotency_key_check",
      sql`length(${t.stripeIdempotencyKey}) BETWEEN 1 AND 255`,
    ),
    check(
      "membership_checkout_reservations_stripe_session_check",
      sql`${t.stripeSubscriptionId} IS NULL OR ${t.stripeCheckoutSessionId} IS NOT NULL`,
    ),
    check(
      "membership_checkout_reservations_lease_fields_check",
      sql`(
        ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAt} IS NULL
      ) OR (
        ${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "membership_checkout_reservations_attempt_count_check",
      sql`${t.attemptCount} >= 1`,
    ),
    check(
      "membership_checkout_reservations_chronology_check",
      sql`${t.updatedAt} >= ${t.createdAt}
        AND ${t.expiresAt} >= ${t.createdAt}
        AND ${t.retentionExpiresAt} >= ${t.expiresAt}`,
    ),
    uniqueIndex("membership_checkout_reservations_idempotency_uq").on(
      t.stripeIdempotencyKey,
    ),
    uniqueIndex("membership_checkout_reservations_payment_request_uq")
      .on(t.paymentCreationRequestId)
      .where(sql`${t.paymentCreationRequestId} IS NOT NULL`),
    uniqueIndex("membership_checkout_reservations_session_uq")
      .on(t.stripeCheckoutSessionId)
      .where(sql`${t.stripeCheckoutSessionId} IS NOT NULL`),
    index("membership_checkout_reservations_user_history_idx").on(
      t.clerkUserId,
      t.createdAt.desc(),
    ),
    index("membership_checkout_reservations_reconcile_idx").on(
      t.state,
      t.updatedAt,
    ),
    index("membership_checkout_reservations_retention_idx").on(
      t.retentionExpiresAt,
    ),
    uniqueIndex("membership_checkout_reservations_one_unresolved_per_user_uq")
      .on(t.clerkUserId)
      .where(
        sql`${t.state} IN ('processing', 'session_created', 'reconciling', 'manual_review')`,
      ),
  ],
);

export const membershipCheckoutReservationsRelations = relations(
  membershipCheckoutReservationsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [membershipCheckoutReservationsTable.clerkUserId],
      references: [usersTable.clerkId],
    }),
    paymentCreationRequest: one(paymentCreationRequestsTable, {
      fields: [membershipCheckoutReservationsTable.paymentCreationRequestId],
      references: [paymentCreationRequestsTable.id],
    }),
  }),
);

export type MembershipCheckoutReservation =
  typeof membershipCheckoutReservationsTable.$inferSelect;
export type InsertMembershipCheckoutReservation =
  typeof membershipCheckoutReservationsTable.$inferInsert;