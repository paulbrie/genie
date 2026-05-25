-- Adds users.last_seen_update_version — the renderer ships a hardcoded
-- changelog and compares this value against the latest entry to decide
-- whether to show the "What's new" modal once per user per release.
--
--   psql "$DB" -f packages/manager/migrations/2026-05-25_user_update_log.sql
--
-- Idempotent: safe to re-run.

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "last_seen_update_version" text;
