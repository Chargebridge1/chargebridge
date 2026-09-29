import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const adminRoleEventsTable = pgTable("admin_role_events", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actorClerkId: text("actor_clerk_id").notNull(),
  actorName: text("actor_name"),
  targetClerkId: text("target_clerk_id").notNull(),
  targetEmail: text("target_email").notNull(),
  targetName: text("target_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminRoleEvent = typeof adminRoleEventsTable.$inferSelect;
