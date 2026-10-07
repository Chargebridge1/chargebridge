import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createInterface } from "node:readline/promises";
import {
  assertExplicitStagingCommand,
  loadStagingMigrationPlan,
  parseStagingTarget,
  STAGING_DATABASE_NAME,
  STAGING_LEDGER_NAME,
  STAGING_LEDGER_SQL_NAME,
  STAGING_LEDGER_DDL,
  validateReceiptRows,
  verifyStagingMigrationEvidence,
} from "./runner-core.mjs";
import {
  assertIndexCatalogParity,
  expectedCatalogForPrefix,
} from "./catalog-parity.mjs";
import {
  inspectInventory,
  verifyCatalogPrefix,
  verifyStagingSchemaDefinitions,
} from "./staging-catalog-verifier.mjs";

const IDENTITY_SQL = `SELECT identity_id, environment, current_database() AS database_name,
  current_user AS database_role
  FROM public.chargebridge_database_identity LIMIT 2`;
const LEDGER_SHAPE_SQL = `SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = $1
  ORDER BY ordinal_position`;
const LEDGER_CONSTRAINTS_SQL = `SELECT constraint_type, constraint_definition, constraint_name
  FROM (
    SELECT c.contype::text AS constraint_type, pg_get_constraintdef(c.oid) AS constraint_definition,
      c.conname AS constraint_name
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass($1)
    UNION ALL
    SELECT 'CHECK'::text, pg_get_constraintdef(c.oid), c.conname
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass($1) AND c.contype = 'c'
  ) constraints`;
const FRESH_PUBLIC_SCHEMA_SQL = `SELECT c.relname AS name, c.relkind::text AS kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = c.oid
  LEFT JOIN pg_class indexed_table ON indexed_table.oid = ix.indrelid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')
    AND c.relname NOT IN ('chargebridge_database_identity', 'chargebridge_staging_migration_ledger')
    AND COALESCE(indexed_table.relname, '') NOT IN (
      'chargebridge_database_identity', 'chargebridge_staging_migration_ledger'
    )
  UNION ALL
  SELECT t.typname AS name, t.typtype::text AS kind
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
  UNION ALL
  SELECT p.proname AS name, 'function'::text AS kind
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT t.tgname AS name, 'trigger'::text AS kind
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND c.relname NOT IN ('chargebridge_database_identity', 'chargebridge_staging_migration_ledger')
  ORDER BY name`;
const CONCURRENT_INDEX_TARGETS = [
  { name: "users_stripe_customer_idx", table: "users", column: "stripe_customer_id", predicate: "IS NOT NULL" },
  { name: "charging_sessions_stripe_payment_intent_idx", table: "charging_sessions", column: "stripe_payment_intent_id", predicate: "IS NOT NULL" },
  { name: "stripe_refund_jobs_due_idx", table: "stripe_refund_jobs", column: "next_retry_at", predicate: "succeeded_at IS NULL" },
];
const CONCURRENT_INDEXES_SQL = `SELECT i.relname AS name, t.relname AS table_name,
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
  FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = i.relam
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = ANY($1)
  ORDER BY t.relname, i.relname`;
const EXECUTOR_LOCK_KEY = 1_128_411_988;

// Adoption does not lock a PostgreSQL namespace. The operator must establish an
// exclusive staging DDL maintenance window; advisory/table locks supplement it.
const ADOPTION_ACTIVITY_SQL = `/* adoption activity */
  SELECT pid FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
    AND backend_type = 'client backend'`;
const ADOPTION_RELATIONS_SQL = `/* adoption relations */
  SELECT c.relname AS name, c.relkind::text AS kind, c.relispartition,
    parent.relname AS table_name,
    COALESCE(parent_ns.nspname, '') AS table_schema,
    marker_attribute.attname AS marker_column,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
      WHERE con.conindid = c.oid AND con.convalidated
        AND NOT con.condeferrable AND NOT con.condeferred
        AND cardinality(con.conkey) = 1
        AND ((con.contype = 'p' AND a.attname = 'identity_id')
          OR (con.contype = 'u' AND a.attname = 'environment'))
    ) AND ix.indisvalid AND ix.indisready AND ix.indislive
      AND ix.indisunique AND ix.indimmediate
      AND ix.indnatts = 1 AND ix.indnkeyatts = 1
      AND ix.indexprs IS NULL AND ix.indpred IS NULL AS marker_support
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_index ix ON ix.indexrelid = c.oid
  LEFT JOIN pg_catalog.pg_class parent ON parent.oid = ix.indrelid
  LEFT JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  LEFT JOIN pg_catalog.pg_attribute marker_attribute
    ON marker_attribute.attrelid = parent.oid AND marker_attribute.attnum = ix.indkey[0]
  WHERE n.nspname = 'public' ORDER BY c.relname`;
