import { pgTable, serial, text, real, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chargerTypeEnum = pgEnum("charger_type", ["Level1", "Level2", "DCFC"]);
export const stationStatusEnum = pgEnum("station_status", ["available", "busy", "offline", "pending", "removed"]);

export const stationsTable = pgTable("stations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  country: text("country").notNull().default("United States"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  chargerType: chargerTypeEnum("charger_type").notNull(),
  powerKw: real("power_kw").notNull(),
  pricePerKwh: real("price_per_kwh").notNull(),
  totalPorts: integer("total_ports").notNull().default(1),
  availablePorts: integer("available_ports").notNull().default(1),
  status: stationStatusEnum("status").notNull().default("pending"),
  description: text("description"),
  network: text("network"),
  photoUrl: text("photo_url"),
  ocppChargePointId: text("ocpp_charge_point_id"),
  ocppPassword: text("ocpp_password"),
  ownerClerkUserId: text("owner_clerk_user_id"),
  cpoOrgId: integer("cpo_org_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStationSchema = createInsertSchema(stationsTable).omit({ id: true, createdAt: true });
export type InsertStation = z.infer<typeof insertStationSchema>;
export type Station = typeof stationsTable.$inferSelect;
