import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const chargingHistoryTable = pgTable("charging_history", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  stationId: text("station_id"),
  stationName: text("station_name").notNull(),
  stationAddress: text("station_address"),
  chargerType: text("charger_type"),
  kwh: real("kwh"),
  amountCents: integer("amount_cents"),
  currency: text("currency").default("usd"),
  chargedAt: timestamp("charged_at").notNull().defaultNow(),
});

export type ChargingHistory = typeof chargingHistoryTable.$inferSelect;