const ADOPTION_TYPES_SQL = `/* adoption types */
  SELECT t.typname AS name, t.typtype::text AS kind,
    CASE WHEN rn.nspname = 'public' THEN c.relname END AS row_table,
    CASE WHEN en.nspname = 'public' AND t.oid = element.typarray
      THEN element.typname END AS array_element
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_class c ON c.oid = t.typrelid
  LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_type element ON element.oid = t.typelem
  LEFT JOIN pg_catalog.pg_namespace en ON en.oid = element.typnamespace
  WHERE n.nspname = 'public' ORDER BY t.typname`;
const ADOPTION_ROUTINES_SQL = `/* adoption routines */
  SELECT p.proname AS name, 'function' AS kind
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT t.tgname, 'trigger'
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT e.evtname, 'event_trigger' FROM pg_catalog.pg_event_trigger e`;
const ADOPTION_SEQUENCES_SQL = `/* adoption sequences */
  SELECT seq.relname AS name, parent.relname AS table_name, a.attname AS column_name,
    pn.nspname AS table_schema, d.deptype::text AS dependency,
    pg_catalog.format_type(s.seqtypid, NULL) AS type,
    s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle
  FROM pg_catalog.pg_class seq JOIN pg_catalog.pg_namespace n ON n.oid = seq.relnamespace
  JOIN pg_catalog.pg_sequence s ON s.seqrelid = seq.oid
  LEFT JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_class'::regclass
    AND d.objid = seq.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass
    AND d.deptype IN ('a', 'i')
  LEFT JOIN pg_catalog.pg_class parent ON parent.oid = d.refobjid
  LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = parent.oid AND a.attnum = d.refobjsubid
  WHERE n.nspname = 'public' ORDER BY seq.relname`;

export function baselineSeedRows(sql) {
  const inserts = [...sql.matchAll(/\bINSERT\s+INTO\b/gi)];
  const match = sql.match(/INSERT INTO button_configs \(key, label, platform, location, description, enabled\) VALUES\s*([\s\S]+);\s*$/);
  assert(inserts.length === 1 && match,
    "Staging adoption baseline seed syntax is unsupported");
  const fields = ["key", "label", "platform", "location", "description", "enabled"];
  const rows = [];
  let remaining = match[1].trim();
  const tuple = /^\(\s*('(?:[^'\\]|'')*')\s*,\s*('(?:[^'\\]|'')*')\s*,\s*('(?:[^'\\]|'')*')\s*,\s*('(?:[^'\\]|'')*')\s*,\s*('(?:[^'\\]|'')*')\s*,\s*(TRUE|FALSE)\s*\)/;
  while (remaining) {
    const row = remaining.match(tuple);
    assert(row, "Staging adoption baseline seed syntax is unsupported");
    rows.push(Object.fromEntries(fields.map((field, index) => [field,
      index === 5 ? row[index + 1] === "TRUE" : row[index + 1].slice(1, -1).replaceAll("''", "'")])));
    remaining = remaining.slice(row[0].length).trim();
    if (!remaining) break;
    assert(remaining.startsWith(",") && remaining.slice(1).trim(),
      "Staging adoption baseline seed syntax is unsupported");
    remaining = remaining.slice(1).trim();
  }
  assert(rows.length === 26 && new Set(rows.map((row) => row.key)).size === 26,
    "Staging adoption requires exactly 26 approved baseline seeds");
  return rows;
}

