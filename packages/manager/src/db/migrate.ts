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
// Idempotent DDL steps tracked in `_genie_boot_migrations` — run once per DB.

import { sql } from "drizzle-orm";
import { getDb } from "./index.js";

const LEDGER_TABLE = "_genie_boot_migrations";

const BOOT_MIGRATIONS: { id: string; run: () => Promise<void> }[] = [
  { id: "orgs", run: migrateOrgs },
  { id: "server_credentials", run: migrateServerCredentials },
  { id: "org_credentials", run: migrateOrgCredentials },
  { id: "team_invites", run: migrateTeamInvites },
  { id: "vps_metric_samples", run: migrateVpsMetricSamples },
  { id: "vps_stats_tokens", run: migrateVpsStatsTokens },
  { id: "agents", run: migrateAgents },
  { id: "base_image_history", run: migrateBaseImageHistory },
  { id: "tracker_per_project_identifier", run: migrateTrackerPerProjectIdentifier },
  { id: "project_teams", run: migrateProjectTeams },
  { id: "security_scan_project", run: migrateSecurityScanProject },
  { id: "analytics_events", run: migrateAnalyticsEvents },
  { id: "analytics_events_project", run: migrateAnalyticsEventsProject },
  { id: "claude_plugins", run: migrateClaudePlugins },
  { id: "connection_log", run: migrateConnectionLog },
  { id: "projects_soft_delete", run: migrateProjectsSoftDelete },
  { id: "projects_revert_fk_cascade", run: migrateProjectsRevertFkCascade },
  { id: "vps_git_repos", run: migrateVpsGitRepos },
];

async function tableExists(tableName: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists
  `);
  return Boolean((rows as unknown as { exists: boolean }[])[0]?.exists);
}

async function ensureLedgerTable(): Promise<void> {
  if (await tableExists(LEDGER_TABLE)) return;
  const db = getDb();
  await db.execute(sql`CREATE TABLE ${sql.raw(LEDGER_TABLE)} (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
}

async function getAppliedMigrationIds(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM ${sql.raw(LEDGER_TABLE)}
  `);
  return new Set((rows as unknown as { id: string }[]).map((r) => r.id));
}

async function markMigrationApplied(id: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO ${sql.raw(LEDGER_TABLE)} (id) VALUES (${id})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function migrationTablesExist(id: string): Promise<boolean> {
  switch (id) {
    case "orgs": return tableExists("organizations");
    case "server_credentials": return tableExists("server_credentials");
    case "org_credentials": return tableExists("org_credentials");
    case "team_invites": return tableExists("team_invites");
    case "vps_metric_samples": return tableExists("vps_metric_samples");
    case "vps_stats_tokens": return tableExists("vps_stats_tokens");
    case "project_teams": return tableExists("project_teams");
    case "agents": return tableExists("agents");
    case "base_image_history": return tableExists("base_image_template_history");
    case "analytics_events": return tableExists("analytics_events");
    case "claude_plugins": return tableExists("claude_plugins");
    case "connection_log": return tableExists("connection_log");
    // security_scan_project only adds a column (idempotent ALTER) — let the
    // catch-up path run it rather than guessing from a table name.
    default: return false;
  }
}

/** Run any boot migrations not yet recorded in `_genie_boot_migrations`. */
export async function runBootMigrations(): Promise<void> {
  await ensureLedgerTable();
  const applied = await getAppliedMigrationIds();

  // DBs migrated before the ledger existed: mark steps whose tables are
  // already present; run any catch-up steps that were added later.
  if (applied.size === 0 && await tableExists("organizations")) {
    let catchUp = 0;
    for (const m of BOOT_MIGRATIONS) {
      if (await migrationTablesExist(m.id)) {
        await markMigrationApplied(m.id);
      } else {
        await m.run();
        await markMigrationApplied(m.id);
        catchUp++;
        console.log(`[migrate] applied ${m.id} (legacy catch-up)`);
      }
    }
    console.log(catchUp === 0
      ? "[migrate] boot migrations already applied (existing schema)"
      : `[migrate] bootstrapped legacy schema (${catchUp} catch-up migration(s))`);
    return;
  }

  let ran = 0;
  for (const m of BOOT_MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await m.run();
    await markMigrationApplied(m.id);
    ran++;
    console.log(`[migrate] applied ${m.id}`);
  }
  if (ran === 0) {
    console.log("[migrate] boot migrations up to date");
  }
}

/** Ensure a single boot migration has run (for one-off scripts). */
export async function ensureBootMigration(id: string): Promise<void> {
  await ensureLedgerTable();
  const applied = await getAppliedMigrationIds();
  if (applied.has(id)) return;
  const m = BOOT_MIGRATIONS.find((entry) => entry.id === id);
  if (!m) throw new Error(`Unknown boot migration: ${id}`);
  await m.run();
  await markMigrationApplied(id);
  console.log(`[migrate] applied ${id}`);
}

/** Create the org_credentials table (encrypted per-org cloud-provider tokens
 *  + SSH keys — currently TazCloud, room for DO / GitHub later). Idempotent. */
export async function migrateOrgCredentials(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS org_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  // The lookup index must be UNIQUE so setCredential can use ON CONFLICT (one
  // round trip, atomic) and so concurrent writes can't produce duplicate rows.
  // An earlier release shipped this as a non-unique index — drop + recreate.
  // Dedupe first by keeping the freshest row per (org_id, kind) so the unique
  // CREATE doesn't fail on installations that already raced.
  await db.execute(sql`DELETE FROM org_credentials a
    USING org_credentials b
    WHERE a.org_id = b.org_id
      AND a.kind = b.kind
      AND (a.updated_at < b.updated_at
        OR (a.updated_at = b.updated_at AND a.id < b.id))`);
  await db.execute(sql`DROP INDEX IF EXISTS idx_org_credentials_lookup`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_credentials_lookup ON org_credentials(org_id, kind)`);
}

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

