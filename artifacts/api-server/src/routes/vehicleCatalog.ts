import { Router } from "express";
import { db } from "@workspace/db";
import {
  evManufacturersTable,
  evModelsTable,
  evModelYearsTable,
  evTrimsTable,
  evChargingProfilesTable,
  vehicleCatalogVersionsTable,
} from "@workspace/db";
import { eq, ilike, and, or, sql, asc, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAdmin } from "../middlewares/requireAuth";
import { SEED_CATALOG, type ChargingSpec } from "./vehicleCatalogData";

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────
const FUEL_CATS = ["BEV", "PHEV", "HEV", "GAS", "DIESEL", "E85"] as const;
const DC_CONNECTORS = ["NACS", "CCS", "CHAdeMO"] as const;
const AC_CONNECTORS = ["J1772", "NACS"] as const;

const chargingSpecSchema = z.object({
  dcConnector:          z.enum(DC_CONNECTORS).nullable().optional(),
  acConnector:          z.enum(AC_CONNECTORS).nullable().optional(),
  batteryKwh:           z.number().min(1).max(400).nullable().optional(),
  usableKwh:            z.number().min(1).max(400).nullable().optional(),
  acMaxKw:              z.number().min(0.5).max(50).nullable().optional(),
  dcMaxKw:              z.number().min(1).max(800).nullable().optional(),
  onboardChargerKw:     z.number().min(0.5).max(50).nullable().optional(),
  rangeMiles:           z.number().int().min(1).max(1200).nullable().optional(),
  typicalMpg:           z.number().min(1).max(200).nullable().optional(),
  plugAndCharge:        z.boolean().optional(),
  superchargerEligible: z.boolean().optional(),
  notes:                z.string().max(500).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.batteryKwh && v.usableKwh && v.usableKwh > v.batteryKwh) {
    ctx.addIssue({ code: "custom", message: `usableKwh (${v.usableKwh}) must not exceed batteryKwh (${v.batteryKwh})` });
  }
  if ((v.dcConnector === "NACS" || v.acConnector === "NACS") && v.dcConnector === "CHAdeMO") {
    ctx.addIssue({ code: "custom", message: "NACS and CHAdeMO cannot be combined" });
  }
});

const hierarchicalTrimSchema = z.object({
  name: z.string().default(""),
  year: z.number().int().min(1990).max(2035),
}).merge(chargingSpecSchema);

const hierarchicalModelSchema = z.object({
  name:         z.string().min(1),
  fuelCategory: z.enum(FUEL_CATS),
  bodyStyle:    z.string().optional(),
  segment:      z.string().optional(),
  trims:        z.array(hierarchicalTrimSchema).min(1).max(500),
});

const hierarchicalMfrSchema = z.object({
  name:    z.string().min(1),
  slug:    z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  country: z.string().length(2).optional().default("US"),
  models:  z.array(hierarchicalModelSchema).min(1).max(200),
});

const importHierarchicalSchema = z.object({
  manufacturers: z.array(hierarchicalMfrSchema).min(1).max(100),
});

const importFlatSchema = z.object({
  entries: z.array(z.object({
    make:         z.string().min(1),
    model:        z.string().min(1),
    year:         z.number().int().min(1990).max(2035),
    trimName:     z.string().default(""),
    fuelCategory: z.enum(FUEL_CATS),
    bodyStyle:    z.string().optional(),
    segment:      z.string().optional(),
  }).merge(chargingSpecSchema)).min(1).max(5000),
});

// ── Helper: normalize a ChargingSpec to DB-ready values ──────────────────────
function normalizeSpec(s: ChargingSpec) {
  return {
    dcConnector:          s.dcConnector          ?? null,
    acConnector:          s.acConnector          ?? null,
    batteryKwh:           s.batteryKwh           ?? null,
    usableKwh:            s.usableKwh            ?? null,
    acMaxKw:              s.acMaxKw              ?? null,
    dcMaxKw:              s.dcMaxKw              ?? null,
    onboardChargerKw:     s.onboardChargerKw     ?? null,
    rangeMiles:           s.rangeMiles           ?? null,
    typicalMpg:           s.typicalMpg           ?? null,
    plugAndCharge:        s.plugAndCharge        ?? false,
    superchargerEligible: s.superchargerEligible ?? false,
    notes:                s.notes               ?? null,
  };
}

// ── Helper: shared JOIN across all 5 tables ───────────────────────────────────
function catalogJoin(q: ReturnType<typeof db.select>) {
  return q
    .from(evTrimsTable)
    .innerJoin(evModelYearsTable,     eq(evTrimsTable.modelYearId,     evModelYearsTable.id))
    .innerJoin(evModelsTable,         eq(evModelYearsTable.modelId,    evModelsTable.id))
    .innerJoin(evManufacturersTable,  eq(evModelsTable.manufacturerId, evManufacturersTable.id))
    .leftJoin(evChargingProfilesTable, eq(evChargingProfilesTable.trimId, evTrimsTable.id));
}

// ── Helper: flat CatalogEntry column projection ───────────────────────────────
// Backward-compatible shape used by /vehicles/catalog/* and /vehicles/search.
function catalogSelect() {
  return {
    id:                   evTrimsTable.id,
    trimId:               evTrimsTable.id,
    modelYearId:          evModelYearsTable.id,
    modelId:              evModelsTable.id,
    manufacturerId:       evManufacturersTable.id,
    make:                 evManufacturersTable.name,
    model:                evModelsTable.name,
    year:                 evModelYearsTable.year,
    yearFrom:             evModelYearsTable.year,
    yearTo:               evModelYearsTable.year,
    yearDisplay:          sql<string>`${evModelYearsTable.year}::text`,
    trim:                 sql<string | null>`NULLIF(${evTrimsTable.trimName}, '')`,
    trimName:             evTrimsTable.trimName,
    fuelCategory:         evModelsTable.fuelCategory,
    bodyStyle:            evModelsTable.bodyStyle,
    segment:              evModelsTable.segment,
    dcConnector:          evChargingProfilesTable.dcConnector,
    acConnector:          evChargingProfilesTable.acConnector,
    batteryKwh:           evChargingProfilesTable.batteryKwh,
    usableKwh:            evChargingProfilesTable.usableKwh,
    acMaxKw:              evChargingProfilesTable.acMaxKw,
    dcMaxKw:              evChargingProfilesTable.dcMaxKw,
    onboardChargerKw:     evChargingProfilesTable.onboardChargerKw,
    rangeMiles:           evChargingProfilesTable.rangeMiles,
    typicalMpg:           evChargingProfilesTable.typicalMpg,
    plugAndCharge:        evChargingProfilesTable.plugAndCharge,
    superchargerEligible: evChargingProfilesTable.superchargerEligible,
    source:               evTrimsTable.source,
    isActive:             evTrimsTable.isActive,
  };
}

