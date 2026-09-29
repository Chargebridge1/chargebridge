import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const reviewerAccessTable = pgTable("reviewer_access", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  grantedBy: text("granted_by").notNull(),
  grantedByName: text("granted_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ReviewerAccess = typeof reviewerAccessTable.$inferSelect;
