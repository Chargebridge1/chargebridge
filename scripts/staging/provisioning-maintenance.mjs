import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Standalone maintenance entrypoint. No application, database, or provisioner
// imports. A successful health probe means maintenance is running, not API readiness.
const BODY = '{"status":"maintenance"}\n';

export function maintenanceConfiguration(env = process.env) {
  if (env.CHARGEBRIDGE_ENVIRONMENT !== "staging" ||
      !/^[1-9][0-9]{0,4}$/.test(env.PORT ?? "") ||
      Number(env.PORT) > 65535) {
    throw new Error("MAINTENANCE CONFIGURATION REFUSED");
  }
  return { port: Number(env.PORT), host: "0.0.0.0" };
}

export function maintenanceHealthHandler(request, response) {
  // The existing provider health-check path is not known. All GET/HEAD paths
  // return the same constant body; there is no routing, input echo, or action.
  const allowed = request.method === "GET" || request.method === "HEAD";
  response.writeHead(allowed ? 200 : 405, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(BODY),
    "X-Content-Type-Options": "nosniff",
    ...(allowed ? {} : { Allow: "GET, HEAD" }),
  });
  response.end(request.method === "HEAD" ? undefined : BODY);
}

export function startMaintenance({ env = process.env, serverFactory = createServer } = {}) {
  const { port, host } = maintenanceConfiguration(env);
  const server = serverFactory(maintenanceHealthHandler);
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  // Never print raw bind errors, headers, request paths, or environment values.
  server.on("error", () => {
    process.stderr.write("MAINTENANCE FAILED\n");
    process.exitCode = 1;
  });
  server.listen(port, host);
  return server;
}

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    if (process.argv.length !== 2) throw new Error("REFUSED");
    const server = startMaintenance();
    const stop = () => server.close(() => { process.exitCode = 0; });
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    process.stderr.write("MAINTENANCE FAILED\n");
    process.exitCode = 1;
  }
}