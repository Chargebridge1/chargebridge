import {
  pgTable, serial, text, real, integer, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Legacy flat table (kept for backward-compat / migration fallback) ─────────
export const evCatalogTable = pgTable(
  "ev_catalog",
  {
    id: serial("id").primaryKey(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    yearFrom: integer("year_from"),
    yearTo: integer("year_to"),
    yearDisplay: text("year_display").notNull(),
    trim: text("trim"),
    fuelCategory: text("fuel_category").notNull(),
    dcConnector: text("dc_connector"),
    acConnector: text("ac_connector"),
    batteryKwh: real("battery_kwh"),
    acMaxKw: real("ac_max_kw"),
    dcMaxKw: real("dc_max_kw"),
    rangeMiles: integer("range_miles"),
    typicalMpg: real("typical_mpg"),
    source: text("source").notNull().default("seed"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ev_catalog_make_idx").on(t.make),
    index("ev_catalog_make_model_idx").on(t.make, t.model),
    index("ev_catalog_fuel_idx").on(t.fuelCategory),
    index("ev_catalog_active_idx").on(t.isActive),
  ]
);

export const insertEvCatalogSchema = createInsertSchema(evCatalogTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const selectEvCatalogSchema = createSelectSchema(evCatalogTable);
export type InsertEvCatalog = z.infer<typeof insertEvCatalogSchema>;
export type EvCatalogEntry = typeof evCatalogTable.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Normalized Vehicle Intelligence Platform
// Hierarchy: Manufacturer → Model → ModelYear → Trim → ChargingProfile
// ═══════════════════════════════════════════════════════════════════════════════

// ── Level 1: Manufacturer ─────────────────────────────────────────────────────
export const evManufacturersTable = pgTable(
  "ev_manufacturers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    country: text("country").notNull().default("US"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ev_mfr_active_idx").on(t.isActive)]
);

// ── Level 2: Model (one per make × model name) ────────────────────────────────
export const evModelsTable = pgTable(
  "ev_models",
  {
    id: serial("id").primaryKey(),
    manufacturerId: integer("manufacturer_id")
      .notNull()
      .references(() => evManufacturersTable.id),
    name: text("name").notNull(),
    bodyStyle: text("body_style"),   // sedan | suv | truck | van | hatchback | coupe
    segment: text("segment"),        // compact | midsize | fullsize | luxury
    fuelCategory: text("fuel_category").notNull().default("BEV"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ev_models_mfr_name_idx").on(t.manufacturerId, t.name),
    index("ev_models_fuel_idx").on(t.fuelCategory),
    index("ev_models_mfr_idx").on(t.manufacturerId),
  ]
);

// ── Level 3: ModelYear (one per model × calendar year) ────────────────────────
// Separating year into its own table lets the importer add a new model year
// without any schema changes — just INSERT a new model_year row.
export const evModelYearsTable = pgTable(
  "ev_model_years",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id")
      .notNull()
      .references(() => evModelsTable.id),
    year: integer("year").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ev_model_years_unique_idx").on(t.modelId, t.year),
    index("ev_model_years_model_idx").on(t.modelId),
    index("ev_model_years_year_idx").on(t.year),
    index("ev_model_years_active_idx").on(t.isActive),
  ]
);

// ── Level 4: Trim (one per model-year × trim name) ────────────────────────────
// trimName = '' means "base / only trim". The empty-string sentinel keeps the
// unique constraint (model_year_id, trim_name) null-safe without nullable cols.
export const evTrimsTable = pgTable(
  "ev_trims",
  {
    id: serial("id").primaryKey(),
    modelYearId: integer("model_year_id")
      .notNull()
      .references(() => evModelYearsTable.id),
    trimName: text("trim_name").notNull().default(""),
    msrpUsd: integer("msrp_usd"),
    source: text("source").notNull().default("seed"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ev_trims_unique_idx").on(t.modelYearId, t.trimName),
    index("ev_trims_model_year_idx").on(t.modelYearId),
    index("ev_trims_active_idx").on(t.isActive),
  ]
);

// ── Level 5: ChargingProfile (exactly one per trim) ───────────────────────────
// UNIQUE(trim_id) enforces the 1:1 relationship at the DB level.
// For vehicles shipping with a NACS adapter (but native CCS), the primary
// connector is recorded here; the notes field captures adapter availability.
export const evChargingProfilesTable = pgTable(
  "ev_charging_profiles",
  {
    id: serial("id").primaryKey(),
    trimId: integer("trim_id")
      .notNull()
      .references(() => evTrimsTable.id)
      .unique(),
    // Connectors
    dcConnector: text("dc_connector"),           // NACS | CCS | CHAdeMO | null
    acConnector: text("ac_connector"),           // J1772 | NACS | null
    // Battery
    batteryKwh: real("battery_kwh"),             // gross capacity kWh
    usableKwh: real("usable_kwh"),               // usable/net capacity kWh
    // AC charging
    acMaxKw: real("ac_max_kw"),                  // max AC charge rate kW
    onboardChargerKw: real("onboard_charger_kw"),// onboard AC charger hardware kW
    // DC fast charging
    dcMaxKw: real("dc_max_kw"),                  // peak DC fast-charge acceptance kW
    // Range & efficiency
    rangeMiles: integer("range_miles"),           // EPA range (miles)
    typicalMpg: real("typical_mpg"),             // gas/hybrid mpge
    // Special capabilities
    plugAndCharge: boolean("plug_and_charge").notNull().default(false),
    superchargerEligible: boolean("supercharger_eligible").notNull().default(false),
    // Future extension fields (reserved for route-planning, battery-health)
    chargeCurveJson: text("charge_curve_json"),  // JSON array of [soc%, kw] pairs (future)
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ev_cp_trim_idx").on(t.trimId),
    index("ev_cp_dc_idx").on(t.dcConnector),
    index("ev_cp_sc_idx").on(t.superchargerEligible),
    index("ev_cp_pac_idx").on(t.plugAndCharge),
  ]
);

// ── Catalog Versioning ─────────────────────────────────────────────────────────
// One row per catalog release (e.g. "2026.07"). The row with isCurrent=true
// is returned by GET /vehicles/version. Enables the mobile app to detect
// when a full catalog refresh is needed (stored version ≠ server version).
export const vehicleCatalogVersionsTable = pgTable(
  "vehicle_catalog_versions",
  {
    id: serial("id").primaryKey(),
    versionTag: text("version_tag").notNull().unique(),  // e.g. "2026.07"
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
    entryCount: integer("entry_count").notNull().default(0),
    trimCount: integer("trim_count").notNull().default(0),
    notes: text("notes"),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vcv_current_idx").on(t.isCurrent),
    index("vcv_released_idx").on(t.releasedAt),
  ]
);

// ── TypeScript types ──────────────────────────────────────────────────────────
export type EvManufacturer = typeof evManufacturersTable.$inferSelect;
export type EvModel        = typeof evModelsTable.$inferSelect;
export type EvModelYear    = typeof evModelYearsTable.$inferSelect;
export type EvTrim         = typeof evTrimsTable.$inferSelect;
export type EvChargingProfile = typeof evChargingProfilesTable.$inferSelect;
export type VehicleCatalogVersion = typeof vehicleCatalogVersionsTable.$inferSelect;
