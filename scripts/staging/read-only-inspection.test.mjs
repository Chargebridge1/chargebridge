import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { tokenize, validateSql, redact, inspect } from "./read-only-inspection.mjs";
import {
  stagingVerifiedTlsConnection, verifyStagingDatabaseIdentity,
} from "../../lib/db/src/stagingIdentity.ts";

// Fictitious, isolated inputs. Never process.env, a real Client, or a live socket.
const ID = "12345678-1234-1234-1234-123456789abc";
const PASSWORD = "FAKE-INSPECTION-PASSWORD";
const ENV = Object.freeze({
  CHARGEBRIDGE_ENVIRONMENT: "staging",
  CHARGEBRIDGE_STAGING_DB_ROLE: "chargebridge_staging_runtime",
  CHARGEBRIDGE_STAGING_DB_HOST: "staging.example.invalid",
  CHARGEBRIDGE_STAGING_DB_PORT: "25060",
  CHARGEBRIDGE_STAGING_DB_ID: ID,
  DATABASE_URL: `postgres://chargebridge_staging_runtime:${PASSWORD}@staging.example.invalid:25060/chargebridge_staging?sslmode=verify-full`,
});
const validators = { stagingVerifiedTlsConnection, verifyStagingDatabaseIdentity };

async function exercise({ sql = [], env = ENV, failure, marker, markerStructure, safety, rows, kind = "r", signal } = {}) {
  let output = "", options, factories = 0;
  const calls = [];
  const client = new EventEmitter();
  client.connect = async () => { calls.push("CONNECT"); if (failure === "CONNECT") throw new Error(ENV.DATABASE_URL); };
  client.end = async () => { calls.push("END"); if (failure === "END") throw new Error(ID); };
  client.query = async (text, values) => {
    calls.push(text);
    if (failure && text.includes(failure)) throw new Error(`${PASSWORD} ${ID}`);
    if (text.includes("AS read_only")) return { rows: safety ?? [{ read_only: "on", isolation: "repeatable read", search_path: "pg_catalog" }] };
    if (text.includes("AS marker_kind")) return { rows: markerStructure ?? [{
      marker_kind: "r", owner: "doadmin", rls: false, forced_rls: false,
    }] };
    if (text.includes("SELECT identity_id")) return { rows: marker ?? [{
      identity_id: ID, environment: "staging", database_name: "chargebridge_staging",
      database_role: "chargebridge_staging_runtime",
    }] };
    if (values) return { rows: kind ? [{ kind }] : [] };
    return { rows: rows ?? [] };
  };
  const lines = (async function* () { for (const line of sql) yield line; })();
  const code = await inspect({
    env, lines, validators, checks: [], signal,
    clientFactory: o => { options = o; factories++; return client; },
    write: s => { output += s; },
  });
  return { code, output, options, calls, factories };
}

test("imports and SQL validation need no environment or connection", () => {
  assert.equal(validateSql("SELECT pg_catalog.current_database();").kind, "query");
  assert.equal(validateSql("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;").kind, "setup");
  assert.equal(validateSql("ROLLBACK;").kind, "exit");
});

for (const sql of [
  "SELECT c.relname FROM pg_catalog.pg_class c;",
  "SELECT pg_catalog.current_setting('transaction_read_only');",
  "WITH expected(name) AS (VALUES ('x')) SELECT * FROM expected;",
  "SELECT pg_catalog.format('SELECT count(*) FROM %I.%I;', n.nspname, c.relname) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace;",
  'SELECT \'public\' AS schema_name, \'users\' AS table_name, count(*) AS physical_rows FROM ONLY "public"."users";',
  "SELECT key, label, platform, location, description, enabled FROM public.button_configs ORDER BY key;",
  "SELECT migration_id, filename, sha256, execution_order, mode, target_environment, completed_at FROM public.chargebridge_staging_migration_ledger ORDER BY execution_order;",
  'SELECT "migration_id", "sha256" FROM "public"."migration_history" LIMIT 100;',
]) test(`accepts approved form: ${sql}`, () => assert.equal(validateSql(sql).kind, "query"));

