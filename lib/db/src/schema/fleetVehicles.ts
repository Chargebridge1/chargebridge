import { pgTable, serial, text, timestamp, integer, real, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const vehicleStatusEnum = pgEnum("vehicle_status", ["active", "inactive"]);

export const fleetVehiclesTable = pgTable("fleet_vehicles", {
  id: serial("id").primaryKey(),
  ownerClerkId: text("owner_clerk_id")
    .notNull()
    .references(() => usersTable.clerkId, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(
    () => organizationsTable.id,
    { onDelete: "cascade" }
  ),
  nickname: text("nickname").notNull(),
  make: text("make"),
  model: text("model"),
  year: text("year"),
  licensePlate: text("license_plate"),
  vin: text("vin"),
  color: text("color"),
  department: text("department"),
  batteryKwh: real("battery_kwh"),
  rangePerCharge: real("range_per_charge"),
  connectorType: text("connector_type"),
  status: vehicleStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const fleetDriverAssignmentsTable = pgTable("fleet_driver_assignments", {
  id: serial("id").primaryKey(),
  vehicleId: serial("vehicle_id")
    .notNull()
    .references(() => fleetVehiclesTable.id, { onDelete: "cascade" }),
  driverEmail: text("driver_email").notNull(),
  driverName: text("driver_name"),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
});

export const fleetVehiclesRelations = relations(
  fleetVehiclesTable,
  ({ one }) => ({
    owner: one(usersTable, {
      fields: [fleetVehiclesTable.ownerClerkId],
      references: [usersTable.clerkId],
    }),
    organization: one(organizationsTable, {
      fields: [fleetVehiclesTable.organizationId],
      references: [organizationsTable.id],
    }),
    driver: one(fleetDriverAssignmentsTable, {
      fields: [fleetVehiclesTable.id],
      references: [fleetDriverAssignmentsTable.vehicleId],
    }),
  })
);

export const fleetDriverAssignmentsRelations = relations(
  fleetDriverAssignmentsTable,
  ({ one }) => ({
    vehicle: one(fleetVehiclesTable, {
      fields: [fleetDriverAssignmentsTable.vehicleId],
      references: [fleetVehiclesTable.id],
    }),
  })
);

export type FleetVehicle = typeof fleetVehiclesTable.$inferSelect;
export type InsertFleetVehicle = typeof fleetVehiclesTable.$inferInsert;
export type FleetDriverAssignment = typeof fleetDriverAssignmentsTable.$inferSelect;
