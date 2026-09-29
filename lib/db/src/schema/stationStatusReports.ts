import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const stationStatusReportsTable = pgTable("station_status_reports", {
  id: serial("id").primaryKey(),
  stationId: text("station_id").notNull(),
  reportType: text("report_type").notNull(),
  clerkUserId: text("clerk_user_id"),
  confirmations: integer("confirmations").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StationStatusReport = typeof stationStatusReportsTable.$inferSelect;
export type InsertStationStatusReport = typeof stationStatusReportsTable.$inferInsert;
