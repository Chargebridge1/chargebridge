import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const stationAlertsTable = pgTable("station_alerts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  stationId: integer("station_id"),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("warning"),
  message: text("message").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StationAlert = typeof stationAlertsTable.$inferSelect;
export type InsertStationAlert = typeof stationAlertsTable.$inferInsert;
