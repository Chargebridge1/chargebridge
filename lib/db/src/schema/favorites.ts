import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { stationsTable } from "./stations";

export const favoritesTable = pgTable("favorites", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").references(() => stationsTable.id, { onDelete: "cascade" }),
  externalStationId: text("external_station_id"),
  externalStationData: jsonb("external_station_data"),
  clerkUserId: text("clerk_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFavoriteSchema = createInsertSchema(favoritesTable).omit({ id: true, createdAt: true });
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;
export type Favorite = typeof favoritesTable.$inferSelect;
