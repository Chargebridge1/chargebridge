import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export type ProfileChangeEntry = {
  action: "added" | "updated" | "removed";
  label: string;
};

export const profileChangelogTable = pgTable("profile_changelog", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  deviceId: text("device_id").notNull(),
  deviceType: text("device_type").notNull(),
  fieldGroup: text("field_group").notNull(),
  changeSummary: jsonb("change_summary").$type<ProfileChangeEntry>().notNull(),
});
