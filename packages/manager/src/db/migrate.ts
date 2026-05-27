// Boot-time schema migration for the orgs / per-project ACL feature.
//
// Drizzle does not auto-create or auto-alter tables — the rest of the codebase
// follows the same pattern (see settings-service.ensureBaseImageDefaults). This
// module:
//   1) creates organizations / org_members / project_members if they don't exist
//   2) adds organizations.id reference (org_id) to teams if missing
//   3) drops NOT NULL from users.google_id so admin-invited stub users may
//      exist before they sign in with Google
//   4) backfills: for every team without an org_id, creates a default org,
//      links the team, and rolls each team-member into the new org as
//      owner (if their team role is owner/superadmin) or member.
//
// Idempotent: safe to call on every boot.

import { sql } from "drizzle-orm";
import { getDb } from "./index.js";

/** Create the server_credentials table (encrypted SSH keys for generic
 *  bring-your-own servers). Idempotent; safe to call on every boot. */
export async function migrateServerCredentials(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS server_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_server_credentials_project ON server_credentials(project_id)`);
}

export async function migrateOrgs(): Promise<void> {
  const db = getDb();

  // 1. Tables -----------------------------------------------------------------
  await db.execute(sql`CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS org_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    joined_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_members_org_user ON org_members(org_id, user_id)`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_project_members_project_user ON project_members(project_id, user_id)`);

  // 2. Add org_id to teams ---------------------------------------------------
  await db.execute(sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id)`);

  // 3. Drop NOT NULL on users.google_id so stub invitees may exist -----------
  await db.execute(sql`ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL`);

  // 4. Backfill teams without an org -----------------------------------------
  // For each team with NULL org_id: create an org "<team-name>", set teams.org_id,
  // and copy team_members into org_members (mapping team owner/superadmin → owner,
  // member → member). Wrapped per team so a partial failure on one team doesn't
  // leave the others half-migrated.
  const orphanTeams = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM teams WHERE org_id IS NULL
  `);
  for (const team of orphanTeams as unknown as { id: string; name: string }[]) {
    try {
      const [{ id: orgId }] = (await db.execute<{ id: string }>(sql`
        INSERT INTO organizations (name) VALUES (${team.name})
        RETURNING id
      `)) as unknown as { id: string }[];

      await db.execute(sql`UPDATE teams SET org_id = ${orgId} WHERE id = ${team.id}`);

      await db.execute(sql`
        INSERT INTO org_members (org_id, user_id, role)
        SELECT ${orgId}, tm.user_id,
               CASE WHEN tm.role IN ('owner','superadmin') THEN 'owner' ELSE 'member' END
        FROM team_members tm
        WHERE tm.team_id = ${team.id}
        ON CONFLICT (org_id, user_id) DO NOTHING
      `);
    } catch (err) {
      console.error(`[migrate] Failed to backfill org for team ${team.id}:`, err);
    }
  }

  console.log(`[migrate] orgs migration applied (backfilled ${(orphanTeams as unknown as unknown[]).length} team(s))`);
}