async function verifyAdoptionInventory(client, expected) {
  const tables = new Set([...expected.tables.map((table) => table.name), "chargebridge_database_identity"]);
  const indexes = new Map(expected.indexes.map((index) => [index.name, index.table]));
  const sequences = new Map();
  for (const table of expected.tables) {
    for (const column of table.columns) {
      if (!column.default?.includes("nextval")) continue;
      const sequence = column.default.match(/^nextval\('([a-z_][a-z0-9_]*)'::regclass\)$/);
      assert(sequence && ["integer", "bigint"].includes(column.type),
        "Staging adoption sequence contract is unsupported");
      sequences.set(sequence[1], { table: table.name, column: column.name, type: column.type });
    }
  }
  const relations = (await client.query(ADOPTION_RELATIONS_SQL)).rows;
  const seenTables = new Set(), seenIndexes = new Set(), seenSequences = new Set();
  let markerIndexes = 0;
  const markerColumns = new Set();
  for (const row of relations) {
    assert(!row.relispartition, "Staging adoption rejects partition structures");
    if (row.kind === "r" && tables.has(row.name)) seenTables.add(row.name);
    else if (row.kind === "i" && row.table_schema === "public" && indexes.get(row.name) === row.table_name)
      seenIndexes.add(row.name);
    else if (row.kind === "i" && row.table_schema === "public" &&
      row.table_name === "chargebridge_database_identity" && row.marker_support === true) {
      markerIndexes++;
      markerColumns.add(row.marker_column);
    }
    else if (row.kind === "S" && sequences.has(row.name)) seenSequences.add(row.name);
    else throw new Error("Staging adoption found an unexpected public relation");
  }
  assert(seenTables.size === tables.size && seenIndexes.size === indexes.size &&
    seenSequences.size === sequences.size && markerIndexes === 2 &&
    markerColumns.size === 2 && markerColumns.has("identity_id") && markerColumns.has("environment"),
  "Staging adoption public inventory is incomplete or ambiguous");
  const enumNames = new Set(expected.enums.map((entry) => entry.name));
  const types = (await client.query(ADOPTION_TYPES_SQL)).rows;
  assert(types.every((row) =>
    (row.kind === "e" && enumNames.has(row.name)) ||
    (row.kind === "c" && row.row_table === row.name && tables.has(row.name)) ||
    (row.kind === "b" && (tables.has(row.array_element) || enumNames.has(row.array_element)))),
  "Staging adoption found an unexpected public type");
  assert((await client.query(ADOPTION_ROUTINES_SQL)).rows.length === 0,
    "Staging adoption found unexpected functions, triggers or event triggers");
  const sequenceRows = (await client.query(ADOPTION_SEQUENCES_SQL)).rows;
  assert(sequenceRows.length === sequences.size && new Set(sequenceRows.map((row) => row.name)).size === sequences.size,
    "Staging adoption sequence inventory mismatch");
  for (const row of sequenceRows) {
    const approved = sequences.get(row.name);
    assert(approved && row.table_schema === "public" && row.table_name === approved.table &&
      row.column_name === approved.column && row.type === approved.type && row.dependency === "a" &&
      Number(row.seqstart) === 1 && Number(row.seqincrement) === 1 && Number(row.seqmin) === 1 &&
      String(row.seqmax) === (approved.type === "integer" ? "2147483647" : "9223372036854775807") &&
      Number(row.seqcache) === 1 && row.seqcycle === false,
    "Staging adoption sequence definition or ownership mismatch");
  }
}

async function verifyAdoptionSeeds(client, expected) {
  const rows = (await client.query(
    "SELECT key, label, platform, location, description, enabled FROM public.button_configs ORDER BY key",
  )).rows;
  const signature = (values) => JSON.stringify([...values].sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => [row.key, row.label, row.platform, row.location, row.description, row.enabled]));
  assert(signature(rows) === signature(expected), "Staging adoption baseline seed verification failed");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equalColumns(actual, expected, label) {
  assert(actual.length === expected.length, `${label} has an unexpected column count`);
  for (let index = 0; index < expected.length; index += 1) {
    assert(actual[index].column_name === expected[index][0] &&
      actual[index].data_type === expected[index][1] &&
      actual[index].is_nullable === expected[index][2],
    `${label} has an unexpected column definition`);
  }
}

export function parseConcurrentIndexStatements(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, "");
  const statements = withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert(statements.length === 9, "0006 must contain exactly six timeout settings and three index statements");
  const parsed = [];
  for (let index = 0; index < statements.length; index += 3) {
    const lockTimeout = statements[index];
    const statementTimeout = statements[index + 1];
    const createIndex = statements[index + 2];
    assert(/^SET\s+lock_timeout\s*=\s*'5s'$/i.test(lockTimeout),
      "0006 lock_timeout must remain exactly 5s before every index");
    assert(/^SET\s+statement_timeout\s*=\s*'30min'$/i.test(statementTimeout),
      "0006 statement_timeout must remain exactly 30min before every index");
    assert(/^CREATE\s+INDEX\s+CONCURRENTLY\b/i.test(createIndex),
      "0006 may execute only one CREATE INDEX CONCURRENTLY per connection");
    const match = createIndex.match(/^CREATE\s+INDEX\s+CONCURRENTLY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)\b/i);
    const expected = CONCURRENT_INDEX_TARGETS[parsed.length];
    assert(match && expected && match[1] === expected.name && match[2] === expected.table,
      "0006 concurrent index name/table differs from the approved index");
    assert(new RegExp(`\\b${expected.column}\\b`, "i").test(createIndex) &&
      /USING\s+btree/i.test(createIndex),
    `0006 ${expected.name} index definition is unexpected`);
    const whereClause = expected.predicate === "IS NOT NULL"
      ? `${expected.column} IS NOT NULL`
      : expected.predicate;
    const canonical = `CREATE INDEX CONCURRENTLY ${expected.name} ON ${expected.table} USING btree ( ${expected.column} ASC NULLS LAST ) WHERE ${whereClause}`;
    assert(createIndex.replace(/\s+/g, " ").trim().toLowerCase() === canonical.toLowerCase(),
      `0006 ${expected.name} definition differs from the approved concurrent-index plan`);
    parsed.push({ ...expected, sql: `${createIndex};` });
  }
  assert(parsed.length === CONCURRENT_INDEX_TARGETS.length,
    "0006 must retain exactly three approved concurrent indexes");
  return parsed;
}

