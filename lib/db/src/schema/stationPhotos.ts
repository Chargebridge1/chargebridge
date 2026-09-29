import { pgTable, serial, text, timestamp, integer, real } from "drizzle-orm/pg-core";
import { stationsTable } from "./stations";

export const stationPhotosTable = pgTable("station_photos", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => stationsTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id").notNull(),
  photoUrl: text("photo_url").notNull(),
  caption: text("caption"),
  photoType: text("photo_type").notNull().default("station"),
  businessName: text("business_name"),
  businessLat: real("business_lat"),
  businessLng: real("business_lng"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StationPhoto = typeof stationPhotosTable.$inferSelect;
export type InsertStationPhoto = typeof stationPhotosTable.$inferInsert;
