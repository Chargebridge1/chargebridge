let stagingReadinessPassed = false;

/** An incorrectly labeled staging connection must never use the legacy path. */
export function assertStagingEnvironmentSelection(env: NodeJS.ProcessEnv): void {
  let stagingDatabaseUrl = false;
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      // pg-connection-string consumes query options before the URL authority;
      // looking at pathname alone misses ?host=, ?user= and database aliases.
      // Only use this for detecting a mislabeled staging target. The staging
      // preflight itself rejects *all* query options except verified TLS.
      stagingDatabaseUrl = decodeURIComponent(url.pathname.slice(1)) === "chargebridge_staging" ||
        [...url.searchParams.entries()].some(([key, value]) =>
          /^(?:host|hostname|port|database|dbname|db|user|username)$/i.test(key) &&
          (value === "chargebridge_staging" ||
            (env.CHARGEBRIDGE_STAGING_DB_HOST && value === env.CHARGEBRIDGE_STAGING_DB_HOST) ||
            (env.CHARGEBRIDGE_STAGING_DB_ROLE && value === env.CHARGEBRIDGE_STAGING_DB_ROLE) ||
            /(?:^|[_-])staging(?:[_-]|$)/i.test(value)));
    } catch {
      // The driver also accepts Unix-socket connection strings. Reject a
      // staging-named target even if it is not parseable as a URL.
      stagingDatabaseUrl = /(?:^|[\/\s])chargebridge_staging(?:$|[?\s])/i.test(env.DATABASE_URL);
    }
  }
  if (env.CHARGEBRIDGE_ENVIRONMENT !== "staging" &&
      (stagingDatabaseUrl || env.CHARGEBRIDGE_STAGING_DB_ID ||
        env.CHARGEBRIDGE_STAGING_DB_HOST || env.CHARGEBRIDGE_STAGING_DB_ROLE)) {
    throw new Error("Staging database target requires CHARGEBRIDGE_ENVIRONMENT=staging");
  }
}

/** Prevent direct execution of index.ts from bypassing the staging bootstrap. */
export function assertStagingStartupAuthorized(environment: string | undefined): void {
  assertStagingEnvironmentSelection(process.env);
  if (environment === "staging" && !stagingReadinessPassed) {
    throw new Error("Staging startup requires identity and schema readiness verification");
  }
}

export async function startAfterStagingPreflight(
  environment: string | undefined,
  preflight: () => Promise<void>,
  startApplication: () => Promise<unknown>,
  verifyReadiness?: () => Promise<void>,
): Promise<void> {
  if (environment === "staging") {
    stagingReadinessPassed = false;
    await preflight();
    if (!verifyReadiness) throw new Error("Staging schema readiness verification is required");
    await verifyReadiness();
    stagingReadinessPassed = true;
  }
  try {
    await startApplication();
  } catch (error) {
    if (environment === "staging") stagingReadinessPassed = false;
    throw error;
  }
}