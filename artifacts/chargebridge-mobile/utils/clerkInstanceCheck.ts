/**
 * Clerk Instance Alignment Check
 *
 * Decodes the Clerk publishable key baked into this EAS build and compares
 * its instance domain against the `clerkInstance` the production API server
 * reports via /api/version.
 *
 * PURPOSE
 * -------
 * Prevent the "silent 401 for all authenticated calls" regression caused by
 * building the mobile app with a test-instance publishable key while the
 * production server validates tokens against a different (live) Clerk instance.
 *
 * The mismatch produces a specific fingerprint in the DIAG logs:
 *   hasAuthHeader: true        — JWT IS sent (the null-token guard works)
 *   authHeaderPrefix: "Bearer eyJhbGci…"
 *   clerkUserId: null          — server Clerk can't resolve the user
 *
 * Run this check at app startup (dev/staging only) to catch drift early.
 */

/**
 * Decodes the Clerk frontend API domain from a publishable key.
 *
 * Clerk publishable keys: `pk_live_<base64>` or `pk_test_<base64>`
 * The base64 payload decodes to `<frontend-api-domain>$`
 * e.g. `select-panda-53.clerk.accounts.dev` or `clerk.www.example.com`
 */
export function decodeClerkInstance(publishableKey: string | undefined): string | null {
  if (!publishableKey) return null;
  try {
    const b64 = publishableKey.replace(/^pk_(live|test)_/, "");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(padded);
    return decoded.replace(/\$$/, "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Checks whether the publishable key baked into this build is a test key
 * (`pk_test_...`).  Production EAS builds must use a `pk_live_...` key.
 */
export function isTestPublishableKey(publishableKey: string | undefined): boolean {
  if (!publishableKey) return false;
  return publishableKey.startsWith("pk_test_");
}

export interface ClerkAlignmentResult {
  /** The Clerk instance domain decoded from the baked-in publishable key */
  mobileInstance: string | null;
  /** The Clerk instance domain reported by the production API (/api/version) */
  serverInstance: string | null;
  /** Whether the mobile and server instances match */
  aligned: boolean;
  /** Whether the mobile key is a test key (pk_test_...) */
  isTestKey: boolean;
}

/**
 * Fetches `/api/version` from the given base URL and compares its
 * `clerkInstance` field against the publishable key baked into this build.
 *
 * Use in development / staging to detect Clerk instance drift before
 * it reaches a TestFlight build.
 *
 * @param apiBase  Base URL of the API server, e.g. "https://www.chargebridgeapp.com"
 * @param publishableKey  The value of `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
 */
export async function checkClerkAlignment(
  apiBase: string,
  publishableKey: string | undefined,
): Promise<ClerkAlignmentResult> {
  const mobileInstance = decodeClerkInstance(publishableKey);
  const isTestKey = isTestPublishableKey(publishableKey);

  let serverInstance: string | null = null;
  try {
    const res = await fetch(`${apiBase}/api/version`);
    if (res.ok) {
      const data = await res.json();
      serverInstance = typeof data.clerkInstance === "string" ? data.clerkInstance : null;
    }
  } catch {
    // Network unavailable — skip comparison
  }

  const aligned =
    mobileInstance !== null &&
    serverInstance !== null &&
    mobileInstance === serverInstance;

  return { mobileInstance, serverInstance, aligned, isTestKey };
}