for (const sql of [
  "SELECT 1; DELETE FROM public.users;",
  "WITH x AS (DELETE FROM public.users RETURNING *) SELECT * FROM x;",
  "SELECT * INTO TEMP x FROM public.users;",
  "CREATE TEMP TABLE x(id int);",
  "COMMIT;",
  "SET default_transaction_read_only=off;",
  "RESET ALL;",
  "COPY public.users TO STDOUT;",
  "SELECT pg_catalog.set_config('transaction_read_only','off',true);",
  'SELECT "pg_catalog"."set_config"(\'x\',\'y\',true);',
  "SELECT public.reject_charging_attempt_quote_mutation();",
  "SELECT pg_catalog.pg_read_file('/etc/passwd');",
  "SELECT pg_catalog.pg_advisory_lock(1);",
  "SELECT pg_catalog.nextval('public.users_id_seq');",
  "SELECT pg_catalog.current_setting('custom.secret');",
  "SELECT * FROM pg_catalog.pg_authid;",
  "SELECT * FROM public.stations;",
  "SELECT min(ocpp_password) FROM public.stations;",
  "SELECT identity_id FROM public.chargebridge_database_identity;",
  "SELECT pg_catalog.current_database(), evil();",
  "SELECT $$unsafe$$;",
  "SELECT E'unsafe';",
  "SELECT 'unterminated",
  "SELECT 1 /* hidden syntax */;",
  "WITH RECURSIVE x AS (SELECT 1) SELECT * FROM x;",
  "WITH pg_read_file AS (SELECT 1) SELECT pg_read_file('/etc/passwd');",
  "SELECT s.ocpp_password FROM pg_catalog.pg_class c, public.stations s;",
  'SELECT s.ocpp_password FROM pg_catalog.pg_class c, "public"."stations" s;',
  "SELECT pg_catalog.pg_read_file('/etc/passwd') FROM pg_catalog.pg_class c;",
  'SELECT public."where"(1);',
  'SELECT pg_catalog."where"(1);',
  "SELECT 'secret'::public.untrusted_type;",
  "SELECT 'secret'::untrusted_type;",
  "SELECT 'secret'::pg_catalog.untrusted_type;",
]) test(`rejects unsafe/unapproved form: ${sql}`, () => assert.throws(() => validateSql(sql)));

test("lexer preserves semicolons in quoted SQL text, rejects stacked statements", () => {
  assert.equal(tokenize("SELECT 'x;''y';").filter(t => t.kind === "literal")[0].value, "x;'y");
  assert.throws(() => tokenize("SELECT 1; SELECT 2;"));
});

test("CHECK probes must exactly match approved snapshot expressions", () => {
  const checks = [{ table: "users", name: "approved_check", expression: "(length(name) > 0)" }];
  assert.equal(validateSql(`SELECT 'approved_check' AS constraint_name, count(*) AS violating_rows FROM public."users" WHERE ((length(name) > 0)) IS FALSE;`, checks).kind, "query");
  assert.throws(() => validateSql(`SELECT 'approved_check' AS constraint_name, count(*) AS violating_rows FROM public."users" WHERE (true) IS FALSE;`, checks));
});

test("approved aggregate association, marker digest and duplicate queries are accepted", () => {
  for (const sql of [
    `SELECT count(*) AS marker_rows, count(*) FILTER (WHERE environment = 'staging') AS staging_rows,
      count(*) FILTER (WHERE identity_id IS NULL) AS null_identity_rows,
      CASE WHEN count(*) = 1 THEN min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.uuid_send(identity_id)), 'hex'))
      END AS identity_binary_sha256 FROM public.chargebridge_database_identity;`,
    `SELECT count(*) AS session_rows,
      count(*) FILTER (WHERE s.payment_creation_request_id IS NOT NULL) AS associated_rows,
      count(*) FILTER (WHERE s.payment_creation_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.payment_creation_requests r WHERE r.id = s.payment_creation_request_id))
      AS orphan_associations FROM public.charging_sessions s;`,
    `SELECT count(*) AS duplicate_groups, COALESCE(sum(group_rows - 1), 0) AS excess_rows FROM (
      SELECT count(*) AS group_rows FROM public.charging_sessions WHERE payment_creation_request_id IS NOT NULL
      GROUP BY payment_creation_request_id HAVING count(*) > 1) duplicates;`,
  ]) assert.equal(validateSql(sql).kind, "query");
});

