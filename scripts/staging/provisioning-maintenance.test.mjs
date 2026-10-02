import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  maintenanceConfiguration, maintenanceHealthHandler, startMaintenance,
} from "./provisioning-maintenance.mjs";

test("staging maintenance uses configured PORT and binds all interfaces", () => {
  assert.deepEqual(maintenanceConfiguration({ CHARGEBRIDGE_ENVIRONMENT: "staging", PORT: "8080" }),
    { port: 8080, host: "0.0.0.0" });
});

for (const [name, env] of [
  ["production", { CHARGEBRIDGE_ENVIRONMENT: "production", PORT: "8080" }],
  ["missing environment", { PORT: "8080" }],
  ...["", "0", "-1", "65536", "80x", "080", "8080\n"].map((port) =>
    [`invalid port ${JSON.stringify(port)}`, { CHARGEBRIDGE_ENVIRONMENT: "staging", PORT: port }]),
]) {
  test(`maintenance refuses ${name}`, () => {
    assert.throws(() => maintenanceConfiguration(env), { message: "MAINTENANCE CONFIGURATION REFUSED" });
  });
}

function responseFor(method, url) {
  let status;
  let headers;
  let body;
  maintenanceHealthHandler({ method, url, headers: { authorization: "FAKE-SENSITIVE-INPUT" } }, {
    writeHead(code, values) { status = code; headers = values; },
    end(value) { body = value; },
  });
  return { status, headers, body };
}

for (const path of ["/", "/health", "/api/health", "/provision", "/provision?secret=FAKE-SENSITIVE-INPUT"]) {
  test(`GET ${path} is only generic maintenance health`, () => {
    const response = responseFor("GET", path);
    assert.equal(response.status, 200);
    assert.equal(response.body, '{"status":"maintenance"}\n');
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.headers["Content-Length"], Buffer.byteLength(response.body));
    assert.equal(JSON.stringify(response).includes("FAKE-SENSITIVE-INPUT"), false);
  });
}

test("HEAD has no response body", () => {
  assert.equal(responseFor("HEAD", "/provision").body, undefined);
});

for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
  test(`${method} cannot trigger a provisioning action`, () => {
    const response = responseFor(method, "/provision");
    assert.equal(response.status, 405);
    assert.equal(response.headers.Allow, "GET, HEAD");
    assert.equal(response.body, '{"status":"maintenance"}\n');
  });
}

test("maintenance starts only an injected fake server; no socket is opened", () => {
  let handler;
  let binding;
  const fakeServer = {
    on() {},
    listen(...args) { binding = args; },
  };
  const server = startMaintenance({
    env: { CHARGEBRIDGE_ENVIRONMENT: "staging", PORT: "8080" },
    serverFactory(value) { handler = value; return fakeServer; },
  });
  assert.equal(server, fakeServer);
  assert.equal(handler, maintenanceHealthHandler);
  assert.deepEqual(binding, [8080, "0.0.0.0"]);
});

test("maintenance entrypoint has no application, database, or provisioning import/hook", () => {
  const source = readFileSync(new URL("./provisioning-maintenance.mjs", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["node:http", "node:path", "node:url"]);
  assert.doesNotMatch(source, /bootstrap\.ts|startupGate\.ts|provision-database-identity|child_process|DATABASE_URL/);
  assert.match(source, /if \(invokedDirectly\)/);
});