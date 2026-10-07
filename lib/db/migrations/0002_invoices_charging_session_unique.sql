-- Add charging_session_id column to invoices with a unique constraint.
-- This makes createChargingInvoice idempotent against Stripe webhook retries:
-- a second delivery for the same session hits the unique index and is discarded
-- via ON CONFLICT DO NOTHING, so no duplicate invoice is created.
-- Safe to re-run: all statements use IF NOT EXISTS / duplicate-object guards.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS charging_session_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_charging_session_id_unique
  ON invoices (charging_session_id)
  WHERE charging_session_id IS NOT NULL;
