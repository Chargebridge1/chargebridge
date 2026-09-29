import pg from "pg";

type QueryResult = { rows: Record<string, unknown>[] };
type ReadOnlyQuery = (sql: string) => Promise<QueryResult>;

const STAGING_DATABASE = "chargebridge_staging";
const IDENTITY_SQL = `SELECT identity_id, environment, current_database() AS database_name,
  current_user AS database_role
  FROM public.chargebridge_database_identity LIMIT 2`;

/** No database connection is made until all independently approved inputs pass. */
export function stagingDatabaseExpectation(env: NodeJS.ProcessEnv) {
  const url = env.DATABASE_URL;
  const id = env.CHARGEBRIDGE_STAGING_DB_ID;
  const role = env.CHARGEBRIDGE_STAGING_DB_ROLE;
  const host = env.CHARGEBRIDGE_STAGING_DB_HOST;
  const port = env.CHARGEBRIDGE_STAGING_DB_PORT;
  if (env.CHARGEBRIDGE_ENVIRONMENT !== "staging" ||
      !url || !id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) ||
      !role || role === "postgres" || !host ||
      !port || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
    throw new Error("Staging database identity: approved staging ID, host, port and restricted role required");
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    throw new Error("Staging database identity: invalid DATABASE_URL");
  }
  // pg-connection-string permits ?host= / ?user= to override URL authority.
  // Only a TLS mode may be supplied; no effective target override is allowed.
  const parameters = [...parsed.searchParams.entries()];
  if (parsed.hash || parameters.some(([key, value]) =>
    key !== "sslmode" || value !== "verify-full") ||
      parameters.length !== 1 || parameters[0][0] !== "sslmode") {
    throw new Error("Staging database identity: connection target overrides are forbidden");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      decodeURIComponent(parsed.pathname.slice(1)) !== STAGING_DATABASE ||
      decodeURIComponent(parsed.username) !== role ||
      parsed.hostname !== host ||
      parsed.port !== port) {
    throw new Error("Staging database identity: connection target does not match approved staging target");
  }
  return { id: id.toLowerCase(), role, host, port, database: STAGING_DATABASE, url };
}

/** pg-connection-string overrides an explicit ssl object if sslmode remains in the URL. */
export function stagingVerifiedTlsConnection(env: NodeJS.ProcessEnv) {
  const target = stagingDatabaseExpectation(env);
  const url = new URL(target.url);
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, servername: target.host },
  };
}

/** The marker must be provisioned independently in the approved staging database. */
export async function verifyStagingDatabaseIdentity(
  env: NodeJS.ProcessEnv,
  query: ReadOnlyQuery,
): Promise<void> {
  const expected = stagingDatabaseExpectation(env);
  const result = await query(IDENTITY_SQL);
  if (result.rows.length !== 1 ||
      result.rows[0].identity_id !== expected.id ||
      result.rows[0].environment !== "staging" ||
      result.rows[0].database_name !== expected.database ||
      result.rows[0].database_role !== expected.role) {
    throw new Error("Staging database identity: database marker or connection identity mismatch");
  }
}

export async function runStagingDatabasePreflight(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await withStagingReadOnlyConnection(env, async () => undefined);
}

/** Rechecks the marker on the connection used for staging-only catalog reads. */
export async function withStagingReadOnlyConnection<T>(
  env: NodeJS.ProcessEnv,
  work: (query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    ...stagingVerifiedTlsConnection(env),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const query = async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows };
    };
    await verifyStagingDatabaseIdentity(env, async (sql) => query(sql));
    return await work(query);
  } finally {
    await client.end().catch(() => undefined);
  }
}