export function createVerifiedPgClient(target) {
  const connectionUrl = new URL(target.connectionString);
  assert(connectionUrl.searchParams.get("sslmode") === "verify-full",
    "Staging PostgreSQL client requires the validated sslmode=verify-full target");
  connectionUrl.searchParams.delete("sslmode");
  const client = new pg.Client({
    connectionString: connectionUrl.toString(),
    ssl: { rejectUnauthorized: true, servername: target.host },
    connectionTimeoutMillis: 5_000,
    application_name: "chargebridge-staging-phase1b-migrator",
  });
  return client;
}

export function assertVerifiedTls(client) {
  const stream = client.connection?.stream;
  assert(stream?.encrypted === true && stream.authorized === true,
    "Staging migration requires a TLS connection with a verified server certificate");
}

export async function verifyIdentityOnConnection(client, target) {
  assertVerifiedTls(client);
  const result = await client.query(IDENTITY_SQL);
  assert(result.rows.length === 1,
    "Staging database identity marker is missing or ambiguous");
  const row = result.rows[0];
  assert(row.identity_id === target.identityId &&
    row.environment === "staging" &&
    row.database_name === STAGING_DATABASE_NAME &&
    row.database_role === target.role,
  "Staging database identity, host, name, role, or environment mismatch");
}

function assertNoInventoryCollisions(snapshot, label) {
  const found = snapshot.tables.length > 0 ||
    snapshot.enums.length > 0 ||
    snapshot.indexes.length > 0 ||
    snapshot.functions.length > 0 ||
    snapshot.triggers.length > 0 ||
    snapshot.alteredColumns.length > 0;
  assert(!found, `${label} has unexplained pre-existing objects; refusing to replay`);
}

function assertInventoryComplete(snapshot, inventory, label) {
  const actual = {
    tables: new Set(snapshot.tables.filter((row) => ["r", "p"].includes(row.kind))
      .map((row) => row.name)),
    enums: new Set(snapshot.enums.map((row) => row.name)),
    indexes: new Set(snapshot.indexes.map((row) => row.name)),
    functions: new Set(snapshot.functions.map((row) => row.name)),
    triggers: new Set(snapshot.triggers.map((row) => row.name)),
    alteredColumns: new Set(snapshot.alteredColumns.map((row) => row.name)),
  };
  const missing = Object.entries(inventory).flatMap(([kind, names]) =>
    names.filter((name) => !actual[kind].has(name)).map((name) => `${kind}:${name}`));
  assert(missing.length === 0,
    `${label} is missing manifest objects (${missing.join(", ")}); refusing to record completion`);
  for (const index of snapshot.indexes) {
    assert(index.valid === true && index.ready === true && index.live === true,
      `${label} produced an invalid or unready index; refusing to record completion`);
  }
}

async function verifyLedgerSchema(client) {
  const { rows: columns } = await client.query(LEDGER_SHAPE_SQL, [STAGING_LEDGER_NAME]);
  equalColumns(columns, [
    ["migration_id", "text", "NO"],
    ["filename", "text", "NO"],
    ["sha256", "text", "NO"],
    ["execution_order", "integer", "NO"],
    ["completed_at", "timestamp with time zone", "NO"],
    ["mode", "text", "NO"],
    ["target_environment", "text", "NO"],
    ["receipt_kind", "text", "NO"],
  ], "Staging migration receipt ledger");
  assert(columns.at(-1).column_default === "'executed'::text",
    "Staging migration receipt provenance default is invalid");
  const { rows: constraints } = await client.query(LEDGER_CONSTRAINTS_SQL, [STAGING_LEDGER_SQL_NAME]);
  const definitions = constraints.map((row) => row.constraint_definition.toLowerCase());
  assert(definitions.some((definition) => definition.includes("primary key (migration_id)")),
    "Staging migration receipt ledger is missing its migration_id primary key");
  assert(definitions.some((definition) => definition.includes("unique (filename)")) &&
    definitions.some((definition) => definition.includes("unique (execution_order)")),
  "Staging migration receipt ledger is missing required unique constraints");
  assert(definitions.some((definition) =>
    definition.includes("target_environment = 'staging'")),
  "Staging migration receipt ledger lacks its staging-only target constraint");
  const normalizeCheck = (text) => text.toLowerCase().replaceAll("::text", "").replace(/[\s()[\]]/g, "");
  const kind = constraints.find((row) => row.constraint_name === "staging_receipt_kind_check");
  const scope = constraints.find((row) => row.constraint_name === "staging_adoption_scope_check");
  assert(kind && [
    "checkreceipt_kindin'executed','verified_adopted'",
    "checkreceipt_kind=anyarray'executed','verified_adopted'",
  ].includes(normalizeCheck(kind.constraint_definition)),
  "Staging migration receipt ledger lacks its exact provenance constraint");
  assert(scope && normalizeCheck(scope.constraint_definition) ===
    "checkreceipt_kind='executed'orexecution_order=0andmigration_id='chargebridge.phase1b.pre-0004'orexecution_order=1andmigration_id='phase1b.security-enums-and-tables'",
  "Staging migration receipt ledger lacks its exact adoption scope constraint");
}

