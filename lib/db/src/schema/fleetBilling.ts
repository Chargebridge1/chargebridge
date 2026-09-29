import { relations, sql } from "drizzle-orm";
import {
  check,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const fleetBillingAccountStateEnum = pgEnum(
  "fleet_billing_account_state",
  ["pending", "active", "reconciling", "cancellation_pending", "canceled", "manual_review"],
);

export const fleetQuantityOperationTypeEnum = pgEnum(
  "fleet_quantity_operation_type",
  ["quantity_change", "final_vehicle_transition"],
);

export const fleetQuantityOperationStateEnum = pgEnum(
  "fleet_quantity_operation_state",
  [
    "reserved",
    "processing",
    "stripe_succeeded",
    "completed",
    "retryable_failure",
    "reconciling",
    "terminal_failure",
    "cancelled",
    "manual_review",
  ],
);

/**
 * One auditable Fleet billing owner per organization. The row must only become
 * active after the Stripe customer, subscription, and catalog Price have been
 * independently verified.
 */
export const fleetBillingAccountsTable = pgTable(
  "fleet_billing_accounts",
  {
    id: uuid("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    billingOwnerClerkId: text("billing_owner_clerk_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
    state: fleetBillingAccountStateEnum("state").notNull().default("pending"),
    currentQuantity: integer("current_quantity").notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    stripeSubscriptionStatus: text("stripe_subscription_status"),
    reconciliationReason: text("reconciliation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fleet_billing_accounts_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizationsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fleet_billing_accounts_billing_owner_clerk_id_fkey",
      columns: [t.billingOwnerClerkId],
      foreignColumns: [usersTable.clerkId],
    }).onDelete("restrict"),
    check(
      "fleet_billing_accounts_quantity_check",
      sql`${t.currentQuantity} > 0`,
    ),
    check(
      "fleet_billing_accounts_verified_state_check",
      sql`${t.state} <> 'active' OR (
        ${t.lastVerifiedAt} IS NOT NULL
        AND ${t.stripeSubscriptionStatus} IS NOT NULL
        AND ${t.stripeSubscriptionStatus} IN ('active', 'trialing')
        AND ${t.reconciliationReason} IS NULL
      )`,
    ),
    check(
      "fleet_billing_accounts_reconciliation_state_check",
      sql`${t.state} NOT IN ('reconciling', 'manual_review')
        OR ${t.reconciliationReason} IS NOT NULL`,
    ),
    unique("fleet_billing_accounts_org_uq").on(t.organizationId),
    unique("fleet_billing_accounts_subscription_uq").on(t.stripeSubscriptionId),
    index("fleet_billing_accounts_owner_idx").on(t.billingOwnerClerkId),
    index("fleet_billing_accounts_state_idx").on(t.state, t.updatedAt.desc()),
  ],
);

/**
 * Durable operation log, separate from the account's current quantity. A
 * partial unique index permits only one unresolved change per subscription;
 * the server-generated operation UUID is the Stripe idempotency-key source.
 */
export const fleetQuantityOperationsTable = pgTable(
  "fleet_quantity_operations",
  {
    id: uuid("id").primaryKey(),
    billingAccountId: uuid("billing_account_id").notNull(),
    organizationId: integer("organization_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
    operationType: fleetQuantityOperationTypeEnum("operation_type").notNull(),
    fromQuantity: integer("from_quantity").notNull(),
    // NULL is only used for the explicit final-vehicle cancellation/transition;
    // a Stripe quantity is never updated to zero.
    targetQuantity: integer("target_quantity"),
    prorationBehavior: text("proration_behavior").notNull().default("create_prorations"),
    applyImmediately: boolean("apply_immediately").notNull().default(true),
    requestHash: text("request_hash").notNull(),
    stripeIdempotencyKeyRef: text("stripe_idempotency_key_ref").notNull(),
    state: fleetQuantityOperationStateEnum("state").notNull().default("reserved"),
    stripeRequestId: text("stripe_request_id"),
    stripeEventId: text("stripe_event_id"),
    stripeResultStatus: text("stripe_result_status"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseOwner: uuid("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCategory: text("last_error_category"),
    reconciliationReason: text("reconciliation_reason"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "fleet_quantity_operations_billing_account_id_fkey",
      columns: [t.billingAccountId],
      foreignColumns: [fleetBillingAccountsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fleet_quantity_operations_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizationsTable.id],
    }).onDelete("restrict"),
    check(
      "fleet_quantity_operations_from_quantity_check",
      sql`${t.fromQuantity} > 0`,
    ),
    check(
      "fleet_quantity_operations_target_quantity_check",
      sql`(
        ${t.operationType} = 'quantity_change'
        AND ${t.targetQuantity} IS NOT NULL
        AND ${t.targetQuantity} > 0
        AND ${t.targetQuantity} <> ${t.fromQuantity}
      ) OR (
        ${t.operationType} = 'final_vehicle_transition'
        AND ${t.targetQuantity} IS NULL
      )`,
    ),
    check(
      "fleet_quantity_operations_proration_check",
      sql`${t.prorationBehavior} = 'create_prorations'`,
    ),
    check(
      "fleet_quantity_operations_apply_immediately_check",
      sql`${t.applyImmediately} = true`,
    ),
    check(
      "fleet_quantity_operations_attempt_count_check",
      sql`${t.attemptCount} >= 0`,
    ),
    check(
      "fleet_quantity_operations_lease_fields_check",
      sql`(
        ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAt} IS NULL
      ) OR (
        ${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "fleet_quantity_operations_reconciliation_check",
      sql`${t.state} NOT IN ('reconciling', 'manual_review')
        OR ${t.reconciliationReason} IS NOT NULL`,
    ),
    check(
      "fleet_quantity_operations_completed_check",
      sql`${t.state} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
    unique("fleet_quantity_operations_idempotency_ref_uq").on(
      t.stripeIdempotencyKeyRef,
    ),
    index("fleet_quantity_operations_account_created_idx").on(
      t.billingAccountId,
      t.createdAt.desc(),
    ),
    index("fleet_quantity_operations_subscription_state_idx").on(
      t.stripeSubscriptionId,
      t.state,
      t.createdAt.desc(),
    ),
    uniqueIndex("fleet_quantity_operations_one_unresolved_per_subscription_uq")
      .on(t.stripeSubscriptionId)
      .where(
        sql`${t.state} IN ('reserved', 'processing', 'stripe_succeeded', 'reconciling', 'manual_review')`,
      ),
  ],
);

export const fleetBillingAccountsRelations = relations(
  fleetBillingAccountsTable,
  ({ one, many }) => ({
    organization: one(organizationsTable, {
      fields: [fleetBillingAccountsTable.organizationId],
      references: [organizationsTable.id],
    }),
    owner: one(usersTable, {
      fields: [fleetBillingAccountsTable.billingOwnerClerkId],
      references: [usersTable.clerkId],
    }),
    operations: many(fleetQuantityOperationsTable),
  }),
);

export const fleetQuantityOperationsRelations = relations(
  fleetQuantityOperationsTable,
  ({ one }) => ({
    billingAccount: one(fleetBillingAccountsTable, {
      fields: [fleetQuantityOperationsTable.billingAccountId],
      references: [fleetBillingAccountsTable.id],
    }),
    organization: one(organizationsTable, {
      fields: [fleetQuantityOperationsTable.organizationId],
      references: [organizationsTable.id],
    }),
  }),
);

export type FleetBillingAccount = typeof fleetBillingAccountsTable.$inferSelect;
export type InsertFleetBillingAccount =
  typeof fleetBillingAccountsTable.$inferInsert;
export type FleetQuantityOperation =
  typeof fleetQuantityOperationsTable.$inferSelect;
export type InsertFleetQuantityOperation =
  typeof fleetQuantityOperationsTable.$inferInsert;