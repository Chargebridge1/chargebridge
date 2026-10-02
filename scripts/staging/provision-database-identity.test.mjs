import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { provisionDatabaseIdentity, readProvisioningConfiguration } from "./provision-database-identity.mjs";

// Synthetic fixtures only. Tests neither request nor need an actual secret.
const IDENTITY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PASSWORD = "UNIT-TEST-ONLY-NOT-A-CREDENTIAL";
const HOST = "staging-db.example.invalid";
const SAFE_LOGGING = Object.freeze({
  log_statement: "none",
  pgaudit_log: "none",
  pgaudit_log_parameter: "off",
  log_duration: "off",
  log_transaction_sample_rate: "0",
  log_min_duration_sample: "-1",
  log_min_error_statement: "error",
  log_min_duration_statement: "1000",
  auto_explain_log_min_duration: "-1",
  // These can remain unlimited. The implementation must never rely on them.
  log_parameter_max_length: "-1",
  log_parameter_max_length_on_error: "-1",
  log_error_verbosity: "default",
});
const environment = {
  CHARGEBRIDGE_ENVIRONMENT: "staging",
  CHARGEBRIDGE_STAGING_DB_ID: IDENTITY,
  CHARGEBRIDGE_STAGING_PROVISIONER_PASSWORD: PASSWORD,
  CHARGEBRIDGE_STAGING_DB_HOST: HOST,
  CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST: HOST,
  CHARGEBRIDGE_STAGING_DB_PORT: "25060",
  CHARGEBRIDGE_STAGING_DB_ROLE: "chargebridge_staging_runtime",
  CHARGEBRIDGE_STAGING_PROVISIONER_CA_CERT: rootCertificates[0],
};

async function withEnvironment(overrides, work) {
  const original = process.env;
  process.env = { ...environment, ...overrides };
  try { return await work(); } finally { process.env = original; }
}

