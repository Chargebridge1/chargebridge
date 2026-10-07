-- Phase 1B non-unique Stripe performance/supporting indexes.
--
-- This migration must run outside a transaction.
-- Execute one index at a time and verify indisvalid/indisready before
-- authorizing the next index.
--
-- Do not add IF NOT EXISTS. Preflight must reject same-name or equivalent
-- conflicting objects rather than silently accepting them.

-- Index 1: Stripe customer lookup
SET lock_timeout = '5s';
SET statement_timeout = '30min';

CREATE INDEX CONCURRENTLY users_stripe_customer_idx
ON users USING btree (
  stripe_customer_id ASC NULLS LAST
)
WHERE stripe_customer_id IS NOT NULL;

-- STOP AND VERIFY:
-- users_stripe_customer_idx must have indisvalid=true and indisready=true
-- before Index 2 is separately authorized.

-- Index 2: charging-session PaymentIntent lookup
SET lock_timeout = '5s';
SET statement_timeout = '30min';

CREATE INDEX CONCURRENTLY charging_sessions_stripe_payment_intent_idx
ON charging_sessions USING btree (
  stripe_payment_intent_id ASC NULLS LAST
)
WHERE stripe_payment_intent_id IS NOT NULL;

-- STOP AND VERIFY:
-- charging_sessions_stripe_payment_intent_idx must have
-- indisvalid=true and indisready=true before Index 3 is separately authorized.

-- Index 3: due unresolved refund jobs
SET lock_timeout = '5s';
SET statement_timeout = '30min';

CREATE INDEX CONCURRENTLY stripe_refund_jobs_due_idx
ON stripe_refund_jobs USING btree (
  next_retry_at ASC NULLS LAST
)
WHERE succeeded_at IS NULL;

-- FINAL VERIFICATION:
-- all three indexes must have indisvalid=true and indisready=true.