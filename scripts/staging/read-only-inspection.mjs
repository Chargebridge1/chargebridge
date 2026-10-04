import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Manual operator tool. Importing it reads no environment and opens no connection.
// No app bootstrap, database pool, dotenv, provisioner, or migration imports.
const ROOT = new URL("../../", import.meta.url);
const SNAPSHOT_SHA = "ede7ed28bf66bd6c09698c25bd9b7c1544059e90542c63628e0f4416b8998df3";
const FAIL = "STOP: inspection refused or failed; details suppressed. Session closed.\n";
const SETUP = [
  "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  "SET LOCAL search_path = pg_catalog",
  "SET LOCAL lock_timeout = '5s'",
  "SET LOCAL statement_timeout = '30s'",
  "SET LOCAL idle_in_transaction_session_timeout = '10min'",
  "SET LOCAL row_security = off",
];
const FUNCTIONS = new Set(`count sum min coalesce bool_or array_agg string_agg unnest
  current_database current_setting pg_is_in_recovery inet_server_addr inet_server_port
  transaction_timestamp pg_backend_pid pg_get_userbyid obj_description to_regclass
  format_type pg_get_expr pg_get_constraintdef pg_get_indexdef pg_get_partkeydef
  pg_get_function_identity_arguments pg_get_function_result pg_get_functiondef
  pg_get_triggerdef pg_get_viewdef pg_get_ruledef has_table_privilege
  has_any_column_privilege has_schema_privilege pg_describe_object
  format encode sha256 uuid_send lower length`.split(/\s+/));
const CATALOGS = new Set(`pg_class pg_namespace pg_attribute pg_constraint pg_index
  pg_am pg_tablespace pg_inherits pg_type pg_enum pg_sequence pg_depend pg_attrdef
  pg_collation pg_proc pg_language pg_trigger pg_rewrite pg_event_trigger pg_policy
  pg_default_acl pg_roles pg_auth_members pg_database pg_stat_ssl pg_settings`.split(/\s+/));
const SETTINGS = new Set(`server_version transaction_read_only transaction_isolation
  search_path row_security`.split(/\s+/));
const META_COLUMNS = new Set(`id migration_id logical_id migration_name filename script
  version hash checksum sha256 execution_order order_index installed_rank mode
  target_environment record_kind transactional concurrent_provenance
  catalog_review_reference completed_at applied_at installed_on recorded_at
  catalog_reviewed_at created_at success`.split(/\s+/));
const SYNTAX_PARENS = new Set(["as", "in", "filter", "over", "any", "exists", "values",
  "where", "and", "or", "not", "on", "having", "when", "then", "else", "from", "join", "only"]);
const CAST_TYPES = new Set(`regclass regrole text name oid uuid bytea bool boolean char
  integer int int2 int4 int8 smallint bigint numeric decimal real float4 float8
  double character varchar timestamp timestamptz date interval`.split(/\s+/));

// A deliberately small lexer, not a general SQL parser. Fail closed on unsupported
// syntax. Quoted identifiers are decoded so quoting cannot hide a forbidden call.
export function tokenize(sql) {
  if (typeof sql !== "string" || sql.length > 65536) throw new Error("REFUSED");
  const tokens = [];
  for (let i = 0; i < sql.length;) {
    const rest = sql.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (rest.startsWith("/*")) throw new Error("REFUSED");
    const quote = sql[i];
    if (quote === "'" || quote === '"') {
      if (i > 0 && /[a-zA-Z_0-9]/.test(sql[i - 1])) throw new Error("REFUSED");
      let value = "";
      let closed = false;
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\") throw new Error("REFUSED");
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { value += quote; i += 2; continue; }
          i++; closed = true; break;
        }
        value += sql[i++];
      }
      if (!closed) throw new Error("REFUSED");
      tokens.push({ kind: quote === "'" ? "literal" : "identifier", value, quoted: true });
      continue;
    }
    const word = rest.match(/^[a-zA-Z_][a-zA-Z_0-9]*/);
    if (word) {
      tokens.push({ kind: "identifier", value: word[0].toLowerCase() });
      i += word[0].length; continue;
    }
    const number = rest.match(/^\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      i += number[0].length; continue;
    }
    if (!/^[.,;()[\]:*+=<>!~|/-]$/.test(sql[i])) throw new Error("REFUSED");
    tokens.push({ kind: "symbol", value: sql[i++] });
  }
  if (tokens.at(-1)?.value === ";") tokens.pop();
  if (tokens.some(t => t.value === ";" && t.kind === "symbol")) throw new Error("REFUSED");
  return tokens;
}