function mockDatabase({ refuse, throwAt, commitError = false, rollbackError = false,
  closeError = false, connectError = false, insertCount = 1, tls = true,
  authorized = tls, faultAt, refuseAfter, errorValue,
  namespaceState = { path: "pg_catalog", schemas: ["pg_catalog"], temporaryOid: 0 },
  loggingSettings = {}, markerRows,
  copyWriteError = false, copySubmitError = false, copyReadyError = false,
  copyLateResponse = false, copyCompleteText, copyRepeatedResponse = false,
} = {}) {
  const calls = [];
  const events = {};
  let options;
  let ended = false;
  const client = {
    connection: { stream: { encrypted: tls, authorized } },
    on(name, callback) { events[name] = callback; },
    async connect() {
      calls.push({ text: "CONNECT" });
      if (connectError) throw errorValue ?? new Error(`${IDENTITY} ${PASSWORD}`);
    },
    query(statement, values) {
      const text = typeof statement === "string" ? statement : statement.text;
      const call = { text, values };
      calls.push(call);
      const label = text.match(/\/\* ([a-z-]+) \*\//)?.[1] ?? text;
      if (faultAt === label) events.error(new Error(`${IDENTITY} ${PASSWORD}`));
      if (throwAt === label || (throwAt && text.startsWith(throwAt)) ||
          (commitError && text === "COMMIT") ||
          (rollbackError && text === "ROLLBACK")) {
        if (errorValue !== undefined) throw errorValue;
        const error = new Error(`RAW-DRIVER-ERROR ${IDENTITY} ${PASSWORD} postgres://doadmin:${PASSWORD}@${HOST}`);
        error.detail = `DETAIL ${IDENTITY}`;
        if (typeof statement !== "string") {
          statement.handleError(error);
          return statement;
        }
        throw error;
      }
      const changedPrecondition = refuseAfter?.guard === label &&
        calls.slice(0, -1).some((call) => call.text.startsWith(refuseAfter.statementPrefix));
      if (label === "logging") {
        return { rows: [{ ...SAFE_LOGGING, ...loggingSettings,
          ...(label === refuse || changedPrecondition ? { log_statement: "all" } : {}),
        }] };
      }
      if (label === "marker-identity") {
        return { rows: markerRows ?? (label === refuse
          ? [] : [{ identity_bytes: Buffer.from(IDENTITY.replaceAll("-", ""), "hex"), environment: "staging" }]) };
      }
      if (typeof statement !== "string") {
        // Exercise the real Submittable's protocol handlers, never a database.
        call.copyChunks = [];
        call.copyDone = false;
        const connection = {
          query(sql) {
            assert.equal(sql, text);
            if (copySubmitError) throw new Error(`${IDENTITY} ${PASSWORD}`);
          },
          sendCopyFromChunk(chunk) {
            if (copyWriteError) throw new Error(`${IDENTITY} ${PASSWORD}`);
            call.copyChunks.push(Buffer.from(chunk));
          },
          endCopyFrom() { call.copyDone = true; },
          sendCopyFail(message) { call.copyFailure = message; },
        };
        const submitError = statement.submit(connection);
        if (submitError) statement.handleError(submitError);
        if (copySubmitError) return statement;
        if (copyLateResponse) statement.handleError(new Error("Query read timeout"));
        statement.handleCopyInResponse(connection);
        if (copyRepeatedResponse) statement.handleCopyInResponse(connection);
        statement.handleCommandComplete({ text: copyCompleteText ?? `COPY ${insertCount}` });
        if (copyReadyError) statement.handleError(new Error(`${IDENTITY} ${PASSWORD}`));
        statement.handleReadyForQuery();
        return statement;
      }
      if (label === "namespace") {
        const safe = namespaceState.path === "pg_catalog" &&
          namespaceState.schemas.length === 1 && namespaceState.schemas[0] === "pg_catalog" &&
          namespaceState.temporaryOid === 0;
        return { rows: [{ ok: safe && label !== refuse && !changedPrecondition }] };
      }
      if (text.startsWith("/*")) return { rows: [{ ok: label !== refuse && !changedPrecondition }] };
      return { rows: [], rowCount: 0 };
    },
    async end() {
      ended = true;
      if (closeError) throw new Error(`${IDENTITY} ${PASSWORD}`);
    },
  };
  return {
    calls,
    get options() { return options; },
    get ended() { return ended; },
    factory(value) { options = value; return client; },
  };
}

function assertNonDisclosing(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(text.toLowerCase().includes(IDENTITY), false, "identity must not reach output");
  assert.equal(text.includes(PASSWORD), false, "password must not reach output");
  assert.equal(text.includes("postgres://"), false, "connection URL must not reach output");
  assert.equal(text.includes("RAW-DRIVER-ERROR"), false, "driver errors must not reach output");
}

async function exercise(overrides = {}, behavior = {}) {
  const database = mockDatabase(behavior);
  const output = [];
  const result = await withEnvironment(overrides, () => provisionDatabaseIdentity({
    clientFactory: database.factory,
    report(status) { output.push(status); },
  }));
  assertNonDisclosing({ output, result });
  return { database, output, result };
}

test("configuration returns only non-secret metadata, with fixed database and provisioner", async () => {
  await withEnvironment({}, () => {
    const config = readProvisioningConfiguration();
    assert.equal(config.database, "chargebridge_staging");
    assert.equal(config.user, "doadmin");
    assert.equal(config.host, HOST);
    assert.equal(config.port, 25060);
    assert.equal(Object.isFrozen(config), true);
    assertNonDisclosing(config);
  });
});

for (const [name, overrides] of [
  ["production environment", { CHARGEBRIDGE_ENVIRONMENT: "production" }],
  ["missing environment", { CHARGEBRIDGE_ENVIRONMENT: undefined }],
  ["missing identity", { CHARGEBRIDGE_STAGING_DB_ID: undefined }],
  ["invalid identity", { CHARGEBRIDGE_STAGING_DB_ID: `${IDENTITY}-invalid` }],
  ["missing provisioner password", { CHARGEBRIDGE_STAGING_PROVISIONER_PASSWORD: undefined }],
  ["blank provisioner password", { CHARGEBRIDGE_STAGING_PROVISIONER_PASSWORD: " " }],
  ["invalid password", { CHARGEBRIDGE_STAGING_PROVISIONER_PASSWORD: `${PASSWORD}\0` }],
  ["runtime provisioner", { CHARGEBRIDGE_STAGING_PROVISIONER_ROLE: "chargebridge_staging_runtime" }],
  ["migrator provisioner", { CHARGEBRIDGE_STAGING_PROVISIONER_ROLE: "chargebridge_staging_migrator" }],
  ["postgres provisioner", { CHARGEBRIDGE_STAGING_PROVISIONER_ROLE: "postgres" }],
  ["wrong API runtime", { CHARGEBRIDGE_STAGING_DB_ROLE: "doadmin" }],
  ["missing approved host", { CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST: undefined }],
  ["mismatched approved host", { CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST: "other.example.invalid" }],
  ["production host", { CHARGEBRIDGE_STAGING_DB_HOST: "production.example.invalid",
    CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST: "production.example.invalid" }],
  ["URL as hostname", { CHARGEBRIDGE_STAGING_DB_HOST: "postgres://example.invalid/production" }],
  ["localhost", { CHARGEBRIDGE_STAGING_DB_HOST: "localhost",
    CHARGEBRIDGE_STAGING_PROVISIONER_APPROVED_HOST: "localhost" }],
  ["missing CA", { CHARGEBRIDGE_STAGING_PROVISIONER_CA_CERT: undefined }],
  ["malformed CA", { CHARGEBRIDGE_STAGING_PROVISIONER_CA_CERT: PASSWORD }],
  ["extra material in CA", { CHARGEBRIDGE_STAGING_PROVISIONER_CA_CERT: `${rootCertificates[0]}\n${PASSWORD}` }],
  ...["", "0", "65536", "025060", "25060\n", "5432?user=postgres"].map((port) =>
    [`invalid port ${JSON.stringify(port)}`, { CHARGEBRIDGE_STAGING_DB_PORT: port }]),
]) {
  test(`refuses ${name} before constructing a client`, async () => {
    const { database, output, result } = await exercise(overrides);
    assert.equal(database.options, undefined);
    assert.equal(database.calls.length, 0);
    assert.equal(result, "FAILED / CONFIGURATION REFUSED");
    assert.deepEqual(output, ["FAILED / CONFIGURATION REFUSED"]);
  });
}

test("successful mocked transaction uses verified TLS and a separate fixed doadmin connection", async () => {
  const { database, output, result } = await exercise({
    PGHOST: "production.example.invalid", PGPORT: "5432", PGDATABASE: "production",
    PGUSER: "postgres", PGOPTIONS: "-c role=postgres",
    DATABASE_URL: `postgres://postgres:${PASSWORD}@production.example.invalid/production`,
  });
  const options = database.options;
  assert.equal(options.host, HOST);
  assert.equal(options.user, "doadmin");
  assert.equal(options.database, "chargebridge_staging");
  assert.equal(options.port, 25060);
  assert.equal(options.connectionString, undefined);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.servername, HOST);
  assert.equal(options.ssl.ca, rootCertificates[0]);
  assert.equal(options.options, "-c search_path=pg_catalog");
  assert.doesNotMatch(options.options, /log_parameter_max_length|log_error_verbosity/);
  assert.equal(result, "RUNTIME SELECT VERIFIED");
  assert.deepEqual(output, ["TARGET VERIFIED", "PROVISIONER VERIFIED",
    "MARKER CREATED", "MARKER VERIFIED", "RUNTIME SELECT VERIFIED"]);
  assert.equal(database.ended, true);
  assert.equal(database.calls.filter((call) => call.text === "COMMIT").length, 1);
  assert.equal(database.calls.some((call) => call.text === "ROLLBACK"), false);
});

