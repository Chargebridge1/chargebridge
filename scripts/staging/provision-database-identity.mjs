import { createRequire } from "node:module";
import { X509Certificate } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Manual, staging-only entrypoint; no bootstrap, pool, migration, dotenv, or HTTP
// imports. Importing this module performs no environment reads or connections.
//
// Required runtime inputs (never supplied as arguments or written to files):
// CHARGEBRIDGE_ENVIRONMENT=staging
// CHARGEBRIDGE_STAGING_DB_ID                   existing, unchanged secret
// CHARGEBRIDGE_STAGING_PROVISIONER_PASSWORD    temporary doadmin secret
// CHARGEBRIDGE_STAGING_DB_HOST / _PORT / _ROLE existing target/runtime metadata
// CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST independently approved hostname
// CHARGEBRIDGE_STAGING_PROVISIONER_CA_CERT     trusted PEM CA certificate(s)
// CHARGEBRIDGE_STAGING_PROVISIONER_ROLE        optional; only doadmin is accepted
//
// The approved-host input must be approved independently of the connection
// metadata, not inferred from it. No secret/configuration is populated here.
//
// REQUIRED OPERATOR SAFEGUARDS BEFORE ANY APPROVED EXECUTION:
// - Review PostgreSQL/provider/proxy/instrumentation logging. We do NOT suppress
//   bind-parameter logging: log_parameter_max_length=-1 is outside our control.
//   The UUID travels only in binary COPY data, never SQL text or bind parameters.
//   PostgreSQL 16 binary COPY error context omits row/column values, unlike text
//   COPY. Only one validated row enters our freshly created, transaction-locked
//   table, so its fixed constraints cannot produce a duplicate/invalid-row error.
//   Arbitrary primary error messages, third-party logging of protocol data,
//   process inspection and memory dumps are not controlled by this tool.
// - Arrange a controlled window with no unrelated privileged DDL. The advisory
//   lock coordinates cooperating provisioners only. Repeated event-trigger and
//   namespace checks cannot prevent an independent DBA from changing state
//   between a check and a statement. No event trigger or role grant is added.
// - The provider-compatible logging gate must pass; never grant extra privileges
//   or weaken logging checks to get the tool to run. No logging GUC is changed.
const DATABASE = "chargebridge_staging";
const PROVISIONER = "doadmin";
const RUNTIME = "chargebridge_staging_runtime";
const privateInputs = new WeakMap();
const statuses = new Set([
  "TARGET VERIFIED", "PROVISIONER VERIFIED", "MARKER CREATED",
  "MARKER VERIFIED", "RUNTIME SELECT VERIFIED",
  "FAILED / CONFIGURATION REFUSED", "FAILED / TARGET REFUSED",
  "FAILED / NAMESPACE REFUSED",
  "FAILED / PROVISIONER REFUSED", "FAILED / SAFETY CHECK REFUSED",
  "FAILED / CONCURRENT OPERATION REFUSED", "MARKER EXISTS / REFUSED",
  "FAILED / ROLLED BACK", "FAILED / ROLLBACK UNCONFIRMED",
  "OUTCOME UNKNOWN", "FAILED", "CONNECTION CLOSE FAILED",
]);

class Refusal extends Error {
  constructor(status) {
    super(statuses.has(status) ? status : "FAILED");
    this.status = this.message;
  }
}

function requireTrue(result, status) {
  if (result?.rows?.length !== 1 || result.rows[0].ok !== true) {
    throw new Refusal(status);
  }
}

function requireLoggingSafety(result) {
  // Pin the independently reviewed staging configuration, including its active
  // 1000 ms slow-statement logger. This is NOT evidence of bind suppression.
  const expected = {
    log_statement: "none",
    pgaudit_log: "none",
    pgaudit_log_parameter: "off",
    log_duration: "off",
    log_transaction_sample_rate: "0",
    log_min_duration_sample: "-1",
    log_min_error_statement: "error",
    log_min_duration_statement: "1000",
    auto_explain_log_min_duration: "-1",
  };
  if (result?.rows?.length !== 1 ||
      Object.entries(expected).some(([key, value]) => result.rows[0][key] !== value)) {
    throw new Refusal("FAILED / SAFETY CHECK REFUSED");
  }
}

// node-postgres's supported Submittable query interface. Send a simple COPY
// command, then CopyData/CopyDone; never Parse/Bind, CSV, text COPY or SQL literals.
// No application code, extra dependency, server function or grant is involved.
class BinaryIdentityCopy {
  #payload;
  #settled = false;
  #sent = false;
  #rowCount;