function canonical(sql) {
  return tokenKey(tokenize(sql));
}

function tokenKey(tokens) {
  return JSON.stringify(tokens.map(({ kind, value }) => ({ kind, value })));
}

const markerSummary = `SELECT count(*) AS marker_rows,
  count(*) FILTER (WHERE environment = 'staging') AS staging_rows,
  count(*) FILTER (WHERE identity_id IS NULL) AS null_identity_rows,
  CASE WHEN count(*) = 1 THEN min(pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.uuid_send(identity_id)), 'hex'))
  END AS identity_binary_sha256 FROM public.chargebridge_database_identity`;
const associationSummary = `SELECT count(*) AS session_rows,
  count(*) FILTER (WHERE s.payment_creation_request_id IS NOT NULL) AS associated_rows,
  count(*) FILTER (WHERE s.payment_creation_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payment_creation_requests r
    WHERE r.id = s.payment_creation_request_id)) AS orphan_associations
  FROM public.charging_sessions s`;
const duplicateSummary = `SELECT count(*) AS duplicate_groups,
  COALESCE(sum(group_rows - 1), 0) AS excess_rows FROM (
    SELECT count(*) AS group_rows FROM public.charging_sessions
    WHERE payment_creation_request_id IS NOT NULL
    GROUP BY payment_creation_request_id HAVING count(*) > 1) duplicates`;
const EXACT_DATA = new Set([markerSummary, associationSummary, duplicateSummary,
  "SELECT identity_id, environment FROM public.chargebridge_database_identity",
  "SELECT key, label, platform, location, description, enabled FROM public.button_configs ORDER BY key",
  "SELECT migration_id, filename, sha256, execution_order, mode, target_environment, completed_at FROM public.chargebridge_staging_migration_ledger ORDER BY execution_order",
].map(canonical));

const BUTTON_KEYS = `mobile_dashboard_find_nearby mobile_dashboard_explore
  mobile_dashboard_add_station mobile_dashboard_charge_now mobile_dashboard_live_map
  mobile_dashboard_gas_prices mobile_dashboard_membership mobile_dashboard_app_reviews
  mobile_header_home_button mobile_header_charge_now web_sidebar_charge_now
  web_sidebar_share web_nav_add_station web_nav_gas_stations web_nav_membership
  web_nav_live_map web_station_favorite web_station_review web_page_stations
  web_page_nearby web_page_map web_page_favorites web_page_add_station web_page_invoices
  web_page_gas_stations web_page_membership`.split(/\s+/);
const BUTTON_COMPARISON = canonical(`WITH expected(key) AS (
  VALUES ${BUTTON_KEYS.map(k => `('${k}')`).join(",")}
), actual AS (
  SELECT key, count(*) AS copies FROM public.button_configs GROUP BY key
) SELECT COALESCE(e.key, a.key) AS key, a.copies,
  CASE WHEN e.key IS NULL THEN 'UNEXPECTED' WHEN a.key IS NULL THEN 'MISSING'
  WHEN a.copies <> 1 THEN 'DUPLICATE' ELSE 'PRESENT' END AS status
  FROM expected e FULL OUTER JOIN actual a ON a.key = e.key ORDER BY key`);

function approvedChecks() {
  const bytes = readFileSync(new URL("lib/db/migrations/staging/catalog-snapshot.json", ROOT));
  if (createHash("sha256").update(bytes).digest("hex") !== SNAPSHOT_SHA) throw new Error("REFUSED");
  return JSON.parse(bytes).catalog.constraints.filter(c => c.type === "c").map(c => ({
    table: c.table, name: c.name, expression: c.definition.replace(/^CHECK\s*/i, ""),
  }));
}

