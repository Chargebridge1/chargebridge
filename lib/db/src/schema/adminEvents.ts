import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const adminEventsTable = pgTable("admin_events", {
  id: serial("id").primaryKey(),
  adminClerkId: text("admin_clerk_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  targetName: text("target_name"),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminEvent = typeof adminEventsTable.$inferSelect;