test("active 1000 ms duration logging and unlimited bind limits do not require superuser settings", async () => {
  const { database, result } = await exercise({}, { loggingSettings: {
    log_parameter_max_length: "-1",
    log_parameter_max_length_on_error: "-1",
    log_error_verbosity: "default",
  } });
  assert.equal(result, "RUNTIME SELECT VERIFIED");
  assert.equal(database.options.options, "-c search_path=pg_catalog");
  // Even a slow/error statement logger with unlimited parameters sees only
  // fixed SQL, never the UUID. Protocol-data logging is a separate operator risk.
  const statementLog = database.calls.map(({ text, values }) => ({ text, values }));
  assertNonDisclosing(statementLog);
  assert.equal(statementLog.every(({ values }) => values === undefined), true);
});

for (const [setting, value] of [
  ["log_statement", "all"], ["log_statement", "ddl"], ["log_statement", "mod"],
  ["pgaudit_log", "all"], ["pgaudit_log", "write"],
  ["pgaudit_log_parameter", "on"], ["log_duration", "on"],
  ["log_transaction_sample_rate", "0.1"], ["log_min_duration_sample", "0"],
  ["log_min_error_statement", "warning"], ["log_min_error_statement", "log"],
  ["log_min_duration_statement", "0"], ["log_min_duration_statement", "999"],
  ["log_min_duration_statement", "1001"], ["log_min_duration_statement", "1s"],
  ["auto_explain_log_min_duration", "0"],
  ...Object.keys(SAFE_LOGGING).filter((key) =>
    !["log_parameter_max_length", "log_parameter_max_length_on_error", "log_error_verbosity"].includes(key))
    .map((key) => [key, undefined]),
]) {
  test(`logging gate refuses unapproved/missing ${setting}=${String(value)} before DDL or COPY`, async () => {
    const { database, result, output } = await exercise({}, { loggingSettings: { [setting]: value } });
    assert.equal(result, "FAILED / SAFETY CHECK REFUSED");
    assert.equal(database.calls.some(({ text }) => /^(CREATE|COPY|REVOKE|GRANT)/.test(text)), false);
    assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(output.includes("MARKER CREATED"), false);
  });
}

for (const behavior of [
  { copySubmitError: true }, { copyWriteError: true }, { copyReadyError: true },
  { copyLateResponse: true }, { copyRepeatedResponse: true },
  { copyCompleteText: "INSERT 0 1" }, { insertCount: 2 },
]) {
  test(`COPY protocol failure ${Object.keys(behavior)[0]} rolls back without success or unsafe fallback`, async () => {
    const { database, result, output } = await exercise({}, behavior);
    assert.equal(result, "FAILED");
    assert.equal(output.includes("FAILED / ROLLED BACK"), true);
    assert.equal(output.includes("MARKER CREATED"), false);
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(database.calls.some(({ text }) => /^INSERT|FORMAT (?:text|csv)/i.test(text)), false);
    const copy = database.calls.find(({ text }) => text.startsWith("COPY"));
    if (behavior.copyLateResponse) {
      assert.equal(copy.copyChunks.length, 0);
      assert.equal(copy.copyFailure, "FAILED");
    }
    if (behavior.copyWriteError || behavior.copyRepeatedResponse) {
      assert.equal(copy.copyFailure, "FAILED");
    }
    if (behavior.copyRepeatedResponse) assert.equal(copy.copyChunks.length, 1);
  });
}

