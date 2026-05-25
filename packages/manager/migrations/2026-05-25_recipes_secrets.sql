-- Add `secrets` JSONB column to recipes table so built-in recipes that prompt
-- the operator for tokens (e.g. git-credentials's GitHub/GitLab PAT) can live
-- in the DB alongside user recipes — unifies built-in + user into a single
-- source.
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS secrets JSONB NOT NULL DEFAULT '[]'::jsonb;