/** Create the vps_stats_tokens table (per-instance bearer token for the on-VM
 *  genie-stats daemon's HTTPS postback). Idempotent; safe to call every boot. */
export async function migrateVpsStatsTokens(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS vps_stats_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    token TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_vps_stats_tokens_token ON vps_stats_tokens(token)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_vps_stats_tokens_instance ON vps_stats_tokens(project_id, instance_id)`);
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

/** Reusable team invite links (org + team membership on accept). Idempotent. */
export async function migrateTeamInvites(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS team_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_invites_org ON team_invites(org_id)`);
}

/** User-definable AI agents (and their runs). Idempotent.
 *  See `agents` / `agent_runs` in schema.ts for column-level docs. */
export async function migrateAgents(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    system_prompt TEXT DEFAULT '' NOT NULL,
    model_id TEXT DEFAULT 'claude-sonnet' NOT NULL,
    max_tool_rounds INTEGER DEFAULT 40 NOT NULL,
    tools JSONB DEFAULT '[]'::jsonb NOT NULL,
    sandbox JSONB DEFAULT '{}'::jsonb NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_builtin BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agents_slug ON agents(slug)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_user_id)`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    parent_run_id UUID,
    triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    instance_id TEXT,
    status TEXT DEFAULT 'queued' NOT NULL
      CHECK (status IN ('queued','running','succeeded','failed','timeout','cancelled')),
    input JSONB DEFAULT '{}'::jsonb NOT NULL,
    output JSONB,
    error TEXT,
    input_tokens INTEGER DEFAULT 0 NOT NULL,
    output_tokens INTEGER DEFAULT 0 NOT NULL,
    cost_usd REAL DEFAULT 0 NOT NULL,
    tool_events JSONB DEFAULT '[]'::jsonb NOT NULL,
    sandbox_ref TEXT,
    started_at TIMESTAMP DEFAULT NOW() NOT NULL,
    finished_at TIMESTAMP
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at)`);
}

/** Scalar VPS metric samples for historical charts. Idempotent. */
export async function migrateVpsMetricSamples(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS vps_metric_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    sampled_at TIMESTAMP NOT NULL,
    cpu_percent REAL NOT NULL,
    mem_used_bytes BIGINT NOT NULL,
    mem_total_bytes BIGINT NOT NULL,
    mem_percent REAL NOT NULL,
    disk_used_bytes BIGINT NOT NULL,
    disk_total_bytes BIGINT NOT NULL,
    disk_percent REAL NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vps_metric_samples_lookup ON vps_metric_samples(project_id, instance_id, sampled_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vps_metric_samples_sampled_at ON vps_metric_samples(sampled_at)`);
}

/** Additional teams granted access to a project (many-to-many), beyond the
 *  single primary `projects.team_id`. Idempotent; safe to call every boot. */
export async function migrateProjectTeams(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS project_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_project_teams_project ON project_teams(project_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_project_teams_team ON project_teams(team_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_project_teams_project_team ON project_teams(project_id, team_id)`);
}

/** Move tracker issue identifiers from a single global sequence to a per-project
 *  one: drop the old non-unique index on `identifier` alone and add a composite
 *  unique index on (project_id, identifier). Existing identifiers were globally
 *  unique, so they are trivially unique per project — the unique index is safe
 *  to create without renumbering. New issues are numbered per project going
 *  forward (see tracker-service.getNextIdentifier). Idempotent. */