for (const [name, markerRows] of [
  ["no row", []],
  ["multiple rows", [
    { identity_bytes: Buffer.from(IDENTITY.replaceAll("-", ""), "hex"), environment: "staging" },
    { identity_bytes: Buffer.from(IDENTITY.replaceAll("-", ""), "hex"), environment: "staging" },
  ]],
  ["wrong environment", [
    { identity_bytes: Buffer.from(IDENTITY.replaceAll("-", ""), "hex"), environment: "production" },
  ]],
  ["wrong identity", [{ identity_bytes: Buffer.alloc(16), environment: "staging" }]],
  ["text instead of binary", [{ identity_bytes: IDENTITY, environment: "staging" }]],
  ["missing identity", [{ environment: "staging" }]],
]) {
  test(`in-memory runtime identity check refuses ${name} and rolls back`, async () => {
    const { database, result, output } = await exercise({}, { markerRows });
    assert.equal(result, "FAILED");
    assert.equal(output.includes("FAILED / ROLLED BACK"), true);
    assert.equal(output.includes("MARKER VERIFIED"), false);
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(database.calls.every(({ values }) => values === undefined), true);
  });
}

test("only the marker is mutated, with the approved definition and binary COPY identity", async () => {
  const { database } = await exercise();
  const mutations = database.calls.filter(({ text }) => /^(CREATE|COPY|REVOKE|GRANT)/.test(text));
  assert.equal(mutations.length, 4);
  assert.match(mutations[0].text, /^CREATE TABLE public\.chargebridge_database_identity/);
  assert.match(mutations[0].text, /identity_id pg_catalog\.uuid PRIMARY KEY/);
  assert.match(mutations[0].text, /environment pg_catalog\.text NOT NULL UNIQUE/);
  assert.match(mutations[0].text, /CHECK \(environment OPERATOR\(pg_catalog\.=\) 'staging'::pg_catalog\.text\)/);
  for (const call of mutations) {
    assert.match(call.text, /public\.chargebridge_database_identity/);
    assertNonDisclosing(call.text);
  }
  assert.match(mutations[1].text, /^COPY public\.chargebridge_database_identity \(identity_id, environment\)/);
  assert.match(mutations[1].text, /FROM STDIN WITH \(FORMAT binary\)/);
  assert.equal(mutations[1].values, undefined);
  assert.equal(mutations[1].copyDone, true);
  assert.equal(mutations[1].copyChunks.length, 1);
  const payload = mutations[1].copyChunks[0];
  assert.equal(payload.length, 54);
  assert.equal(payload.subarray(0, 11).equals(Buffer.from("5047434f50590aff0d0a00", "hex")), true);
  assert.equal(payload.readInt32BE(11), 0);
  assert.equal(payload.readInt32BE(15), 0);
  assert.equal(payload.readInt16BE(19), 2);
  assert.equal(payload.readInt32BE(21), 16);
  assert.equal(payload.subarray(25, 41).equals(Buffer.from(IDENTITY.replaceAll("-", ""), "hex")), true);
  assert.equal(payload.readInt32BE(41), 7);
  assert.equal(payload.subarray(45, 52).toString(), "staging");
  assert.equal(payload.readInt16BE(52), -1);
  assert.equal(database.calls.every(({ values }) => values === undefined), true);
  assert.equal(database.calls.some(({ text }) => /\$[0-9]+/.test(text)), false);
  assert.match(mutations[2].text, /FROM PUBLIC, chargebridge_staging_runtime/);
  assert.match(mutations[3].text, /^GRANT SELECT ON TABLE/);
  assert.equal(database.calls.some(({ text }) =>
    /^(?:DROP\b|ALTER\s+TABLE\b|GRANT\b[\s\S]*\bTO\s+doadmin\b)/i.test(text) ||
    /migration_ledger/i.test(text)), false);
});

test("runtime switch is proved before CREATE and runtime verification precedes COMMIT", async () => {
  const { database } = await exercise();
  const texts = database.calls.map(({ text }) => text);
  const switchIndex = texts.indexOf("SET LOCAL ROLE chargebridge_staging_runtime");
  const createIndex = texts.findIndex((text) => text.startsWith("CREATE TABLE"));
  const verificationIndex = texts.findIndex((text) => text.startsWith("/* marker-identity */"));
  assert.equal(switchIndex < createIndex, true);
  const runtimeChecks = texts.slice(createIndex, verificationIndex)
    .filter((text) => text.startsWith("/* runtime-identity */"));
  assert.equal(runtimeChecks.length, 1);
  assert.equal(texts.slice(createIndex, verificationIndex).includes("SET LOCAL ROLE chargebridge_staging_runtime"), true);
  assert.equal(verificationIndex < texts.indexOf("COMMIT"), true);
  const comparison = database.calls[verificationIndex];
  assert.match(comparison.text, /pg_catalog\.uuid_send\(identity_id\) AS identity_bytes/);
  assert.match(comparison.text, /FROM public\.chargebridge_database_identity/);
  assert.equal(comparison.values, undefined);
});

