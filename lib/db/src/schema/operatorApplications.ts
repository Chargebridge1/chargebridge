import { pgTable, serial, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const operatorAppStatusEnum = pgEnum("operator_app_status", ["pending", "reviewing", "approved", "rejected"]);

export const operatorApplicationsTable = pgTable("operator_applications", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  chargerBrand: text("charger_brand").notNull(),
  chargerModel: text("charger_model"),
  ocppVersion: text("ocpp_version"),
  currentNetwork: text("current_network"),
  stationCount: text("station_count"),
  locations: text("locations"),
  notes: text("notes"),
  status: operatorAppStatusEnum("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type OperatorApplication = typeof operatorApplicationsTable.$inferSelect;