async function ledgerExists(client) {
  const { rows } = await client.query(
    "SELECT to_regclass($1) IS NOT NULL AS ledger_exists",
    [STAGING_LEDGER_SQL_NAME],
  );
  return rows.length === 1 && rows[0].ledger_exists === true;
}

async function assertFreshPublicSchema(client) {
  const { rows } = await client.query(FRESH_PUBLIC_SCHEMA_SQL);
  assert(rows.length === 0,
    `Staging baseline requires an empty public schema; found ${rows.map((row) => row.name).join(", ")}`);
}

async function readLedger(client, plan) {
  if (!(await ledgerExists(client))) return [];
  await verifyLedgerSchema(client);
  const { rows } = await client.query(
    `SELECT migration_id, filename, sha256, execution_order, completed_at, mode,
      target_environment, receipt_kind
     FROM ${STAGING_LEDGER_SQL_NAME}
     ORDER BY execution_order`,
  );
  validateReceiptRows(rows, plan);
  return rows;
}

async function recordReceipt(client, entry, receiptKind = "executed") {
  const { rows } = await client.query(
    `INSERT INTO ${STAGING_LEDGER_SQL_NAME}
       (migration_id, filename, sha256, execution_order, completed_at, mode, target_environment, receipt_kind)
     VALUES ($1, $2, $3, $4, clock_timestamp(), $5, 'staging', $6)
     RETURNING migration_id, filename, sha256, execution_order, completed_at, mode, target_environment, receipt_kind`,
    [
      entry.migrationId,
      entry.filename,
      entry.sha256,
      entry.executionOrder,
      entry.transactionMode,
      receiptKind,
    ],
  );
  assert(rows.length === 1 && rows[0].migration_id === entry.migrationId &&
    rows[0].receipt_kind === receiptKind,
    "Staging migration receipt insert was not verifiable");
}

