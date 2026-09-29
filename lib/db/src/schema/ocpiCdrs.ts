import { pgTable, serial, text, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { chargingSessionsTable } from "./chargingSessions";

export const ocpiCdrsTable = pgTable("ocpi_cdrs", {
  id: serial("id").primaryKey(),
  cdrId: text("cdr_id").notNull().unique(),
  countryCode: text("country_code").notNull(),
  partyId: text("party_id").notNull(),
  sessionId: integer("session_id").references(() => chargingSessionsTable.id, { onDelete: "set null" }),
  startDateTime: timestamp("start_date_time").notNull(),
  endDateTime: timestamp("end_date_time").notNull(),
  cdrToken: jsonb("cdr_token").notNull().$type<{
    country_code: string; party_id: string; uid: string; type: string; contract_id: string;
  }>(),
  authMethod: text("auth_method").notNull().default("AUTH_REQUEST"),
  locationId: text("location_id").notNull(),
  evseUid: text("evse_uid").notNull(),
  connectorId: text("connector_id").notNull(),
  currency: text("currency").notNull().default("USD"),
  chargingPeriods: jsonb("charging_periods").notNull().$type<unknown[]>().default([]),
  totalCost: jsonb("total_cost").notNull().$type<{ excl_vat: number; incl_vat?: number }>(),
  totalEnergy: real("total_energy").notNull(),
  totalTime: real("total_time").notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type OcpiCdr = typeof ocpiCdrsTable.$inferSelect;
export type InsertOcpiCdr = typeof ocpiCdrsTable.$inferInsert;