export function validateSql(sql, checks = []) {
  const tokens = tokenize(sql);
  const key = tokenKey(tokens);
  if (SETUP.some(s => canonical(s) === key)) return { kind: "setup" };
  if (key === canonical("ROLLBACK")) return { kind: "exit" };
  if (!["select", "with"].includes(tokens[0]?.value)) throw new Error("REFUSED");
  const words = tokens.filter(t => t.kind === "identifier").map(t => t.value);
  if (words.some(w => /^(insert|update|delete|merge|into|copy|create|alter|drop|truncate|call|do|set|reset|commit|grant|revoke|lock|vacuum|execute|prepare|operator|tablesample|recursive)$/.test(w)))
    throw new Error("REFUSED");
  const ctes = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === "as" && tokens[i + 1]?.value === "(") {
      let j = i - 1;
      if (tokens[j]?.value === ")") {
        while (j >= 0 && tokens[j].value !== "(") j--;
        j--;
      }
      if (tokens[j]?.kind === "identifier") ctes.add(tokens[j].value);
    }
  }
  const relations = [];
  let depth = 0;
  const fromDepths = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.value === ":" && tokens[i + 1]?.value === ":") {
      let j = i + 2;
      if (tokens[j + 1]?.value === ".") {
        if (tokens[j].value !== "pg_catalog") throw new Error("REFUSED");
        j += 2;
      }
      if (!CAST_TYPES.has(tokens[j]?.value)) throw new Error("REFUSED");
    }
    if (t.value === "(" && t.kind === "symbol") depth++;
    if (t.value === ")" && t.kind === "symbol") { fromDepths.delete(depth); depth--; }
    if (t.kind === "identifier" && ["where", "group", "order", "having", "union", "limit", "except", "intersect"].includes(t.value))
      fromDepths.delete(depth);
    const commaRelation = t.value === "," && t.kind === "symbol" && fromDepths.has(depth);
    if (commaRelation) {
      // The approved procedure uses explicit JOINs, never comma joins.
      throw new Error("REFUSED");
    }
    if (t.kind !== "identifier") continue;
    if (tokens[i + 1]?.value === "(") {
      const schema = tokens[i - 1]?.value === "." ? tokens[i - 2]?.value : null;
      if (schema && (schema !== "pg_catalog" || !FUNCTIONS.has(t.value))) throw new Error("REFUSED");
      let end = i + 2, nesting = 1;
      while (end < tokens.length && nesting) {
        if (tokens[end].value === "(") nesting++;
        if (tokens[end].value === ")") nesting--;
        end++;
      }
      const declaration = ctes.has(t.value) && tokens[end]?.value === "as";
      const aliasColumns = tokens[i - 1]?.value === ")" && !schema &&
        tokens.slice(i + 2, end - 1).every(x => x.kind === "identifier" || x.value === ",");
      if (!aliasColumns && !declaration && !(SYNTAX_PARENS.has(t.value) && !t.quoted && !schema)) {
        if ((schema && schema !== "pg_catalog") || !FUNCTIONS.has(t.value)) throw new Error("REFUSED");
        if (t.value === "current_setting" &&
            (tokens[i + 2]?.kind !== "literal" || !SETTINGS.has(tokens[i + 2].value)))
          throw new Error("REFUSED");
      }
    }
    if (t.value !== "from" && t.value !== "join") continue;
    fromDepths.add(depth);
    let j = i + 1;
    if (tokens[j]?.value === "only") j++;
    if (tokens[j]?.value === "(") continue;
    if (tokens[j]?.kind !== "identifier") throw new Error("REFUSED");
    if (tokens[j + 1]?.value === ".") {
      const schema = tokens[j].value, table = tokens[j + 2]?.value;
      if (tokens[j + 2]?.kind !== "identifier") throw new Error("REFUSED");
      if (schema === "pg_catalog") {
        if (!CATALOGS.has(table)) throw new Error("REFUSED");
      } else if (schema === "information_schema") {
        if (table !== "columns") throw new Error("REFUSED");
      } else relations.push({ schema, table });
    } else if (!ctes.has(tokens[j].value)) throw new Error("REFUSED");
  }
  if (!relations.length) return { kind: "query", relations };
  if (EXACT_DATA.has(key)) return { kind: "query", relations };
  const text = tokens.map(t => t.kind === "literal" ? "?" : t.value).join(" ");
  // Generated physical counts: literals are labels, never executable SQL.
  if (/^select \? as schema_name , \? as table_name , count \( \* \) as physical_rows from only \w+ \. \w+$/.test(text))
    return { kind: "query", relations };
  // Existing migration metadata: raw fields only, no expressions or SELECT *.
  const direct = text.match(/^select (.+) from \w+ \. (\w+)(?: limit 100| order by (.+))?$/);
  if (direct && relations.length === 1) {
    const fields = direct[1].split(" , ");
    const order = direct[3]?.split(" , ") ?? [];
    if ((/(migrat|ledger|schema.*version|version.*schema|changelog|flyway|databasechangelog)/i.test(direct[2]) ||
         fields.some(f => /^(migration_id|logical_id|migration_name|execution_order|installed_rank|catalog_review_reference)$/.test(f))) &&
        fields.every(f => META_COLUMNS.has(f)) && order.every(f => META_COLUMNS.has(f)))
      return { kind: "query", relations };
  }
  if (key === BUTTON_COMPARISON)
    return { kind: "query", relations };
  for (const c of checks) {
    const expected = `SELECT '${c.name.replaceAll("'", "''")}' AS constraint_name,
      count(*) AS violating_rows FROM public."${c.table}" WHERE (${c.expression}) IS FALSE`;
    if (canonical(expected) === key) return { kind: "query", relations };
  }
  throw new Error("REFUSED");
}

