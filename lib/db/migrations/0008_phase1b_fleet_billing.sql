-- Phase 1B Fleet billing ownership and quantity operation evidence.
-- Additive only. Do not apply outside the development schema authorization.

CREATE TYPE fleet_billing_account_state AS ENUM (
  'pending', 'active', 'reconciling', 'cancellation_pending', 'canceled', 'manual_review'
);

CREATE TYPE fleet_quantity_operation_type AS ENUM (
  'quantity_change', 'final_vehicle_transition'
);

CREATE TYPE fleet_quantity_operation_state AS ENUM (
  'reserved', 'processing', 'stripe_succeeded', 'completed', 'retryable_failure',
  'reconciling', 'terminal_failure', 'cancelled', 'manual_review'
);

CREATE TABLE fleet_billing_accounts (
  id UUID PRIMARY KEY,
  organization_id INTEGER NOT NULL
    REFERENCES organizations(id) ON DELETE RESTRICT,
  billing_owner_clerk_id TEXT NOT NULL
    REFERENCES users(clerk_id) ON DELETE RESTRICT,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  state fleet_billing_account_state NOT NULL DEFAULT 'pending',
  current_quantity INTEGER NOT NULL,
  last_verified_at TIMESTAMPTZ,
  stripe_subscription_status TEXT,
  reconciliation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fleet_billing_accounts_quantity_check
    CHECK (current_quantity > 0),
  CONSTRAINT fleet_billing_accounts_verified_state_check
    CHECK (
      state <> 'active'
      OR (
        last_verified_at IS NOT NULL
        AND stripe_subscription_status IS NOT NULL
        AND stripe_subscription_status IN ('active', 'trialing')
        AND reconciliation_reason IS NULL
      )
    ),
  CONSTRAINT fleet_billing_accounts_reconciliation_state_check
    CHECK (
      state NOT IN ('reconciling', 'manual_review')
      OR reconciliation_reason IS NOT NULL
    ),
  CONSTRAINT fleet_billing_accounts_org_uq UNIQUE (organization_id),
  CONSTRAINT fleet_billing_accounts_subscription_uq UNIQUE (stripe_subscription_id)
);

CREATE INDEX fleet_billing_accounts_owner_idx
  ON fleet_billing_accounts (billing_owner_clerk_id);
CREATE INDEX fleet_billing_accounts_state_idx
  ON fleet_billing_accounts (state, updated_at DESC);

CREATE TABLE fleet_quantity_operations (
  id UUID PRIMARY KEY,
  billing_account_id UUID NOT NULL
    REFERENCES fleet_billing_accounts(id) ON DELETE RESTRICT,
  organization_id INTEGER NOT NULL
    REFERENCES organizations(id) ON DELETE RESTRICT,
  stripe_subscription_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  operation_type fleet_quantity_operation_type NOT NULL,
  from_quantity INTEGER NOT NULL,
  target_quantity INTEGER,
  proration_behavior TEXT NOT NULL DEFAULT 'create_prorations',
  apply_immediately BOOLEAN NOT NULL DEFAULT TRUE,
  request_hash TEXT NOT NULL,
  stripe_idempotency_key_ref TEXT NOT NULL,
  state fleet_quantity_operation_state NOT NULL DEFAULT 'reserved',
  stripe_request_id TEXT,
  stripe_event_id TEXT,
  stripe_result_status TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_category TEXT,
  reconciliation_reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fleet_quantity_operations_from_quantity_check
    CHECK (from_quantity > 0),
  CONSTRAINT fleet_quantity_operations_target_quantity_check
    CHECK (
      (
        operation_type = 'quantity_change'
        AND target_quantity IS NOT NULL
        AND target_quantity > 0
        AND target_quantity <> from_quantity
      )
      OR (
        operation_type = 'final_vehicle_transition'
        AND target_quantity IS NULL
      )
    ),
  CONSTRAINT fleet_quantity_operations_proration_check
    CHECK (proration_behavior = 'create_prorations'),
  CONSTRAINT fleet_quantity_operations_apply_immediately_check
    CHECK (apply_immediately = TRUE),
  CONSTRAINT fleet_quantity_operations_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT fleet_quantity_operations_lease_fields_check
    CHECK (
      (lease_owner IS NULL AND lease_expires_at IS NULL)
      OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
  CONSTRAINT fleet_quantity_operations_reconciliation_check
    CHECK (
      state NOT IN ('reconciling', 'manual_review')
      OR reconciliation_reason IS NOT NULL
    ),
  CONSTRAINT fleet_quantity_operations_completed_check
    CHECK (state <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT fleet_quantity_operations_idempotency_ref_uq
    UNIQUE (stripe_idempotency_key_ref)
);

CREATE INDEX fleet_quantity_operations_account_created_idx
  ON fleet_quantity_operations (billing_account_id, created_at DESC);
CREATE INDEX fleet_quantity_operations_subscription_state_idx
  ON fleet_quantity_operations (stripe_subscription_id, state, created_at DESC);
CREATE UNIQUE INDEX fleet_quantity_operations_one_unresolved_per_subscription_uq
  ON fleet_quantity_operations (stripe_subscription_id)
  WHERE state IN ('reserved', 'processing', 'stripe_succeeded', 'reconciling', 'manual_review');