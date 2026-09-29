import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { stationsTable } from "./stations";

export const stationCheckinsTable = pgTable("station_checkins", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => stationsTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id").notNull(),
  portNumber: integer("port_number"),
  checkedInAt: timestamp("checked_in_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
});

export type StationCheckin = typeof stationCheckinsTable.$inferSelect;
export type InsertStationCheckin = typeof stationCheckinsTable.$inferInsert;
