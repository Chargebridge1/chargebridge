import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";

export const orgRoleEnum = pgEnum("org_role", [
  "admin",
  "manager",
  "supervisor",
  "driver",
  "analyst",
  "technician",
  "finance",
  "regional_manager",
]);

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  ownerClerkId: text("owner_clerk_id")
    .notNull()
    .references(() => usersTable.clerkId),
  plan: text("plan").notNull().default("fleet"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const orgMembershipsTable = pgTable("org_memberships", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id").references(() => usersTable.clerkId, {
    onDelete: "cascade",
  }),
  email: text("email").notNull(),
  name: text("name"),
  role: orgRoleEnum("role").notNull().default("driver"),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const organizationsRelations = relations(
  organizationsTable,
  ({ many, one }) => ({
    memberships: many(orgMembershipsTable),
    owner: one(usersTable, {
      fields: [organizationsTable.ownerClerkId],
      references: [usersTable.clerkId],
    }),
  })
);

export const orgMembershipsRelations = relations(
  orgMembershipsTable,
  ({ one }) => ({
    org: one(organizationsTable, {
      fields: [orgMembershipsTable.orgId],
      references: [organizationsTable.id],
    }),
  })
);

export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = typeof organizationsTable.$inferInsert;
export type OrgMembership = typeof orgMembershipsTable.$inferSelect;
export type InsertOrgMembership = typeof orgMembershipsTable.$inferInsert;
export type OrgRole =
  | "admin"
  | "manager"
  | "supervisor"
  | "driver"
  | "analyst"
  | "technician"
  | "finance"
  | "regional_manager";
