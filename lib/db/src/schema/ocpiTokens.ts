import { pgTable, serial, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";

export const ocpiTokensTable = pgTable("ocpi_tokens", {
  id: serial("id").primaryKey(),
  countryCode: text("country_code").notNull(),
  partyId: text("party_id").notNull(),
  uid: text("uid").notNull(),
  type: text("type").notNull().default("RFID"),
  contractId: text("contract_id").notNull(),
  visualNumber: text("visual_number"),
  issuer: text("issuer").notNull(),
  groupId: text("group_id"),
  valid: boolean("valid").notNull().default(true),
  whitelist: text("whitelist").notNull().default("ALLOWED"),
  language: text("language"),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
}, (t) => [
  unique("ocpi_tokens_uid_unique").on(t.countryCode, t.partyId, t.uid),
]);

export type OcpiToken = typeof ocpiTokensTable.$inferSelect;
export type InsertOcpiToken = typeof ocpiTokensTable.$inferInsert;
