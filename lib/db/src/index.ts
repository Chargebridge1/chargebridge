import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { stagingVerifiedTlsConnection } from "./stagingIdentity";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// No network call: validate the staging runtime pool's target and verified
// transport before any route or background job can use it. Production is unchanged.
export const pool = new Pool(
  process.env.CHARGEBRIDGE_ENVIRONMENT === "staging"
    ? stagingVerifiedTlsConnection(process.env)
    : { connectionString: process.env.DATABASE_URL },
);
export const db = drizzle(pool, { schema });

export * from "./schema";
