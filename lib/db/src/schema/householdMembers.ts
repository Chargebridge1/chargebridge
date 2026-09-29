import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const householdMembersTable = pgTable("household_members", {
  id: serial("id").primaryKey(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  memberEmail: text("member_email").notNull(),
  memberClerkId: text("member_clerk_id"),
  status: text("status").notNull().default("pending"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHouseholdMemberSchema = createInsertSchema(householdMembersTable).omit({ id: true, invitedAt: true });
export type InsertHouseholdMember = z.infer<typeof insertHouseholdMemberSchema>;
export type HouseholdMember = typeof householdMembersTable.$inferSelect;
