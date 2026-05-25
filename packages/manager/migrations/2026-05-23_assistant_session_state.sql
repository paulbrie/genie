-- Adds the assistant_session_state table. This persists the mapping from
-- `projectId:instanceId` to the Claude Code session id used for --resume, so
-- Manager restarts no longer drop conversation continuity. The conversation
-- content itself lives on the VPS in ~/.claude/projects/...jsonl.
--
--   psql "$DB" -f packages/manager/migrations/2026-05-23_assistant_session_state.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "assistant_session_state" (
    "session_key" text PRIMARY KEY NOT NULL,
    "claude_code_session_id" text NOT NULL,
    "project_id" text NOT NULL,
    "instance_id" text NOT NULL,
    "last_activity" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ass_session_state_project"
    ON "assistant_session_state" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_ass_session_state_last_activity"
    ON "assistant_session_state" ("last_activity");