export async function migrateTrackerPerProjectIdentifier(): Promise<void> {
  const db = getDb();
  await db.execute(sql`DROP INDEX IF EXISTS idx_tracker_issues_identifier`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_tracker_issues_project_identifier ON tracker_issues(project_id, identifier)`);
}

/** Scope genie-security MCP scans to the project their token belongs to —
 *  adds security_scans.project_id. Idempotent. */
export async function migrateSecurityScanProject(): Promise<void> {
  const db = getDb();
  await db.execute(sql`ALTER TABLE security_scans ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_security_scans_project ON security_scans(project_id)`);
}

/** Product-analytics events backing the superadmin dashboard. Idempotent. */
export async function migrateAnalyticsEvents(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_name TEXT,
    event TEXT NOT NULL,
    project_id TEXT,
    props JSONB,
    ip TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at)`);
}

/** Add analytics_events.project_id so the dashboard can filter by project. Its
 *  own ledger step because the base table may have been created without it.
 *  Idempotent. */
export async function migrateAnalyticsEventsProject(): Promise<void> {
  const db = getDb();
  await db.execute(sql`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS project_id TEXT`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analytics_events_project ON analytics_events(project_id)`);
}

/** Official Claude Code plugins catalog. Same shape as `recipes` but kept in a
 *  dedicated table so its slug namespace doesn't collide with recipes.
 *  Idempotent; safe to call on every boot. */
export async function migrateClaudePlugins(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS claude_plugins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    icon TEXT DEFAULT 'Puzzle' NOT NULL,
    homepage_url TEXT DEFAULT '' NOT NULL,
    check_script TEXT NOT NULL,
    install_script TEXT NOT NULL,
    uninstall_script TEXT DEFAULT '' NOT NULL,
    commands JSONB DEFAULT '[]'::jsonb NOT NULL,
    options JSONB DEFAULT '[]'::jsonb NOT NULL,
    secrets JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_claude_plugins_slug ON claude_plugins(slug)`);
}

/** One row per WebSocket close — written from ws-server. Lets us hand Railway
 *  support sample `x-railway-request-id`s after Railway's log retention rolls
 *  off, and track baseline disconnect rates over time. Idempotent. */
export async function migrateConnectionLog(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS connection_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_name TEXT,
    client_type TEXT,
    ip TEXT,
    user_agent TEXT,
    railway_request_id TEXT,
    connected_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP DEFAULT NOW() NOT NULL,
    duration_sec INTEGER,
    close_code INTEGER,
    close_description TEXT,
    close_hint TEXT,
    close_reason TEXT,
    alive_last_ping BOOLEAN
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_connection_log_closed ON connection_log(closed_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_connection_log_code ON connection_log(close_code)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_connection_log_user ON connection_log(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_connection_log_request_id ON connection_log(railway_request_id)`);
}

/** Add projects.deleted_at to enable soft delete. project-service.remove() sets
 *  this instead of running DELETE so audit data (tracker issues, deploy logs)
 *  stays attached without polluting visible project lists. Idempotent. */
export async function migrateProjectsSoftDelete(): Promise<void> {
  const db = getDb();
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
}

/** Ensure projects→{tracker_issues, deploy_logs} FKs are NO ACTION (default),
 *  not CASCADE. A short-lived prior step flipped them to CASCADE before we
 *  settled on soft delete; with cascade in place a stray hard DELETE on
 *  projects would silently wipe historical issues and deploy logs. Re-declares
 *  the constraints without an ON DELETE clause. Idempotent. */
export async function migrateProjectsRevertFkCascade(): Promise<void> {
  const db = getDb();
  await db.execute(sql`ALTER TABLE tracker_issues
    DROP CONSTRAINT IF EXISTS tracker_issues_project_id_projects_id_fk`);
  await db.execute(sql`ALTER TABLE tracker_issues
    ADD CONSTRAINT tracker_issues_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id)`);
  await db.execute(sql`ALTER TABLE deploy_logs
    DROP CONSTRAINT IF EXISTS deploy_logs_project_id_projects_id_fk`);
  await db.execute(sql`ALTER TABLE deploy_logs
    ADD CONSTRAINT deploy_logs_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id)`);
}

/** Per-(project, instance) git repos registered via the Github tab. Token
 *  bundle is encrypted via vps/credential-crypto.ts. Idempotent. */
export async function migrateVpsGitRepos(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS vps_git_repos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'github' CHECK (provider IN ('github','gitlab','other')),
    ciphertext TEXT,
    iv TEXT,
    auth_tag TEXT,
    salt TEXT,
    auto_save BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vps_git_repos_lookup ON vps_git_repos(project_id, instance_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_vps_git_repos_path ON vps_git_repos(project_id, instance_id, repo_path)`);
}

/** Base image template edit history. Idempotent. */
export async function migrateBaseImageHistory(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS base_image_template_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored')),
    data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_base_image_tpl_hist_name ON base_image_template_history (template_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_base_image_tpl_hist_created ON base_image_template_history (created_at)`);
}
