-- Adds resume-metadata columns to chat_session_meta so the History panel can
-- reinstall the Claude Code --resume mapping when a past session is re-opened.
-- Columns are nullable: pre-existing rows (created before this feature) simply
-- won't carry a Claude Code session id, and clicking them in History will
-- still show the messages — they just won't auto-resume.
--
--   psql "$DB" -f packages/manager/migrations/2026-05-23_chat_session_meta_resume.sql
--
-- Idempotent: safe to re-run.

ALTER TABLE "chat_session_meta"
    ADD COLUMN IF NOT EXISTS "claude_code_session_id" text;
ALTER TABLE "chat_session_meta"
    ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "chat_session_meta"
    ADD COLUMN IF NOT EXISTS "instance_id" text;
