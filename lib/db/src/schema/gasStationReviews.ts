import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gasStationReviewsTable = pgTable(
  "gas_station_reviews",
  {
    id: serial("id").primaryKey(),
    osmId: text("osm_id").notNull(),
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("gas_station_reviews_osm_id_idx").on(t.osmId)]
);

export const insertGasStationReviewSchema = createInsertSchema(
  gasStationReviewsTable
).omit({ id: true, createdAt: true });

export type InsertGasStationReview = z.infer<typeof insertGasStationReviewSchema>;
export type GasStationReview = typeof gasStationReviewsTable.$inferSelect;