for (const [label, expected] of [
  ["target", "FAILED / TARGET REFUSED"],
  ["logging", "FAILED / SAFETY CHECK REFUSED"],
  ["prerequisites", "FAILED / PROVISIONER REFUSED"],
  ["role-safety", "FAILED / SAFETY CHECK REFUSED"],
  ["serialize", "FAILED / CONCURRENT OPERATION REFUSED"],
  ["absent", "MARKER EXISTS / REFUSED"],
  ["runtime-identity", "FAILED / PROVISIONER REFUSED"],
]) {
  test(`failed ${label} stops before marker creation and rolls back`, async () => {
    const { database, output, result } = await exercise({}, { refuse: label });
    assert.equal(result, expected);
    assert.equal(database.calls.some(({ text }) => /^(CREATE|COPY|REVOKE|GRANT)/.test(text)), false);
    assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(output.includes("MARKER CREATED"), false);
    assert.equal(database.ended, true);
  });
}

test("unverified TLS refuses before any query", async () => {
  const { database, result } = await exercise({}, { tls: false });
  assert.equal(result, "FAILED / TARGET REFUSED");
  assert.deepEqual(database.calls.map(({ text }) => text), ["CONNECT"]);
  assert.equal(database.ended, true);
});

test("encrypted but unauthorized TLS refuses before any query", async () => {
  const { database, result } = await exercise({}, { tls: true, authorized: false });
  assert.equal(result, "FAILED / TARGET REFUSED");
  assert.deepEqual(database.calls.map(({ text }) => text), ["CONNECT"]);
});

test("connect errors are sanitized and the client is closed", async () => {
  const { database, result } = await exercise({}, { connectError: true });
  assert.equal(result, "FAILED");
  assert.deepEqual(database.calls.map(({ text }) => text), ["CONNECT"]);
  assert.equal(database.ended, true);
});

test("a denied role switch causes rollback before marker creation", async () => {
  const { database, output } = await exercise({}, { throwAt: "SET LOCAL ROLE chargebridge_staging_runtime" });
  assert.equal(database.calls.some(({ text }) => text.startsWith("CREATE TABLE")), false);
  assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
  assert.equal(output.includes("FAILED / ROLLED BACK"), true);
});

test("a racing external CREATE failure is not retried, accepted, or repaired", async () => {
  const { database, output } = await exercise({}, {
    throwAt: "CREATE TABLE",
  });
  assert.equal(database.calls.filter(({ text }) => text.startsWith("CREATE TABLE")).length, 1);
  assert.equal(database.calls.some(({ text }) => text.startsWith("COPY")), false);
  assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
  assert.equal(output.includes("FAILED / ROLLED BACK"), true);
});

for (const label of ["marker-structure", "effective-permissions", "marker-identity"]) {
  test(`failed ${label} rolls back all creation, insertion, and grants`, async () => {
    const { database, output } = await exercise({}, { refuse: label });
    assert.equal(database.calls.some(({ text }) => text.startsWith("CREATE TABLE")), true);
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
    assert.equal(output.includes("FAILED / ROLLED BACK"), true);
    assert.equal(output.includes("MARKER CREATED"), false);
    assert.equal(output.includes("MARKER VERIFIED"), false);
  });
}

test("incorrect COPY row count rolls back", async () => {
  const { database, output } = await exercise({}, { insertCount: 0 });
  assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
  assert.equal(output.includes("FAILED / ROLLED BACK"), true);
});

test("raw errors, including identity, password and URL, never reach statuses or return values", async () => {
  const { output } = await exercise({}, { throwAt: "marker-identity" });
  assert.equal(output.includes("FAILED / ROLLED BACK"), true);
});

test("lost COMMIT response is unknown, not success or a claimed rollback", async () => {
  const { database, output, result } = await exercise({}, { commitError: true });
  assert.equal(result, "OUTCOME UNKNOWN");
  assert.equal(database.calls.filter(({ text }) => text === "COMMIT").length, 1);
  assert.equal(output.includes("MARKER CREATED"), false);
  assert.equal(output.includes("FAILED / ROLLED BACK"), false);
  assert.equal(database.ended, true);
});

test("rollback failure is disclosed without exposing the raw error", async () => {
  const { output } = await exercise({}, { throwAt: "marker-identity", rollbackError: true });
  assert.equal(output.includes("FAILED / ROLLBACK UNCONFIRMED"), true);
});

test("connection close errors are sanitized", async () => {
  const { output, result } = await exercise({}, { closeError: true });
  assert.equal(output.includes("CONNECTION CLOSE FAILED"), true);
  assert.equal(result, "CONNECTION CLOSE FAILED");
});

