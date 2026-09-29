import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { stripeEventsTable } from "./stripeEvents";
import { usersTable } from "./users";

export type SubscriptionReconciliationItem = {
  stripeItemId: string | null;
  priceId: string | null;
  quantity: number | null;
};

export type SubscriptionReconciliationSnapshot = {
  objectType: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean | null;
  cancelAt: number | null;
  canceledAt: number | null;
  currentPeriodEnd: number | null;
  trialEnd: number | null;
  latestInvoiceId: string | null;
};

/**
 * Append-only evidence for every accepted Stripe subscription lifecycle event.
 *
 * These rows are intentionally not entitlement commands. Unknown ownership,
 * Price, checkout-operation association, and event ordering remain visible for
 * reconciliation; application code never grants or revokes access from them.
 */
export const subscriptionReconciliationEventsTable = pgTable(
  "subscription_reconciliation_events",
  {
    stripeEventId: text("stripe_event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    eventLivemode: boolean("event_livemode"),
    eventCreatedAt: timestamp("event_created_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    ownerClerkId: text("owner_clerk_id"),
    ownerMatchCount: integer("owner_match_count").notNull(),
    subscriptionStatus: text("subscription_status"),
    approvedPlan: text("approved_plan"),
    priceIds: jsonb("price_ids").$type<Array<string | null>>().notNull(),
    items: jsonb("items")
      .$type<SubscriptionReconciliationItem[]>()
      .notNull(),
    snapshot: jsonb("snapshot")
      .$type<SubscriptionReconciliationSnapshot>()
      .notNull(),
    operationAssociationStatus: text("operation_association_status")
      .notNull()
      .default("not_verified"),
    previousEventCreatedAt: timestamp("previous_event_created_at", {
      withTimezone: true,
    }),
    outOfOrder: boolean("out_of_order").notNull().default(false),
    disposition: text("disposition").notNull(),
    reconciliationReasons: jsonb("reconciliation_reasons")
      .$type<string[]>()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "subscription_reconciliation_events_stripe_event_fk",
      columns: [t.stripeEventId],
      foreignColumns: [stripeEventsTable.stripeEventId],
    }).onDelete("restrict"),
    foreignKey({
      name: "subscription_reconciliation_events_owner_fk",
      columns: [t.ownerClerkId],
      foreignColumns: [usersTable.clerkId],
    }).onDelete("restrict"),
    check(
      "subscription_reconciliation_events_event_type_check",
      sql`${t.eventType} LIKE 'customer.subscription.%'`,
    ),
    check(
      "subscription_reconciliation_events_owner_count_check",
      sql`${t.ownerMatchCount} >= 0`,
    ),
    check(
      "subscription_reconciliation_events_plan_check",
      sql`${t.approvedPlan} IS NULL OR ${t.approvedPlan} IN ('driver', 'family', 'fleet')`,
    ),
    check(
      "subscription_reconciliation_events_operation_association_check",
      sql`${t.operationAssociationStatus} = 'not_verified'`,
    ),
    index("subscription_reconciliation_events_subscription_order_idx").on(
      t.stripeSubscriptionId,
      t.eventCreatedAt.desc(),
      t.receivedAt.desc(),
    ),
    index("subscription_reconciliation_events_disposition_idx").on(
      t.disposition,
      t.receivedAt.desc(),
    ),
  ],
);

export type SubscriptionReconciliationEvent =
  typeof subscriptionReconciliationEventsTable.$inferSelect;
export type InsertSubscriptionReconciliationEvent =
  typeof subscriptionReconciliationEventsTable.$inferInsert;