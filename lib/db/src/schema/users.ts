import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  real,
  jsonb,
} from "drizzle-orm/pg-core";

export type UserPreferences = {
  distanceUnit?: "mi" | "km";
  theme?: "light" | "dark" | "system";
  providerFilter?: string;
  defaultMap?: "chargebridge" | "apple_maps" | "google_maps" | "waze";
};

export const usersTable = pgTable(
  "users",
  {
    clerkId: text("clerk_id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleYear: text("vehicle_year"),
    connectorType: text("connector_type"),
    batteryKwh: real("battery_kwh"),
    rangePerCharge: real("range_per_charge"),
    fuelType: text("fuel_type"),
    mpg: real("mpg"),
    preferences: jsonb("preferences").$type<UserPreferences>().default({}),
  },
  (t) => [
    index("users_stripe_customer_idx")
      .using("btree", t.stripeCustomerId.asc().nullsLast())
      .where(sql`${t.stripeCustomerId} IS NOT NULL`)
      .concurrently(),
  ],
);

export type User = typeof usersTable.$inferSelect;