test("driver error events are handled and stop the operation", async () => {
  const { database, output } = await exercise({}, { faultAt: "absent" });
  assert.equal(database.calls.some(({ text }) => text.startsWith("CREATE TABLE")), false);
  assert.equal(output.includes("FAILED / ROLLED BACK"), true);
});

test("identity inputs are normalized only internally", async () => {
  const { database } = await exercise({ CHARGEBRIDGE_STAGING_DB_ID: IDENTITY.toUpperCase() });
  const copy = database.calls.find(({ text }) => text.startsWith("COPY"));
  assert.equal(copy.copyChunks[0].subarray(25, 41)
    .equals(Buffer.from(IDENTITY.replaceAll("-", ""), "hex")), true);
});

test("SQL checks effective inherited/assumable permissions, ownership and DDL capabilities", async () => {
  const { database } = await exercise();
  const roles = database.calls.find(({ text }) => text.startsWith("/* role-safety */")).text;
  const permissions = database.calls.find(({ text }) => text.startsWith("/* effective-permissions */")).text;
  assert.match(roles, /'USAGE'/);
  assert.match(roles, /'SET'/);
  for (const attribute of ["rolsuper", "rolcreaterole", "rolcreatedb", "rolreplication", "rolbypassrls"]) {
    assert.equal(roles.includes(attribute), true);
  }
  assert.match(roles, /has_schema_privilege/);
  assert.match(roles, /has_database_privilege/);
  assert.match(roles, /pg_auth_members/);
  assert.match(roles, /admin_option/);
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    assert.equal(permissions.includes(`'${privilege}'`), true);
  }
  assert.match(permissions, /relowner/);
  assert.match(permissions, /is_grantable/);
  assert.match(permissions, /has_any_column_privilege/);
});

for (const [name, namespaceState] of [
  ["public search path", { path: "public, pg_catalog", schemas: ["public", "pg_catalog"], temporaryOid: 0 }],
  ["ambient role search path", { path: '"$user", public', schemas: ["pg_catalog", "public"], temporaryOid: 0 }],
  ["temporary schema resolution", { path: "pg_catalog", schemas: ["pg_temp_1", "pg_catalog"], temporaryOid: 100 }],
  ["unexpected effective namespace", { path: "pg_catalog", schemas: ["pg_catalog", "public"], temporaryOid: 0 }],
  ["existing temporary objects", { path: "pg_catalog", schemas: ["pg_catalog"], temporaryOid: 100 }],
]) {
  test(`refuses ${name} before BEGIN, DDL or identity-bearing queries`, async () => {
    const { database, output, result } = await exercise({}, { namespaceState });
    assert.equal(result, "FAILED / NAMESPACE REFUSED");
    assert.equal(database.calls.some(({ text }) => text === "BEGIN"), false);
    assert.equal(database.calls.some(({ values }) => values !== undefined), false);
    assert.equal(database.calls.some(({ text }) => /^(CREATE|COPY|REVOKE|GRANT)/.test(text)), false);
    assert.equal(output.includes("MARKER CREATED"), false);
    assert.equal(database.ended, true);
  });
}

for (const statementPrefix of [
  "SET LOCAL search_path", "SET LOCAL ROLE chargebridge_staging_runtime",
  "CREATE TABLE", "GRANT SELECT",
]) {
  test(`namespace drift after ${statementPrefix} stops and rolls back`, async () => {
    const { database, result, output } = await exercise({}, {
      refuseAfter: { guard: "namespace", statementPrefix },
    });
    assert.equal(result, "FAILED / NAMESPACE REFUSED");
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
    assert.equal(output.includes("FAILED / ROLLED BACK"), true);
    assert.equal(output.includes("MARKER CREATED"), false);
    if (statementPrefix === "CREATE TABLE") {
      assert.equal(database.calls.some(({ text }) => text.startsWith("COPY")), false);
    }
  });
}

test("a fully qualified namespace check runs first and explicit transaction pinning precedes other work", async () => {
  const { database } = await exercise();
  const texts = database.calls.map(({ text }) => text);
  assert.equal(texts[1].startsWith("/* namespace */"), true);
  assert.equal(texts[2], "BEGIN");
  assert.equal(texts[3], "SET LOCAL search_path = pg_catalog");
  assert.equal(texts[4].startsWith("/* namespace */"), true);
  assert.match(texts[1], /pg_catalog\.current_setting\('search_path'\)/);
  assert.match(texts[1], /pg_catalog\.current_schemas\(true\)/);
  assert.match(texts[1], /pg_catalog\.pg_my_temp_schema\(\)/);
});

