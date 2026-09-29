import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { stationsTable } from "./stations";

export const ocpiTariffsTable = pgTable("ocpi_tariffs", {
  id: serial("id").primaryKey(),
  tariffId: text("tariff_id").notNull().unique(),
  currency: text("currency").notNull().default("USD"),
  type: text("type"),
  elements: jsonb("elements").notNull().$type<Array<{
    price_components: Array<{ type: string; price: number; vat?: number; step_size: number }>;
    restrictions?: Record<string, unknown>;
  }>>(),
  stationId: integer("station_id").references(() => stationsTable.id, { onDelete: "set null" }),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

export type OcpiTariff = typeof ocpiTariffsTable.$inferSelect;
export type InsertOcpiTariff = typeof ocpiTariffsTable.$inferInsert;
