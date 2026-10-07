-- Phase 1B canonical nullable charging-session association.
-- Existing rows remain NULL. No backfill or runtime behavior change is included.
-- Read-only definition preflight is required before execution or re-execution.

ALTER TABLE charging_sessions
  ADD COLUMN IF NOT EXISTS payment_creation_request_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'charging_sessions_payment_request_fk'
      AND conrelid = 'charging_sessions'::regclass
  ) THEN
    ALTER TABLE charging_sessions
      ADD CONSTRAINT charging_sessions_payment_request_fk
      FOREIGN KEY (payment_creation_request_id)
      REFERENCES payment_creation_requests(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS charging_sessions_payment_request_uq
  ON charging_sessions (payment_creation_request_id)
  WHERE payment_creation_request_id IS NOT NULL;

-- Ordinary application rollback leaves this additive association installed.
-- Destructive rollback is only for an explicitly authorized disposable
-- environment before durable Phase 1B records exist:
-- DROP INDEX IF EXISTS charging_sessions_payment_request_uq;
-- ALTER TABLE charging_sessions
--   DROP CONSTRAINT IF EXISTS charging_sessions_payment_request_fk;
-- ALTER TABLE charging_sessions
--   DROP COLUMN IF EXISTS payment_creation_request_id;