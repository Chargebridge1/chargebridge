import { withStagingReadOnlyConnection } from "@workspace/db/staging-identity";
import { verifyStagingSchemaDefinitions } from "@workspace/db/staging-catalog";
import { createHash } from "node:crypto";
import catalogSnapshot from "@workspace/db/staging-catalog-snapshot";
import baselineManifest from "../../../lib/db/migrations/staging/baseline-manifest.json";
import phase1bManifest from "../../../lib/db/migrations/phase1b-manifest.json";
import membershipSubstitution from "../../../lib/db/migrations/staging/membership-substitution.json";
import { selectMembershipCatalog } from "./lib/membershipCatalog";
import requiredButtonKeys from "../../../lib/db/migrations/staging/button-required-keys.json";

type Row = Record<string, unknown>;
export type ReadOnlyQuery = (text: string, values?: unknown[]) => Promise<{ rows: Row[] }>;

type StagingPair = { productId: string; priceId: string };
type StagingCatalog = Record<"driver" | "family" | "fleet", StagingPair>;

/** Exact staging-only DDL contract; reject extra branches and development IDs. */
export function matchesStagingMembershipConstraint(
  definition: string,
  catalog: StagingCatalog,
): boolean {
  const branches = (["driver", "family", "fleet"] as const).map((plan) => {
    const { productId, priceId } = catalog[plan];
    const amount = { driver: 499, family: 999, fleet: 1999 }[plan];
    if (!/^prod_[A-Za-z0-9]+$/.test(productId) || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
      return null;
    }
    return `(plan_id = '${plan}' AND stripe_product_id = '${productId}' AND stripe_price_id = '${priceId}' AND unit_amount = ${amount})`;
  });
  if (branches.some((branch) => branch === null)) return false;
  return definition.replace(/\s+/g, "") ===
    `CHECK (${branches.join(" OR ")})`.replace(/\s+/g, "");
}

// Runtime readiness is staging-only. No historical/production migration is edited.
const phase1b = phase1bManifest.migrations.map((entry, index) => index === 3
  ? {
      ...entry,
      filename: membershipSubstitution.replacementFilename,
      sha256: membershipSubstitution.replacementSha256,
    }
  : entry);
const stagingManifestDigest = createHash("sha256").update(JSON.stringify({
  ...phase1bManifest,
  migrations: phase1b,
})).digest("hex");
const expectedReceipts = [
  {
    migration_id: baselineManifest.baselineId,
    filename: baselineManifest.baseline.filename,
    sha256: baselineManifest.baseline.sha256,
    execution_order: 0,
    mode: "baseline",
  },
  ...phase1b.map((migration, index) => ({
    migration_id: migration.id,
    filename: migration.filename,
    sha256: migration.sha256,
    execution_order: index + 1,
    mode: migration.transactional ? "transactional" : "nontransactional-concurrent-indexes",
  })),
];

const expectedTables = new Set([
  ...baselineManifest.baseline.tableNames,
  ...phase1b.flatMap((migration) => migration.createdTables),
  "chargebridge_database_identity",
  "chargebridge_staging_migration_ledger",
]);
const expectedEnums = new Set([
  ...baselineManifest.baseline.enumTypeNames,
  ...phase1b.flatMap((migration) => migration.createdEnums),
]);
const expectedIndexes = new Set(phase1b.flatMap((migration) => migration.createdIndexes));
const requiredColumns = [
  ["stations", "id"],
  ["users", "clerk_id"],
  ["users", "stripe_customer_id"],
  ["charging_sessions", "id"],
  ["charging_sessions", "payment_creation_request_id"],
  ["stripe_refund_jobs", "next_retry_at"],
  ["invoices", "charging_session_id"],
  ["user_vehicles", "catalog_trim_id"],
  ["organizations", "id"],
  ["stripe_events", "id"],
] as const;

function assertMatches(actual: Set<string>, expected: Set<string>, label: string): void {
  const missing = [...expected].filter((item) => !actual.has(item));
  const extra = [...actual].filter((item) => !expected.has(item));
  if (missing.length || extra.length) {
    throw new Error(`Staging schema readiness: ${label} mismatch (missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"})`);
  }
}