test("approved arrays, relation-kind casts and VALUES aliases are accepted", () => {
  for (const sql of [
    "WITH baseline(name) AS (SELECT pg_catalog.unnest(ARRAY['users','stations']::text[])) SELECT name FROM baseline;",
    "SELECT * FROM (VALUES ('users', 'baseline')) v(name, source);",
    "SELECT c.relkind::text AS kind FROM pg_catalog.pg_class c;",
    "SELECT 'pg_catalog.pg_class'::regclass;",
  ]) assert.equal(validateSql(sql).kind, "query");
});

test("approved complete button-key comparison is accepted, altered projection rejected", () => {
  const keys = JSON.parse(readFileSync(new URL("../../lib/db/migrations/staging/button-required-keys.json", import.meta.url)));
  const sql = `WITH expected(key) AS (VALUES ${keys.map(k => `('${k}')`).join(",")}),
    actual AS (SELECT key, count(*) AS copies FROM public.button_configs GROUP BY key)
    SELECT COALESCE(e.key, a.key) AS key, a.copies,
    CASE WHEN e.key IS NULL THEN 'UNEXPECTED' WHEN a.key IS NULL THEN 'MISSING'
    WHEN a.copies <> 1 THEN 'DUPLICATE' ELSE 'PRESENT' END AS status
    FROM expected e FULL OUTER JOIN actual a ON a.key=e.key ORDER BY key;`;
  assert.equal(validateSql(sql).kind, "query");
  assert.throws(() => validateSql(sql.replace("a.copies,", "a.secret_value,")));
});

for (const sql of ["ROLLBACK;", "\\quit"]) test("explicit exit discards pending buffer safely: " + sql, async () => {
  const r = await exercise({ sql: sql === "\\quit" ? ["unsubmitted text", sql] : [sql, "\\run"] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls.slice(-2), ["ROLLBACK", "END"]);
});

test("all approved snapshot CHECK probes can be validated without a database", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../../lib/db/migrations/staging/catalog-snapshot.json", import.meta.url)));
  const checks = snapshot.catalog.constraints.filter(c => c.type === "c").map(c => ({
    table: c.table, name: c.name, expression: c.definition.replace(/^CHECK\s*/i, ""),
  }));
  for (const c of checks) {
    const sql = `SELECT '${c.name}' AS constraint_name, count(*) AS violating_rows
      FROM public."${c.table}" WHERE (${c.expression}) IS FALSE;`;
    assert.equal(validateSql(sql, checks).kind, "query", c.name);
  }
});

