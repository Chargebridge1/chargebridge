import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";

export const rankingWeightsTable = pgTable("ranking_weights", {
  category: text("category").primaryKey(),
  weight: real("weight").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type RankingWeight = typeof rankingWeightsTable.$inferSelect;
