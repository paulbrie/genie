-- Adds the cloud_vm_locks table without touching anything else.
-- Apply manually (drizzle-kit push currently wants to drop unrelated drifted
-- columns/tables, which is unsafe). Run against the same DB drizzle.config.ts
-- points at:
--
--   psql "$DB" -f packages/manager/migrations/2026-05-20_cloud_vm_locks.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "cloud_vm_locks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "provider" text NOT NULL,
    "vm_id" text NOT NULL,
    "locked_by" text,
    "locked_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_cloud_vm_locks_lookup"
    ON "cloud_vm_locks" ("provider", "vm_id");
