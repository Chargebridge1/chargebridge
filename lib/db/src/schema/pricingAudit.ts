import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pricingAuditTable = pgTable("pricing_audit", {
  id: serial("id").primaryKey(),
  changedByClerkId: text("changed_by_clerk_id").notNull(),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  field: text("field").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value").notNull(),
});

export type PricingAudit = typeof pricingAuditTable.$inferSelect;