test("startup uses the real existing validators, verified TLS and startup read-only options", async () => {
  const before = JSON.stringify(ENV);
  const r = await exercise();
  assert.equal(r.code, 0);
  assert.equal(r.options.ssl.rejectUnauthorized, true);
  assert.equal(r.options.ssl.servername, ENV.CHARGEBRIDGE_STAGING_DB_HOST);
  assert.equal(new URL(r.options.connectionString).searchParams.has("sslmode"), false);
  assert.match(r.options.options, /default_transaction_read_only=on/);
  assert.match(r.options.options, /search_path=pg_catalog/);
  assert.match(r.options.options, /lock_timeout=5000/);
  assert.match(r.options.options, /statement_timeout=30000/);
  assert.match(r.options.options, /idle_in_transaction_session_timeout=600000/);
  assert.equal(r.options.connectionTimeoutMillis, 5000);
  assert.equal(r.options.query_timeout, 30000);
  assert.equal(r.calls[1], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.ok(r.calls.findIndex(s => s.includes("SELECT identity_id")) > r.calls.indexOf("SET LOCAL row_security = off"));
  assert.deepEqual(r.calls.slice(-2), ["ROLLBACK", "END"]);
  assert.equal(JSON.stringify(ENV), before);
});

for (const change of [
  { CHARGEBRIDGE_ENVIRONMENT: "production" },
  { CHARGEBRIDGE_STAGING_DB_ROLE: "doadmin" },
  { DATABASE_URL: ENV.DATABASE_URL.replace("verify-full", "require") },
  { DATABASE_URL: ENV.DATABASE_URL + "&host=other.example.invalid" },
  { CHARGEBRIDGE_STAGING_DB_ID: "" },
  { CHARGEBRIDGE_STAGING_DB_HOST: "other.example.invalid" },
]) test("configuration fails before Client construction: " + Object.keys(change), async () => {
  const r = await exercise({ env: Object.freeze({ ...ENV, ...change }) });
  assert.equal(r.code, 1);
  assert.equal(r.factories, 0);
  assert.equal(r.output.includes("Identity verified"), false);
});

for (const marker of [
  [], [{ identity_id: ID }], [
    { identity_id: ID, environment: "staging", database_name: "chargebridge_staging", database_role: "chargebridge_staging_runtime" },
    { identity_id: ID, environment: "staging", database_name: "chargebridge_staging", database_role: "chargebridge_staging_runtime" },
  ],
]) test("marker failure closes before accepting SQL: " + marker.length, async () => {
  const r = await exercise({ marker, sql: ["SELECT 1;", "\\run"] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(s => s.trim() === "SELECT 1;"), false);
  assert.deepEqual(r.calls.slice(-2), ["ROLLBACK", "END"]);
  assert.equal(r.output.includes(ID), false);
});

for (const markerStructure of [
  [], [{ marker_kind: "v", owner: "doadmin", rls: false, forced_rls: false }],
  [{ marker_kind: "r", owner: "chargebridge_staging_runtime", rls: false, forced_rls: false }],
  [{ marker_kind: "r", owner: "doadmin", rls: true, forced_rls: false }],
]) test("unsafe marker relation stops before UUID read", async () => {
  const r = await exercise({ markerStructure });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(s => s.includes("SELECT identity_id")), false);
});

test("an unsafe transaction state closes before the marker read", async () => {
  const r = await exercise({ safety: [{ read_only: "off", isolation: "read committed", search_path: "public" }] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(s => s.includes("SELECT identity_id")), false);
});

test("one snapshot, multiline blocks, explicit submit, repeat Block 1 without restarting", async () => {
  const r = await exercise({ sql: [
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;", "\\run",
    "SELECT", "pg_catalog.current_database();", "\\run", "\\quit",
  ] });
  assert.equal(r.code, 0);
  assert.equal(r.calls.filter(s => s.startsWith("BEGIN")).length, 1);
  assert.equal(r.calls.filter(s => s.includes("pg_catalog.current_database();")).length, 1);
});

test("unsubmitted partial block is refused and never sent", async () => {
  const r = await exercise({ sql: ["SELECT pg_catalog.current_database();"] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(s => s.includes("pg_catalog.current_database();")), false);
});

for (const kind of ["v", "m", "f", null]) test("data SELECT rejects nonordinary/missing relation: " + kind, async () => {
  const r = await exercise({ kind, sql: [
    "SELECT key, label, platform, location, description, enabled FROM public.button_configs ORDER BY key;", "\\run",
  ] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(s => s.includes("SELECT key, label")), false);
});

test("result output and thrown errors do not expose secrets", async () => {
  const secrets = [ID, PASSWORD, ENV.DATABASE_URL];
  const r = await exercise({ rows: [{ value: secrets.join(" ") }], sql: ["SELECT pg_catalog.current_database();", "\\run"] });
  assert.equal(r.code, 0);
  for (const secret of secrets) assert.equal(r.output.includes(secret), false);
  for (const failure of ["CONNECT", "SELECT identity_id", "pg_catalog.current_database();", "ROLLBACK", "END"]) {
    const f = await exercise({ failure, sql: ["SELECT pg_catalog.current_database();", "\\run"] });
    assert.equal(f.code, 1);
    for (const secret of secrets) assert.equal(f.output.includes(secret), false);
    assert.ok(f.calls.includes("END"));
  }
});

test("certificates, UUIDs, tokens and encoded passwords are redacted", () => {
  const env = { ...ENV, TEST_TOKEN: "FAKE-TOKEN",
    TEST_CERT: "-----BEGIN CERTIFICATE-----\nFAKE-CERT\n-----END CERTIFICATE-----" };
  const output = redact([ID, PASSWORD, env.TEST_TOKEN, env.TEST_CERT, ENV.DATABASE_URL,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "postgres://unknown:unknown@example.invalid/db"].join("\n"), env);
  assert.equal(output.includes("FAKE"), false);
  assert.equal(output.includes("postgres://"), false);
  assert.equal(output.includes(ID), false);
  const special = { DATABASE_URL: ENV.DATABASE_URL, EXTRA_SECRET: 'FAKE-"quoted"\nSECRET' };
  assert.equal(redact(JSON.stringify({ value: special.EXTRA_SECRET }), special).includes("FAKE"), false);
});

test("secrets supplied as SQL literals are refused without execution or echo", async () => {
  const r = await exercise({ sql: [`SELECT '${PASSWORD}';`, "\\run"] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(s => s.includes(PASSWORD)), false);
  assert.equal(r.output.includes(PASSWORD), false);
});

test("abort before connection refuses without connecting", async () => {
  const controller = new AbortController(); controller.abort();
  const r = await exercise({ signal: controller.signal });
  assert.equal(r.code, 1);
  assert.equal(r.calls.includes("CONNECT"), false);
});

test("abort while idle releases the reader, rolls back, and closes once", async () => {
  const controller = new AbortController();
  const input = new PassThrough();
  const lines = createInterface({ input, terminal: false });
  const calls = [];
  const client = new EventEmitter();
  client.connect = async () => {};
  client.end = async () => { calls.push("END"); };
  client.query = async sql => {
    calls.push(sql);
    if (sql.includes("AS read_only")) return { rows: [{ read_only: "on", isolation: "repeatable read", search_path: "pg_catalog" }] };
    if (sql.includes("AS marker_kind")) return { rows: [{ marker_kind: "r", owner: "doadmin", rls: false, forced_rls: false }] };
    if (sql.includes("SELECT identity_id")) return { rows: [{
      identity_id: ID, environment: "staging", database_name: "chargebridge_staging",
      database_role: "chargebridge_staging_runtime",
    }] };
    return { rows: [] };
  };
  let output = "";
  const code = await inspect({
    env: ENV, lines, validators, checks: [], signal: controller.signal,
    clientFactory: () => client,
    write: s => {
      output += s;
      if (s.startsWith("Identity verified")) setImmediate(() => controller.abort());
    },
  });
  input.destroy();
  assert.equal(code, 1);
  assert.equal(calls.filter(s => s === "ROLLBACK").length, 1);
  assert.equal(calls.filter(s => s === "END").length, 1);
  assert.equal(output.includes(ID), false);
});

test("entrypoint has no bootstrap, migration, dotenv, env mutation or provisioner import", () => {
  const source = readFileSync(new URL("./read-only-inspection.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import[^\n]*(bootstrap|startupGate|dotenv|provision-database-identity|db\/src\/index)/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]+\s*=(?!=)/);
  assert.doesNotMatch(source, /console\.(log|error)|error\.message|error\.stack/);
});