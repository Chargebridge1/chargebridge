import {
  assertCatalogParity,
  catalogInventory,
  expectedCatalogForPrefix,
} from "./catalog-parity.mjs";

const BASELINE_MIGRATION_ID = "chargebridge.phase1b.pre-0004";
const PHASE1B_MIGRATION_IDS = [
  "phase1b.security-enums-and-tables",
  "phase1b.charging-session-request-binding",
  "phase1b.nonunique-stripe-audit-indexes",
  "phase1b.membership-checkout-reservations",
  "phase1b.subscription-reconciliation-events",
  "phase1b.fleet-billing",
  "phase1b.charging-attempts",
];
const HISTORICAL_MIGRATIONS = [
  ["phase2b.session-state-machines", "0001_phase2b_session_state_machines.sql"],
  ["phase2b.invoice-session-idempotency", "0002_invoices_charging_session_unique.sql"],
  ["vehicle-catalog.user-trim-link", "0003_user_vehicles_catalog_trim_id.sql"],
];

const OBJECTS_SQL = `SELECT c.relname AS name, c.relkind::text AS kind,
    COALESCE((
      SELECT json_agg(json_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'notNull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid)
      ) ORDER BY a.attnum)
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    ), '[]'::json) AS columns,
    COALESCE((
       SELECT json_agg(json_build_object(
         'name', con.conname,
         'definition', pg_get_constraintdef(con.oid),
         'type', con.contype::text,
         'validated', con.convalidated,
         'deferrable', con.condeferrable,
         'deferred', con.condeferred
       )
        ORDER BY con.conname)
      FROM pg_constraint con WHERE con.conrelid = c.oid
    ), '[]'::json) AS constraints
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY($1)
  ORDER BY c.relname`;
const ENUMS_SQL = `SELECT t.typname AS name,
    json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public' AND t.typname = ANY($1)
  GROUP BY t.typname ORDER BY t.typname`;
const PUBLIC_ENUMS_SQL = `SELECT t.typname AS name,
    json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
  GROUP BY t.typname ORDER BY t.typname`;
const INDEXES_SQL = `SELECT i.relname AS name, t.relname AS table_name,
    pg_get_indexdef(i.oid) AS definition,
    pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
    ix.indisunique AS unique, am.amname AS method,
    ix.indnatts, ix.indnkeyatts,
    COALESCE((
      SELECT json_agg(json_build_object(
        'name', a.attname,
        'descending', ((ix.indoption[(k.ordinality - 1)::integer] & 1) <> 0),
        'nullsFirst', ((ix.indoption[(k.ordinality - 1)::integer] & 2) <> 0),
        'opclassDefault', opc.opcdefault,
        'collationDefault',
          (ix.indcollation[(k.ordinality - 1)::integer] = a.attcollation)
      ) ORDER BY k.ordinality)
      FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality)
      LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
      LEFT JOIN pg_opclass opc
        ON opc.oid = ix.indclass[(k.ordinality - 1)::integer]
      WHERE k.ordinality <= ix.indnkeyatts
    ), '[]'::json) AS keys,
    ix.indisprimary AS primary, ix.indimmediate AS immediate,
    COALESCE((to_jsonb(ix)->>'indnullsnotdistinct')::boolean, false) AS "nullsNotDistinct",
    ix.indisexclusion AS exclusion, i.reloptions AS "storageParameters",
    ix.indisvalid AS valid, ix.indisready AS ready, ix.indislive AS live
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  JOIN pg_index ix ON ix.indexrelid = i.oid
  JOIN pg_am am ON am.oid = i.relam
  JOIN pg_class t ON t.oid = ix.indrelid
  WHERE n.nspname = 'public' AND i.relname = ANY($1)
  ORDER BY i.relname`;
const TABLE_INDEXES_SQL = INDEXES_SQL
  .replace("i.relname = ANY($1)", "t.relname = ANY($1)")
  .replace("ORDER BY i.relname", "ORDER BY t.relname, i.relname");
const FUNCTIONS_SQL = `SELECT p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    format_type(p.prorettype, NULL) AS returns,
    l.lanname AS language, p.prosrc AS source,
    p.proisstrict AS strict, p.prosecdef AS security_definer,
    p.provolatile AS volatility, p.proparallel AS parallel,
    p.proleakproof AS leakproof, p.proretset AS returns_set,
    p.proconfig AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.proname = ANY($1)
  ORDER BY p.proname, arguments`;
const TRIGGERS_SQL = `SELECT t.tgname AS name, c.relname AS table_name,
    p.proname AS function, t.tgtype AS trigger_type, t.tgenabled AS enabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND (t.tgname = ANY($1) OR c.relname = ANY($2))
  ORDER BY t.tgname`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function inspectInventory(client, inventory) {
  const snapshot = {
    tables: [],
    tableDefinitions: [],
    tableIndexes: [],
    enums: [],
    indexes: [],
    functions: [],
    triggers: [],
    alteredColumns: [],
  };
  const tables = inventory.tables;
  const enums = inventory.enums;
  const indexes = inventory.indexes;
  const functions = inventory.functions;
  const triggers = inventory.triggers;
  const alteredColumnNames = inventory.alteredColumns ?? [];
  const tableNames = [...new Set([
    ...tables,
    ...alteredColumnNames.map((column) => column.split(".")[0]),
  ])];
  if (tableNames.length) {
    snapshot.tableDefinitions = (await client.query(OBJECTS_SQL, [tableNames])).rows;
    snapshot.tableIndexes = (await client.query(TABLE_INDEXES_SQL, [tableNames])).rows;
    const createdTables = new Set(tables);
    snapshot.tables = snapshot.tableDefinitions.filter((row) => createdTables.has(row.name));
  }
  if (enums.length) {
    snapshot.enums = (await client.query(ENUMS_SQL, [enums])).rows;
  }
  if (indexes.length) {
    snapshot.indexes = (await client.query(INDEXES_SQL, [indexes])).rows;
  }
  if (functions.length) {
    snapshot.functions = (await client.query(FUNCTIONS_SQL, [functions])).rows;
  }
  if (triggers.length || tableNames.length) {
    snapshot.triggers = (await client.query(TRIGGERS_SQL, [triggers, tableNames])).rows;
  }
  if (alteredColumnNames.length) {
    const expected = new Set(alteredColumnNames);
    snapshot.alteredColumns = snapshot.tableDefinitions.flatMap((table) =>
      table.columns
        .map((column) => ({ name: `${table.name}.${column.name}` }))
        .filter((column) => expected.has(column.name)));
  }
  return snapshot;
}

