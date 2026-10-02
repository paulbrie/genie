-- Communication panel: per-recipient log of platform emails sent by super-admins.
CREATE TABLE IF NOT EXISTS "email_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipient_user_id" uuid,
  "recipient_email" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "sent_by_user_id" uuid,
  "sent_by_name" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_email_logs_recipient" ON "email_logs" ("recipient_user_id");
CREATE INDEX IF NOT EXISTS "idx_email_logs_status" ON "email_logs" ("status");
CREATE INDEX IF NOT EXISTS "idx_email_logs_created" ON "email_logs" ("created_at");
