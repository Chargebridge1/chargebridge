-- Add catalog_trim_id to user_vehicles.
-- Links a saved vehicle to the ev_catalog_trims table so POST /api/stations/match
-- can look up the precise EV charging profile (dcMaxKw, acMaxKw, dcConnector, etc.)
-- for SoC-aware feasibility and speed scoring.
-- Nullable: vehicles created before this migration or entered manually keep null
-- and fall back to inline field scoring.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS catalog_trim_id INTEGER;