export async function verifyCatalogModel(client, expected, label = "Staging schema readiness") {
  const snapshot = await inspectInventory(client, catalogInventory(expected));
  snapshot.enums = (await client.query(PUBLIC_ENUMS_SQL)).rows;
  assertCatalogParity({
    tables: snapshot.tableDefinitions,
    enums: snapshot.enums,
    indexes: snapshot.tableIndexes.map((index) => ({
      ...index,
      table: index.table ?? index.table_name,
    })),
    functions: snapshot.functions,
    triggers: snapshot.triggers.map((trigger) => ({
      ...trigger,
      table: trigger.table ?? trigger.table_name,
      timing: (trigger.trigger_type & 64) ? "INSTEAD OF" :
        (trigger.trigger_type & 2) ? "BEFORE" : "AFTER",
      events: [
        ...(trigger.trigger_type & 4 ? ["INSERT"] : []),
        ...(trigger.trigger_type & 8 ? ["DELETE"] : []),
        ...(trigger.trigger_type & 16 ? ["UPDATE"] : []),
        ...(trigger.trigger_type & 32 ? ["TRUNCATE"] : []),
      ],
      level: trigger.trigger_type & 1 ? "row" : "statement",
    })),
  }, expected, label);
  return snapshot;
}

export async function verifyCatalogPrefix(client, plan, executionOrder, label) {
  return verifyCatalogModel(client, expectedCatalogForPrefix(plan, executionOrder), label);
}

function validateCatalogSnapshot(snapshot) {
  const hash = /^[0-9a-f]{64}$/;
  const bindings = snapshot.sourceBindings;
  assert(snapshot.schemaVersion === 1 &&
    bindings?.baseline?.migrationId === BASELINE_MIGRATION_ID &&
    bindings.baseline.filename === "baseline.sql" &&
    hash.test(bindings.baseline.sha256) &&
    hash.test(bindings.baseline.manifestSha256) &&
    hash.test(bindings.phase1bManifestSha256) &&
    Array.isArray(bindings.historicalProvenance) &&
    bindings.historicalProvenance.length === HISTORICAL_MIGRATIONS.length &&
    Array.isArray(bindings.migrations) &&
    bindings.migrations.length === PHASE1B_MIGRATION_IDS.length,
  "Staging catalog snapshot source bindings are invalid");
  for (let index = 0; index < bindings.historicalProvenance.length; index += 1) {
    const history = bindings.historicalProvenance[index];
    const [migrationId, filename] = HISTORICAL_MIGRATIONS[index];
    assert(history.executionOrder === index + 1 &&
      history.migrationId === migrationId &&
      history.filename === filename &&
      history.mode === "included_in_baseline" &&
      hash.test(history.sha256),
    `Staging catalog snapshot historical provenance mismatch at order ${index + 1}`);
  }
  for (let index = 0; index < bindings.migrations.length; index += 1) {
    const migration = bindings.migrations[index];
    assert(migration.executionOrder === index + 1 &&
      migration.migrationId === PHASE1B_MIGRATION_IDS[index] &&
      typeof migration.filename === "string" &&
      hash.test(migration.sha256) &&
      migration.manifestSha256 === bindings.phase1bManifestSha256,
    `Staging catalog snapshot source binding mismatch at order ${index + 1}`);
  }
  assert(snapshot.catalog && ["tables", "alteredColumns", "constraints", "enums", "indexes",
    "functions", "triggers"].every((key) => Array.isArray(snapshot.catalog[key])),
  "Staging catalog snapshot model is incomplete");
}

/**
 * Read-only catalog check. Supplying a snapshot or pinned plan performs no
 * filesystem access; the API package export deliberately has no SQL loader.
 */
export async function verifyStagingSchemaDefinitions(client, plan) {
  assert(plan, "Schema readiness requires a source-bound catalog snapshot or pinned plan");
  let expected;
  const snapshot = plan.schemaVersion === 1
    ? plan
    : plan.entries?.length === 1 && plan.entries[0].catalog?.schemaVersion === 1
      ? plan.entries[0].catalog
      : null;
  if (snapshot) {
    validateCatalogSnapshot(snapshot);
    expected = snapshot.catalog;
  } else {
    assert(Array.isArray(plan.entries) && plan.entries.length > 0 &&
      plan.entries.every((entry) => entry?.catalog),
    "Schema readiness requires a pinned plan or source-bound catalog snapshot");
    expected = expectedCatalogForPrefix(plan, plan.entries.length - 1);
  }
  await verifyCatalogModel(client, expected, "Staging schema readiness");
  return true;
}