import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const paymentProtocolObservationsTable = pgTable(
  "payment_protocol_observations",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    installationHmac: text("installation_hmac").notNull(),
    installationHmacVersion: integer("installation_hmac_version").notNull(),
    platform: text("platform").notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    appVersion: text("app_version"),
    nativeBuild: text("native_build"),
    runtimeVersion: text("runtime_version"),
    otaUpdateId: text("ota_update_id"),
    isEmbedded: boolean("is_embedded"),
    eventType: text("event_type").notNull(),
    resultCategory: text("result_category"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "payment_protocol_observations_hmac_version_check",
      sql`${t.installationHmacVersion} > 0`,
    ),
    check(
      "payment_protocol_observations_platform_check",
      sql`${t.platform} IN ('ios', 'android', 'web')`,
    ),
    check(
      "payment_protocol_observations_protocol_check",
      sql`${t.protocolVersion} > 0`,
    ),
    check(
      "payment_protocol_observations_expiry_check",
      sql`${t.expiresAt} > ${t.observedAt}`,
    ),
    index("payment_protocol_observations_adoption_idx").on(
      t.platform,
      t.protocolVersion,
      t.observedAt.desc(),
    ),
    index("payment_protocol_observations_installation_idx").on(
      t.installationHmacVersion,
      t.installationHmac,
      t.observedAt.desc(),
    ),
    index("payment_protocol_observations_expiry_idx").on(t.expiresAt),
  ],
);

export type PaymentProtocolObservation =
  typeof paymentProtocolObservationsTable.$inferSelect;
export type InsertPaymentProtocolObservation =
  typeof paymentProtocolObservationsTable.$inferInsert;
