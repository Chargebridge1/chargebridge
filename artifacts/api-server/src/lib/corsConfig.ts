import { logger } from "./logger";

export function buildAllowedOriginSet(): Set<string> {
  const set = new Set<string>();
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of fromEnv) set.add(o);
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const d of replitDomains) {
    set.add(`https://${d}`);
  }
  return set;
}

/**
 * How long the allowed-origin set is cached before being rebuilt from env vars.
 * Defaults to 60 seconds. Set CORS_CACHE_TTL_MS in the environment to override.
 */
export function getCacheTtlMs(): number {
  const raw = process.env.CORS_CACHE_TTL_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 60_000;
}

let _cachedOrigins: Set<string> | null = null;
let _cacheExpiresAt = 0;

/**
 * Returns the allowed-origin set, rebuilding it from env vars when the cache
 * has expired (default TTL: 60 seconds).
 *
 * Using a lazy getter (rather than a top-level constant) ensures env vars are
 * read at the moment of first CORS check — not at bundle-evaluation time.
 * This prevents the set from being permanently empty in pre-built deployments
 * where env vars are injected after the JS bundle has been evaluated.
 *
 * After the TTL elapses the cache is transparently rebuilt on the next CORS
 * check, so operators can update ALLOWED_ORIGINS or REPLIT_DOMAINS at runtime
 * (e.g. via a Replit secret update) without restarting the server.
 *
 * NOTE: the startup warning below intentionally calls buildAllowedOriginSet()
 * directly so it never pre-warms this cache. _cachedOrigins stays null until
 * the first actual CORS check.
 */
export function getAllowedOrigins(): Set<string> {
  const now = Date.now();
  if (_cachedOrigins === null || now >= _cacheExpiresAt) {
    _cachedOrigins = buildAllowedOriginSet();
    _cacheExpiresAt = now + getCacheTtlMs();
  }
  return _cachedOrigins;
}

/**
 * Immediately invalidates the cached origin set so the next CORS check
 * rebuilds it from current env vars.
 *
 * Used by the `POST /api/admin/cors-cache/reset` endpoint and in tests.
 */
export function resetAllowedOriginsCache(): void {
  _cachedOrigins = null;
  _cacheExpiresAt = 0;
}

// Startup warning — fires at module load (= server startup).
// Calls buildAllowedOriginSet() directly, NOT getAllowedOrigins(), so that
// the warning log reflects env vars at startup time without pre-warming the
// lazy runtime cache. The cache remains null until the first real CORS check.
(function warnIfEmpty() {
  const origins = buildAllowedOriginSet();
  if (process.env.NODE_ENV === "production" && origins.size === 0) {
    logger.warn(
      "⚠️  CORS WARNING: NODE_ENV is 'production' but neither ALLOWED_ORIGINS nor REPLIT_DOMAINS is set. " +
        "All credentialed cross-origin requests (e.g. from your frontend) will be rejected by browsers. " +
        "Set ALLOWED_ORIGINS to a comma-separated list of allowed frontend origins (e.g. https://yourapp.com).",
    );
  } else if (origins.size === 0) {
    logger.warn(
      "ALLOWED_ORIGINS and REPLIT_DOMAINS are both empty — CORS will block all credentialed cross-origin requests",
    );
  }
})();