test("catalogs, functions, casts, type resolution and operators are explicitly trusted", async () => {
  const { database } = await exercise();
  const statements = database.calls.map(({ text }) => text)
    .filter((text) => text.startsWith("/*") || text.startsWith("CREATE") || text.startsWith("COPY"));
  const functions = ["current_setting", "current_database", "current_schemas", "pg_my_temp_schema",
    "pg_is_in_recovery", "has_schema_privilege", "has_database_privilege", "pg_has_role",
    "pg_try_advisory_xact_lock", "to_regclass", "aclexplode", "acldefault", "count", "bool_and",
    "has_table_privilege", "has_any_column_privilege", "uuid_send"];
  for (const statement of statements) {
    for (const name of functions) {
      assert.doesNotMatch(statement, new RegExp(`(?<!pg_catalog\\.)\\b${name}\\s*\\(`, "i"));
    }
    assert.doesNotMatch(statement, /\b(?:FROM|JOIN)\s+(?!pg_catalog\.|public\.)pg_[a-z_]+/i);
    assert.doesNotMatch(statement, /::(?!pg_catalog\.)[a-z_]+/i);
    // Remove string literals and qualified OPERATOR expressions. No ambient
    // comparison operator may remain; SQL grammar AND/IS/COALESCE is not a function.
    const stripped = statement.replace(/'(?:''|[^'])*'/g, "''")
      .replace(/OPERATOR\(pg_catalog\.[<>=]+\)/g, "OPERATOR()");
    assert.doesNotMatch(stripped, /[<>=]/);
    assertNonDisclosing(statement);
  }
  const structure = statements.find((statement) => statement.startsWith("/* marker-structure */"));
  assert.match(structure, /'pg_catalog\.uuid'::pg_catalog\.regtype/);
  assert.match(structure, /'pg_catalog\.text'::pg_catalog\.regtype/);
  assert.match(structure, /'public\.chargebridge_database_identity'::pg_catalog\.regclass/);
  assert.match(structure, /'doadmin'::pg_catalog\.regrole/);
});

for (const statementPrefix of ["CREATE TABLE", "COPY public.", "REVOKE ALL", "GRANT SELECT"]) {
  test(`new event trigger detected after ${statementPrefix} stops remaining work and commit`, async () => {
    const { database, output, result } = await exercise({}, {
      refuseAfter: { guard: "event-triggers", statementPrefix },
    });
    assert.equal(result, "FAILED / SAFETY CHECK REFUSED");
    assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(output.includes("MARKER CREATED"), false);
    if (statementPrefix === "CREATE TABLE") {
      assert.equal(database.calls.some(({ text }) => text.startsWith("COPY")), false);
    }
  });
}

test("enabled event trigger check refuses before CREATE even when other prerequisites passed", async () => {
  const { database, result } = await exercise({}, { refuse: "event-triggers" });
  assert.equal(result, "FAILED / SAFETY CHECK REFUSED");
  assert.equal(database.calls.some(({ text }) => text.startsWith("CREATE TABLE")), false);
  assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
});

test("every marker mutation and COMMIT rechecks event triggers and logging", async () => {
  const { database } = await exercise();
  const calls = database.calls;
  for (let index = 0; index < calls.length; index++) {
    if (/^(CREATE|COPY|REVOKE|GRANT)/.test(calls[index].text) || calls[index].text === "COMMIT") {
      assert.equal(calls[index - 3].text.startsWith("/* event-triggers */"), true);
      assert.equal(calls[index - 2].text.startsWith("/* logging */"), true);
      assert.equal(calls[index - 1].text.startsWith("/* namespace */"), true);
    }
  }
  const preflight = calls.find(({ text }) => text.startsWith("/* prerequisites */")).text;
  assert.match(preflight, /FROM pg_catalog\.pg_event_trigger/);
  assert.equal(calls.filter(({ text }) => text.startsWith("/* serialize */")).length, 1);
  assert.equal(calls.some(({ text }) => /^(CREATE|ALTER|DROP)\s+EVENT\s+TRIGGER/i.test(text)), false);
});

for (const statementPrefix of ["CREATE TABLE", "GRANT SELECT"]) {
  test(`logging protection drift after ${statementPrefix} refuses subsequent sensitive work`, async () => {
    const { database, output, result } = await exercise({}, {
      refuseAfter: { guard: "logging", statementPrefix },
    });
    assert.equal(result, "FAILED / SAFETY CHECK REFUSED");
    assert.equal(database.calls.some(({ text }) => text === "COMMIT"), false);
    assert.equal(database.calls.some(({ text }) => text === "ROLLBACK"), true);
    assert.equal(output.includes("MARKER CREATED"), false);
    if (statementPrefix === "CREATE TABLE") {
      assert.equal(database.calls.some(({ values }) => values !== undefined), false);
    }
  });
}

test("COPY and UUID verification recheck provider-compatible logging safeguards", async () => {
  const { database } = await exercise();
  for (let index = 0; index < database.calls.length; index++) {
    if (database.calls[index].text.startsWith("COPY") ||
        database.calls[index].text.startsWith("/* marker-identity */")) {
      assert.equal(database.calls[index - 2].text.startsWith("/* logging */"), true);
      assert.equal(database.calls[index - 1].text.startsWith("/* namespace */"), true);
      assertNonDisclosing(database.calls[index].text);
    }
  }
  const logging = database.calls.find(({ text }) => text.startsWith("/* logging */")).text;
  for (const setting of ["log_statement", "pgaudit.log", "pgaudit.log_parameter",
    "log_duration", "log_transaction_sample_rate", "log_min_duration_sample",
    "log_min_error_statement", "auto_explain.log_min_duration"]) {
    assert.equal(logging.includes(`current_setting('${setting}'`), true);
  }
  assert.match(logging, /FROM pg_catalog\.pg_settings/);
  assert.match(logging, /'log_min_duration_statement'::pg_catalog\.text/);
  assert.match(logging, /unit OPERATOR\(pg_catalog\.=\) 'ms'/);
  assert.doesNotMatch(logging, /log_parameter_max_length|log_error_verbosity/);
});

