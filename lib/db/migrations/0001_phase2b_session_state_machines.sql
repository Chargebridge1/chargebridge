-- Phase 2B: Separate payment, charging, and OCPP state in charging_sessions
-- Safe to re-run: all statements use IF NOT EXISTS / duplicate-object guards.
-- Rollback: see commented ROLLBACK section at the bottom of this file.

-- 1. Payment state enum
DO $$ BEGIN
  CREATE TYPE payment_state AS ENUM (
    'pending',      -- session created, payment not yet initiated
    'authorized',   -- PaymentIntent created, awaiting confirmation
    'captured',     -- payment confirmed and captured
    'refunded',     -- payment fully or partially refunded
    'failed'        -- payment failed, cancelled, or expired
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'payment_state enum already exists, skipping';
END $$;

-- 2. Charging lifecycle state enum
DO $$ BEGIN
  CREATE TYPE charging_state AS ENUM (
    'not_started',        -- no remote start has been issued yet
    'remote_start_sent',  -- RemoteStartTransaction sent, awaiting charger ack
    'charging',           -- StartTransaction received, power flowing
    'remote_stop_sent',   -- RemoteStopTransaction sent, awaiting charger ack
    'stopped',            -- StopTransaction received, charging ended cleanly
    'failed'              -- charger rejected start, timed out, or disconnected
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'charging_state enum already exists, skipping';
END $$;

-- 3. Add new nullable columns to charging_sessions (existing rows → NULL, no impact)
ALTER TABLE charging_sessions
  ADD COLUMN IF NOT EXISTS payment_state       payment_state,
  ADD COLUMN IF NOT EXISTS charging_state      charging_state,
  ADD COLUMN IF NOT EXISTS ocpp_transaction_id integer;

-- 4. Session events audit table (one row per state-machine event, never updated)
CREATE TABLE IF NOT EXISTS session_events (
  id          serial      PRIMARY KEY,
  session_id  integer     NOT NULL
                          REFERENCES charging_sessions(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  payload     jsonb,
  created_at  timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_events_session_id_idx
  ON session_events (session_id);

CREATE INDEX IF NOT EXISTS session_events_event_type_idx
  ON session_events (event_type);

-- ============================================================
-- ROLLBACK (manual — run only if you need to undo this migration)
-- ============================================================
-- DROP TABLE  IF EXISTS session_events;
-- ALTER TABLE charging_sessions
--   DROP COLUMN IF EXISTS payment_state,
--   DROP COLUMN IF EXISTS charging_state,
--   DROP COLUMN IF EXISTS ocpp_transaction_id;
-- DROP TYPE IF EXISTS charging_state;
-- DROP TYPE IF EXISTS payment_state;
