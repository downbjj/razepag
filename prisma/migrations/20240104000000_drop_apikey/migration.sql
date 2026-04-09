-- ============================================================
-- Migration: drop_apikey
-- Removes the old ApiKey table entirely.
-- Replaced by ApiClient (client_id + client_secret + bcrypt).
-- ============================================================

DROP TABLE IF EXISTS "ApiKey";
