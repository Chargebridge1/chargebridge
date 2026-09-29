import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const ocpiPartiesTable = pgTable("ocpi_parties", {
  id: serial("id").primaryKey(),
  countryCode: text("country_code").notNull(),
  partyId: text("party_id").notNull(),
  role: text("role").notNull(),
  businessDetails: jsonb("business_details").$type<{
    name: string;
    website?: string;
    logo?: { url: string; category: string; type: string };
  }>(),
  inboundToken: text("inbound_token").notNull().unique(),
  outboundToken: text("outbound_token"),
  versionsUrl: text("versions_url"),
  moduleUrls: jsonb("module_urls").$type<Record<string, string>>(),
  status: text("status").notNull().default("PLANNED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OcpiParty = typeof ocpiPartiesTable.$inferSelect;
export type InsertOcpiParty = typeof ocpiPartiesTable.$inferInsert;
