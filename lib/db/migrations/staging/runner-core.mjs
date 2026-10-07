import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../phase1b-migration-ledger.mjs";
import { parseExpectedCatalog, validateCatalogManifest } from "./catalog-parity.mjs";

export const STAGING_DATABASE_NAME = "chargebridge_staging";
export const STAGING_LEDGER_NAME = "chargebridge_staging_migration_ledger";
export const STAGING_LEDGER_SQL_NAME = `public.${STAGING_LEDGER_NAME}`;
export const BASELINE_MIGRATION_ID = "chargebridge.phase1b.pre-0004";
export const BASELINE_FILENAME = "baseline.sql";
export const PHASE1B_MIGRATION_IDS = [
  "phase1b.security-enums-and-tables",
  "phase1b.charging-session-request-binding",
  "phase1b.nonunique-stripe-audit-indexes",
  "phase1b.membership-checkout-reservations",
  "phase1b.subscription-reconciliation-events",
  "phase1b.fleet-billing",
  "phase1b.charging-attempts",
];
export const REQUIRED_HISTORY = [
  {
    executionOrder: 1,
    migrationId: "phase2b.session-state-machines",
    filename: "0001_phase2b_session_state_machines.sql",
    incorporatedEffects: [
      "payment_state",
      "charging_state",
      "charging_sessions.payment_state",
      "charging_sessions.charging_state",
      "charging_sessions.ocpp_transaction_id",
      "session_events",
      "session_events_session_id_idx",
      "session_events_event_type_idx",
    ],
    objects: {
      tables: ["session_events"],
      enums: ["payment_state", "charging_state"],
      indexes: ["session_events_session_id_idx", "session_events_event_type_idx"],
      functions: [],
      triggers: [],
      alteredColumns: [
        "charging_sessions.payment_state",
        "charging_sessions.charging_state",
        "charging_sessions.ocpp_transaction_id",
      ],
    },
  },
  {
    executionOrder: 2,
    migrationId: "phase2b.invoice-session-idempotency",
    filename: "0002_invoices_charging_session_unique.sql",
    incorporatedEffects: [
      "invoices.charging_session_id",
      "invoices_charging_session_id_unique",
    ],
    objects: {
      tables: [],
      enums: [],
      indexes: ["invoices_charging_session_id_unique"],
      functions: [],
      triggers: [],
      alteredColumns: ["invoices.charging_session_id"],
    },
  },
  {
    executionOrder: 3,
    migrationId: "vehicle-catalog.user-trim-link",
    filename: "0003_user_vehicles_catalog_trim_id.sql",
    incorporatedEffects: ["user_vehicles.catalog_trim_id"],
    objects: {
      tables: [],
      enums: [],
      indexes: [],
      functions: [],
      triggers: [],
      alteredColumns: ["user_vehicles.catalog_trim_id"],
    },
  },
];
export const REQUIRED_RECEIPT_IDS = [
  BASELINE_MIGRATION_ID,
  ...PHASE1B_MIGRATION_IDS,
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(HERE, "..");
const DEFAULT_STAGING_DIRECTORY = HERE;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const COLUMN_PATTERN = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonFile(filePath, label) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`${label} is unavailable; refusing to connect or migrate`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON; refusing to connect or migrate`);
  }
}

function validateObjectInventory(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value),
    `${label} must declare an explicit object inventory`);
  for (const key of ["tables", "enums", "indexes", "functions", "triggers", "alteredColumns"]) {
    assert(Array.isArray(value[key]), `${label}.${key} must be an explicit array`);
    const names = value[key];
    const pattern = key === "alteredColumns" ? COLUMN_PATTERN : null;
    for (const name of names) {
      assert(
        typeof name === "string" && (pattern ? pattern.test(name) : IDENTIFIER_PATTERN.test(name)),
        `${label}.${key} contains an unsafe or invalid identifier`,
      );
    }
    assert(new Set(names).size === names.length, `${label}.${key} contains duplicates`);
  }
  return structuredClone(value);
}

function safeMigrationFile(directory, filename, label) {
  assert(typeof filename === "string" && path.basename(filename) === filename &&
    /\.sql$/.test(filename), `${label} has an invalid SQL filename`);
  const fullPath = path.resolve(directory, filename);
  assert(fullPath.startsWith(`${path.resolve(directory)}${path.sep}`),
    `${label} SQL path escapes the migrations directory`);
  try {
    return readFileSync(fullPath);
  } catch {
    throw new Error(`${label} SQL file is unavailable; refusing to connect or migrate`);
  }
}

const STAGING_MEMBERSHIP_SQL = "0007_phase1b_staging_membership_checkout_reservations.sql";
const HISTORICAL_MEMBERSHIP_SQL = "0007_phase1b_membership_checkout_reservations.sql";
const MEMBERSHIP_PLANS = ["driver", "family", "fleet"];

/** File-only preflight; never accesses Stripe or a database. */
export function validateStagingMembershipSubstitution(
  substitution, sqlBytes, historicalBytes, { snapshotOnly = false } = {},
) {
  assert(substitution?.version === 1 &&
    substitution.historicalMigrationId === "phase1b.membership-checkout-reservations" &&
    substitution.historicalFilename === HISTORICAL_MEMBERSHIP_SQL &&
    substitution.replacementFilename === STAGING_MEMBERSHIP_SQL,
  "Staging membership substitution must replace exactly the historical membership 0007");
  assert(substitution.status === "verified-test-catalog" ||
    (snapshotOnly && substitution.status === "ids-pinned-awaiting-provider-verification"),
  "Staging membership TEST-mode catalog is not independently verified; refusing to migrate");
  assert(SHA256_PATTERN.test(substitution.replacementSha256) &&
    sha256(sqlBytes) === substitution.replacementSha256,
  "Staging membership migration checksum mismatch");
  const sql = sqlBytes.toString("utf8");
  assert(!/__UNRESOLVED_STAGING_[A-Z_]+__/.test(sql),
    "Staging membership SQL contains unresolved Product/Price markers");
  const historicalSql = historicalBytes.toString("utf8");
  const historicalIds = new Set(historicalSql.match(/\b(?:prod|price)_[A-Za-z0-9]+\b/g) ?? []);
  const historicalCatalog = parseExpectedCatalog(historicalSql);
  const stagingCatalog = parseExpectedCatalog(sql);
  assert(JSON.stringify(stagingCatalog.tables.map((table) => table.name)) ===
    JSON.stringify(historicalCatalog.tables.map((table) => table.name)) &&
    JSON.stringify(stagingCatalog.enums) === JSON.stringify(historicalCatalog.enums) &&
    JSON.stringify(stagingCatalog.tables[0]?.columns) ===
      JSON.stringify(historicalCatalog.tables[0]?.columns) &&
    JSON.stringify(stagingCatalog.tables[0]?.constraints.map((constraint) => constraint.name)) ===
      JSON.stringify(historicalCatalog.tables[0]?.constraints.map((constraint) => constraint.name)) &&
    JSON.stringify(stagingCatalog.indexes.map((index) => index.name)) ===
      JSON.stringify(historicalCatalog.indexes.map((index) => index.name)),
  "Staging membership schema inventory differs from historical 0007");
  const values = [];
  assert(Object.keys(substitution.catalog ?? {}).sort().join(",") ===
    [...MEMBERSHIP_PLANS].sort().join(","), "Staging membership catalog must have exactly three plans");
  for (const plan of MEMBERSHIP_PLANS) {
    const entry = substitution.catalog[plan];
    assert(entry && Object.keys(entry).sort().join(",") === "priceId,productId" &&
      /^prod_[A-Za-z0-9]+$/.test(entry.productId ?? "") &&
      /^price_[A-Za-z0-9]+$/.test(entry.priceId ?? ""),
    `Staging ${plan} Product/Price IDs are missing or invalid`);
    assert(!historicalIds.has(entry.productId) && !historicalIds.has(entry.priceId),
      `Staging ${plan} reuses a development Stripe ID`);
    const amount = { driver: 499, family: 999, fleet: 1999 }[plan];
    const branch = sql.match(new RegExp(
      `plan_id\\s*=\\s*'${plan}'\\s+AND\\s+stripe_product_id\\s*=\\s*'(prod_[A-Za-z0-9]+)'` +
      `\\s+AND\\s+stripe_price_id\\s*=\\s*'(price_[A-Za-z0-9]+)'` +
      `\\s+AND\\s+unit_amount\\s*=\\s*${amount}\\b`,
    ));
    assert(branch?.[1] === entry.productId && branch?.[2] === entry.priceId,
      `Staging ${plan} Product/Price/amount are not pinned in the correct SQL branch`);
    values.push(entry.productId, entry.priceId);
  }
  assert(new Set(values).size === 6,
    "Staging membership Product/Price IDs must be distinct");
  const actualIds = sql.match(/\b(?:prod|price)_[A-Za-z0-9]+\b/g) ?? [];
  assert(actualIds.length === 6 && actualIds.every((id) => values.includes(id)),
    "Staging membership SQL has unexpected, duplicate, or development Stripe IDs");
  assert(sql.includes("currency = 'usd' AND billing_interval = 'month' AND interval_count = 1"),
    "Staging membership currency or recurring interval is not the approved catalog");
  assert(!/^\s*(?:BEGIN|COMMIT)\s*;/im.test(sql),
    "Staging membership migration must use the runner transaction");
}

function assertNoTransactionControl(sql, label) {
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\s*;/im.test(sql),
    `${label} must not contain transaction control`);
}

function parseBaseline(stagingDirectory, migrationsDirectory) {
  const manifestPath = path.join(stagingDirectory, "baseline-manifest.json");
  const manifest = parseJsonFile(manifestPath, "Staging baseline manifest");
  assert(manifest.manifestVersion === 1 && manifest.baselineId === BASELINE_MIGRATION_ID &&
    manifest.kind === "fresh-database-schema-snapshot",
    "Unsupported staging baseline manifest");
  assert(manifest.target?.dialect === "postgresql" &&
    manifest.target.schema === "public" &&
    manifest.target.precondition === "The target is a fresh database: its public schema has no application objects.",
  "Staging baseline target/precondition mismatch");
  assert(manifest.baseline?.filename === BASELINE_FILENAME,
    `Staging baseline filename must be ${BASELINE_FILENAME}`);
  assert(SHA256_PATTERN.test(manifest.baseline.sha256),
    "Staging baseline manifest must pin a lowercase SHA-256 checksum");
  const sqlBytes = safeMigrationFile(stagingDirectory, manifest.baseline.filename, "Staging baseline");
  const sql = sqlBytes.toString("utf8");
  assert(sha256(sqlBytes) === manifest.baseline.sha256,
    "Staging baseline checksum mismatch; refusing to migrate");
  assertNoTransactionControl(sql, "Staging baseline");
  assert(manifest.baseline.phase1bManifest === "../phase1b-manifest.json",
    "Staging baseline must reference the approved adjacent Phase 1B manifest");
  assert(manifest.applicationEvidence?.baselineReceiptId === BASELINE_MIGRATION_ID &&
    manifest.applicationEvidence.historicalMigrationsAreAppliedReceipts === false &&
    JSON.stringify(manifest.applicationEvidence.phase1bReceiptIds) ===
      JSON.stringify(PHASE1B_MIGRATION_IDS),
  "Staging baseline application evidence differs from its pinned baseline receipt identity");
  const catalog = parseExpectedCatalog(sql);
  const declaredTables = catalog.tables.map((table) => table.name);
  const declaredEnums = catalog.enums.map((entry) => entry.name);
  const declaredIndexes = catalog.indexes.map((entry) => entry.name);
  assert(JSON.stringify(declaredTables) === JSON.stringify(manifest.baseline.tableNames) &&
    declaredTables.length === manifest.baseline.objectCounts?.tables,
  "Staging baseline table inventory/count differs from the pinned manifest");
  assert(JSON.stringify(declaredEnums) === JSON.stringify(manifest.baseline.enumTypeNames) &&
    declaredEnums.length === manifest.baseline.objectCounts?.enumTypes,
  "Staging baseline enum inventory/count differs from the pinned manifest");
  assert(declaredIndexes.length ===
    manifest.baseline.objectCounts?.indexesIncludingHistorical0001And0002,
  "Staging baseline index inventory/count differs from the pinned manifest");
  const objects = validateObjectInventory({
    tables: declaredTables,
    enums: declaredEnums,
    indexes: declaredIndexes,
    functions: [],
    triggers: [],
    alteredColumns: REQUIRED_HISTORY.flatMap((entry) => entry.objects.alteredColumns),
  }, "Staging baseline SQL inventory");
  validateCatalogManifest(catalog, { ...objects, alteredColumns: [] }, "Staging baseline");
  assert(JSON.stringify(catalog.tables.map((table) => table.name)) ===
    JSON.stringify(manifest.baseline.tableNames),
  "Staging baseline full catalog inventory differs from the pinned table order");

  assert(manifest.historicalMigrations?.receiptTreatment ===
    "schema_effects_incorporated_in_baseline_snapshot; not represented as migration-executed receipts on a newly baselined database" &&
    Array.isArray(manifest.historicalMigrations.entries) &&
    manifest.historicalMigrations.entries.length === REQUIRED_HISTORY.length,
  "Staging baseline manifest must pin historical migrations 0001-0003 as baseline provenance");
  const history = manifest.historicalMigrations.entries.map((entry, index) => {
    const expected = REQUIRED_HISTORY[index];
    assert(entry && entry.order === expected.executionOrder &&
      entry.id === expected.migrationId && entry.filename === expected.filename &&
      entry.receiptType === "incorporated-in-baseline-provenance" &&
      JSON.stringify(entry.incorporatedEffects) === JSON.stringify(expected.incorporatedEffects),
    `Historical migration order/identity mismatch at ${expected.migrationId}`);
    assert(SHA256_PATTERN.test(entry.sha256),
      `Historical migration ${expected.migrationId} must have a pinned SHA-256 checksum`);
    const migrationBytes = safeMigrationFile(migrationsDirectory, entry.filename, expected.migrationId);
    assert(sha256(migrationBytes) === entry.sha256,
      `Historical migration checksum mismatch for ${expected.filename}`);
    const migrationSql = migrationBytes.toString("utf8");
    return {
      executionOrder: expected.executionOrder,
      migrationId: expected.migrationId,
      filename: expected.filename,
      sha256: entry.sha256,
      mode: "included_in_baseline",
      sql: migrationSql,
      objects: structuredClone(expected.objects),
    };
  });

  return {
    manifest,
    manifestSha256: sha256(JSON.stringify(manifest)),
    filename: BASELINE_FILENAME,
    sha256: manifest.baseline.sha256,
    sql,
    objects,
    catalog,
    history,
  };
}

export function loadStagingMigrationPlan({
  stagingDirectory = DEFAULT_STAGING_DIRECTORY,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
  historicalTestFixture = false,
  snapshotOnly = false,
} = {}) {
  const baseline = parseBaseline(stagingDirectory, migrationsDirectory);
  const manifestPath = path.join(migrationsDirectory, "phase1b-manifest.json");
  const historicalManifest = parseJsonFile(manifestPath, "Phase 1B manifest");
  const historical = validateManifest(historicalManifest, migrationsDirectory);
  // The historical plan is retained solely for database-free regression tests.
  // The executable runner never supplies this option.
  const manifest = historicalTestFixture ? historicalManifest : structuredClone(historicalManifest);
  let replacementBytes;
  if (!historicalTestFixture) {
    const substitution = parseJsonFile(
      path.join(stagingDirectory, "membership-substitution.json"),
      "Staging membership substitution",
    );
    const index = historical.findIndex((entry) =>
      entry.id === "phase1b.membership-checkout-reservations");
    assert(index === 3 && historical.filter((entry) =>
      entry.createdTables.includes("membership_checkout_reservations")).length === 1,
    "Staging requires exactly one membership table creator at order 4");
    replacementBytes = safeMigrationFile(
      stagingDirectory, substitution.replacementFilename, "Staging membership substitution");
    validateStagingMembershipSubstitution(
      substitution, replacementBytes,
      safeMigrationFile(migrationsDirectory, historical[index].filename, "Historical membership"),
      { snapshotOnly },
    );
    manifest.migrations[index] = {
      ...manifest.migrations[index],
      filename: substitution.replacementFilename,
      sha256: substitution.replacementSha256,
    };
    assert(manifest.migrations.filter((entry) =>
      entry.createdTables.includes("membership_checkout_reservations")).length === 1 &&
      manifest.migrations.every((entry) =>
        entry.filename !== substitution.historicalFilename),
    "Both membership migrations selected; refusing staging execution");
  }
  const ordered = manifest.migrations;
  assert(ordered.length === PHASE1B_MIGRATION_IDS.length,
    "Phase 1B migration count mismatch; refusing to migrate");
  assert(ordered.every((entry, index) => entry.id === PHASE1B_MIGRATION_IDS[index]),
    "Phase 1B migration order is not the approved order; refusing to migrate");

  const migrations = ordered.map((entry, index) => {
    assert(!/\b0009\b/.test(`${entry.id} ${entry.filename}`),
      "Migration 0009 is not part of the approved staging sequence");
    const sqlBytes = !historicalTestFixture && index === 3
      ? replacementBytes
      : safeMigrationFile(migrationsDirectory, entry.filename, entry.id);
    const sql = sqlBytes.toString("utf8");
    const objects = validateObjectInventory({
      tables: entry.createdTables ?? [],
      enums: entry.createdEnums ?? [],
      indexes: entry.createdIndexes ?? [],
      functions: entry.createdFunctions ?? [],
      triggers: entry.createdTriggers ?? [],
      alteredColumns: entry.alteredColumns ?? [],
    }, `${entry.id} manifest objects`);
    const catalog = parseExpectedCatalog(sql);
    validateCatalogManifest(catalog, objects, entry.id);
    return {
      executionOrder: 1 + index,
      migrationId: entry.id,
      filename: entry.filename,
      sha256: entry.sha256,
      sql,
      transactionMode: entry.transactional ? "transactional" : "nontransactional-concurrent-indexes",
      objects,
      catalog,
    };
  });

  return {
    baseline,
    phase1bManifest: manifest,
    phase1bManifestSha256: sha256(JSON.stringify(manifest)),
    phase1b: migrations,
    history: baseline.history,
    entries: [
      {
        executionOrder: 0,
        migrationId: BASELINE_MIGRATION_ID,
        filename: BASELINE_FILENAME,
        sha256: baseline.sha256,
        manifestSha256: baseline.manifestSha256,
        sql: baseline.sql,
        transactionMode: "baseline",
        objects: baseline.objects,
        catalog: baseline.catalog,
      },
      ...migrations.map((entry) => ({
        ...entry,
        manifestSha256: sha256(JSON.stringify(manifest)),
      })),
    ],
  };
}

export function parseStagingTarget(env) {
  assert(env?.CHARGEBRIDGE_ENVIRONMENT === "staging",
    "Staging migration requires CHARGEBRIDGE_ENVIRONMENT=staging");
  const connectionString = env.DATABASE_URL;
  const approvedHost = env.CHARGEBRIDGE_STAGING_DB_HOST;
  const approvedPort = env.CHARGEBRIDGE_STAGING_DB_PORT;
  const approvedRole = env.CHARGEBRIDGE_STAGING_DB_ROLE;
  const identityId = env.CHARGEBRIDGE_STAGING_DB_ID;
  assert(connectionString && approvedHost && approvedRole && identityId,
    "Staging migration requires an explicit database URL, approved host, role, and identity marker");
  assert(approvedPort && /^[1-9][0-9]{0,4}$/.test(approvedPort) && Number(approvedPort) <= 65535,
    "Staging migration requires an independently approved PostgreSQL port");
  assert(approvedRole !== "postgres",
    "Staging migration refuses the postgres superuser role");
  assert(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(identityId),
    "Staging migration requires an approved UUID identity marker");

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Staging migration received an invalid DATABASE_URL");
  }
  assert(["postgres:", "postgresql:"].includes(url.protocol),
    "Staging migration requires PostgreSQL; refusing another database target");
  assert(!url.hash && url.searchParams.size === 1 &&
    url.searchParams.get("sslmode") === "verify-full",
  "Staging DATABASE_URL must use sslmode=verify-full and contain no target overrides");
  assert(url.hostname && url.hostname === approvedHost.toLowerCase(),
    "Staging DATABASE_URL hostname does not match the independently approved host");
  assert(url.port === approvedPort,
    "Staging DATABASE_URL port does not match the independently approved port");
  assert(decodeURIComponent(url.pathname.slice(1)) === STAGING_DATABASE_NAME,
    "Staging DATABASE_URL must name exactly chargebridge_staging");
  assert(decodeURIComponent(url.username) === approvedRole,
    "Staging DATABASE_URL role does not match the approved staging role");
  assert(url.password.length > 0, "Staging DATABASE_URL has no database password");
  return {
    connectionString,
    host: approvedHost.toLowerCase(),
    port: approvedPort,
    role: approvedRole,
    database: STAGING_DATABASE_NAME,
    identityId: identityId.toLowerCase(),
  };
}

export function assertExplicitStagingCommand(argv) {
  assert(argv.length === 3 && argv[0] === "--target" && argv[1] === "staging" &&
    ["--apply", "--adopt-baseline-and-0004"].includes(argv[2]),
  "Refusing to run: explicitly invoke --target staging --apply or --target staging --adopt-baseline-and-0004");
  return argv[2];
}

export function validateReceiptKinds(rows) {
  const adopted = rows.filter((row) => row.receipt_kind === "verified_adopted");
  assert(rows.every((row) => ["executed", "verified_adopted"].includes(row.receipt_kind)),
    "Staging migration receipt has missing or invalid provenance");
  assert(adopted.length === 0 || (adopted.length === 2 &&
    rows[0]?.receipt_kind === "verified_adopted" &&
    rows[0]?.execution_order === 0 && rows[0]?.migration_id === BASELINE_MIGRATION_ID &&
    rows[1]?.receipt_kind === "verified_adopted" &&
    rows[1]?.execution_order === 1 && rows[1]?.migration_id === PHASE1B_MIGRATION_IDS[0]),
  "Staging adoption provenance must cover exactly baseline and 0004 together");
}

export function expectedReceiptRows(plan) {
  return plan.entries.map((entry) => ({
    migration_id: entry.migrationId,
    filename: entry.filename,
    sha256: entry.sha256,
    execution_order: entry.executionOrder,
    mode: entry.transactionMode,
    target_environment: "staging",
  }));
}

export function validateReceiptRows(rows, plan, { requireComplete = false } = {}) {
  assert(Array.isArray(rows), "Staging migration receipt ledger is unreadable");
  const expected = expectedReceiptRows(plan);
  assert(rows.length <= expected.length,
    "Staging migration receipt has unexpected rows; refusing to continue");
  assert(!requireComplete || rows.length === expected.length,
    "Staging schema is incomplete; required migration receipts are missing");
  validateReceiptKinds(rows);
  for (let index = 0; index < rows.length; index += 1) {
    const actual = rows[index];
    const wanted = expected[index];
    assert(actual.migration_id === wanted.migration_id &&
      actual.filename === wanted.filename &&
      actual.sha256 === wanted.sha256 &&
      Number(actual.execution_order) === wanted.execution_order &&
      actual.mode === wanted.mode &&
      actual.target_environment === "staging" &&
      actual.completed_at,
    `Staging migration receipt conflict at execution order ${index}`);
  }
  return rows.length;
}

export async function verifyStagingMigrationEvidence(client, plan) {
  const result = await client.query(
    `SELECT migration_id, filename, sha256, execution_order, completed_at, mode,
      target_environment, receipt_kind
     FROM ${STAGING_LEDGER_SQL_NAME}
     ORDER BY execution_order`,
  );
  validateReceiptRows(result.rows, plan, { requireComplete: true });
  return true;
}

export const DEFAULT_PATHS = Object.freeze({
  stagingDirectory: DEFAULT_STAGING_DIRECTORY,
  migrationsDirectory: DEFAULT_MIGRATIONS_DIRECTORY,
});

export const STAGING_LEDGER_DDL = `CREATE TABLE public.${STAGING_LEDGER_NAME} (
  migration_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  execution_order INT NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  mode TEXT NOT NULL,
  target_environment TEXT NOT NULL CHECK (target_environment = 'staging'),
  receipt_kind TEXT NOT NULL DEFAULT 'executed'
    CONSTRAINT staging_receipt_kind_check CHECK (receipt_kind IN ('executed', 'verified_adopted')),
  CONSTRAINT staging_adoption_scope_check CHECK (
    receipt_kind = 'executed' OR
    (execution_order = 0 AND migration_id = 'chargebridge.phase1b.pre-0004') OR
    (execution_order = 1 AND migration_id = 'phase1b.security-enums-and-tables')
  )
)`;
