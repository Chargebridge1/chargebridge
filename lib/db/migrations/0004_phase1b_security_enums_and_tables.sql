-- Phase 1B additive persistence foundation.
-- No runtime enforcement is enabled by this migration.
-- Read-only definition preflight is required before execution or re-execution.

DO $$ BEGIN
  CREATE TYPE checkout_verification_status AS ENUM (
    'pending', 'verified', 'locked', 'expired', 'consumed'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'checkout_verification_status already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE payment_request_operation AS ENUM (
    'charging_checkout', 'charging_payment_intent', 'subscription_checkout'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'payment_request_operation already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE payment_request_state AS ENUM (
    'processing', 'stripe_succeeded', 'completed', 'retryable_failure',
    'reconciling', 'terminal_failure', 'expired', 'superseded', 'manual_review'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'payment_request_state already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE payment_principal_type AS ENUM (
    'clerk_user', 'verified_guest'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'payment_principal_type already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE stripe_object_type AS ENUM (
    'checkout_session', 'payment_intent'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'stripe_object_type already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE payment_retention_class AS ENUM (
    'active', 'successful', 'failed', 'reconciliation_evidence'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'payment_retention_class already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE rate_limit_subject_type AS ENUM (
    'email', 'ip', 'principal', 'installation'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'rate_limit_subject_type already exists, skipping';
END $$;

CREATE TABLE IF NOT EXISTS checkout_email_verifications (
  id UUID PRIMARY KEY,
  purpose payment_request_operation NOT NULL,
  email_hmac TEXT NOT NULL,
  email_hmac_version INTEGER NOT NULL,
  purchase_draft_hash TEXT NOT NULL,
  purchase_draft_hash_version INTEGER NOT NULL,
  otp_hash TEXT NOT NULL,
  otp_hash_version INTEGER NOT NULL,
  status checkout_verification_status NOT NULL DEFAULT 'pending',
  send_count INTEGER NOT NULL DEFAULT 1,
  failed_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_delivery_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_delivery_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  grant_hash TEXT,
  grant_hash_version INTEGER,
  grant_expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  consumed_by_request_id UUID,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT checkout_email_verifications_email_hmac_version_check
    CHECK (email_hmac_version > 0),
  CONSTRAINT checkout_email_verifications_purchase_hash_version_check
    CHECK (purchase_draft_hash_version > 0),
  CONSTRAINT checkout_email_verifications_otp_hash_version_check
    CHECK (otp_hash_version > 0),
  CONSTRAINT checkout_email_verifications_grant_hash_version_check
    CHECK (grant_hash_version IS NULL OR grant_hash_version > 0),
  CONSTRAINT checkout_email_verifications_send_count_check
    CHECK (send_count >= 1),
  CONSTRAINT checkout_email_verifications_failed_attempt_count_check
    CHECK (failed_attempt_count >= 0),
  CONSTRAINT checkout_email_verifications_delivery_state_check
    CHECK (last_delivery_state IN ('accepted', 'failed', 'unknown')),
  CONSTRAINT checkout_email_verifications_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT checkout_email_verifications_last_delivery_check
    CHECK (last_delivery_at >= created_at),
  CONSTRAINT checkout_email_verifications_verified_chronology_check
    CHECK (verified_at IS NULL OR verified_at >= created_at),
  CONSTRAINT checkout_email_verifications_locked_chronology_check
    CHECK (locked_at IS NULL OR locked_at >= created_at),
  CONSTRAINT checkout_email_verifications_grant_chronology_check
    CHECK (
      grant_expires_at IS NULL
      OR (verified_at IS NOT NULL AND grant_expires_at > verified_at)
    ),
  CONSTRAINT checkout_email_verifications_consumed_chronology_check
    CHECK (
      consumed_at IS NULL
      OR (verified_at IS NOT NULL AND consumed_at >= verified_at)
    ),
  CONSTRAINT checkout_email_verifications_retention_check
    CHECK (
      retention_expires_at >= expires_at
      AND (grant_expires_at IS NULL OR retention_expires_at >= grant_expires_at)
      AND (consumed_at IS NULL OR retention_expires_at >= consumed_at)
    ),
  CONSTRAINT checkout_email_verifications_pending_check
    CHECK (
      status <> 'pending'
      OR (
        verified_at IS NULL
        AND locked_at IS NULL
        AND consumed_at IS NULL
        AND consumed_by_request_id IS NULL
      )
    ),
  CONSTRAINT checkout_email_verifications_verified_check
    CHECK (
      status <> 'verified'
      OR (
        verified_at IS NOT NULL
        AND grant_hash IS NOT NULL
        AND grant_hash_version IS NOT NULL
        AND grant_expires_at IS NOT NULL
        AND consumed_at IS NULL
        AND consumed_by_request_id IS NULL
      )
    ),
  CONSTRAINT checkout_email_verifications_locked_check
    CHECK (status <> 'locked' OR locked_at IS NOT NULL),
  CONSTRAINT checkout_email_verifications_consumed_check
    CHECK (
      status <> 'consumed'
      OR (
        verified_at IS NOT NULL
        AND grant_hash IS NOT NULL
        AND grant_hash_version IS NOT NULL
        AND grant_expires_at IS NOT NULL
        AND consumed_at IS NOT NULL
        AND consumed_by_request_id IS NOT NULL
      )
    ),
  CONSTRAINT checkout_email_verifications_grant_fields_check
    CHECK (
      (
        grant_hash IS NULL
        AND grant_hash_version IS NULL
        AND grant_expires_at IS NULL
      )
      OR (
        grant_hash IS NOT NULL
        AND grant_hash_version IS NOT NULL
        AND grant_expires_at IS NOT NULL
      )
    ),
  CONSTRAINT checkout_email_verifications_consumption_fields_check
    CHECK (
      (consumed_at IS NULL AND consumed_by_request_id IS NULL)
      OR (consumed_at IS NOT NULL AND consumed_by_request_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS payment_creation_requests (
  id UUID PRIMARY KEY,
  operation payment_request_operation NOT NULL,
  principal_type payment_principal_type NOT NULL,
  principal_hmac TEXT NOT NULL,
  principal_hmac_version INTEGER NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  idempotency_key_hash_version INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  request_hash_version INTEGER NOT NULL,
  transaction_fingerprint TEXT NOT NULL,
  fingerprint_key_version INTEGER NOT NULL,
  state payment_request_state NOT NULL DEFAULT 'processing',
  station_id INTEGER,
  plan_id TEXT,
  stripe_object_type stripe_object_type,
  stripe_object_id TEXT,
  stripe_idempotency_key_ref TEXT NOT NULL,
  checkout_url_expires_at TIMESTAMPTZ,
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_category TEXT,
  supersedes_request_id UUID,
  superseded_by_request_id UUID,
  client_protocol INTEGER,
  client_platform TEXT,
  client_version TEXT,
  client_build TEXT,
  runtime_version TEXT,
  ota_update_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  retention_class payment_retention_class NOT NULL DEFAULT 'active',
  retention_started_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  retention_hold_at TIMESTAMPTZ,
  retention_hold_reason TEXT,
  retention_hold_case_id TEXT,
  CONSTRAINT payment_creation_requests_station_fk
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE RESTRICT,
  CONSTRAINT payment_creation_requests_supersedes_fk
    FOREIGN KEY (supersedes_request_id)
    REFERENCES payment_creation_requests(id) ON DELETE SET NULL,
  CONSTRAINT payment_creation_requests_superseded_by_fk
    FOREIGN KEY (superseded_by_request_id)
    REFERENCES payment_creation_requests(id) ON DELETE SET NULL,
  CONSTRAINT payment_creation_requests_principal_hmac_version_check
    CHECK (principal_hmac_version > 0),
  CONSTRAINT payment_creation_requests_idempotency_hash_version_check
    CHECK (idempotency_key_hash_version > 0),
  CONSTRAINT payment_creation_requests_request_hash_version_check
    CHECK (request_hash_version > 0),
  CONSTRAINT payment_creation_requests_fingerprint_key_version_check
    CHECK (fingerprint_key_version > 0),
  CONSTRAINT payment_creation_requests_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT payment_creation_requests_client_protocol_check
    CHECK (client_protocol IS NULL OR client_protocol > 0),
  CONSTRAINT payment_creation_requests_charging_checkout_station_check
    CHECK (operation <> 'charging_checkout' OR station_id IS NOT NULL),
  CONSTRAINT payment_creation_requests_payment_intent_station_check
    CHECK (operation <> 'charging_payment_intent' OR station_id IS NOT NULL),
  CONSTRAINT payment_creation_requests_subscription_plan_check
    CHECK (operation <> 'subscription_checkout' OR plan_id IS NOT NULL),
  CONSTRAINT payment_creation_requests_stripe_fields_check
    CHECK (
      (stripe_object_type IS NULL AND stripe_object_id IS NULL)
      OR (stripe_object_type IS NOT NULL AND stripe_object_id IS NOT NULL)
    ),
  CONSTRAINT payment_creation_requests_lease_fields_check
    CHECK (
      (lease_owner IS NULL AND lease_expires_at IS NULL)
      OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
  CONSTRAINT payment_creation_requests_supersedes_self_check
    CHECK (supersedes_request_id IS NULL OR supersedes_request_id <> id),
  CONSTRAINT payment_creation_requests_superseded_by_self_check
    CHECK (superseded_by_request_id IS NULL OR superseded_by_request_id <> id),
  CONSTRAINT payment_creation_requests_updated_chronology_check
    CHECK (updated_at >= created_at),
  CONSTRAINT payment_creation_requests_completed_chronology_check
    CHECK (completed_at IS NULL OR completed_at >= created_at),
  CONSTRAINT payment_creation_requests_expiry_chronology_check
    CHECK (expires_at IS NULL OR expires_at >= created_at),
  CONSTRAINT payment_creation_requests_retention_fields_check
    CHECK (
      (
        retention_class = 'active'
        AND retention_started_at IS NULL
        AND retention_expires_at IS NULL
      )
      OR (
        retention_class <> 'active'
        AND retention_started_at IS NOT NULL
        AND retention_expires_at IS NOT NULL
      )
    ),
  CONSTRAINT payment_creation_requests_retention_chronology_check
    CHECK (
      retention_expires_at IS NULL
      OR (
        retention_started_at IS NOT NULL
        AND retention_started_at >= created_at
        AND retention_expires_at >= retention_started_at
        AND (completed_at IS NULL OR retention_expires_at >= completed_at)
        AND (expires_at IS NULL OR retention_expires_at >= expires_at)
      )
    ),
  CONSTRAINT payment_creation_requests_successful_retention_check
    CHECK (
      retention_class <> 'successful'
      OR retention_expires_at >= retention_started_at + INTERVAL '90 days'
    ),
  CONSTRAINT payment_creation_requests_failed_retention_check
    CHECK (
      retention_class <> 'failed'
      OR retention_expires_at >= retention_started_at + INTERVAL '30 days'
    ),
  CONSTRAINT payment_creation_requests_reconciliation_retention_check
    CHECK (
      retention_class <> 'reconciliation_evidence'
      OR retention_expires_at >= retention_started_at + INTERVAL '180 days'
    ),
  CONSTRAINT payment_creation_requests_hold_fields_check
    CHECK (
      (
        retention_hold_at IS NULL
        AND retention_hold_reason IS NULL
        AND retention_hold_case_id IS NULL
      )
      OR (
        retention_hold_at IS NOT NULL
        AND retention_hold_reason IS NOT NULL
        AND retention_hold_case_id IS NOT NULL
      )
    )
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkout_email_verifications_consumed_request_fk'
      AND conrelid = 'checkout_email_verifications'::regclass
  ) THEN
    ALTER TABLE checkout_email_verifications
      ADD CONSTRAINT checkout_email_verifications_consumed_request_fk
      FOREIGN KEY (consumed_by_request_id)
      REFERENCES payment_creation_requests(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS abuse_rate_limit_buckets (
  action TEXT NOT NULL,
  subject_type rate_limit_subject_type NOT NULL,
  subject_hmac TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_seconds INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT abuse_rate_limit_buckets_pk PRIMARY KEY (
    action, subject_type, subject_hmac, key_version,
    window_started_at, window_seconds
  ),
  CONSTRAINT abuse_rate_limit_buckets_key_version_check
    CHECK (key_version > 0),
  CONSTRAINT abuse_rate_limit_buckets_window_seconds_check
    CHECK (window_seconds > 0),
  CONSTRAINT abuse_rate_limit_buckets_count_check
    CHECK (count >= 0),
  CONSTRAINT abuse_rate_limit_buckets_expiry_check
    CHECK (expires_at > window_started_at),
  CONSTRAINT abuse_rate_limit_buckets_seen_order_check
    CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE IF NOT EXISTS payment_protocol_observations (
  id BIGSERIAL PRIMARY KEY,
  installation_hmac TEXT NOT NULL,
  installation_hmac_version INTEGER NOT NULL,
  platform TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  app_version TEXT,
  native_build TEXT,
  runtime_version TEXT,
  ota_update_id TEXT,
  is_embedded BOOLEAN,
  event_type TEXT NOT NULL,
  result_category TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT payment_protocol_observations_hmac_version_check
    CHECK (installation_hmac_version > 0),
  CONSTRAINT payment_protocol_observations_platform_check
    CHECK (platform IN ('ios', 'android', 'web')),
  CONSTRAINT payment_protocol_observations_protocol_check
    CHECK (protocol_version > 0),
  CONSTRAINT payment_protocol_observations_expiry_check
    CHECK (expires_at > observed_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_email_verifications_grant_hash_uq
  ON checkout_email_verifications (grant_hash_version, grant_hash)
  WHERE grant_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS checkout_email_verifications_expiry_idx
  ON checkout_email_verifications (expires_at);
CREATE INDEX IF NOT EXISTS checkout_email_verifications_email_recent_idx
  ON checkout_email_verifications
    (email_hmac_version, email_hmac, created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS checkout_email_verifications_status_expiry_idx
  ON checkout_email_verifications (status, expires_at);
CREATE INDEX IF NOT EXISTS checkout_email_verifications_retention_idx
  ON checkout_email_verifications (retention_expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_creation_requests_idempotency_uq
  ON payment_creation_requests
    (operation, idempotency_key_hash_version, idempotency_key_hash);
CREATE INDEX IF NOT EXISTS payment_creation_requests_active_fingerprint_idx
  ON payment_creation_requests
    (principal_hmac_version, principal_hmac, transaction_fingerprint, created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS payment_creation_requests_lease_idx
  ON payment_creation_requests (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS payment_creation_requests_retention_idx
  ON payment_creation_requests (retention_class, retention_expires_at);
CREATE INDEX IF NOT EXISTS payment_creation_requests_hold_idx
  ON payment_creation_requests (retention_hold_at)
  WHERE retention_hold_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS abuse_rate_limit_buckets_expiry_idx
  ON abuse_rate_limit_buckets (expires_at);
CREATE INDEX IF NOT EXISTS abuse_rate_limit_buckets_action_recent_idx
  ON abuse_rate_limit_buckets
    (action, subject_type, last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS payment_protocol_observations_adoption_idx
  ON payment_protocol_observations
    (platform, protocol_version, observed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS payment_protocol_observations_installation_idx
  ON payment_protocol_observations
    (installation_hmac_version, installation_hmac, observed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS payment_protocol_observations_expiry_idx
  ON payment_protocol_observations (expires_at);

-- Ordinary application rollback leaves this additive schema installed.
-- Destructive rollback is only for an explicitly authorized disposable
-- environment before durable Phase 1B records exist.