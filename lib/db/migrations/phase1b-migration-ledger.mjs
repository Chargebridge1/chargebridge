import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "phase1b-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function manifestDigest(value = manifest) {
  return sha256(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateManifest(value, migrationDirectory = here) {
  assert(value?.manifestVersion === 1, "Unsupported Phase 1B manifest version");
  assert(value.scope === "phase1b", "Manifest scope must be phase1b");
  assert(Array.isArray(value.migrations) && value.migrations.length > 0, "Manifest has no migrations");

  const ordered = [...value.migrations].sort((a, b) => a.order - b.order);
  assert(
    ordered.every((entry, index) => entry.order === index + 1),
    "Manifest order must be contiguous and start at 1",
  );
  assert(
    value.migrations.every((entry, index) => entry.id === ordered[index].id),
    "Manifest entries must be physically stored in their fixed execution order",
  );

  const expectedFiles = ordered.map((entry) => entry.filename).sort();
  const actualFiles = readdirSync(migrationDirectory)
    .filter((filename) => /^\d{4}_phase1b_.*\.sql$/.test(filename))
    .sort();
  assert(
    JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
    "Phase 1B SQL files differ from the explicit manifest; review ordering before proceeding",
  );

  const ids = new Set();
  const filenames = new Set();
  const knownIds = new Set(ordered.map((entry) => entry.id));
  for (const entry of ordered) {
    assert(entry.id && !ids.has(entry.id), `Duplicate migration logical ID: ${entry.id}`);
    assert(entry.filename && !filenames.has(entry.filename), `Duplicate migration filename: ${entry.filename}`);
    ids.add(entry.id);
    filenames.add(entry.filename);
    assert(/^[0-9a-f]{64}$/.test(entry.sha256), `Invalid SHA-256 for ${entry.id}`);
    assert(/^\d{4}$/.test(entry.legacyPrefix), `Invalid legacy prefix for ${entry.id}`);
    assert(entry.filename.startsWith(`${entry.legacyPrefix}_`), `Legacy prefix mismatch for ${entry.id}`);
    assert(entry.replaySafe === false, `Historical Phase 1B DDL cannot be marked replay-safe`);
    assert(typeof entry.transactional === "boolean", `Missing transaction mode for ${entry.id}`);

    for (const dependency of entry.dependsOn ?? []) {
      if (dependency.startsWith("base:")) continue;
      assert(knownIds.has(dependency), `Unknown dependency ${dependency} for ${entry.id}`);
      const dependencyOrder = ordered.find((candidate) => candidate.id === dependency).order;
      assert(dependencyOrder < entry.order, `Dependency ${dependency} must precede ${entry.id}`);
    }

    const sql = readFileSync(resolve(migrationDirectory, entry.filename));
    assert(sha256(sql) === entry.sha256, `Checksum mismatch for ${entry.filename}; refusing to proceed`);
    validateMigrationMode(entry, sql.toString("utf8"));
  }

  const duplicatePrefixes = new Map();
  for (const entry of ordered) {
    duplicatePrefixes.set(
      entry.legacyPrefix,
      [...(duplicatePrefixes.get(entry.legacyPrefix) ?? []), entry.id],
    );
  }
  const duplicated = [...duplicatePrefixes.entries()].filter(([, entries]) => entries.length > 1);
  assert(
    duplicated.length === 1 && duplicated[0][0] === "0007" && duplicated[0][1].length === 2,
    "Expected two explicitly identified 0007 files and no other duplicate sequence",
  );
  assert(
    ordered.map((entry) => entry.legacyPrefix).join(",") === "0004,0005,0006,0007,0007,0008,0010",
    "Historical Phase 1B order changed; review dependencies before proceeding",
  );
  assert(
    new Set(ordered.flatMap((entry) => entry.createdTables)).size === 9
      && new Set(ordered.flatMap((entry) => entry.createdEnums)).size === 13
      && new Set(ordered.flatMap((entry) => entry.createdIndexes)).size === 39,
    "Manifest object inventory differs from the reviewed Phase 1B baseline",
  );
  return ordered;
}

export function validateMigrationMode(entry, sql) {
  const concurrentStatements = [...sql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi)];
  if (entry.legacyPrefix === "0006") {
    assert(entry.transactional === false, "0006 concurrent indexes must be nontransactional");
    assert(
      entry.transactionMode === "one-concurrent-index-per-connection",
      "0006 must run one concurrent index at a time",
    );
    assert(concurrentStatements.length === 3, "0006 must retain its three concurrent-index statements");
    assert(!/^\s*(?:BEGIN|COMMIT)\s*;/im.test(sql), "0006 cannot contain transaction control");
  } else {
    assert(entry.transactional === true, `${entry.filename} must be transactional`);
    assert(concurrentStatements.length === 0, "Concurrent-index mode is only permitted for 0006");
  }
}

/**
 * Pure planning only. This function performs no catalog query or write.
 * An operator must independently establish parity before inserting baseline
 * rows through the development-only ledger bootstrap SQL.
 */
export function planAdoption(existingRows, value = manifest) {
  const ordered = [...value.migrations].sort((a, b) => a.order - b.order);
  if (existingRows.length === 0) return { action: "eligible_for_manual_adoption", entries: ordered };
  if (existingRows.length !== ordered.length) {
    throw new Error("Partial Phase 1B ledger found; refusing replay or automatic repair");
  }

  const byOrder = [...existingRows].sort((a, b) => a.order_index - b.order_index);
  for (let index = 0; index < ordered.length; index += 1) {
    const expected = ordered[index];
    const actual = byOrder[index];
    if (
      actual.logical_id !== expected.id
      || actual.order_index !== expected.order
      || actual.filename !== expected.filename
      || actual.sha256 !== expected.sha256
      || actual.target_environment !== "development"
      || actual.transactional !== expected.transactional
      || actual.concurrent_provenance !== (
        expected.id === "phase1b.nonunique-stripe-audit-indexes" ? "unknown" : "not_applicable"
      )
    ) {
      throw new Error(`Ledger order/checksum conflict at ${expected.id}; refusing replay`);
    }
  }
  return { action: "already_recorded", entries: ordered };
}

function main(command) {
  if (command !== "verify") {
    throw new Error(
      "Only the read-only verify command is supported. There is no automated database adoption or migration-execution command.",
    );
  }
  const entries = validateManifest(manifest);
  console.log(`Verified ${entries.length} Phase 1B migration checksums and fixed order.`);
  console.log(`Manifest digest: ${manifestDigest()}`);
  for (const entry of entries) {
    console.log(`${entry.order}. ${entry.id} (${entry.filename})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Phase 1B manifest verification failed");
    process.exitCode = 1;
  }
}