export function redact(text, env) {
  let output = String(text);
  const values = Object.entries(env).filter(([k, v]) =>
    typeof v === "string" && v.length &&
    /PASSWORD|TOKEN|SECRET|CERT|PRIVATE.*KEY|DATABASE_URL|STAGING_DB_ID/i.test(k)).map(([, v]) => v);
  try { values.push(decodeURIComponent(new URL(env.DATABASE_URL).password)); } catch {}
  const encodings = values.filter(Boolean).flatMap(v =>
    [v, JSON.stringify(v).slice(1, -1), encodeURIComponent(v)]);
  for (const value of encodings.sort((a, b) => b.length - a.length))
    output = output.replaceAll(value, "[REDACTED]");
  return output
    .replace(/-----BEGIN [^-]*-----[\s\S]*?-----END [^-]*-----/g, "[REDACTED]")
    .replace(/\b(?:postgres(?:ql)?):\/\/[^\s"'<>]+/gi, "[REDACTED]")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, "[REDACTED]");
}

async function deadline(work) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("REFUSED")), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function inspect({
  env, lines, write, clientFactory, validators, checks, signal,
}) {
  let client, connected = false, failed = false, closing;
  const close = () => closing ??= (async () => {
    if (connected) {
      try { await deadline(client.query("ROLLBACK")); } catch { failed = true; }
    }
    if (client) {
      try { await deadline(client.end()); }
      catch { failed = true; client.connection?.stream?.destroy(); }
    }
  })();
  const abort = () => { failed = true; lines.close?.(); void close(); };
  try {
    if (env.CHARGEBRIDGE_ENVIRONMENT !== "staging" ||
        env.CHARGEBRIDGE_STAGING_DB_ROLE !== "chargebridge_staging_runtime")
      throw new Error("REFUSED");
    const options = {
      ...validators.stagingVerifiedTlsConnection(env),
      connectionTimeoutMillis: 5000,
      query_timeout: 30000,
      options: "-c default_transaction_read_only=on -c search_path=pg_catalog -c lock_timeout=5000 -c statement_timeout=30000 -c idle_in_transaction_session_timeout=600000",
    };
    if (options.ssl?.rejectUnauthorized !== true ||
        options.ssl?.servername !== env.CHARGEBRIDGE_STAGING_DB_HOST)
      throw new Error("REFUSED");
    client = clientFactory(options);
    client.on?.("error", abort);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) throw new Error("REFUSED");
    await client.connect();
    connected = true;
    for (const sql of SETUP) await client.query(sql);
    const safety = await client.query(`SELECT
      current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation,
      current_setting('search_path') AS search_path`);
    if (safety.rows.length !== 1 || safety.rows[0].read_only !== "on" ||
        safety.rows[0].isolation !== "repeatable read" || safety.rows[0].search_path !== "pg_catalog")
      throw new Error("REFUSED");
    const marker = await client.query(`SELECT c.relkind::text AS marker_kind,
      pg_catalog.pg_get_userbyid(c.relowner) AS owner,
      c.relrowsecurity AS rls, c.relforcerowsecurity AS forced_rls
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'chargebridge_database_identity'`);
    if (marker.rows.length !== 1 || marker.rows[0].marker_kind !== "r" ||
        marker.rows[0].owner !== "doadmin" || marker.rows[0].rls !== false ||
        marker.rows[0].forced_rls !== false)
      throw new Error("REFUSED");
    await validators.verifyStagingDatabaseIdentity(env, sql => client.query(sql));
    if (failed) throw new Error("REFUSED");
    write("Identity verified. Block 1 is already applied in this snapshot.\nPaste one SQL block, then enter \\run on a separate line. Use \\quit to close.\n");
    if (failed || signal?.aborted) throw new Error("REFUSED");
    let buffer = "", stoppingForExit = false;
    for await (const line of lines) {
      if (failed || signal?.aborted) throw new Error("REFUSED");
      if (line.trim() === "\\quit") { stoppingForExit = true; break; }
      if (line.trim() !== "\\run") {
        buffer += line + "\n";
        if (buffer.length > 65536) throw new Error("REFUSED");
        continue;
      }
      if (redact(buffer, env) !== buffer) throw new Error("REFUSED");
      const plan = validateSql(buffer, checks);
      if (plan.kind === "exit") { stoppingForExit = true; break; }
      if (plan.kind === "setup") { write("Block 1 setting already applied.\n"); buffer = ""; continue; }
      // Never evaluate an unknown view/foreign table through a data SELECT.
      for (const r of plan.relations) {
        const result = await client.query(`SELECT c.relkind::text AS kind
          FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2`, [r.schema, r.table]);
        if (result.rows.length !== 1 || !["r", "p"].includes(result.rows[0].kind))
          throw new Error("REFUSED");
      }
      const result = await client.query(buffer);
      if (failed || signal?.aborted) throw new Error("REFUSED");
      if (!Array.isArray(result.rows)) throw new Error("REFUSED");
      write(redact(JSON.stringify(result.rows, null, 2), env) + "\n");
      buffer = "";
    }
    if (buffer.trim() && !stoppingForExit) throw new Error("REFUSED");
  } catch { failed = true; }
  finally {
    signal?.removeEventListener("abort", abort);
    await close();
  }
  write(failed ? FAIL : "Read-only snapshot rolled back. Session closed.\n");
  return failed ? 1 : 0;
}

async function main() {
  let lines;
  try {
    if (process.argv.length !== 2 || !/^v24\./.test(process.version)) throw new Error("REFUSED");
    const checks = approvedChecks();
    const validators = await import(new URL("lib/db/src/stagingIdentity.ts", ROOT));
    const require = createRequire(new URL("lib/db/package.json", ROOT));
    const { Client } = require("pg");
    lines = createInterface({ input: process.stdin, terminal: false });
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("uncaughtException", stop);
    process.once("unhandledRejection", stop);
    try {
      process.exitCode = await inspect({
        env: process.env, lines, write: s => process.stdout.write(s),
        validators, checks, clientFactory: options => new Client(options),
        signal: controller.signal,
      });
    } finally {
      for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"])
        process.removeListener(event, stop);
    }
  } catch { process.stderr.write(FAIL); process.exitCode = 1; }
  finally { lines?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();