/** Queries only pg_catalog, information_schema, and the staging receipt ledger. */
export async function verifyStagingSchemaReadiness(query: ReadOnlyQuery): Promise<void> {
  const catalog = membershipSubstitution.catalog as StagingCatalog;
  const verifiedIds = (["driver", "family", "fleet"] as const).every((plan) => {
    const pair = catalog[plan];
    return /^prod_[A-Za-z0-9]+$/.test(pair?.productId ?? "") &&
      /^price_[A-Za-z0-9]+$/.test(pair?.priceId ?? "");
  });
  // Check the selected staging catalog, never the development fallback.
  const stagingCatalog = selectMembershipCatalog("staging");
  const runtimeCatalogMatches = (["driver", "family", "fleet"] as const).every((plan) => {
    const pair = catalog[plan];
    const runtime = stagingCatalog[plan as "driver" | "family" | "fleet"];
    return pair?.productId === runtime.productId && pair?.priceId === runtime.priceId;
  });
  const table = catalogSnapshot.catalog.tables.find((entry) =>
    entry.name === "membership_checkout_reservations");
  const snapshotConstraints = catalogSnapshot.catalog.constraints.filter((entry) =>
    entry.table === "membership_checkout_reservations" &&
    entry.name === "membership_checkout_reservations_catalog_check");
  const tableConstraints = table?.constraints.filter((entry) =>
    entry.name === "membership_checkout_reservations_catalog_check") ?? [];
  const stagingConstraintMatches = snapshotConstraints.length === 1 &&
    tableConstraints.length === 1 &&
    matchesStagingMembershipConstraint(snapshotConstraints[0].definition, catalog) &&
    tableConstraints[0].definition === snapshotConstraints[0].definition;
  if (!verifiedIds || !runtimeCatalogMatches || !stagingConstraintMatches ||
      membershipSubstitution.status !== "verified-test-catalog" ||
      membershipSubstitution.historicalMigrationId !== phase1bManifest.migrations[3]?.id ||
      membershipSubstitution.historicalFilename !== phase1bManifest.migrations[3]?.filename ||
      membershipSubstitution.replacementFilename !== "0007_phase1b_staging_membership_checkout_reservations.sql" ||
      catalogSnapshot.sourceBindings.phase1bManifestSha256 !== stagingManifestDigest ||
      phase1b.length !== 7 || baselineManifest.applicationEvidence.historicalMigrationsAreAppliedReceipts !== false ||
      phase1b.map((entry) => entry.id).join("|") !== baselineManifest.applicationEvidence.phase1bReceiptIds.join("|") ||
      phase1b.some((entry) => /0009/.test(entry.filename)) ||
      catalogSnapshot.sourceBindings.baseline.sha256 !== baselineManifest.baseline.sha256 ||
      catalogSnapshot.sourceBindings.baseline.migrationId !== baselineManifest.baselineId ||
      catalogSnapshot.sourceBindings.migrations.length !== phase1b.length ||
      catalogSnapshot.sourceBindings.migrations.some((entry, index) =>
        entry.migrationId !== phase1b[index].id ||
        entry.filename !== phase1b[index].filename ||
        entry.sha256 !== phase1b[index].sha256)) {
    throw new Error("Staging schema readiness: the approved migration plan is inconsistent");
  }
  await verifyStagingSchemaCatalogForTests(query);
}

