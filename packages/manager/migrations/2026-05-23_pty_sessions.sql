-- Adds the pty_sessions table. The id matches the tmux session name on the
-- VPS, so reattach is just another spawn with the same id (tmux new -A -s X
-- attaches if X exists, creates otherwise). Survives Manager restart; the
-- tmux session survives SSH channel drops.
--
--   psql "$DB" -f packages/manager/migrations/2026-05-23_pty_sessions.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "pty_sessions" (
    "id" text PRIMARY KEY NOT NULL,
    "owner_id" text NOT NULL,
    "kind" text NOT NULL DEFAULT 'shell',
    "project_id" text,
    "instance_id" text,
    "vps_host" text NOT NULL,
    "command_label" text,
    "ssh_config" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "last_activity" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pty_sessions_owner"
    ON "pty_sessions" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_pty_sessions_project"
    ON "pty_sessions" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_pty_sessions_last_activity"
    ON "pty_sessions" ("last_activity");