for (const phase of ["connect", "CREATE TABLE", "COPY public.", "marker-identity", "COMMIT", "ROLLBACK"]) {
  test(`PostgreSQL primary/DETAIL/HINT/CONTEXT/stack secrets at ${phase} never reach actual output`, async (t) => {
    const error = new Error(`ERROR: synthetic failed row ${IDENTITY} credential ${PASSWORD}`);
    Object.assign(error, {
      code: "23505", severity: "ERROR", detail: `Key (identity_id)=(${IDENTITY}) already exists. ${PASSWORD}`,
      hint: `Synthetic password ${PASSWORD}`, where: `CONTEXT row (${IDENTITY}, staging)`,
      query: `SYNTHETIC QUERY ${IDENTITY}`,
      stack: `SYNTHETIC STACK postgres://doadmin:${PASSWORD}@${HOST}/${IDENTITY}`,
    });
    const behavior = { errorValue: error };
    if (phase === "connect") behavior.connectError = true;
    else if (phase === "COMMIT") behavior.commitError = true;
    else if (phase === "ROLLBACK") {
      behavior.throwAt = "marker-identity";
      behavior.rollbackError = true;
    } else behavior.throwAt = phase;
    const database = mockDatabase(behavior);
    const captured = [];
    const stdout = t.mock.method(process.stdout, "write", (chunk) => { captured.push(String(chunk)); return true; });
    const stderr = t.mock.method(process.stderr, "write", (chunk) => { captured.push(String(chunk)); return true; });
    let result;
    try {
      result = await withEnvironment({}, () => provisionDatabaseIdentity({ clientFactory: database.factory }));
    } finally {
      stdout.mock.restore();
      stderr.mock.restore();
    }
    assertNonDisclosing({ result, captured });
    assert.equal(result, phase === "COMMIT" ? "OUTCOME UNKNOWN" : "FAILED");
    assert.equal(captured.some((text) => text.includes("MARKER CREATED")), false);
  });
}

test("unexpected thrown values or sensitive error getters are not serialized", async () => {
  let reads = 0;
  const error = new Error();
  for (const field of ["message", "detail", "stack", "status"]) {
    Object.defineProperty(error, field, { get() { reads++; throw new Error(PASSWORD); } });
  }
  const { result } = await exercise({}, { throwAt: "COPY public.", errorValue: error });
  assert.equal(result, "FAILED");
  assert.equal(reads, 0);
  const raw = await exercise({}, { throwAt: "COPY public.", errorValue: `${IDENTITY} ${PASSWORD}` });
  assert.equal(raw.result, "FAILED");
});

test("even an internal refusal with a corrupted status cannot return a secret", async () => {
  let refusal;
  await withEnvironment({ CHARGEBRIDGE_ENVIRONMENT: "production" }, () => {
    try { readProvisioningConfiguration(); } catch (error) { refusal = error; }
  });
  refusal.status = PASSWORD;
  const { result } = await exercise({}, { throwAt: "COPY public.", errorValue: refusal });
  assert.equal(result, "FAILED");
});

test("operator documentation does not promise independent DBA or absolute backend-log control", () => {
  const source = readFileSync(new URL("./provision-database-identity.mjs", import.meta.url), "utf8");
  assert.match(source, /no unrelated privileged DDL/);
  assert.match(source, /coordinates cooperating provisioners only/);
  assert.match(source, /cannot prevent an independent DBA/);
  assert.match(source, /primary error messages, third-party/);
  assert.match(source, /never grant extra privileges[\s\S]*or weaken logging checks/);
  assert.match(source, /do NOT suppress[\s\S]*bind-parameter logging/);
  assert.match(source, /log_parameter_max_length=-1 is outside our control/);
  assert.match(source, /binary COPY error context omits row\/column values/);
});

test("standalone module has no application/migration imports and is guarded against automatic execution", () => {
  const source = readFileSync(new URL("./provision-database-identity.mjs", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["node:module", "node:crypto", "node:path", "node:url"]);
  assert.match(source, /if \(invokedDirectly\)/);
  assert.match(source, /process\.argv\.length !== 2/);
  assert.doesNotMatch(source, /import\(["'][^"']*(?:bootstrap|startupGate|migration)/);
  assert.doesNotMatch(source, /console\.(?:log|error)|JSON\.stringify|RETURNING|SELECT identity_id/);
  assert.match(source, /const identity = env\.CHARGEBRIDGE_STAGING_DB_ID/);
});