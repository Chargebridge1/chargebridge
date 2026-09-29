import { Router } from "express";
import { AUTH_DIAG } from "../middlewares/requireAuth";

// Build-time constants injected by build.mjs via esbuild `define`.
// These are baked in at compile time — the running process always reports
// exactly which code it is executing, regardless of env vars.
declare const __COMMIT_SHA__: string;
declare const __COMMIT_SHA_SHORT__: string;
declare const __BUILD_TIMESTAMP__: string;

const router = Router();

// Capture process start wall-clock time once at module load.
const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Decode the Clerk frontend API domain from a publishable key.
 *
 * Clerk publishable keys are: pk_live_<base64> or pk_test_<base64>
 * The base64 payload decodes to "<frontend-api-domain>$"
 * e.g. "select-panda-53.clerk.accounts.dev"
 */
function parseClerkInstance(key: string | undefined): string {
  if (!key) return "not configured";
  try {
    const b64 = key.replace(/^pk_(live|test)_/, "");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return decoded.replace(/\$$/, "").trim() || "parse error";
  } catch {
    return "parse error";
  }
}

/**
 * The base URL the mobile app uses to reach this backend.
 *
 * In production, REPLIT_DOMAINS contains the custom domain
 * (e.g. "www.chargebridgeapp.com"). In development it holds the
 * *.replit.dev preview domain. We take the first listed domain.
 *
 * Can be overridden with MOBILE_API_BASE env var for non-Replit deployments.
 */
function resolveMobileApiBase(): string {
  if (process.env.MOBILE_API_BASE) return process.env.MOBILE_API_BASE;
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) return "unknown";
  return `https://${domains[0]}`;
}

/**
 * A stable deployment identifier combining commit SHA and build timestamp.
 * Changes with every deploy; suitable for comparing two /api/version responses.
 * Format: <short-sha>@<ISO-date-only>T<HHmmss>Z
 */
function buildDeploymentId(): string {
  // Compact ISO timestamp: drop milliseconds and punctuation for readability
  const ts = __BUILD_TIMESTAMP__
    .replace(/\.\d{3}Z$/, "Z")   // drop ms
    .replace(/[-:]/g, "")        // 20260804T062519Z
    .replace("T", "T");
  return `${__COMMIT_SHA_SHORT__}@${ts}`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/version
 *
 * Machine-readable deployment snapshot. Use this after every production deploy
 * to confirm the new code is active before running any authentication test.
 *
 * Deployment Verification Checklist
 * ──────────────────────────────────
 * ☑ backend.commitSha      — matches the expected git SHA
 * ☑ backend.buildTimestamp — after the deploy was triggered
 * ☑ backend.processStartedAt — after the deploy completed (server restarted)
 * ☑ backend.pid            — differs from the previous deployment's pid
 * ☑ auth.diag.status       — "ENABLED" (instrumentation compiled and running)
 * ☑ environment            — "production" (not "development")
 * ☑ mobileApiBase          — matches the URL the mobile app uses
 * ☑ clerkInstance          — matches the Clerk instance in the mobile Clerk config
 *
 * Example response:
 * {
 *   "environment": "production",
 *   "mobileApiBase": "https://www.chargebridgeapp.com",
 *   "deploymentId": "22e83d2@20260804T062519Z",
 *   "clerkInstance": "select-panda-53.clerk.accounts.dev",
 *   "backend": {
 *     "commitSha": "22e83d2",
 *     "commitShaFull": "22e83d296851...",
 *     "buildTimestamp": "2026-08-04T06:25:19.347Z",
 *     "processStartedAt": "2026-08-04T06:25:22.274Z",
 *     "processUptimeSeconds": 42,
 *     "pid": 18,
 *     "nodeVersion": "v24.13.0"
 *   },
 *   "auth": {
 *     "diag": {
 *       "version": "AuthDiag v1",
 *       "status": "ENABLED",
 *       "compiled": true,
 *       "fields": ["hasAuthHeader", "authHeaderPrefix", "clerkUserId", "clerkSessionId"]
 *     }
 *   },
 *   "api": { "version": "1" }
 * }
 */
router.get("/version", (_req, res) => {
  res.json({
    environment:   process.env.CHARGEBRIDGE_ENVIRONMENT === "staging"
      ? "staging"
      : (process.env.NODE_ENV ?? "unknown"),
    mobileApiBase: resolveMobileApiBase(),
    deploymentId:  buildDeploymentId(),
    clerkInstance: parseClerkInstance(process.env.CLERK_PUBLISHABLE_KEY),
    backend: {
      commitSha:            __COMMIT_SHA_SHORT__,
      commitShaFull:        __COMMIT_SHA__,
      buildTimestamp:       __BUILD_TIMESTAMP__,
      processStartedAt,
      processUptimeSeconds: Math.floor(process.uptime()),
      pid:                  process.pid,
      nodeVersion:          process.version,
    },
    auth: {
      diag: AUTH_DIAG,
    },
    api: {
      version: "1",
    },
  });
});

export default router;
