import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const externalStationReviewsTable = pgTable(
  "external_station_reviews",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    authorName: text("author_name").notNull(),
    clerkUserId: text("clerk_user_id"),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("external_station_reviews_external_id_idx").on(t.externalId)]
);

export const insertExternalReviewSchema = createInsertSchema(
  externalStationReviewsTable
).omit({ id: true, createdAt: true });

export type InsertExternalReview = z.infer<typeof insertExternalReviewSchema>;
export type ExternalReview = typeof externalStationReviewsTable.$inferSelect;