/** Read-only catalog assertions; the production entrypoint above owns the fail-closed plan gate. */
export async function verifyStagingSchemaCatalogForTests(query: ReadOnlyQuery): Promise<void> {
  const tables = await query(`SELECT c.relname AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`);
  assertMatches(new Set(tables.rows.map((row) => String(row.name))), expectedTables, "table inventory");

  const enums = await query(`SELECT t.typname AS name FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'`);
  assertMatches(new Set(enums.rows.map((row) => String(row.name))), expectedEnums, "enum inventory");

  const columns = await query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'`);
  const presentColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const [table, column] of requiredColumns) {
    if (!presentColumns.has(`${table}.${column}`)) {
      throw new Error(`Staging schema readiness: required column ${table}.${column} is missing`);
    }
  }

  const buttonSeeds = await query(`SELECT key FROM public.button_configs`);
  const expectedButtonCount = baselineManifest.baseline.legacyApiRuntimeObjects
    .find((item) => item.table === "button_configs")?.seededRows;
  const actualKeys = buttonSeeds.rows.map((row) => row.key);
  if (expectedButtonCount !== 26 ||
      requiredButtonKeys.length !== expectedButtonCount ||
      new Set(requiredButtonKeys).size !== expectedButtonCount ||
      actualKeys.some((key) => typeof key !== "string") ||
      buttonSeeds.rows.length !== expectedButtonCount ||
      new Set(actualKeys).size !== actualKeys.length ||
      requiredButtonKeys.some((key) => !actualKeys.includes(key))) {
    throw new Error("Staging schema readiness: required button configuration keys are missing or unexpected");
  }

  const indexes = await query(`SELECT i.relname AS name, ix.indisvalid AS valid,
      ix.indisready AS ready, ix.indislive AS live
    FROM pg_catalog.pg_index ix
    JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'public'`);
  const indexMap = new Map(indexes.rows.map((row) => [String(row.name), row]));
  for (const name of expectedIndexes) {
    const index = indexMap.get(name);
    if (!index || index.valid !== true || index.ready !== true || index.live !== true) {
      throw new Error(`Staging schema readiness: ${name} is absent or not valid and ready`);
    }
  }

  const receipts = await query(`SELECT migration_id, filename, sha256, execution_order,
      mode, target_environment, completed_at, receipt_kind
    FROM public.chargebridge_staging_migration_ledger ORDER BY execution_order`);
  if (receipts.rows.length !== expectedReceipts.length) {
    throw new Error("Staging schema readiness: migration evidence is incomplete or unexpected");
  }
  const adopted = receipts.rows.filter((row) => row.receipt_kind === "verified_adopted");
  if (receipts.rows.some((row) => row.receipt_kind !== "executed" && row.receipt_kind !== "verified_adopted") ||
      (adopted.length !== 0 && !(adopted.length === 2 &&
        receipts.rows[0].receipt_kind === "verified_adopted" &&
        receipts.rows[1].receipt_kind === "verified_adopted" &&
        receipts.rows.slice(2).every((row) => row.receipt_kind === "executed")))) {
    throw new Error("Staging schema readiness: invalid migration receipt provenance");
  }
  for (const [index, expected] of expectedReceipts.entries()) {
    const actual = receipts.rows[index];
    if (actual.migration_id !== expected.migration_id ||
        actual.filename !== expected.filename ||
        actual.sha256 !== expected.sha256 ||
        actual.execution_order !== expected.execution_order ||
        actual.mode !== expected.mode ||
        actual.target_environment !== "staging" ||
        !actual.completed_at) {
      throw new Error(`Staging schema readiness: migration evidence mismatch at order ${index}`);
    }
  }

  const triggers = await query(`SELECT t.tgname AS name, c.relname AS table_name,
      p.proname AS function_name, t.tgenabled AS enabled
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal`);
  const quoteTrigger = triggers.rows.filter((row) =>
    row.name === "charging_attempts_immutable_quote" &&
    row.table_name === "charging_attempts" &&
    row.function_name === "reject_charging_attempt_quote_mutation" &&
    row.enabled === "O");
  if (quoteTrigger.length !== 1) {
    throw new Error("Staging schema readiness: required charging-attempts quote trigger is absent, altered or disabled");
  }

  // Full definition parity (not just object names): every approved baseline and
  // Phase 1B column, enum, constraint, index predicate, function, and trigger.
  // The plan is bundled from a checksum-pinned snapshot, so production bundles
  // need no migration SQL files or filesystem-based loader at runtime.
  await verifyStagingSchemaDefinitions({ query }, { entries: [{ catalog: catalogSnapshot.catalog }] });
}

/** The staging bootstrap invokes this before importing the API or starting jobs. */
export async function runStagingSchemaReadiness(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await withStagingReadOnlyConnection(env, verifyStagingSchemaReadiness);
}