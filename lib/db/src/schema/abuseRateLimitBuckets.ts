import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { rateLimitSubjectTypeEnum } from "./phase1bEnums";

export const abuseRateLimitBucketsTable = pgTable(
  "abuse_rate_limit_buckets",
  {
    action: text("action").notNull(),
    subjectType: rateLimitSubjectTypeEnum("subject_type").notNull(),
    subjectHmac: text("subject_hmac").notNull(),
    keyVersion: integer("key_version").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    count: integer("count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "abuse_rate_limit_buckets_pk",
      columns: [
        t.action,
        t.subjectType,
        t.subjectHmac,
        t.keyVersion,
        t.windowStartedAt,
        t.windowSeconds,
      ],
    }),
    check(
      "abuse_rate_limit_buckets_key_version_check",
      sql`${t.keyVersion} > 0`,
    ),
    check(
      "abuse_rate_limit_buckets_window_seconds_check",
      sql`${t.windowSeconds} > 0`,
    ),
    check("abuse_rate_limit_buckets_count_check", sql`${t.count} >= 0`),
    check(
      "abuse_rate_limit_buckets_expiry_check",
      sql`${t.expiresAt} > ${t.windowStartedAt}`,
    ),
    check(
      "abuse_rate_limit_buckets_seen_order_check",
      sql`${t.lastSeenAt} >= ${t.firstSeenAt}`,
    ),
    index("abuse_rate_limit_buckets_expiry_idx").on(t.expiresAt),
    index("abuse_rate_limit_buckets_action_recent_idx").on(
      t.action,
      t.subjectType,
      t.lastSeenAt.desc(),
    ),
  ],
);

export type AbuseRateLimitBucket =
  typeof abuseRateLimitBucketsTable.$inferSelect;
export type InsertAbuseRateLimitBucket =
  typeof abuseRateLimitBucketsTable.$inferInsert;
