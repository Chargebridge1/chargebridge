import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";

export const savedTripsTable = pgTable("saved_trips", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  name: text("name").notNull(),
  originLabel: text("origin_label").notNull(),
  originLat: real("origin_lat").notNull(),
  originLng: real("origin_lng").notNull(),
  destLabel: text("dest_label").notNull(),
  destLat: real("dest_lat").notNull(),
  destLng: real("dest_lng").notNull(),
  rangeKm: integer("range_km").notNull().default(300),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SavedTrip = typeof savedTripsTable.$inferSelect;
export type InsertSavedTrip = typeof savedTripsTable.$inferInsert;
