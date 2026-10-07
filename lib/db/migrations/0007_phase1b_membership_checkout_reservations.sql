-- Additive Phase 1B membership Checkout reservation/state persistence.
-- No Stripe operation or existing subscription is changed by this migration.

CREATE TYPE membership_checkout_reservation_state AS ENUM (
  'processing',
  'session_created',
  'reconciling',
  'completed',
  'terminal_failure',
  'expired',
  'manual_review'
);

CREATE TABLE membership_checkout_reservations (
  id UUID PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  stripe_product_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  unit_amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  billing_interval TEXT NOT NULL,
  interval_count INTEGER NOT NULL,
  request_fingerprint TEXT NOT NULL,
  fingerprint_key_version INTEGER NOT NULL,
  request_snapshot JSONB NOT NULL,
  state membership_checkout_reservation_state NOT NULL DEFAULT 'processing',
  stripe_idempotency_key TEXT NOT NULL,
  payment_creation_request_id UUID,
  stripe_checkout_session_id TEXT,
  stripe_subscription_id TEXT,
  stripe_session_expires_at TIMESTAMPTZ,
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error_category TEXT,
  reconciliation_evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT membership_checkout_reservations_user_fk
    FOREIGN KEY (clerk_user_id) REFERENCES users(clerk_id) ON DELETE RESTRICT,
  CONSTRAINT membership_checkout_reservations_payment_request_fk
    FOREIGN KEY (payment_creation_request_id)
    REFERENCES payment_creation_requests(id) ON DELETE RESTRICT,
  CONSTRAINT membership_checkout_reservations_plan_check
    CHECK (plan_id IN ('driver', 'family', 'fleet')),
  CONSTRAINT membership_checkout_reservations_catalog_check
    CHECK (
      (
        plan_id = 'driver'
        AND stripe_product_id = 'prod_UXygFuoApjQQVQ'
        AND stripe_price_id = 'price_1U7jIjDItJjjt34XXl9sC071'
        AND unit_amount = 499
      )
      OR (
        plan_id = 'family'
        AND stripe_product_id = 'prod_VJb52POYyOYpQH'
        AND stripe_price_id = 'price_1UIxt0DItJjjt34XP9YjcDJV'
        AND unit_amount = 999
      )
      OR (
        plan_id = 'fleet'
        AND stripe_product_id = 'prod_UXygLCNEL5xuLc'
        AND stripe_price_id = 'price_1U7jIjDItJjjt34XIIyFnQrH'
        AND unit_amount = 1999
      )
    ),
  CONSTRAINT membership_checkout_reservations_currency_interval_check
    CHECK (currency = 'usd' AND billing_interval = 'month' AND interval_count = 1),
  CONSTRAINT membership_checkout_reservations_fingerprint_check
    CHECK (length(request_fingerprint) = 64 AND fingerprint_key_version > 0),
  CONSTRAINT membership_checkout_reservations_idempotency_key_check
    CHECK (length(stripe_idempotency_key) BETWEEN 1 AND 255),
  CONSTRAINT membership_checkout_reservations_session_check
    CHECK (
      stripe_subscription_id IS NULL
      OR stripe_checkout_session_id IS NOT NULL
    ),
  CONSTRAINT membership_checkout_reservations_lease_fields_check
    CHECK (
      (lease_owner IS NULL AND lease_expires_at IS NULL)
      OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
  CONSTRAINT membership_checkout_reservations_attempt_count_check
    CHECK (attempt_count >= 1),
  CONSTRAINT membership_checkout_reservations_chronology_check
    CHECK (
      updated_at >= created_at
      AND expires_at >= created_at
      AND retention_expires_at >= expires_at
    )
);

CREATE UNIQUE INDEX membership_checkout_reservations_idempotency_uq
  ON membership_checkout_reservations (stripe_idempotency_key);
CREATE UNIQUE INDEX membership_checkout_reservations_payment_request_uq
  ON membership_checkout_reservations (payment_creation_request_id)
  WHERE payment_creation_request_id IS NOT NULL;
CREATE UNIQUE INDEX membership_checkout_reservations_session_uq
  ON membership_checkout_reservations (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX membership_checkout_reservations_user_history_idx
  ON membership_checkout_reservations (clerk_user_id, created_at DESC);
CREATE INDEX membership_checkout_reservations_reconcile_idx
  ON membership_checkout_reservations (state, updated_at);
CREATE INDEX membership_checkout_reservations_retention_idx
  ON membership_checkout_reservations (retention_expires_at);
CREATE UNIQUE INDEX membership_checkout_reservations_one_unresolved_per_user_uq
  ON membership_checkout_reservations (clerk_user_id)
  WHERE state IN ('processing', 'session_created', 'reconciling', 'manual_review');