function activeConditions() {
  return [
    eq(evTrimsTable.isActive,      true),
    eq(evModelYearsTable.isActive, true),
    eq(evModelsTable.isActive,     true),
    eq(evManufacturersTable.isActive, true),
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// Catalog Version Endpoints
// ════════════════════════════════════════════════════════════════════════════

// ── GET /vehicles/version ─────────────────────────────────────────────────────
// Returns the current catalog version. Mobile app compares this against its
// locally cached version to decide whether to download a fresh catalog.
router.get("/vehicles/version", async (_req, res) => {
  const [v] = await db
    .select({
      version:    vehicleCatalogVersionsTable.versionTag,
      releasedAt: vehicleCatalogVersionsTable.releasedAt,
      entryCount: vehicleCatalogVersionsTable.entryCount,
      trimCount:  vehicleCatalogVersionsTable.trimCount,
      notes:      vehicleCatalogVersionsTable.notes,
    })
    .from(vehicleCatalogVersionsTable)
    .where(eq(vehicleCatalogVersionsTable.isCurrent, true))
    .limit(1);

  if (!v) return res.json({ version: null, releasedAt: null, entryCount: 0, trimCount: 0 });
  return res.json(v);
});

// ── GET /vehicles/version/history ─────────────────────────────────────────────
router.get("/vehicles/version/history", async (_req, res) => {
  const history = await db
    .select()
    .from(vehicleCatalogVersionsTable)
    .orderBy(desc(vehicleCatalogVersionsTable.releasedAt))
    .limit(20);
  return res.json(history);
});

// ════════════════════════════════════════════════════════════════════════════
// Progressive Selection Endpoints (for mobile picker)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /vehicles/manufacturers ───────────────────────────────────────────────
// Returns all active manufacturers with model count, optionally filtered by fuel.
router.get("/vehicles/manufacturers", async (req, res) => {
  const fuel = typeof req.query.fuel === "string" ? req.query.fuel.trim() : undefined;
  const q    = typeof req.query.q    === "string" ? req.query.q.trim()    : undefined;

  const conditions: ReturnType<typeof eq>[] = [eq(evManufacturersTable.isActive, true)];
  if (q) {
    conditions.push(ilike(evManufacturersTable.name, `%${q}%`) as unknown as ReturnType<typeof eq>);
  }

  // Use subquery to count models (filtered by fuel if requested)
  const modelCountExpr = fuel
    ? sql<number>`(
        SELECT COUNT(DISTINCT em.id)::int FROM ev_models em
        WHERE em.manufacturer_id = ${evManufacturersTable.id}
          AND em.fuel_category = ${fuel}
          AND em.is_active = true
      )`
    : sql<number>`(
        SELECT COUNT(DISTINCT em.id)::int FROM ev_models em
        WHERE em.manufacturer_id = ${evManufacturersTable.id}
          AND em.is_active = true
      )`;

  const rows = await db
    .select({
      id:         evManufacturersTable.id,
      name:       evManufacturersTable.name,
      slug:       evManufacturersTable.slug,
      country:    evManufacturersTable.country,
      modelCount: modelCountExpr,
    })
    .from(evManufacturersTable)
    .where(and(...conditions))
    .orderBy(asc(evManufacturersTable.name));

  const filtered = fuel ? rows.filter((r) => r.modelCount > 0) : rows;
  return res.json(filtered);
});

// ── GET /vehicles/models?manufacturerId=&fuel= ────────────────────────────────
router.get("/vehicles/models", async (req, res) => {
  const mfrId = req.query.manufacturerId ? parseInt(String(req.query.manufacturerId), 10) : undefined;
  const fuel  = typeof req.query.fuel === "string" ? req.query.fuel.trim() : undefined;
  const q     = typeof req.query.q    === "string" ? req.query.q.trim()    : undefined;

  const conditions: ReturnType<typeof eq>[] = [eq(evModelsTable.isActive, true)];
  if (mfrId && !isNaN(mfrId)) conditions.push(eq(evModelsTable.manufacturerId, mfrId) as unknown as ReturnType<typeof eq>);
  if (fuel) conditions.push(eq(evModelsTable.fuelCategory, fuel) as unknown as ReturnType<typeof eq>);
  if (q) conditions.push(ilike(evModelsTable.name, `%${q}%`) as unknown as ReturnType<typeof eq>);

  const rows = await db
    .select({
      id:           evModelsTable.id,
      manufacturerId: evModelsTable.manufacturerId,
      name:         evModelsTable.name,
      fuelCategory: evModelsTable.fuelCategory,
      bodyStyle:    evModelsTable.bodyStyle,
      segment:      evModelsTable.segment,
      yearCount: sql<number>`(
        SELECT COUNT(DISTINCT my.year)::int FROM ev_model_years my
        WHERE my.model_id = ${evModelsTable.id} AND my.is_active = true
      )`,
    })
    .from(evModelsTable)
    .where(and(...conditions))
    .orderBy(asc(evModelsTable.name));

  return res.json(rows);
});

// ── GET /vehicles/years?modelId= ──────────────────────────────────────────────
router.get("/vehicles/years", async (req, res) => {
  const modelId = req.query.modelId ? parseInt(String(req.query.modelId), 10) : undefined;
  if (!modelId || isNaN(modelId)) return res.status(400).json({ error: "modelId is required" });

  const rows = await db
    .select({
      id:   evModelYearsTable.id,
      year: evModelYearsTable.year,
      trimCount: sql<number>`(
        SELECT COUNT(*)::int FROM ev_trims t
        WHERE t.model_year_id = ${evModelYearsTable.id} AND t.is_active = true
      )`,
    })
    .from(evModelYearsTable)
    .where(and(
      eq(evModelYearsTable.modelId,   modelId),
      eq(evModelYearsTable.isActive,  true),
    ))
    .orderBy(desc(evModelYearsTable.year));

  return res.json(rows);
});

// ── GET /vehicles/trims?modelYearId= ─────────────────────────────────────────
// Returns all trims for a model-year, each with its full charging profile.
router.get("/vehicles/trims", async (req, res) => {
  const modelYearId = req.query.modelYearId ? parseInt(String(req.query.modelYearId), 10) : undefined;
  const modelId     = req.query.modelId     ? parseInt(String(req.query.modelId), 10)     : undefined;

  if (!modelYearId && !modelId) {
    return res.status(400).json({ error: "modelYearId or modelId is required" });
  }

  const conditions: ReturnType<typeof eq>[] = [eq(evTrimsTable.isActive, true)];
  if (modelYearId && !isNaN(modelYearId)) {
    conditions.push(eq(evTrimsTable.modelYearId, modelYearId) as unknown as ReturnType<typeof eq>);
  } else if (modelId && !isNaN(modelId)) {
    conditions.push(eq(evModelYearsTable.modelId, modelId) as unknown as ReturnType<typeof eq>);
    conditions.push(eq(evModelYearsTable.isActive, true) as unknown as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({
      id:          evTrimsTable.id,
      modelYearId: evTrimsTable.modelYearId,
      trimName:    evTrimsTable.trimName,
      msrpUsd:     evTrimsTable.msrpUsd,
      source:      evTrimsTable.source,
      chargingProfile: {
        dcConnector:          evChargingProfilesTable.dcConnector,
        acConnector:          evChargingProfilesTable.acConnector,
        batteryKwh:           evChargingProfilesTable.batteryKwh,
        usableKwh:            evChargingProfilesTable.usableKwh,
        acMaxKw:              evChargingProfilesTable.acMaxKw,
        dcMaxKw:              evChargingProfilesTable.dcMaxKw,
        onboardChargerKw:     evChargingProfilesTable.onboardChargerKw,
        rangeMiles:           evChargingProfilesTable.rangeMiles,
        typicalMpg:           evChargingProfilesTable.typicalMpg,
        plugAndCharge:        evChargingProfilesTable.plugAndCharge,
        superchargerEligible: evChargingProfilesTable.superchargerEligible,
        notes:                evChargingProfilesTable.notes,
      },
    })
    .from(evTrimsTable)
    .innerJoin(evModelYearsTable,      eq(evTrimsTable.modelYearId,     evModelYearsTable.id))
    .leftJoin(evChargingProfilesTable, eq(evChargingProfilesTable.trimId, evTrimsTable.id))
    .where(and(...conditions))
    .orderBy(asc(evTrimsTable.trimName));

  return res.json(rows);
});

// ── GET /vehicles/:trimId/charging-profile ────────────────────────────────────
router.get("/vehicles/:trimId/charging-profile", async (req, res) => {
  const trimId = parseInt(String(req.params.trimId), 10);
  if (isNaN(trimId)) return res.status(400).json({ error: "invalid trimId" });

  const [row] = await db
    .select(catalogSelect())
    .from(evTrimsTable)
    .innerJoin(evModelYearsTable,      eq(evTrimsTable.modelYearId,     evModelYearsTable.id))
    .innerJoin(evModelsTable,          eq(evModelYearsTable.modelId,    evModelsTable.id))
    .innerJoin(evManufacturersTable,   eq(evModelsTable.manufacturerId, evManufacturersTable.id))
    .leftJoin(evChargingProfilesTable, eq(evChargingProfilesTable.trimId, evTrimsTable.id))
    .where(eq(evTrimsTable.id, trimId))
    .limit(1);

  if (!row) return res.status(404).json({ error: "trim not found" });
  return res.json(row);
});

// ── GET /vehicles/search ──────────────────────────────────────────────────────
// Full-text search across all 5 levels. Returns flat CatalogEntry objects
// compatible with the mobile catalog hook. All filters are server-side.
const VALID_FUELS = new Set(["BEV", "PHEV", "HEV", "GAS", "DIESEL", "E85", "all"]);
const VALID_DC    = new Set(["NACS", "CCS", "CHAdeMO", "J1772"]);
const VALID_SORTS = new Set(["make", "model", "year", "range", "battery", "trim"]);

router.get("/vehicles/search", async (req, res) => {
  const q              = typeof req.query.q              === "string" ? req.query.q.trim()              : undefined;
  const fuel           = typeof req.query.fuel           === "string" ? req.query.fuel.trim()           : undefined;
  const dc             = typeof req.query.dc             === "string" ? req.query.dc.trim()             : undefined;
  const manufacturerId = req.query.manufacturerId ? parseInt(String(req.query.manufacturerId), 10) : undefined;
  const modelId        = req.query.modelId        ? parseInt(String(req.query.modelId), 10)        : undefined;
  const year           = req.query.year           ? parseInt(String(req.query.year), 10)           : undefined;
  const plugAndCharge  = req.query.plugAndCharge  === "true" ? true : undefined;
  const sc             = req.query.supercharger   === "true" ? true : undefined;
  const sortKey        = typeof req.query.sort === "string" ? req.query.sort.trim() : "make";
  const sortDir        = typeof req.query.dir  === "string" ? req.query.dir.trim()  : "asc";
  const limit          = Math.min(parseInt(String(req.query.limit  ?? "200"), 10) || 200, 1000);
  const offset         = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  if (fuel && !VALID_FUELS.has(fuel))
    return res.status(400).json({ error: `Invalid fuel value. Must be one of: ${[...VALID_FUELS].filter(f => f !== "all").join(", ")}` });
  if (dc && !VALID_DC.has(dc))
    return res.status(400).json({ error: `Invalid dc value. Must be one of: ${[...VALID_DC].join(", ")}` });
  if (!VALID_SORTS.has(sortKey))
    return res.status(400).json({ error: `Invalid sort key. Must be one of: ${[...VALID_SORTS].join(", ")}` });
  if (sortDir !== "asc" && sortDir !== "desc")
    return res.status(400).json({ error: "dir must be 'asc' or 'desc'" });

  const orderFn = sortDir === "desc" ? desc : asc;

  // Build the ORDER BY clause based on sort key
  const primaryOrder = (() => {
    switch (sortKey) {
      case "model":   return [orderFn(evModelsTable.name),         asc(evManufacturersTable.name), sortDir === "asc" ? desc(evModelYearsTable.year) : asc(evModelYearsTable.year), asc(evTrimsTable.trimName)];
      case "year":    return [orderFn(evModelYearsTable.year),     asc(evManufacturersTable.name), asc(evModelsTable.name), asc(evTrimsTable.trimName)];
      case "range":   return [sql`${evChargingProfilesTable.rangeMiles} ${sql.raw(sortDir === "desc" ? "DESC" : "ASC")} NULLS LAST`,   asc(evManufacturersTable.name), asc(evModelsTable.name), desc(evModelYearsTable.year)];
      case "battery": return [sql`${evChargingProfilesTable.batteryKwh} ${sql.raw(sortDir === "desc" ? "DESC" : "ASC")} NULLS LAST`,   asc(evManufacturersTable.name), asc(evModelsTable.name), desc(evModelYearsTable.year)];
      case "trim":    return [orderFn(evTrimsTable.trimName),      asc(evManufacturersTable.name), asc(evModelsTable.name), desc(evModelYearsTable.year)];
      default:        return [orderFn(evManufacturersTable.name),  asc(evModelsTable.name), desc(evModelYearsTable.year), asc(evTrimsTable.trimName)];
    }
  })();

  const conditions = [...activeConditions()];
  if (fuel           && fuel !== "all")   conditions.push(eq(evModelsTable.fuelCategory, fuel) as unknown as ReturnType<typeof eq>);
  if (dc)             conditions.push(eq(evChargingProfilesTable.dcConnector, dc) as unknown as ReturnType<typeof eq>);
  if (manufacturerId && !isNaN(manufacturerId)) conditions.push(eq(evManufacturersTable.id, manufacturerId) as unknown as ReturnType<typeof eq>);
  if (modelId        && !isNaN(modelId))        conditions.push(eq(evModelsTable.id, modelId) as unknown as ReturnType<typeof eq>);
  if (year           && !isNaN(year))           conditions.push(eq(evModelYearsTable.year, year) as unknown as ReturnType<typeof eq>);
  if (plugAndCharge)  conditions.push(eq(evChargingProfilesTable.plugAndCharge, true) as unknown as ReturnType<typeof eq>);
  if (sc)             conditions.push(eq(evChargingProfilesTable.superchargerEligible, true) as unknown as ReturnType<typeof eq>);
  if (q) {
    conditions.push(
      or(
        ilike(evManufacturersTable.name, `%${q}%`),
        ilike(evModelsTable.name,        `%${q}%`),
        ilike(evTrimsTable.trimName,     `%${q}%`),
      )! as unknown as ReturnType<typeof eq>
    );
  }

  const where = and(...conditions);
  const [entries, countResult] = await Promise.all([
    catalogJoin(db.select(catalogSelect()))
      .where(where)
      .orderBy(...primaryOrder)
      .limit(limit)
      .offset(offset),
    catalogJoin(db.select({ count: sql<number>`count(*)::int` }))
      .where(where),
  ]);

  const total = Number(countResult[0]?.count ?? 0);
  return res.json({ entries, total, limit, offset, hasMore: offset + entries.length < total });
});

// ════════════════════════════════════════════════════════════════════════════
// Backward-Compatible Catalog Endpoints (legacy mobile + web paths)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /vehicles/catalog ──────────────────────────────────────────────────────
router.get("/vehicles/catalog", async (req, res) => {
  const q      = typeof req.query.q    === "string" ? req.query.q.trim()    : undefined;
  const make   = typeof req.query.make === "string" ? req.query.make.trim() : undefined;
  const fuel   = typeof req.query.fuel === "string" ? req.query.fuel.trim() : undefined;
  const year   = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
  const dc     = typeof req.query.dc   === "string" ? req.query.dc.trim()   : undefined;
  const limit  = Math.min(parseInt(String(req.query.limit  ?? "200"), 10) || 200, 1000);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  const conditions = [...activeConditions()];
  if (make) conditions.push(eq(evManufacturersTable.name, make) as unknown as ReturnType<typeof eq>);
  if (fuel) conditions.push(eq(evModelsTable.fuelCategory, fuel) as unknown as ReturnType<typeof eq>);
  if (year && !isNaN(year)) conditions.push(eq(evModelYearsTable.year, year) as unknown as ReturnType<typeof eq>);
  if (dc)   conditions.push(eq(evChargingProfilesTable.dcConnector, dc) as unknown as ReturnType<typeof eq>);
  if (q) {
    conditions.push(
      or(
        ilike(evManufacturersTable.name, `%${q}%`),
        ilike(evModelsTable.name,        `%${q}%`),
        ilike(evTrimsTable.trimName,     `%${q}%`),
      )! as unknown as ReturnType<typeof eq>
    );
  }

  const where = and(...conditions);
  const [entries, countResult] = await Promise.all([
    catalogJoin(db.select(catalogSelect()))
      .where(where)
      .orderBy(asc(evManufacturersTable.name), asc(evModelsTable.name), desc(evModelYearsTable.year), asc(evTrimsTable.trimName))
      .limit(limit)
      .offset(offset),
    catalogJoin(db.select({ count: sql<number>`count(*)::int` }))
      .where(where),
  ]);

  return res.json({ entries, total: countResult[0]?.count ?? 0, limit, offset });
});

// ── GET /vehicles/catalog/makes ───────────────────────────────────────────────
router.get("/vehicles/catalog/makes", async (req, res) => {
  const fuel = typeof req.query.fuel === "string" ? req.query.fuel.trim() : undefined;
  const conditions = [eq(evManufacturersTable.isActive, true), eq(evModelsTable.isActive, true)];
  if (fuel) conditions.push(eq(evModelsTable.fuelCategory, fuel) as unknown as ReturnType<typeof eq>);

  const rows = await db
    .selectDistinct({ make: evManufacturersTable.name })
    .from(evManufacturersTable)
    .innerJoin(evModelsTable, eq(evModelsTable.manufacturerId, evManufacturersTable.id))
    .where(and(...conditions))
    .orderBy(asc(evManufacturersTable.name));

  return res.json(rows.map((r) => r.make));
});

// ── GET /vehicles/catalog/models?make= ───────────────────────────────────────
router.get("/vehicles/catalog/models", async (req, res) => {
  const make = typeof req.query.make === "string" ? req.query.make.trim() : undefined;
  if (!make) return res.status(400).json({ error: "make is required" });

  const rows = await db
    .selectDistinct({ model: evModelsTable.name })
    .from(evModelsTable)
    .innerJoin(evManufacturersTable, eq(evModelsTable.manufacturerId, evManufacturersTable.id))
    .where(and(
      eq(evManufacturersTable.isActive, true),
      eq(evModelsTable.isActive, true),
      eq(evManufacturersTable.name, make),
    ))
    .orderBy(asc(evModelsTable.name));

  return res.json(rows.map((r) => r.model));
});

// ── GET /vehicles/catalog/years?make=&model= ──────────────────────────────────
router.get("/vehicles/catalog/years", async (req, res) => {
  const make  = typeof req.query.make  === "string" ? req.query.make.trim()  : undefined;
  const model = typeof req.query.model === "string" ? req.query.model.trim() : undefined;
  if (!make || !model) return res.status(400).json({ error: "make and model are required" });

  const rows = await db
    .selectDistinct({ year: evModelYearsTable.year })
    .from(evModelYearsTable)
    .innerJoin(evModelsTable,        eq(evModelYearsTable.modelId,    evModelsTable.id))
    .innerJoin(evManufacturersTable, eq(evModelsTable.manufacturerId, evManufacturersTable.id))
    .where(and(
      eq(evManufacturersTable.isActive, true),
      eq(evModelsTable.isActive,        true),
      eq(evModelYearsTable.isActive,    true),
      eq(evManufacturersTable.name,     make),
      eq(evModelsTable.name,            model),
    ))
    .orderBy(asc(evModelYearsTable.year));

  return res.json(rows.map((r) => ({
    yearFrom:    r.year,
    yearTo:      r.year,
    yearDisplay: String(r.year),
  })));
});

// ── GET /vehicles/catalog/trims?make=&model=&year= ────────────────────────────
router.get("/vehicles/catalog/trims", async (req, res) => {
  const make  = typeof req.query.make  === "string" ? req.query.make.trim()  : undefined;
  const model = typeof req.query.model === "string" ? req.query.model.trim() : undefined;
  const year  = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
  if (!make || !model) return res.status(400).json({ error: "make and model are required" });

  const conditions = [
    ...activeConditions(),
    eq(evManufacturersTable.name, make) as unknown as ReturnType<typeof eq>,
    eq(evModelsTable.name,        model) as unknown as ReturnType<typeof eq>,
  ];
  if (year && !isNaN(year)) conditions.push(eq(evModelYearsTable.year, year) as unknown as ReturnType<typeof eq>);

  const entries = await catalogJoin(db.select(catalogSelect()))
    .where(and(...conditions))
    .orderBy(asc(evModelYearsTable.year), asc(evTrimsTable.trimName));

  return res.json(entries);
});

// ── GET /vehicles/catalog/stats ───────────────────────────────────────────────
router.get("/vehicles/catalog/stats", async (_req, res) => {
  const [version] = await db
    .select({ tag: vehicleCatalogVersionsTable.versionTag })
    .from(vehicleCatalogVersionsTable)
    .where(eq(vehicleCatalogVersionsTable.isCurrent, true))
    .limit(1);

  const [totals] = await db
    .select({
      manufacturers: sql<number>`(SELECT count(*)::int FROM ev_manufacturers WHERE is_active = true)`,
      models:        sql<number>`(SELECT count(*)::int FROM ev_models WHERE is_active = true)`,
      modelYears:    sql<number>`(SELECT count(*)::int FROM ev_model_years WHERE is_active = true)`,
      trims:         sql<number>`(SELECT count(*)::int FROM ev_trims WHERE is_active = true)`,
      bevTrims: sql<number>`(
        SELECT count(*)::int FROM ev_trims et
        JOIN ev_model_years emy ON et.model_year_id = emy.id
        JOIN ev_models em ON emy.model_id = em.id
        WHERE et.is_active = true AND em.fuel_category = 'BEV'
      )`,
    })
    .from(evManufacturersTable)
    .limit(1);

  return res.json({
    ...(totals ?? { manufacturers: 0, models: 0, modelYears: 0, trims: 0, bevTrims: 0 }),
    version: version?.tag ?? null,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Seed & Import
// ════════════════════════════════════════════════════════════════════════════

type SeedResult = {
  manufacturers: number;
  models: number;
  modelYears: number;
  trims: number;
  profiles: number;
  version: string;
};

async function runSeed(): Promise<SeedResult> {
  let mfrCount = 0, modelCount = 0, yearCount = 0, trimCount = 0, profileCount = 0;

  // In-memory caches to avoid redundant DB calls for duplicated slugs/names
  const seenMfr       = new Map<string, number>(); // slug → manufacturer id
  const seenModel     = new Map<string, number>(); // `${mfrId}:${name}` → model id
  const seenModelYear = new Map<string, number>(); // `${modelId}:${year}` → model_year id

  for (const mfrSpec of SEED_CATALOG) {
    let mfrId: number;
    if (seenMfr.has(mfrSpec.slug)) {
      mfrId = seenMfr.get(mfrSpec.slug)!;
    } else {
      const [mfr] = await db.insert(evManufacturersTable)
        .values({ name: mfrSpec.name, slug: mfrSpec.slug, country: mfrSpec.country })
        .onConflictDoUpdate({
          target: evManufacturersTable.slug,
          set: { name: mfrSpec.name, country: mfrSpec.country, isActive: true },
        })
        .returning({ id: evManufacturersTable.id });
      mfrId = mfr.id;
      seenMfr.set(mfrSpec.slug, mfrId);
      mfrCount++;
    }

    for (const modelSpec of mfrSpec.models) {
      const modelKey = `${mfrId}:${modelSpec.name}`;
      let modelId: number;
      if (seenModel.has(modelKey)) {
        modelId = seenModel.get(modelKey)!;
      } else {
        const [model] = await db.insert(evModelsTable)
          .values({
            manufacturerId: mfrId,
            name:           modelSpec.name,
            fuelCategory:   modelSpec.fuelCategory,
            bodyStyle:      modelSpec.bodyStyle ?? null,
            segment:        modelSpec.segment   ?? null,
          })
          .onConflictDoUpdate({
            target: [evModelsTable.manufacturerId, evModelsTable.name],
            set: {
              fuelCategory: sql`excluded.fuel_category`,
              bodyStyle:    sql`excluded.body_style`,
              segment:      sql`excluded.segment`,
              isActive:     true,
            },
          })
          .returning({ id: evModelsTable.id });
        modelId = model.id;
        seenModel.set(modelKey, modelId);
        modelCount++;
      }

      for (const trimSpec of modelSpec.trims) {
        if (trimSpec.years.length === 0) continue;

        for (const year of trimSpec.years) {
          // ── Upsert model year ──
          const yearKey = `${modelId}:${year}`;
          let modelYearId: number;
          if (seenModelYear.has(yearKey)) {
            modelYearId = seenModelYear.get(yearKey)!;
          } else {
            const [my] = await db.insert(evModelYearsTable)
              .values({ modelId, year })
              .onConflictDoUpdate({
                target: [evModelYearsTable.modelId, evModelYearsTable.year],
                set:    { isActive: true },
              })
              .returning({ id: evModelYearsTable.id });
            modelYearId = my.id;
            seenModelYear.set(yearKey, modelYearId);
            yearCount++;
          }

          // ── Upsert trim ──
          const [trim] = await db.insert(evTrimsTable)
            .values({ modelYearId, trimName: trimSpec.name, source: "seed" })
            .onConflictDoUpdate({
              target: [evTrimsTable.modelYearId, evTrimsTable.trimName],
              set:    { isActive: true, updatedAt: sql`now()` },
            })
            .returning({ id: evTrimsTable.id });
          trimCount++;

          // ── Upsert charging profile ──
          const spec = normalizeSpec(trimSpec.specs);
          await db.insert(evChargingProfilesTable)
            .values({ trimId: trim.id, ...spec })
            .onConflictDoUpdate({
              target: evChargingProfilesTable.trimId,
              set: {
                dcConnector:          sql`excluded.dc_connector`,
                acConnector:          sql`excluded.ac_connector`,
                batteryKwh:           sql`excluded.battery_kwh`,
                usableKwh:            sql`excluded.usable_kwh`,
                acMaxKw:              sql`excluded.ac_max_kw`,
                dcMaxKw:              sql`excluded.dc_max_kw`,
                onboardChargerKw:     sql`excluded.onboard_charger_kw`,
                rangeMiles:           sql`excluded.range_miles`,
                typicalMpg:           sql`excluded.typical_mpg`,
                plugAndCharge:        sql`excluded.plug_and_charge`,
                superchargerEligible: sql`excluded.supercharger_eligible`,
                notes:                sql`excluded.notes`,
                updatedAt:            sql`now()`,
              },
            });
          profileCount++;
        }
      }
    }
  }

  // Auto-publish a catalog version after seeding
  const now  = new Date();
  const tag  = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
  await db.update(vehicleCatalogVersionsTable)
    .set({ isCurrent: false })
    .where(eq(vehicleCatalogVersionsTable.isCurrent, true));
  await db.insert(vehicleCatalogVersionsTable)
    .values({ versionTag: tag, entryCount: mfrCount, trimCount, isCurrent: true })
    .onConflictDoUpdate({
      target: vehicleCatalogVersionsTable.versionTag,
      set:    { trimCount, isCurrent: true, releasedAt: sql`now()` },
    });

  return { manufacturers: mfrCount, models: modelCount, modelYears: yearCount, trims: trimCount, profiles: profileCount, version: tag };
}

// ── POST /admin/vehicles/seed ─────────────────────────────────────────────────
// Accepts Clerk admin session OR the ADMIN_SETUP_KEY header (bootstrap mode).
router.post("/admin/vehicles/seed", async (req, res) => {
  const setupKey = req.headers["x-admin-setup-key"] as string | undefined;
  if (setupKey && process.env.ADMIN_SETUP_KEY && setupKey === process.env.ADMIN_SETUP_KEY) {
    const result = await runSeed();
    return res.json({ ok: true, ...result });
  }
  const auth = (await import("@clerk/express")).getAuth(req);
  const { isAdmin } = await import("../middlewares/requireAuth");
  if (!auth?.userId || !isAdmin(auth)) {
    return res.status(auth?.userId ? 403 : 401).json({ error: auth?.userId ? "Forbidden" : "Unauthorized" });
  }
  const result = await runSeed();
  return res.json({ ok: true, ...result });
});

// ── POST /admin/vehicles/catalog/seed (backward-compat path) ──────────────────
router.post("/admin/vehicles/catalog/seed", async (req, res) => {
  const setupKey = req.headers["x-admin-setup-key"] as string | undefined;
  if (setupKey && process.env.ADMIN_SETUP_KEY && setupKey === process.env.ADMIN_SETUP_KEY) {
    const result = await runSeed();
    return res.json({ ok: true, ...result });
  }
  const auth = (await import("@clerk/express")).getAuth(req);
  const { isAdmin } = await import("../middlewares/requireAuth");
  if (!auth?.userId || !isAdmin(auth)) {
    return res.status(auth?.userId ? 403 : 401).json({ error: auth?.userId ? "Forbidden" : "Unauthorized" });
  }
  const result = await runSeed();
  return res.json({ ok: true, ...result });
});

// ── POST /admin/vehicles/import ───────────────────────────────────────────────
// Accepts hierarchical { manufacturers: [...] } OR flat { entries: [...] }.
// Adding a new model year = append { year, trimName, ...spec } — no schema changes.
router.post("/admin/vehicles/import", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;

  if (body.manufacturers) {
    const parsed = importHierarchicalSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid import payload", details: parsed.error.issues });
    }

    let inserted = 0, updated = 0, skipped = 0;
    const validationErrors: string[] = [];
    const seenModelYear = new Map<string, number>();

    for (const mfrInput of parsed.data.manufacturers) {
      const slug = mfrInput.slug ?? mfrInput.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const [mfr] = await db.insert(evManufacturersTable)
        .values({ name: mfrInput.name, slug, country: mfrInput.country ?? "US" })
        .onConflictDoUpdate({
          target: evManufacturersTable.slug,
          set:    { name: mfrInput.name, country: mfrInput.country ?? "US", isActive: true },
        })
        .returning({ id: evManufacturersTable.id });

      for (const modelInput of mfrInput.models) {
        const [model] = await db.insert(evModelsTable)
          .values({
            manufacturerId: mfr.id,
            name:           modelInput.name,
            fuelCategory:   modelInput.fuelCategory,
            bodyStyle:      modelInput.bodyStyle ?? null,
            segment:        modelInput.segment   ?? null,
          })
          .onConflictDoUpdate({
            target: [evModelsTable.manufacturerId, evModelsTable.name],
            set:    { fuelCategory: sql`excluded.fuel_category`, bodyStyle: sql`excluded.body_style`, segment: sql`excluded.segment` },
          })
          .returning({ id: evModelsTable.id });

        for (const trimInput of modelInput.trims) {
          const { name: trimName, year, ...rawSpec } = trimInput;

          if (rawSpec.batteryKwh && rawSpec.usableKwh && rawSpec.usableKwh > rawSpec.batteryKwh) {
            validationErrors.push(`${mfrInput.name} ${modelInput.name} ${year} "${trimName ?? ""}": usableKwh > batteryKwh`);
            skipped++;
            continue;
          }

          // Upsert model year
          const yearKey = `${model.id}:${year}`;
          let modelYearId: number;
          if (seenModelYear.has(yearKey)) {
            modelYearId = seenModelYear.get(yearKey)!;
          } else {
            const [my] = await db.insert(evModelYearsTable)
              .values({ modelId: model.id, year })
              .onConflictDoUpdate({
                target: [evModelYearsTable.modelId, evModelYearsTable.year],
                set:    { isActive: true },
              })
              .returning({ id: evModelYearsTable.id });
            modelYearId = my.id;
            seenModelYear.set(yearKey, modelYearId);
          }

          const [trim] = await db.insert(evTrimsTable)
            .values({ modelYearId, trimName: trimName ?? "", source: "import" })
            .onConflictDoUpdate({
              target: [evTrimsTable.modelYearId, evTrimsTable.trimName],
              set:    { isActive: true, updatedAt: sql`now()` },
            })
            .returning({ id: evTrimsTable.id });

          const spec = normalizeSpec(rawSpec as ChargingSpec);
          const existing = await db
            .select({ id: evChargingProfilesTable.id })
            .from(evChargingProfilesTable)
            .where(eq(evChargingProfilesTable.trimId, trim.id))
            .limit(1);

          await db.insert(evChargingProfilesTable)
            .values({ trimId: trim.id, ...spec })
            .onConflictDoUpdate({
              target: evChargingProfilesTable.trimId,
              set: {
                dcConnector: sql`excluded.dc_connector`, acConnector: sql`excluded.ac_connector`,
                batteryKwh: sql`excluded.battery_kwh`,   usableKwh: sql`excluded.usable_kwh`,
                acMaxKw: sql`excluded.ac_max_kw`,        dcMaxKw: sql`excluded.dc_max_kw`,
                onboardChargerKw: sql`excluded.onboard_charger_kw`,
                rangeMiles: sql`excluded.range_miles`,   typicalMpg: sql`excluded.typical_mpg`,
                plugAndCharge: sql`excluded.plug_and_charge`,
                superchargerEligible: sql`excluded.supercharger_eligible`,
                notes: sql`excluded.notes`, updatedAt: sql`now()`,
              },
            });

          existing.length > 0 ? updated++ : inserted++;
        }
      }
    }

    return res.json({ ok: true, inserted, updated, skipped, ...(validationErrors.length ? { validationErrors } : {}) });
  }

  if (body.entries) {
    const parsed = importFlatSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid import payload", details: parsed.error.issues });
    }

    let inserted = 0, updated = 0, skipped = 0;
    const validationErrors: string[] = [];
    const seenModelYear = new Map<string, number>();

    for (const entry of parsed.data.entries) {
      const { make, model, year, trimName, fuelCategory, bodyStyle, segment, ...rawSpec } = entry;

      if (rawSpec.batteryKwh && rawSpec.usableKwh && rawSpec.usableKwh > rawSpec.batteryKwh) {
        validationErrors.push(`${make} ${model} ${year} "${trimName ?? ""}": usableKwh > batteryKwh`);
        skipped++;
        continue;
      }

      const slug = make.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const [mfr] = await db.insert(evManufacturersTable)
        .values({ name: make, slug })
        .onConflictDoUpdate({ target: evManufacturersTable.slug, set: { name: make, isActive: true } })
        .returning({ id: evManufacturersTable.id });

      const [mod] = await db.insert(evModelsTable)
        .values({ manufacturerId: mfr.id, name: model, fuelCategory, bodyStyle: bodyStyle ?? null, segment: segment ?? null })
        .onConflictDoUpdate({
          target: [evModelsTable.manufacturerId, evModelsTable.name],
          set:    { fuelCategory: sql`excluded.fuel_category` },
        })
        .returning({ id: evModelsTable.id });

      const yearKey = `${mod.id}:${year}`;
      let modelYearId: number;
      if (seenModelYear.has(yearKey)) {
        modelYearId = seenModelYear.get(yearKey)!;
      } else {
        const [my] = await db.insert(evModelYearsTable)
          .values({ modelId: mod.id, year })
          .onConflictDoUpdate({
            target: [evModelYearsTable.modelId, evModelYearsTable.year],
            set:    { isActive: true },
          })
          .returning({ id: evModelYearsTable.id });
        modelYearId = my.id;
        seenModelYear.set(yearKey, modelYearId);
      }

      const [trim] = await db.insert(evTrimsTable)
        .values({ modelYearId, trimName: trimName ?? "", source: "import" })
        .onConflictDoUpdate({
          target: [evTrimsTable.modelYearId, evTrimsTable.trimName],
          set:    { isActive: true, updatedAt: sql`now()` },
        })
        .returning({ id: evTrimsTable.id });

      const spec = normalizeSpec(rawSpec as ChargingSpec);
      const existing = await db
        .select({ id: evChargingProfilesTable.id })
        .from(evChargingProfilesTable)
        .where(eq(evChargingProfilesTable.trimId, trim.id))
        .limit(1);

      await db.insert(evChargingProfilesTable)
        .values({ trimId: trim.id, ...spec })
        .onConflictDoUpdate({
          target: evChargingProfilesTable.trimId,
          set: {
            dcConnector: sql`excluded.dc_connector`, acConnector: sql`excluded.ac_connector`,
            batteryKwh: sql`excluded.battery_kwh`,   usableKwh: sql`excluded.usable_kwh`,
            acMaxKw: sql`excluded.ac_max_kw`,        dcMaxKw: sql`excluded.dc_max_kw`,
            onboardChargerKw: sql`excluded.onboard_charger_kw`,
            rangeMiles: sql`excluded.range_miles`,   typicalMpg: sql`excluded.typical_mpg`,
            plugAndCharge: sql`excluded.plug_and_charge`,
            superchargerEligible: sql`excluded.supercharger_eligible`,
            notes: sql`excluded.notes`, updatedAt: sql`now()`,
          },
        });

      existing.length > 0 ? updated++ : inserted++;
    }

    return res.json({ ok: true, inserted, updated, skipped, ...(validationErrors.length ? { validationErrors } : {}) });
  }

  return res.status(400).json({ error: "Body must contain 'manufacturers' (hierarchical) or 'entries' (flat)" });
});

// ── POST /admin/vehicles/catalog/import (backward-compat alias) ───────────────
// Delegates to the same import handler registered above.
// Kept so existing integrations using the old path continue to work.
// Implementation: identical to /admin/vehicles/import — share via runImport().


// ── POST /admin/vehicles/version ──────────────────────────────────────────────
// Publish a named catalog version (e.g. after a manual data refresh).
router.post("/admin/vehicles/version", requireAdmin, async (req, res) => {
  const body = req.body as { tag?: string; notes?: string };
  const now  = new Date();
  const tag  = body.tag ?? `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Count current active trims
  const [counts] = await db
    .select({ trims: sql<number>`count(*)::int` })
    .from(evTrimsTable)
    .where(eq(evTrimsTable.isActive, true));

  await db.update(vehicleCatalogVersionsTable)
    .set({ isCurrent: false })
    .where(eq(vehicleCatalogVersionsTable.isCurrent, true));

  const [v] = await db.insert(vehicleCatalogVersionsTable)
    .values({
      versionTag:  tag,
      trimCount:   counts?.trims ?? 0,
      entryCount:  counts?.trims ?? 0,
      notes:       body.notes ?? null,
      isCurrent:   true,
      releasedAt:  now,
    })
    .onConflictDoUpdate({
      target: vehicleCatalogVersionsTable.versionTag,
      set: {
        trimCount:   counts?.trims ?? 0,
        entryCount:  counts?.trims ?? 0,
        notes:       body.notes ?? null,
        isCurrent:   true,
        releasedAt:  sql`now()`,
      },
    })
    .returning();

  return res.json({ ok: true, version: v });
});

// ── PATCH /admin/vehicles/trims/:id ──────────────────────────────────────────
// :id = ev_trims.id — update trim metadata and/or its charging profile.
router.patch("/admin/vehicles/trims/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });

  const body = req.body as {
    isActive?: boolean; trimName?: string; source?: string; msrpUsd?: number;
    dcConnector?: string; acConnector?: string;
    batteryKwh?: number; usableKwh?: number;
    acMaxKw?: number; dcMaxKw?: number; onboardChargerKw?: number;
    rangeMiles?: number; typicalMpg?: number;
    plugAndCharge?: boolean; superchargerEligible?: boolean; notes?: string;
  };

  if (body.batteryKwh && body.usableKwh && body.usableKwh > body.batteryKwh) {
    return res.status(400).json({ error: "usableKwh must not exceed batteryKwh" });
  }

  const now = new Date();
  const trimUpdate: Record<string, unknown> = { updatedAt: now };
  if (body.isActive  !== undefined) trimUpdate.isActive  = Boolean(body.isActive);
  if (body.trimName  !== undefined) trimUpdate.trimName  = body.trimName;
  if (body.source    !== undefined) trimUpdate.source    = body.source;
  if (body.msrpUsd   !== undefined) trimUpdate.msrpUsd   = body.msrpUsd;

  if (Object.keys(trimUpdate).length > 1) {
    await db.update(evTrimsTable).set(trimUpdate).where(eq(evTrimsTable.id, id));
  }

  const profileUpdate: Record<string, unknown> = {};
  if (body.dcConnector          !== undefined) profileUpdate.dcConnector          = body.dcConnector;
  if (body.acConnector          !== undefined) profileUpdate.acConnector          = body.acConnector;
  if (body.batteryKwh           !== undefined) profileUpdate.batteryKwh           = body.batteryKwh;
  if (body.usableKwh            !== undefined) profileUpdate.usableKwh            = body.usableKwh;
  if (body.acMaxKw              !== undefined) profileUpdate.acMaxKw              = body.acMaxKw;
  if (body.dcMaxKw              !== undefined) profileUpdate.dcMaxKw              = body.dcMaxKw;
  if (body.onboardChargerKw     !== undefined) profileUpdate.onboardChargerKw     = body.onboardChargerKw;
  if (body.rangeMiles           !== undefined) profileUpdate.rangeMiles           = body.rangeMiles;
  if (body.typicalMpg           !== undefined) profileUpdate.typicalMpg           = body.typicalMpg;
  if (body.plugAndCharge        !== undefined) profileUpdate.plugAndCharge        = Boolean(body.plugAndCharge);
  if (body.superchargerEligible !== undefined) profileUpdate.superchargerEligible = Boolean(body.superchargerEligible);
  if (body.notes                !== undefined) profileUpdate.notes                = body.notes;

  if (Object.keys(profileUpdate).length > 0) {
    profileUpdate.updatedAt = now;
    const existing = await db
      .select({ id: evChargingProfilesTable.id })
      .from(evChargingProfilesTable)
      .where(eq(evChargingProfilesTable.trimId, id))
      .limit(1);

    if (existing.length > 0) {
      await db.update(evChargingProfilesTable).set(profileUpdate).where(eq(evChargingProfilesTable.trimId, id));
    } else {
      await db.insert(evChargingProfilesTable).values({ trimId: id, ...profileUpdate });
    }
  }

  // Return the full updated entry
  const [entry] = await catalogJoin(db.select(catalogSelect()))
    .where(eq(evTrimsTable.id, id));

  if (!entry) return res.status(404).json({ error: "entry not found" });
  return res.json(entry);
});

// ── PATCH /admin/vehicles/catalog/:id (backward-compat alias) ────────────────
// Identical to PATCH /admin/vehicles/trims/:id — kept so old admin clients work.
router.patch("/admin/vehicles/catalog/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });

  const body = req.body as {
    isActive?: boolean; trimName?: string; source?: string; msrpUsd?: number;
    dcConnector?: string; acConnector?: string;
    batteryKwh?: number; usableKwh?: number;
    acMaxKw?: number; dcMaxKw?: number; onboardChargerKw?: number;
    rangeMiles?: number; typicalMpg?: number;
    plugAndCharge?: boolean; superchargerEligible?: boolean; notes?: string;
  };

  if (body.batteryKwh && body.usableKwh && body.usableKwh > body.batteryKwh) {
    return res.status(400).json({ error: "usableKwh must not exceed batteryKwh" });
  }

  const now = new Date();
  const trimUpdate: Record<string, unknown> = { updatedAt: now };
  if (body.isActive  !== undefined) trimUpdate.isActive  = Boolean(body.isActive);
  if (body.trimName  !== undefined) trimUpdate.trimName  = body.trimName;
  if (body.source    !== undefined) trimUpdate.source    = body.source;
  if (body.msrpUsd   !== undefined) trimUpdate.msrpUsd   = body.msrpUsd;
  if (Object.keys(trimUpdate).length > 1) {
    await db.update(evTrimsTable).set(trimUpdate).where(eq(evTrimsTable.id, id));
  }

  const profileUpdate: Record<string, unknown> = {};
  if (body.dcConnector          !== undefined) profileUpdate.dcConnector          = body.dcConnector;
  if (body.acConnector          !== undefined) profileUpdate.acConnector          = body.acConnector;
  if (body.batteryKwh           !== undefined) profileUpdate.batteryKwh           = body.batteryKwh;
  if (body.usableKwh            !== undefined) profileUpdate.usableKwh            = body.usableKwh;
  if (body.acMaxKw              !== undefined) profileUpdate.acMaxKw              = body.acMaxKw;
  if (body.dcMaxKw              !== undefined) profileUpdate.dcMaxKw              = body.dcMaxKw;
  if (body.onboardChargerKw     !== undefined) profileUpdate.onboardChargerKw     = body.onboardChargerKw;
  if (body.rangeMiles           !== undefined) profileUpdate.rangeMiles           = body.rangeMiles;
  if (body.typicalMpg           !== undefined) profileUpdate.typicalMpg           = body.typicalMpg;
  if (body.plugAndCharge        !== undefined) profileUpdate.plugAndCharge        = Boolean(body.plugAndCharge);
  if (body.superchargerEligible !== undefined) profileUpdate.superchargerEligible = Boolean(body.superchargerEligible);
  if (body.notes                !== undefined) profileUpdate.notes                = body.notes;

  if (Object.keys(profileUpdate).length > 0) {
    profileUpdate.updatedAt = now;
    const existing = await db
      .select({ id: evChargingProfilesTable.id })
      .from(evChargingProfilesTable)
      .where(eq(evChargingProfilesTable.trimId, id))
      .limit(1);
    if (existing.length > 0) {
      await db.update(evChargingProfilesTable).set(profileUpdate).where(eq(evChargingProfilesTable.trimId, id));
    } else {
      await db.insert(evChargingProfilesTable).values({ trimId: id, ...profileUpdate });
    }
  }

  const [entry] = await catalogJoin(db.select(catalogSelect())).where(eq(evTrimsTable.id, id));
  if (!entry) return res.status(404).json({ error: "entry not found" });
  return res.json(entry);
});

export default router;
