import * as Sentry from "@sentry/node";
import { assertStagingStartupAuthorized } from "./startupGate";

assertStagingStartupAuthorized(process.env.CHARGEBRIDGE_ENVIRONMENT);

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
  });
}

import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensurePricingTable } from "./routes/pricing";
import { ensureGasPricesTable } from "./routes/gasPrices";
import { ensureButtonConfigsTable } from "./routes/buttonConfigs";
import { warmEiaCache } from "./lib/eiaFuelPrices";
import { warmFredCache } from "./lib/fredFuelPrices";
import { warmAaaCache } from "./lib/aaaFuelPrices";
import { setupOcppCsms } from "./lib/ocppCsms";
import { startSessionSweeper } from "./lib/sessionSweeper";
import { startRefundSweeper } from "./lib/refundSweeper";
import { runLegacyStartupDdlUnlessStaging } from "./stagingStartupPolicy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function ensureChargingSessionsTable() {
  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
          CREATE TYPE session_status AS ENUM ('pending', 'stopping', 'completed', 'failed', 'refunded');
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS charging_sessions (
        id SERIAL PRIMARY KEY,
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        driver_email TEXT NOT NULL,
        driver_name TEXT NOT NULL,
        kwh REAL NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        status session_status NOT NULL DEFAULT 'pending',
        stripe_payment_intent_id TEXT,
        stripe_checkout_session_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      );

      ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS stop_initiated_at TIMESTAMP;
    `);

    // Add 'stopping' to the enum if it was created before this migration ran.
    // ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so it
    // must be in its own db.execute call (Drizzle sends each call as a
    // separate implicit transaction).
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'session_status'::regtype
            AND enumlabel = 'stopping'
        ) THEN
          ALTER TYPE session_status ADD VALUE 'stopping' BEFORE 'completed';
        END IF;
      END $$;
    `);

    logger.info("charging_sessions table ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure charging_sessions table");
    throw err;
  }
}

async function ensureOcppColumns() {
  try {
    await db.execute(sql`
      ALTER TABLE stations ADD COLUMN IF NOT EXISTS ocpp_charge_point_id TEXT;
      ALTER TABLE stations ADD COLUMN IF NOT EXISTS ocpp_password TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS stations_ocpp_cpid_idx
        ON stations (ocpp_charge_point_id)
        WHERE ocpp_charge_point_id IS NOT NULL;
    `);
    logger.info("OCPP columns ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure OCPP columns");
    throw err;
  }
}

async function ensureUserTables() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        clerk_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

      ALTER TABLE favorites ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
      ALTER TABLE favorites ADD COLUMN IF NOT EXISTS external_station_id TEXT;
      ALTER TABLE favorites ADD COLUMN IF NOT EXISTS external_station_data JSONB DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS charging_history (
        id SERIAL PRIMARY KEY,
        clerk_user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
        station_id TEXT,
        station_name TEXT NOT NULL,
        station_address TEXT,
        charger_type TEXT,
        kwh REAL,
        amount_cents INTEGER,
        currency TEXT DEFAULT 'usd',
        charged_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    logger.info("users and charging_history tables ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure user tables");
    throw err;
  }
}

async function ensureReviewsClerkUserId() {
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
    `);
    logger.info("reviews.clerk_user_id column ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure reviews.clerk_user_id column");
    throw err;
  }
}

// The staging bootstrap verifies identity and schema before importing this
// module. All schema changes in staging belong to its explicit migrator.
await runLegacyStartupDdlUnlessStaging(process.env.CHARGEBRIDGE_ENVIRONMENT, [
  ensureChargingSessionsTable, ensurePricingTable, ensureGasPricesTable,
  ensureOcppColumns, ensureUserTables, ensureButtonConfigsTable,
  ensureReviewsClerkUserId,
]);

async function ensureExternalReviewsClerkUserId() {
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      ALTER TABLE external_station_reviews ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
    `);
    logger.info("external_station_reviews.clerk_user_id column ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure external_station_reviews.clerk_user_id column");
    throw err;
  }
}
await runLegacyStartupDdlUnlessStaging(process.env.CHARGEBRIDGE_ENVIRONMENT, [ensureExternalReviewsClerkUserId]);

async function ensureStripeRefundJobsTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stripe_refund_jobs (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL,
        payment_intent_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        job_type TEXT NOT NULL DEFAULT 'refund',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        succeeded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE stripe_refund_jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'refund';
    `);
    logger.info("stripe_refund_jobs table ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure stripe_refund_jobs table");
    throw err;
  }
}
await runLegacyStartupDdlUnlessStaging(process.env.CHARGEBRIDGE_ENVIRONMENT, [ensureStripeRefundJobsTable]);

async function ensureConnectorAffinitiesTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_affinities (
        clerk_user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
        connector_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (clerk_user_id, connector_type)
      );
      CREATE INDEX IF NOT EXISTS connector_affinities_clerk_user_id_idx
        ON connector_affinities (clerk_user_id);
    `);
    logger.info("connector_affinities table ready");
  } catch (err) {
    logger.error({ err }, "Failed to ensure connector_affinities table");
    throw err;
  }
}
await runLegacyStartupDdlUnlessStaging(process.env.CHARGEBRIDGE_ENVIRONMENT, [ensureConnectorAffinitiesTable]);

// Warm fuel price caches non-blocking (data updates weekly, 6h local TTL)
warmEiaCache();
warmFredCache();
warmAaaCache();

const httpServer = createServer(app);
setupOcppCsms(httpServer);
startSessionSweeper();
startRefundSweeper();

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — a sweeper or background task may have failed");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — process exiting");
  process.exit(1);
});

httpServer.on("error", (err) => {
  logger.error({ err }, "Error starting server");
  process.exit(1);
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
