-- Append-only subscription webhook evidence and ordering journal.
-- Apply only through the approved development migration process.
-- This migration does not grant/revoke entitlements or modify subscriptions.

CREATE TABLE IF NOT EXISTS subscription_reconciliation_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_livemode BOOLEAN,
  event_created_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  owner_clerk_id TEXT,
  owner_match_count INTEGER NOT NULL,
  subscription_status TEXT,
  approved_plan TEXT,
  price_ids JSONB NOT NULL,
  items JSONB NOT NULL,
  snapshot JSONB NOT NULL,
  operation_association_status TEXT NOT NULL DEFAULT 'not_verified',
  previous_event_created_at TIMESTAMPTZ,
  out_of_order BOOLEAN NOT NULL DEFAULT FALSE,
  disposition TEXT NOT NULL,
  reconciliation_reasons JSONB NOT NULL,
  CONSTRAINT subscription_reconciliation_events_stripe_event_fk
    FOREIGN KEY (stripe_event_id)
    REFERENCES stripe_events(stripe_event_id)
    ON DELETE RESTRICT,
  CONSTRAINT subscription_reconciliation_events_owner_fk
    FOREIGN KEY (owner_clerk_id)
    REFERENCES users(clerk_id)
    ON DELETE RESTRICT,
  CONSTRAINT subscription_reconciliation_events_event_type_check
    CHECK (event_type LIKE 'customer.subscription.%'),
  CONSTRAINT subscription_reconciliation_events_owner_count_check
    CHECK (owner_match_count >= 0),
  CONSTRAINT subscription_reconciliation_events_plan_check
    CHECK (approved_plan IS NULL OR approved_plan IN ('driver', 'family', 'fleet')),
  CONSTRAINT subscription_reconciliation_events_operation_association_check
    CHECK (operation_association_status = 'not_verified')
);

CREATE INDEX IF NOT EXISTS subscription_reconciliation_events_subscription_order_idx
  ON subscription_reconciliation_events
    (stripe_subscription_id, event_created_at DESC, received_at DESC);

CREATE INDEX IF NOT EXISTS subscription_reconciliation_events_disposition_idx
  ON subscription_reconciliation_events (disposition, received_at DESC);