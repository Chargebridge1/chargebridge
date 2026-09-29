import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const stripeEventsTable = pgTable("stripe_events", {
  id: serial("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

export type StripeEvent = typeof stripeEventsTable.$inferSelect;
