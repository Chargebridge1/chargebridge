import { pgTable, serial, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const reviewEntityTypeEnum = pgEnum("review_entity_type", ["station", "operator_application"]);
export const reviewActionEnum = pgEnum("review_action", ["approved", "rejected", "reviewing", "pending"]);

export const reviewLogsTable = pgTable("review_logs", {
  id: serial("id").primaryKey(),
  entityType: reviewEntityTypeEnum("entity_type").notNull(),
  entityId: serial("entity_id").notNull(),
  entityName: text("entity_name"),
  adminClerkId: text("admin_clerk_id").notNull(),
  adminName: text("admin_name"),
  action: reviewActionEnum("action").notNull(),
  previousAction: text("previous_action"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ReviewLog = typeof reviewLogsTable.$inferSelect;