  constructor(identity, callback) {
    this.text = SQL.copy;
    this.callback = callback;
    // PostgreSQL binary COPY: signature, zero flags/extension, two fields,
    // 16-byte uuid, seven-byte text "staging", and the -1 tuple trailer.
    this.#payload = Buffer.alloc(54);
    Buffer.from("5047434f50590aff0d0a00", "hex").copy(this.#payload);
    this.#payload.writeInt16BE(2, 19);
    this.#payload.writeInt32BE(16, 21);
    Buffer.from(identity.replaceAll("-", ""), "hex").copy(this.#payload, 25);
    this.#payload.writeInt32BE(7, 41);
    this.#payload.write("staging", 45, "utf8");
    this.#payload.writeInt16BE(-1, 52);
  }

  submit(connection) {
    try { connection.query(this.text); } catch {
      // Returning an error lets pg restore its queue's ready state as well.
      return new Refusal("FAILED");
    }
  }

  handleCopyInResponse(connection) {
    if (this.#settled || this.#sent) {
      // A client timeout before CopyInResponse must not send the secret later.
      try { connection.sendCopyFail("FAILED"); } catch { /* fixed failure only */ }
      if (!this.#settled) this.handleError(new Refusal("FAILED"));
      return;
    }
    this.#sent = true;
    try {
      connection.sendCopyFromChunk(this.#payload);
      connection.endCopyFrom();
    } catch {
      try { connection.sendCopyFail("FAILED"); } catch { /* fixed failure only */ }
      this.handleError(new Refusal("FAILED"));
    }
  }

  handleCommandComplete(message) {
    const count = /^COPY ([0-9]+)$/.exec(message.text);
    this.#rowCount = count ? Number(count[1]) : undefined;
  }

  handleError(error) {
    if (this.#settled) return;
    this.#settled = true;
    this.#payload.fill(0);
    this.callback(error);
  }

  handleReadyForQuery() {
    if (this.#settled) return;
    if (this.#rowCount !== 1) {
      this.handleError(new Refusal("FAILED"));
      return;
    }
    this.#settled = true;
    this.#payload.fill(0);
    this.callback(null, { rows: [], rowCount: this.#rowCount });
  }
}

function failureStatus(error) {
  // Even unexpected thrown values/getters cannot become returned error text.
  try {
    return error instanceof Refusal && statuses.has(error.status) ? error.status : "FAILED";
  } catch {
    return "FAILED";
  }
}

export function readProvisioningConfiguration() {
  // Identity and credential are read ONLY here, ONLY from process.env.
  const env = process.env;
  const identity = env.CHARGEBRIDGE_STAGING_DB_ID;
  const password = env.CHARGEBRIDGE_STAGING_PROVISIONER_PASSWORD;
  const host = env.CHARGEBRIDGE_STAGING_DB_HOST;
  const approvedHost = env.CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST;
  const port = env.CHARGEBRIDGE_STAGING_DB_PORT;
  const ca = env.CHARGEBRIDGE_STAGING_PROVISIONER_CA_CERT;
  const role = env.CHARGEBRIDGE_STAGING_PROVISIONER_ROLE ?? PROVISIONER;
  const dnsName = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
  if (env.CHARGEBRIDGE_ENVIRONMENT !== "staging" ||
      env.CHARGEBRIDGE_STAGING_DB_ROLE !== RUNTIME ||
      role !== PROVISIONER ||
      !identity || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(identity) ||
      !password || !password.trim() || password.includes("\0") ||
      !host || !dnsName.test(host) || host !== approvedHost ||
      /(?:^|[-.])(?:prod|production)(?:[-.]|$)/i.test(host) ||
      !port || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535 ||
      !ca) {
    throw new Refusal("FAILED / CONFIGURATION REFUSED");
  }
  // Reject non-certificate material, malformed certificates, and leaf certificates.
  try {
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certificates?.length ||
        ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim() ||
        certificates.some((pem) => !new X509Certificate(pem).ca)) {
      throw new Error("REFUSED");
    }
  } catch {
    throw new Refusal("FAILED / CONFIGURATION REFUSED");
  }
  const config = Object.freeze({ host, port: Number(port), database: DATABASE, user: PROVISIONER, ca });
  // Neither secret is returned by configuration validation or comparisons.
  privateInputs.set(config, { identity: identity.toLowerCase(), password });
  return config;
}

function defaultClientFactory(options) {
  // Resolve the already-declared pg dependency WITHOUT importing @workspace/db.
  const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
  const { Client } = require("pg");
  return new Client(options);
}

const SQL = Object.freeze({
  namespace: `/* namespace */
    SELECT pg_catalog.current_setting('search_path')
        OPERATOR(pg_catalog.=) 'pg_catalog'::pg_catalog.text
      AND pg_catalog.current_schemas(true)
        OPERATOR(pg_catalog.=) ARRAY['pg_catalog'::pg_catalog.name]::pg_catalog.name[]
      AND pg_catalog.pg_my_temp_schema() OPERATOR(pg_catalog.=) 0::pg_catalog.oid AS ok`,
  target: `/* target */
    SELECT pg_catalog.current_database() OPERATOR(pg_catalog.=) 'chargebridge_staging'::pg_catalog.name
      AND current_user OPERATOR(pg_catalog.=) 'doadmin'::pg_catalog.name
      AND session_user OPERATOR(pg_catalog.=) 'doadmin'::pg_catalog.name
      AND NOT pg_catalog.pg_is_in_recovery()
      AND pg_catalog.current_setting('server_version_num')::pg_catalog.int4 OPERATOR(pg_catalog.>=) 160000
      AND pg_catalog.current_setting('server_version_num')::pg_catalog.int4 OPERATOR(pg_catalog.<) 170000
      AND pg_catalog.current_setting('transaction_read_only') OPERATOR(pg_catalog.=) 'off'::pg_catalog.text AS ok`,
  logging: `/* logging */
    SELECT pg_catalog.current_setting('log_statement') AS log_statement,
      COALESCE(pg_catalog.current_setting('pgaudit.log', true), 'none') AS pgaudit_log,
      COALESCE(pg_catalog.current_setting('pgaudit.log_parameter', true), 'off') AS pgaudit_log_parameter,
      pg_catalog.current_setting('log_duration') AS log_duration,
      pg_catalog.current_setting('log_transaction_sample_rate') AS log_transaction_sample_rate,
      pg_catalog.current_setting('log_min_duration_sample') AS log_min_duration_sample,
      pg_catalog.current_setting('log_min_error_statement') AS log_min_error_statement,
      -- pg_settings.setting is the raw millisecond value; current_setting may
      -- display the same 1000 ms as '1s'. Verify the unit rather than guessing.
      (SELECT setting FROM pg_catalog.pg_settings
        WHERE name OPERATOR(pg_catalog.=) 'log_min_duration_statement'::pg_catalog.text
          AND unit OPERATOR(pg_catalog.=) 'ms'::pg_catalog.text) AS log_min_duration_statement,
      COALESCE(pg_catalog.current_setting('auto_explain.log_min_duration', true), '-1')
        AS auto_explain_log_min_duration`,
  prerequisites: `/* prerequisites */
    SELECT pg_catalog.has_schema_privilege('doadmin', 'public', 'CREATE')
      AND pg_catalog.has_schema_privilege('chargebridge_staging_runtime', 'public', 'USAGE')
      AND pg_catalog.pg_has_role('doadmin', 'chargebridge_staging_runtime', 'SET')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger
        WHERE evtenabled OPERATOR(pg_catalog.<>) 'D'::pg_catalog."char")
      AS ok`,
  eventTriggers: `/* event-triggers */
    SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger
      WHERE evtenabled OPERATOR(pg_catalog.<>) 'D'::pg_catalog."char") AS ok`,
  roleSafety: `/* role-safety */
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r
      WHERE (pg_catalog.pg_has_role('chargebridge_staging_runtime', r.oid, 'USAGE')
          OR pg_catalog.pg_has_role('chargebridge_staging_runtime', r.oid, 'SET'))
        AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb
          OR r.rolreplication OR r.rolbypassrls
          OR r.rolname OPERATOR(pg_catalog.=) 'doadmin'::pg_catalog.name
          OR r.oid OPERATOR(pg_catalog.=) (SELECT datdba FROM pg_catalog.pg_database
            WHERE datname OPERATOR(pg_catalog.=) pg_catalog.current_database())
          OR r.oid OPERATOR(pg_catalog.=) (SELECT nspowner FROM pg_catalog.pg_namespace
            WHERE nspname OPERATOR(pg_catalog.=) 'public'::pg_catalog.name)
          OR pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')
          OR pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CREATE'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.admin_option
        AND (pg_catalog.pg_has_role('chargebridge_staging_runtime', m.member, 'USAGE')
          OR pg_catalog.pg_has_role('chargebridge_staging_runtime', m.member, 'SET'))
    ) AS ok`,
  lock: `/* serialize */
    SELECT pg_catalog.pg_try_advisory_xact_lock(1128419913, 1398032177) AS ok`,
  absent: `/* absent */
    SELECT pg_catalog.to_regclass('public.chargebridge_database_identity') IS NULL AS ok`,
  runtimeIdentity: `/* runtime-identity */
    SELECT pg_catalog.current_database() OPERATOR(pg_catalog.=) 'chargebridge_staging'::pg_catalog.name
      AND current_user OPERATOR(pg_catalog.=) 'chargebridge_staging_runtime'::pg_catalog.name
      AND session_user OPERATOR(pg_catalog.=) 'doadmin'::pg_catalog.name AS ok`,
  create: `CREATE TABLE public.chargebridge_database_identity (
    identity_id pg_catalog.uuid PRIMARY KEY,
    environment pg_catalog.text NOT NULL UNIQUE
      CHECK (environment OPERATOR(pg_catalog.=) 'staging'::pg_catalog.text)
  )`,
  copy: `COPY public.chargebridge_database_identity (identity_id, environment)
    FROM STDIN WITH (FORMAT binary)`,
  revoke: `REVOKE ALL PRIVILEGES ON TABLE public.chargebridge_database_identity
    FROM PUBLIC, chargebridge_staging_runtime`,
  grant: `GRANT SELECT ON TABLE public.chargebridge_database_identity
    TO chargebridge_staging_runtime`,
  markerStructure: `/* marker-structure */
    SELECT c.relkind OPERATOR(pg_catalog.=) 'r'::pg_catalog."char"
      AND c.relowner OPERATOR(pg_catalog.=) 'doadmin'::pg_catalog.regrole
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND (SELECT pg_catalog.count(*) OPERATOR(pg_catalog.=) 2 FROM pg_catalog.pg_attribute
        WHERE attrelid OPERATOR(pg_catalog.=) c.oid AND attnum OPERATOR(pg_catalog.>) 0 AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid OPERATOR(pg_catalog.=) c.oid
        AND attname OPERATOR(pg_catalog.=) 'identity_id'::pg_catalog.name
        AND atttypid OPERATOR(pg_catalog.=) 'pg_catalog.uuid'::pg_catalog.regtype AND attnotnull)
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid OPERATOR(pg_catalog.=) c.oid
        AND attname OPERATOR(pg_catalog.=) 'environment'::pg_catalog.name
        AND atttypid OPERATOR(pg_catalog.=) 'pg_catalog.text'::pg_catalog.regtype AND attnotnull)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid OPERATOR(pg_catalog.=) c.oid AND NOT tgisinternal)
      AND (SELECT pg_catalog.count(*) OPERATOR(pg_catalog.=) 3 FROM pg_catalog.pg_constraint
        WHERE conrelid OPERATOR(pg_catalog.=) c.oid)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(c.relacl, pg_catalog.acldefault('r'::pg_catalog."char", c.relowner))) a
        WHERE a.grantee OPERATOR(pg_catalog.<>) 'doadmin'::pg_catalog.regrole
          AND a.grantee OPERATOR(pg_catalog.<>) 'chargebridge_staging_runtime'::pg_catalog.regrole
      ) AS ok
    FROM pg_catalog.pg_class c
    WHERE c.oid OPERATOR(pg_catalog.=) 'public.chargebridge_database_identity'::pg_catalog.regclass`,
  markerIdentity: `/* marker-identity */
    SELECT pg_catalog.uuid_send(identity_id) AS identity_bytes, environment
    FROM public.chargebridge_database_identity`,
  permissions: `/* effective-permissions */
    SELECT pg_catalog.has_table_privilege('chargebridge_staging_runtime',
        'public.chargebridge_database_identity', 'SELECT')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
        WHERE (pg_catalog.pg_has_role('chargebridge_staging_runtime', r.oid, 'USAGE')
            OR pg_catalog.pg_has_role('chargebridge_staging_runtime', r.oid, 'SET'))
          AND (r.oid OPERATOR(pg_catalog.=) (SELECT relowner FROM pg_catalog.pg_class
                WHERE oid OPERATOR(pg_catalog.=) 'public.chargebridge_database_identity'::pg_catalog.regclass)
            OR pg_catalog.has_table_privilege(r.oid, 'public.chargebridge_database_identity', 'INSERT')
            OR pg_catalog.has_table_privilege(r.oid, 'public.chargebridge_database_identity', 'UPDATE')
            OR pg_catalog.has_table_privilege(r.oid, 'public.chargebridge_database_identity', 'DELETE')
            OR pg_catalog.has_table_privilege(r.oid, 'public.chargebridge_database_identity', 'TRUNCATE')
            OR pg_catalog.has_table_privilege(r.oid, 'public.chargebridge_database_identity', 'REFERENCES')
            OR pg_catalog.has_table_privilege(r.oid, 'public.chargebridge_database_identity', 'TRIGGER')
            OR pg_catalog.has_any_column_privilege(r.oid, 'public.chargebridge_database_identity', 'INSERT')
            OR pg_catalog.has_any_column_privilege(r.oid, 'public.chargebridge_database_identity', 'UPDATE')
            OR pg_catalog.has_any_column_privilege(r.oid, 'public.chargebridge_database_identity', 'REFERENCES'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode((SELECT relacl FROM pg_catalog.pg_class
          WHERE oid OPERATOR(pg_catalog.=) 'public.chargebridge_database_identity'::pg_catalog.regclass)) a
        WHERE a.grantee OPERATOR(pg_catalog.=) 'chargebridge_staging_runtime'::pg_catalog.regrole
          AND a.is_grantable
      ) AS ok`,
});

export async function provisionDatabaseIdentity({
  clientFactory = defaultClientFactory,
  report = (status) => process.stdout.write(`${status}\n`),
} = {}) {
  const emit = (status) => {
    // Only fixed statuses can reach an output sink. Never serialize errors.
    try { report(statuses.has(status) ? status : "FAILED"); } catch { /* no error echo */ }
  };
  let config;
  let client;
  let transaction = false;
  let commitAttempted = false;
  let committed = false;
  let connectionFault = false;
  let result = "FAILED";
  try {
    config = readProvisioningConfiguration();
    const inputs = privateInputs.get(config);
    client = await clientFactory({
      host: config.host, port: config.port, database: DATABASE, user: PROVISIONER,
      password: inputs.password,
      ssl: { ca: config.ca, rejectUnauthorized: true, servername: config.host },
      // Explicit options supersede PGOPTIONS and ambient namespace defaults.
      // No superuser-only logging options: managed doadmin cannot set them.
      options: "-c search_path=pg_catalog",
      connectionTimeoutMillis: 5_000, query_timeout: 15_000,
      application_name: "chargebridge-staging-marker-provisioner",
    });
    client.on("error", () => { connectionFault = true; });
    await client.connect();
    if (client.connection?.stream?.encrypted !== true ||
        client.connection.stream.authorized !== true) {
      throw new Refusal("FAILED / TARGET REFUSED");
    }
    const rawQuery = async (text) => {
      if (connectionFault) throw new Refusal("FAILED");
      if (text === "COMMIT") commitAttempted = true;
      const response = text === SQL.copy
        ? await new Promise((resolveCopy, rejectCopy) => {
          client.query(new BinaryIdentityCopy(inputs.identity, (error, copied) => {
            if (error) rejectCopy(error);
            else resolveCopy(copied);
          }));
        })
        : await client.query(text);
      if (connectionFault) throw new Refusal("FAILED");
      return response;
    };
    const verifyNamespace = async () => {
      requireTrue(await rawQuery(SQL.namespace), "FAILED / NAMESPACE REFUSED");
    };
    // This bootstrap check is itself fully qualified, even if the server ignored
    // startup search_path options. Never try application/catalog work first.
    await verifyNamespace();
    await rawQuery("BEGIN");
    transaction = true;
    await rawQuery("SET LOCAL search_path = pg_catalog");
    await verifyNamespace();
    const query = async (text) => {
      await verifyNamespace();
      const mutatesMarker = [SQL.create, SQL.copy, SQL.revoke, SQL.grant].includes(text);
      if (mutatesMarker || text === "COMMIT") {
        requireTrue(await rawQuery(SQL.eventTriggers), "FAILED / SAFETY CHECK REFUSED");
      }
      // Recheck the approved logger configuration, not parameter suppression.
      const sensitive = mutatesMarker || text === SQL.markerIdentity || text === "COMMIT";
      if (sensitive) {
        requireLoggingSafety(await rawQuery(SQL.logging));
      }
      if (sensitive) await verifyNamespace();
      return rawQuery(text);
    };
    await query("SET LOCAL lock_timeout = '5s'");
    await query("SET LOCAL statement_timeout = '10s'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    requireTrue(await query(SQL.target), "FAILED / TARGET REFUSED");
    emit("TARGET VERIFIED");
    requireLoggingSafety(await query(SQL.logging));
    requireTrue(await query(SQL.prerequisites), "FAILED / PROVISIONER REFUSED");
    requireTrue(await query(SQL.roleSafety), "FAILED / SAFETY CHECK REFUSED");
    requireTrue(await query(SQL.lock), "FAILED / CONCURRENT OPERATION REFUSED");
    requireTrue(await query(SQL.absent), "MARKER EXISTS / REFUSED");
    // Prove the already-authorized switch BEFORE creating anything. No grants
    // of role membership, schema privileges, or database privileges are made.
    await query("SET LOCAL ROLE chargebridge_staging_runtime");
    requireTrue(await query(SQL.runtimeIdentity), "FAILED / PROVISIONER REFUSED");
    await query("SET LOCAL ROLE doadmin");
    requireTrue(await query(SQL.target), "FAILED / PROVISIONER REFUSED");
    emit("PROVISIONER VERIFIED");
    await query(SQL.create); // Owned by the verified effective doadmin role.
    const inserted = await query(SQL.copy);
    if (inserted.rowCount !== 1) throw new Refusal("FAILED");
    await query(SQL.revoke);
    await query(SQL.grant);
    requireTrue(await query(SQL.markerStructure), "FAILED");
    requireTrue(await query(SQL.roleSafety), "FAILED");
    requireTrue(await query(SQL.permissions), "FAILED");
    await query("SET LOCAL ROLE chargebridge_staging_runtime");
    requireTrue(await query(SQL.runtimeIdentity), "FAILED");
    const marker = await query(SQL.markerIdentity);
    const row = marker?.rows?.[0];
    if (marker?.rows?.length !== 1 || row.environment !== "staging" ||
        !Buffer.isBuffer(row.identity_bytes) ||
        !row.identity_bytes.equals(Buffer.from(inputs.identity.replaceAll("-", ""), "hex"))) {
      throw new Refusal("FAILED");
    }
    requireTrue(await query(SQL.permissions), "FAILED");
    requireTrue(await query(SQL.roleSafety), "FAILED");
    await query("SET LOCAL ROLE doadmin");
    requireTrue(await query(SQL.target), "FAILED");
    await query("COMMIT");
    committed = true;
    transaction = false;
    // Success is never announced for uncommitted DDL or rows.
    emit("MARKER CREATED");
    emit("MARKER VERIFIED");
    emit("RUNTIME SELECT VERIFIED");
    result = "RUNTIME SELECT VERIFIED";
  } catch (error) {
    let rollbackConfirmed = false;
    if (transaction && client) {
      // ROLLBACK is fixed grammar, not namespace-dependent. Do not let a failed
      // namespace/logging guard prevent cleanup of an already-open transaction.
      try { await client.query("ROLLBACK"); rollbackConfirmed = true; } catch { /* sanitized below */ }
    }
    if (commitAttempted && !committed) {
      // A lost COMMIT response cannot be resolved by a subsequent ROLLBACK.
      result = "OUTCOME UNKNOWN";
      emit(result);
    } else {
      result = failureStatus(error);
      emit(result);
      if (transaction) emit(rollbackConfirmed ? "FAILED / ROLLED BACK" : "FAILED / ROLLBACK UNCONFIRMED");
    }
  } finally {
    if (config) privateInputs.delete(config);
    if (client) {
      try { await client.end(); } catch {
        emit("CONNECTION CLOSE FAILED");
        if (committed) result = "CONNECTION CLOSE FAILED";
      }
    }
  }
  return result; // Status only: no configuration, row data, or error objects.
}

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // Refuse arguments instead of risking credential-bearing command invocations.
  // Suppress raw process-level errors as well as driver/query exceptions.
  const fatal = () => { process.stderr.write("FAILED\n"); process.exit(1); };
  process.once("uncaughtException", fatal);
  process.once("unhandledRejection", fatal);
  if (process.argv.length !== 2) {
    process.stderr.write("FAILED / CONFIGURATION REFUSED\n");
    process.exitCode = 1;
  } else {
    const status = await provisionDatabaseIdentity();
    process.exitCode = status === "RUNTIME SELECT VERIFIED" ? 0 : 1;
  }
}