function existingConcurrentIndexesAreComplete(rows) {
  const relevant = rows.filter((index) => CONCURRENT_INDEX_TARGETS.some((target) =>
    target.name === index.name || (
      target.table === index.table_name &&
      new RegExp(`\\b${target.column}\\b`, "i").test(index.definition) &&
      new RegExp(target.predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        .test(index.predicate ?? "")
    )));
  if (relevant.length !== CONCURRENT_INDEX_TARGETS.length) return false;
  return CONCURRENT_INDEX_TARGETS.every((expected) => {
    const item = relevant.find((row) => row.name === expected.name);
    return matchesConcurrentIndex(item, expected) &&
      item.valid === true && item.ready === true && item.live === true;
  });
}

async function queryConcurrentIndexes(client) {
  const tables = [...new Set(CONCURRENT_INDEX_TARGETS.map((item) => item.table))];
  return (await client.query(CONCURRENT_INDEXES_SQL, [tables])).rows;
}

function phase1bIndexSql(entry) {
  return parseConcurrentIndexStatements(entry.sql);
}

function findConcurrentIndex(indexRows, expected) {
  return indexRows.find((index) => {
    const target = CONCURRENT_INDEX_TARGETS.find((candidate) =>
      candidate.name === index.name || (
        candidate.table === index.table_name &&
        new RegExp(`\\b${candidate.column}\\b`, "i").test(index.definition) &&
        new RegExp(candidate.predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
          .test(index.predicate ?? "")
      ));
    return target?.name === expected.name;
  });
}

function matchesConcurrentIndex(index, expected) {
  if (!index || index.table_name !== expected.table ||
      !/USING\s+btree/i.test(index.definition) ||
      !new RegExp(`\\b${expected.column}\\b`, "i").test(index.definition)) return false;
  const expectedPredicate = expected.predicate === "IS NOT NULL"
    ? `${expected.column} IS NOT NULL`
    : expected.predicate;
  const normalize = (value) => value?.toLowerCase().replace(/["()]/g, "")
    .replace(/\s+/g, " ").trim();
  return normalize(index.predicate) === normalize(expectedPredicate);
}

function assertConcurrentIndexProgress(indexRows, completedIndexes, expectedIndexes = []) {
  for (const index of indexRows) {
    const target = CONCURRENT_INDEX_TARGETS.find((candidate) =>
      candidate.name === index.name || (
        candidate.table === index.table_name &&
        new RegExp(`\\b${candidate.column}\\b`, "i").test(index.definition) &&
        new RegExp(candidate.predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
          .test(index.predicate ?? "")
      ));
    if (!target) continue;
    const targetOrder = CONCURRENT_INDEX_TARGETS.indexOf(target);
    assert(targetOrder < completedIndexes,
      "0006 has an unexplained or partial concurrent index; manual review required");
    assert(index.name === target.name && index.table_name === target.table &&
      matchesConcurrentIndex(index, target) &&
      index.valid === true && index.ready === true && index.live === true,
    "0006 has an invalid or equivalent pre-existing index; manual review required");
    const expectedDefinition = expectedIndexes.find((item) => item.name === target.name);
    if (targetOrder < completedIndexes && expectedDefinition) {
      assertIndexCatalogParity({ ...index, table: index.table_name }, expectedDefinition,
        `0006 index ${expectedDefinition.name}`);
    }
  }
  for (let index = 0; index < completedIndexes; index += 1) {
    const expected = CONCURRENT_INDEX_TARGETS[index];
    const found = findConcurrentIndex(indexRows, expected);
    assert(found?.name === expected.name && found.valid === true &&
      matchesConcurrentIndex(found, expected) && found.ready === true && found.live === true,
    "0006 is missing a previously completed concurrent index");
  }
}

async function applyTransactionalEntry(client, entry, { createLedger = false, plan } = {}) {
  if (entry.transactionMode === "included_in_baseline") {
    const snapshot = await inspectInventory(client, entry.objects);
    assertInventoryComplete(snapshot, entry.objects, entry.migrationId);
    await recordReceipt(client, entry);
    return;
  }

  const before = await inspectInventory(client, entry.objects);
  assertNoInventoryCollisions(before, entry.migrationId);
  await client.query("BEGIN");
  try {
    if (createLedger) await client.query(STAGING_LEDGER_DDL);
    await client.query(entry.sql);
    const after = await inspectInventory(client, entry.objects);
    assertInventoryComplete(after, entry.objects, entry.migrationId);
    await verifyCatalogPrefix(client, plan, entry.executionOrder, entry.migrationId);
    await recordReceipt(client, entry);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function applyConcurrentEntry(entry, { target, connect, plan }) {
  const indexes = phase1bIndexSql(entry);
  assert(indexes.length === CONCURRENT_INDEX_TARGETS.length,
    "0006 must retain all three approved concurrent indexes");

  for (const [indexOrder, expected] of indexes.entries()) {
    const expectedDefinition = entry.catalog.indexes.find((item) => item.name === expected.name);
    assert(expectedDefinition, `0006 ${expected.name} has no pinned semantic index definition`);
    const client = await connect(target);
    try {
      await client.connect();
      await verifyIdentityOnConnection(client, target);
      const existing = await queryConcurrentIndexes(client);
      assertConcurrentIndexProgress(existing, indexOrder, entry.catalog.indexes);
      await client.query("SET lock_timeout = '5s'");
      await client.query("SET statement_timeout = '30min'");
      await client.query(expected.sql);
      const after = await queryConcurrentIndexes(client);
      assertConcurrentIndexProgress(after, indexOrder + 1, entry.catalog.indexes);
      const created = after.find((row) => row.name === expected.name);
      assert(matchesConcurrentIndex(created, expected) &&
        created.valid === true && created.ready === true && created.live === true,
      `0006 index ${expected.name} failed validity/readiness verification; execution stopped`);
      assertIndexCatalogParity({ ...created, table: created.table_name }, expectedDefinition,
        `0006 index ${expected.name}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const receiptClient = await connect(target);
  try {
    await receiptClient.connect();
    await verifyIdentityOnConnection(receiptClient, target);
    const finalIndexes = await queryConcurrentIndexes(receiptClient);
    assert(existingConcurrentIndexesAreComplete(finalIndexes),
      "0006 final index set is incomplete or invalid; no receipt will be recorded");
    await verifyCatalogPrefix(receiptClient, plan, entry.executionOrder, entry.migrationId);
    await receiptClient.query("BEGIN");
    try {
      const ledgerRows = await readLedger(receiptClient, plan);
      assert(ledgerRows.length === entry.executionOrder,
        "0006 is not the next approved receipt; refusing to record completion");
      await recordReceipt(receiptClient, entry);
      await receiptClient.query("COMMIT");
    } catch (error) {
      await receiptClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await receiptClient.end().catch(() => undefined);
  }
}

async function verifyRecordedObjects(client, entry, plan, highestRecordedOrder) {
  if (entry.migrationId === "phase1b.nonunique-stripe-audit-indexes") {
    const rows = await queryConcurrentIndexes(client);
    assert(existingConcurrentIndexesAreComplete(rows),
      "Recorded 0006 indexes are missing, invalid, unready, or conflicting");
  }
  await verifyCatalogPrefix(client, plan, highestRecordedOrder, entry.migrationId);
}

async function applyEntry(entry, { target, connect, plan, ledgerExisted }) {
  const client = await connect(target);
  let clientEnded = false;
  try {
    await client.connect();
    await verifyIdentityOnConnection(client, target);
    const receiptRows = await readLedger(client, plan);
    const nextOrder = receiptRows.length;
    if (entry.executionOrder < nextOrder) {
      const receipt = receiptRows[entry.executionOrder];
      assert(receipt.migration_id === entry.migrationId &&
        receipt.filename === entry.filename &&
        receipt.sha256 === entry.sha256 &&
        receipt.mode === entry.transactionMode,
      "Staging migration receipt does not match the approved execution plan");
      await verifyRecordedObjects(client, entry, plan, nextOrder - 1);
      return;
    }
    assert(entry.executionOrder === nextOrder,
      "Staging migration receipts are not an exact prefix of the approved order");

    if (entry.executionOrder === 0) await assertFreshPublicSchema(client);

    if (entry.migrationId === "phase1b.nonunique-stripe-audit-indexes") {
      const existingIndexes = await queryConcurrentIndexes(client);
      assertConcurrentIndexProgress(existingIndexes, 0);
      await client.end();
      clientEnded = true;
      await applyConcurrentEntry(entry, { target, connect, plan });
      return;
    }

    await applyTransactionalEntry(client, entry, {
      createLedger: entry.executionOrder === 0 && !ledgerExisted,
      plan,
    });
  } finally {
    if (!clientEnded) await client.end().catch(() => undefined);
  }
}

function pgConnector(target) {
  return createVerifiedPgClient(target);
}

export async function adoptStagingBaselineAnd0004(options = {}) {
  assert(Object.keys(options).every((key) => ["env", "connect", "maintenanceConfirmed"].includes(key)),
    "Staging adoption refuses scope or plan overrides");
  const { env = process.env, connect = pgConnector, maintenanceConfirmed = false } = options;
  assert(maintenanceConfirmed === true,
    "Staging adoption requires an independently established exclusive DDL maintenance window");
  const plan = loadStagingMigrationPlan();
  assert(plan.entries.length === 8 &&
    plan.entries[0].executionOrder === 0 &&
    plan.entries[0].migrationId === "chargebridge.phase1b.pre-0004" &&
    plan.entries[0].transactionMode === "baseline" &&
    plan.entries[1].executionOrder === 1 &&
    plan.entries[1].migrationId === "phase1b.security-enums-and-tables" &&
    plan.entries[1].transactionMode === "transactional",
  "Staging adoption refuses a different canonical prefix");
  const seeds = baselineSeedRows(plan.baseline.sql);
  const expected = expectedCatalogForPrefix(plan, 1);
  const target = parseStagingTarget(env);
  const client = await connect(target);
  let locked = false, transaction = false;
  try {
    await client.connect();
    await verifyIdentityOnConnection(client, target);
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1, 1) AS acquired", [EXECUTOR_LOCK_KEY]);
    assert(rows.length === 1 && rows[0].acquired === true,
      "Another staging migration executor holds the database lock");
    locked = true;
    assert(!(await ledgerExists(client)), "Staging adoption requires the ledger to be absent");
    // READ COMMITTED deliberately takes fresh catalog snapshots after locking.
    // This is not a namespace lock: maintenance exclusion remains a prerequisite.
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    transaction = true;
    // Inherit the normal staging connection's search_path: the shared catalog
    // comparator relies on its type/default/FK rendering. Adoption SQL stays qualified.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10min'");
    const assertQuiet = async () => assert((await client.query(ADOPTION_ACTIVITY_SQL)).rows.length === 0,
      "Staging adoption detected concurrent database sessions");
    await assertQuiet();
    const tableNames = [...expected.tables.map((table) => table.name), "chargebridge_database_identity"].sort();
    assert(tableNames.every((name) => /^[a-z_][a-z0-9_]*$/.test(name)),
      "Staging adoption table identifiers are invalid");
    for (const name of tableNames) {
      await client.query(`LOCK TABLE ONLY public."${name}" IN ACCESS EXCLUSIVE MODE`);
    }
    await verifyIdentityOnConnection(client, target);
    assert(!(await ledgerExists(client)), "Staging adoption detected an existing ledger");
    await verifyAdoptionInventory(client, expected);
    await verifyCatalogPrefix(client, plan, 1, "Staging adoption baseline and 0004");
    await verifyAdoptionSeeds(client, seeds);
    // Repeat fresh reads immediately before recording; no claim of protection
    // against an uncooperative administrator outside the maintenance boundary.
    await assertQuiet();
    await verifyAdoptionInventory(client, expected);
    await verifyCatalogPrefix(client, plan, 1, "Staging adoption final prefix check");
    await verifyAdoptionSeeds(client, seeds);
    assert(!(await ledgerExists(client)), "Staging adoption detected concurrent ledger creation");
    await client.query(STAGING_LEDGER_DDL);
    await recordReceipt(client, plan.entries[0], "verified_adopted");
    await recordReceipt(client, plan.entries[1], "verified_adopted");
    await verifyLedgerSchema(client);
    const receipts = await readLedger(client, plan);
    assert(receipts.length === 2 && receipts.every((row) => row.receipt_kind === "verified_adopted"),
      "Staging adoption did not establish exactly the approved two-entry prefix");
    await assertQuiet();
    await client.query("COMMIT");
    transaction = false;
    return { migrationsRecorded: 2, database: STAGING_DATABASE_NAME, receiptKind: "verified_adopted" };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1, 1)", [EXECUTOR_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

// Supported executor. Always reload and validate the pinned staging-only plan
// before a network connection; caller-supplied historical plans are ignored.
export async function runStagingMigrations({ env = process.env, connect = pgConnector } = {}) {
  const plan = loadStagingMigrationPlan();
  return executeStagingPlanForTests({ env, plan, connect });
}

// Kept for isolated mocked-connector tests of the execution state machine.
// The CLI and all application entrypoints use runStagingMigrations above.
export async function executeStagingPlanForTests({
  env = process.env,
  plan,
  connect = pgConnector,
} = {}) {
  const selectedPlan = plan ?? loadStagingMigrationPlan();
  const target = parseStagingTarget(env);

  const guard = await connect(target);
  let guardLocked = false;
  let hasLedger = false;
  try {
    await guard.connect();
    await verifyIdentityOnConnection(guard, target);
    const { rows: lockRows } = await guard.query(
      "SELECT pg_try_advisory_lock($1, 1) AS acquired",
      [EXECUTOR_LOCK_KEY],
    );
    assert(lockRows.length === 1 && lockRows[0].acquired === true,
      "Another staging migration executor holds the database lock");
    guardLocked = true;
    hasLedger = await ledgerExists(guard);
    if (hasLedger) await verifyLedgerSchema(guard);

    for (const entry of selectedPlan.entries) {
      await applyEntry(entry, {
        target,
        connect,
        plan: selectedPlan,
        ledgerExisted: hasLedger,
      });
      hasLedger = true;
    }

    const finalClient = await connect(target);
    try {
      await finalClient.connect();
      await verifyIdentityOnConnection(finalClient, target);
      await verifyLedgerSchema(finalClient);
      await verifyStagingMigrationEvidence(finalClient, selectedPlan);
      await verifyStagingSchemaDefinitions(finalClient, selectedPlan);
    } finally {
      await finalClient.end().catch(() => undefined);
    }
  } finally {
    if (guardLocked) {
      await guard.query("SELECT pg_advisory_unlock($1, 1)", [EXECUTOR_LOCK_KEY])
        .catch(() => undefined);
    }
    await guard.end().catch(() => undefined);
  }
  return { migrationsRecorded: selectedPlan.entries.length, database: STAGING_DATABASE_NAME };
}

export async function verifyStagingReadiness(client, plan) {
  await verifyLedgerSchema(client);
  await verifyStagingMigrationEvidence(client, plan);
  return verifyStagingSchemaDefinitions(client, plan);
}

export { verifyStagingMigrationEvidence, verifyStagingSchemaDefinitions };

export async function main(argv = process.argv.slice(2)) {
  const command = assertExplicitStagingCommand(argv);
  if (command === "--adopt-baseline-and-0004") {
    assert(process.stdin.isTTY && process.stdout.isTTY,
      "Staging adoption requires interactive maintenance confirmation");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let confirmed;
    try {
      confirmed = await terminal.question(
        "Confirm an independently established exclusive staging DDL maintenance window. Table/advisory locks do not exclude administrators. Type STAGING_DDL_MAINTENANCE_CONFIRMED: ",
      );
    } finally {
      terminal.close();
    }
    return adoptStagingBaselineAnd0004({
      maintenanceConfirmed: confirmed === "STAGING_DDL_MAINTENANCE_CONFIRMED",
    });
  }
  // Validate both pinned manifests and every SQL checksum before opening a socket.
  return runStagingMigrations({ env: process.env });
}

// Bundlers can rewrite import.meta.url to their application entrypoint. Never
// invoke a migration merely because the API imports the read-only verifier.
if (process.argv[1] && path.basename(process.argv[1]) === "runner.mjs" &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(({ migrationsRecorded, receiptKind }) => {
    console.log(receiptKind === "verified_adopted"
      ? "Verified and adopted exactly baseline and 0004. Stopped before 0005."
      : `Verified and recorded ${migrationsRecorded} staging baseline and Phase 1B receipts.`);
  }).catch((error) => {
    if (process.argv.includes("--adopt-baseline-and-0004")) {
      console.error("Staging adoption failed closed. No later migrations were invoked. If the connection failed during commit, independently check the outcome before proceeding.");
      process.exitCode = 1;
      return;
    }
    // Deliberately avoid printing connection strings, SQL, or PostgreSQL driver objects.
    const safeMessage = error instanceof Error && /^[A-Za-z0-9 .,:_/'()-]{1,240}$/.test(error.message)
      ? error.message
      : "Staging migration failed closed; inspect the approved target and executor output.";
    console.error(safeMessage);
    process.exitCode = 1;
  });
}