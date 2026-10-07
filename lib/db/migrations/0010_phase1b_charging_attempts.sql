-- Phase 1B durable charging Attempt ID and immutable quote.
-- Additive only: no legacy row backfill, merge, or data rewrite.
-- Preflight every table/type/index/constraint/trigger before applying. Do not
-- execute in this implementation task; development migration execution is
-- coordinated by the owning agent.

DO $$ BEGIN
  CREATE TYPE charging_attempt_state AS ENUM (
    'issued', 'processing', 'succeeded', 'failed', 'reconciling', 'manual_review'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'charging_attempt_state already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE charging_attempt_reconciliation_state AS ENUM (
    'none', 'required', 'in_progress', 'resolved', 'manual_review'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'charging_attempt_reconciliation_state already exists, skipping';
END $$;

CREATE TABLE charging_attempts (
  id UUID PRIMARY KEY,
  principal_type payment_principal_type NOT NULL,
  principal_hmac TEXT NOT NULL,
  principal_hmac_version INTEGER NOT NULL,
  operation TEXT NOT NULL,
  station_id INTEGER NOT NULL,
  payment_creation_request_id UUID,
  charging_session_id INTEGER,
  request_hash TEXT NOT NULL,
  request_hash_version INTEGER NOT NULL,
  transaction_fingerprint TEXT NOT NULL,
  fingerprint_key_version INTEGER NOT NULL,
  quote_version INTEGER NOT NULL,
  quote_created_at TIMESTAMPTZ NOT NULL,
  quote JSONB NOT NULL,
  currency TEXT NOT NULL,
  charge_mode TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL,
  unit TEXT NOT NULL,
  energy_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  receipt_email_hmac TEXT,
  receipt_email_hmac_version INTEGER,
  plan_id TEXT,
  price_id TEXT,
  pricing_version TEXT NOT NULL,
  state charging_attempt_state NOT NULL DEFAULT 'issued',
  reconciliation_state charging_attempt_reconciliation_state NOT NULL DEFAULT 'none',
  reconciliation_reason TEXT,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  CONSTRAINT charging_attempts_station_fk
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE RESTRICT,
  CONSTRAINT charging_attempts_payment_request_fk
    FOREIGN KEY (payment_creation_request_id)
    REFERENCES payment_creation_requests(id) ON DELETE RESTRICT,
  CONSTRAINT charging_attempts_session_fk
    FOREIGN KEY (charging_session_id)
    REFERENCES charging_sessions(id) ON DELETE RESTRICT,
  CONSTRAINT charging_attempts_principal_hmac_version_check
    CHECK (principal_hmac_version > 0),
  CONSTRAINT charging_attempts_request_hash_version_check
    CHECK (request_hash_version > 0),
  CONSTRAINT charging_attempts_fingerprint_version_check
    CHECK (fingerprint_key_version > 0),
  CONSTRAINT charging_attempts_quote_version_check
    CHECK (quote_version > 0),
  CONSTRAINT charging_attempts_operation_check
    CHECK (operation IN ('charging_checkout', 'charging_payment_intent')),
  CONSTRAINT charging_attempts_currency_check
    CHECK (currency = lower(currency) AND length(currency) = 3),
  CONSTRAINT charging_attempts_quantity_check
    CHECK (quantity > 0),
  CONSTRAINT charging_attempts_amount_check
    CHECK (
      energy_cents >= 0
      AND platform_fee_cents >= 0
      AND total_cents = energy_cents + platform_fee_cents
    ),
  CONSTRAINT charging_attempts_email_reference_check
    CHECK (
      (receipt_email_hmac IS NULL AND receipt_email_hmac_version IS NULL)
      OR (
        receipt_email_hmac IS NOT NULL
        AND receipt_email_hmac_version IS NOT NULL
        AND receipt_email_hmac_version > 0
      )
    ),
  CONSTRAINT charging_attempts_reconciliation_fields_check
    CHECK (
      (
        reconciliation_state IN ('none', 'resolved')
        AND reconciliation_reason IS NULL
      )
      OR (
        reconciliation_state IN ('required', 'in_progress', 'manual_review')
        AND reconciliation_reason IS NOT NULL
      )
    ),
  CONSTRAINT charging_attempts_state_reconciliation_check
    CHECK (
      (state NOT IN ('reconciling', 'manual_review'))
      OR reconciliation_state IN ('required', 'in_progress', 'manual_review')
    ),
  CONSTRAINT charging_attempts_updated_chronology_check
    CHECK (updated_at >= created_at),
  CONSTRAINT charging_attempts_completed_chronology_check
    CHECK (completed_at IS NULL OR completed_at >= created_at),
  CONSTRAINT charging_attempts_expiry_chronology_check
    CHECK (expires_at IS NULL OR expires_at >= created_at)
);

CREATE UNIQUE INDEX charging_attempts_payment_request_uq
  ON charging_attempts (payment_creation_request_id)
  WHERE payment_creation_request_id IS NOT NULL;
CREATE UNIQUE INDEX charging_attempts_payment_intent_uq
  ON charging_attempts (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX charging_attempts_checkout_session_uq
  ON charging_attempts (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX charging_attempts_equivalent_lookup_idx
  ON charging_attempts (
    principal_hmac_version,
    principal_hmac,
    transaction_fingerprint,
    created_at DESC
  );
CREATE INDEX charging_attempts_state_created_idx
  ON charging_attempts (state, created_at);
CREATE INDEX charging_attempts_session_idx
  ON charging_attempts (charging_session_id)
  WHERE charging_session_id IS NOT NULL;

-- The API only transitions state/linkage fields. The quote identity, principal,
-- station and all Stripe-affecting terms can never be changed after issuance.
CREATE FUNCTION reject_charging_attempt_quote_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.principal_type, NEW.principal_hmac, NEW.principal_hmac_version,
    NEW.operation, NEW.station_id, NEW.request_hash, NEW.request_hash_version,
    NEW.transaction_fingerprint, NEW.fingerprint_key_version, NEW.quote_version,
    NEW.quote_created_at, NEW.quote, NEW.currency, NEW.charge_mode, NEW.quantity,
    NEW.unit, NEW.energy_cents, NEW.platform_fee_cents, NEW.total_cents,
    NEW.receipt_email_hmac, NEW.receipt_email_hmac_version, NEW.plan_id,
    NEW.price_id, NEW.pricing_version
  ) IS DISTINCT FROM ROW(
    OLD.principal_type, OLD.principal_hmac, OLD.principal_hmac_version,
    OLD.operation, OLD.station_id, OLD.request_hash, OLD.request_hash_version,
    OLD.transaction_fingerprint, OLD.fingerprint_key_version, OLD.quote_version,
    OLD.quote_created_at, OLD.quote, OLD.currency, OLD.charge_mode, OLD.quantity,
    OLD.unit, OLD.energy_cents, OLD.platform_fee_cents, OLD.total_cents,
    OLD.receipt_email_hmac, OLD.receipt_email_hmac_version, OLD.plan_id,
    OLD.price_id, OLD.pricing_version
  ) THEN
    RAISE EXCEPTION 'Charging Attempt quote and principal are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER charging_attempts_immutable_quote
  BEFORE UPDATE ON charging_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_charging_attempt_quote_mutation();

-- Ordinary rollback leaves additive structures and attempt evidence intact.
-- Destructive cleanup is only for a disposable development DB with no rows:
-- DROP TRIGGER charging_attempts_immutable_quote ON charging_attempts;
-- DROP FUNCTION reject_charging_attempt_quote_mutation();
-- DROP TABLE charging_attempts;
-- DROP TYPE charging_attempt_reconciliation_state;
-- DROP TYPE charging_attempt_state;