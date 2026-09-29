import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const stripeRefundJobsTable = pgTable(
  "stripe_refund_jobs",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    paymentIntentId: text("payment_intent_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    reason: text("reason").notNull(),
    // "refund"     — PI is known to have succeeded; issue a full refund
    // "reconcile"  — PI state is unknown (Stripe was unavailable); re-fetch and
    //                then cancel (if uncaptured) or refund (if succeeded)
    jobType: text("job_type").notNull().default("refund"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stripe_refund_jobs_due_idx")
      .using("btree", t.nextRetryAt.asc().nullsLast())
      .where(sql`${t.succeededAt} IS NULL`)
      .concurrently(),
  ],
);

export type StripeRefundJob = typeof stripeRefundJobsTable.$inferSelect;
export type InsertStripeRefundJob = typeof stripeRefundJobsTable.$inferInsert;
