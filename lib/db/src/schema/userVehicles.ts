import { pgTable, serial, text, real, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userVehiclesTable = pgTable("user_vehicles", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  nickname: text("nickname"),
  make: text("make"),
  model: text("model"),
  year: text("year"),
  connectorType: text("connector_type"),
  batteryKwh: real("battery_kwh"),
  rangePerCharge: real("range_per_charge"),
  fuelType: text("fuel_type"),
  mpg: real("mpg"),
  isPrimary: boolean("is_primary").notNull().default(false),
  plugTypes: text("plug_types").array(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Nullable link to the vehicle catalog trim (ev_catalog_trims.id).
   *  Set when the user selects a trim from the catalog picker.
   *  Used by /api/stations/match for precise EV charging profile lookup. */
  catalogTrimId: integer("catalog_trim_id"),
});

export const insertUserVehicleSchema = createInsertSchema(userVehiclesTable).omit({ id: true, createdAt: true });
export type InsertUserVehicle = z.infer<typeof insertUserVehicleSchema>;
export type UserVehicle = typeof userVehiclesTable.$inferSelect;
