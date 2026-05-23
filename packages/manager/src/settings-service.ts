import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { globalSettings, users, projects, baseImageTemplateHistory } from "./db/schema.js";

// --- Interfaces (moved from ws-server) ---

export interface BaseImageConfig {
  region: string;
  size: string;
  provisionScript: string;
}

export interface BaseImageTemplate {
  configName: string;
  snapshotPrefix: string;
  snapshotId: number | null;
  snapshotName: string | null;
  deletedAt?: string | null;  // ISO timestamp for soft delete
}

export const DEFAULT_BASE_IMAGE_CONFIG: BaseImageConfig = {
  region: "nyc1",
  size: "s-1vcpu-1gb",
  provisionScript: [
    "#!/bin/bash",
    "set -e",
    "",
    "# Remove stale Docker apt sources from base image, then refresh",
    "rm -f /etc/apt/sources.list.d/*docker*",
    "apt-get update || true",
    "apt-get install -y ca-certificates curl gnupg",
    "install -m 0755 -d /etc/apt/keyrings",
    "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg",
    'echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" > /etc/apt/sources.list.d/docker.list',
    "",
    "# Firewall",
    "ufw allow 3000/tcp && ufw reload",
    "",
    "# Node.js 22 via NodeSource",
    "apt-get purge -y libnode-dev nodejs npm 2>/dev/null || true",
    "apt-get autoremove -y 2>/dev/null || true",
    "mkdir -p /etc/apt/keyrings",
    "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
    'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list',
    "apt-get update && apt-get install -y nodejs",
    "npm install -g @anthropic-ai/claude-code",
    "",
    "# Python",
    "apt-get install -y python3 python3-pip python3-venv rsync",
    "",
    "# PostgreSQL 16",
    "sh -c 'echo \"deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main\" > /etc/apt/sources.list.d/pgdg.list'",
    "curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg",
    "apt-get update && apt-get install -y postgresql-16",
    "systemctl enable postgresql",
    "systemctl start postgresql",
    "",
    "# Pre-pull Docker base images",
    "docker pull node:22-alpine",
    "docker pull node:20-alpine",
    "docker pull postgres:16-alpine",
    "docker pull rabbitmq:3.13-management",
    "docker pull redis:6.2",
  ].join("\n"),
};

export const DEFAULT_BASE_IMAGE_TEMPLATE: BaseImageTemplate = {
  configName: "default",
  snapshotPrefix: "genie-base",
  snapshotId: null,
  snapshotName: null,
};

// --- Global settings KV ---

export async function getGlobalSetting<T = unknown>(key: string): Promise<T | null> {
  const db = getDb();
  const [row] = await db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);
  if (!row) return null;
  return row.value as T;
}

export async function setGlobalSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(globalSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: globalSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

// --- Genie SSH key pair (DB-persisted) ---

export async function getGenieKeyPair(): Promise<{ privateKey: string; publicKey: string } | null> {
  const privateKey = await getGlobalSetting<string>("geniePrivateKey");
  const publicKey = await getGlobalSetting<string>("geniePublicKey");
  if (!privateKey || !publicKey) return null;
  return { privateKey, publicKey };
}

export interface SshKeyHistoryEntry {
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  archivedAt: string;
}

export async function getGenieKeyHistory(): Promise<SshKeyHistoryEntry[]> {
  return (await getGlobalSetting<SshKeyHistoryEntry[]>("genieKeyHistory")) || [];
}

async function archiveCurrentKey(): Promise<void> {
  const current = await getGenieKeyPair();
  if (!current) return;
  const history = await getGenieKeyHistory();
  // Compute fingerprint inline
  const crypto = await import("crypto");
  const keyData = current.publicKey.trim().split(/\s+/)[1] || "";
  const hash = crypto.createHash("md5").update(Buffer.from(keyData, "base64")).digest("hex");
  const fingerprint = hash.match(/.{2}/g)?.join(":") || "";
  history.unshift({
    publicKey: current.publicKey,
    fingerprint,
    createdAt: (await getGlobalSetting<string>("genieKeyCreatedAt")) || new Date().toISOString(),
    archivedAt: new Date().toISOString(),
  });
  // Keep last 20 entries
  await setGlobalSetting("genieKeyHistory", history.slice(0, 20));
}

export async function saveGenieKeyPair(privateKey: string, publicKey: string): Promise<void> {
  await archiveCurrentKey();
  await setGlobalSetting("geniePrivateKey", privateKey);
  await setGlobalSetting("geniePublicKey", publicKey);
  await setGlobalSetting("genieKeyCreatedAt", new Date().toISOString());
}

export async function deleteGenieKeyPair(): Promise<void> {
  await archiveCurrentKey();
  const db = getDb();
  await db.delete(globalSettings).where(eq(globalSettings.key, "geniePrivateKey"));
  await db.delete(globalSettings).where(eq(globalSettings.key, "geniePublicKey"));
  await db.delete(globalSettings).where(eq(globalSettings.key, "genieKeyCreatedAt"));
}

// --- Convenience getters for simple global settings ---

export async function getGlobalDoToken(): Promise<string> {
  return (await getGlobalSetting<string>("digitaloceanApiToken")) || "";
}

export async function getGlobalGitlabDeployKey(): Promise<string> {
  return (await getGlobalSetting<string>("gitlabDeployKey")) || "";
}

export async function getGlobalDefaultEditor(): Promise<string> {
  return (await getGlobalSetting<string>("defaultEditor")) || "";
}

export async function getGlobalRailwayToken(): Promise<string> {
  return (await getGlobalSetting<string>("railwayToken")) || process.env.RAILWAY_TOKEN || "";
}

export async function getGlobalRailwayProjectId(): Promise<string> {
  return (await getGlobalSetting<string>("railwayProjectId")) || process.env.RAILWAY_PROJECT_ID || "";
}

// --- Base image configs ---

export async function getAllBaseImageConfigs(): Promise<Record<string, BaseImageConfig>> {
  return (await getGlobalSetting<Record<string, BaseImageConfig>>("baseImageConfigs")) || {};
}

export async function saveAllBaseImageConfigs(configs: Record<string, BaseImageConfig>): Promise<void> {
  await setGlobalSetting("baseImageConfigs", configs);
}

export async function getBaseImageConfigByName(name: string): Promise<BaseImageConfig | null> {
  const all = await getAllBaseImageConfigs();
  return all[name] || null;
}

export async function saveBaseImageConfigByName(name: string, config: BaseImageConfig): Promise<void> {
  const all = await getAllBaseImageConfigs();
  all[name] = config;
  await saveAllBaseImageConfigs(all);
}

export async function deleteBaseImageConfigByName(name: string): Promise<void> {
  const all = await getAllBaseImageConfigs();
  delete all[name];
  await saveAllBaseImageConfigs(all);
}

// --- Base image templates ---

export async function getAllBaseImageTemplates(includeDeleted = false): Promise<Record<string, BaseImageTemplate>> {
  const all = (await getGlobalSetting<Record<string, BaseImageTemplate>>("baseImageTemplates")) || {};
  if (includeDeleted) return all;
  const filtered: Record<string, BaseImageTemplate> = {};
  for (const [key, tmpl] of Object.entries(all)) {
    if (!tmpl.deletedAt) filtered[key] = tmpl;
  }
  return filtered;
}

export async function saveAllBaseImageTemplates(templates: Record<string, BaseImageTemplate>): Promise<void> {
  await setGlobalSetting("baseImageTemplates", templates);
}

export async function getBaseImageTemplateByName(name: string): Promise<BaseImageTemplate | null> {
  const all = await getAllBaseImageTemplates();
  return all[name] || null;
}

export async function saveBaseImageTemplateByName(name: string, template: BaseImageTemplate): Promise<void> {
  const all = await getAllBaseImageTemplates(true);
  const existed = all[name] && !all[name].deletedAt;
  all[name] = template;
  await saveAllBaseImageTemplates(all);
  await recordTemplateHistory(name, existed ? "updated" : "created", template);
}

export async function deleteBaseImageTemplateByName(name: string): Promise<void> {
  const all = await getAllBaseImageTemplates(true);
  if (!all[name]) return;
  all[name].deletedAt = new Date().toISOString();
  await saveAllBaseImageTemplates(all);
  await recordTemplateHistory(name, "deleted", all[name]);
}

export async function restoreBaseImageTemplateByName(name: string): Promise<void> {
  const all = await getAllBaseImageTemplates(true);
  if (!all[name]) return;
  all[name].deletedAt = null;
  await saveAllBaseImageTemplates(all);
  await recordTemplateHistory(name, "restored", all[name]);
}

export async function hardDeleteBaseImageTemplateByName(name: string): Promise<void> {
  const all = await getAllBaseImageTemplates(true);
  delete all[name];
  await saveAllBaseImageTemplates(all);
}

export async function getDeletedBaseImageTemplates(): Promise<Record<string, BaseImageTemplate>> {
  const all = (await getGlobalSetting<Record<string, BaseImageTemplate>>("baseImageTemplates")) || {};
  const deleted: Record<string, BaseImageTemplate> = {};
  for (const [key, tmpl] of Object.entries(all)) {
    if (tmpl.deletedAt) deleted[key] = tmpl;
  }
  return deleted;
}

// --- Template history ---

export async function recordTemplateHistory(
  templateName: string,
  action: "created" | "updated" | "deleted" | "restored",
  data: BaseImageTemplate,
): Promise<void> {
  const db = getDb();
  await db.insert(baseImageTemplateHistory).values({
    templateName,
    action,
    data,
    createdAt: new Date(),
  });
}

export async function getTemplateHistory(templateName: string): Promise<Array<{
  id: string;
  templateName: string;
  action: string;
  data: BaseImageTemplate;
  createdAt: Date;
}>> {
  const db = getDb();
  const rows = await db.select().from(baseImageTemplateHistory)
    .where(eq(baseImageTemplateHistory.templateName, templateName))
    .orderBy(desc(baseImageTemplateHistory.createdAt));
  return rows.map((r) => ({ ...r, data: r.data as BaseImageTemplate }));
}

export async function getAllTemplateHistory(): Promise<Array<{
  id: string;
  templateName: string;
  action: string;
  data: BaseImageTemplate;
  createdAt: Date;
}>> {
  const db = getDb();
  const rows = await db.select().from(baseImageTemplateHistory)
    .orderBy(desc(baseImageTemplateHistory.createdAt))
    .limit(100);
  return rows.map((r) => ({ ...r, data: r.data as BaseImageTemplate }));
}

// --- Resolve functions (per-project / per-user with global fallback) ---

export async function resolveDoToken(projectId: string): Promise<string> {
  const db = getDb();
  const [row] = await db.select({ doToken: projects.doToken }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (row?.doToken) return row.doToken;
  return getGlobalDoToken();
}

export async function resolveGitlabDeployKey(projectId: string): Promise<string> {
  const db = getDb();
  const [row] = await db.select({ gitlabDeployKey: projects.gitlabDeployKey }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (row?.gitlabDeployKey) return row.gitlabDeployKey;
  return getGlobalGitlabDeployKey();
}

// --- Resolve base image ID via templates ---

export async function resolveBaseImageId(project: { vpsBaseImageConfigName?: string; vpsBaseImageId?: number }): Promise<number | undefined> {
  if (project.vpsBaseImageConfigName) {
    const tmpl = await getBaseImageTemplateByName(project.vpsBaseImageConfigName);
    if (tmpl?.snapshotId) return tmpl.snapshotId;
  }
  if (project.vpsBaseImageId) return project.vpsBaseImageId;
  const defaultTmpl = await getBaseImageTemplateByName("default");
  if (defaultTmpl?.snapshotId) return defaultTmpl.snapshotId;
  return undefined;
}

// --- Composed settings (for settings:get handler) ---

// Role enum lives in ws-acl; we accept the same string shape here without
// importing it, since settings-service is consumed by both server and tools.
type SettingsRole = "user" | "tazcloud" | "admin" | "superadmin" | null | undefined;

function isAdminRole(role: SettingsRole): boolean {
  return role === "admin" || role === "superadmin";
}

export async function getComposedSettings(userId: string, role?: SettingsRole): Promise<Record<string, unknown>> {
  const db = getDb();
  const [user] = await db.select({ defaultEditor: users.defaultEditor }).from(users).where(eq(users.id, userId)).limit(1);
  const globalDefaultEditor = await getGlobalDefaultEditor();

  // Per-user fields — always returned, including for non-admins.
  const base = {
    defaultEditor: user?.defaultEditor || globalDefaultEditor || "",
  };

  // Global / shared fields — only returned to admins. Non-admins still get
  // empty placeholders so the renderer's typed AppSettings shape is satisfied.
  if (!isAdminRole(role)) {
    return {
      ...base,
      digitaloceanApiToken: "",
      gitlabDeployKey: "",
      railwayToken: "",
      railwayProjectId: "",
    };
  }

  const globalDoToken = await getGlobalDoToken();
  const globalGitlabDeployKey = await getGlobalGitlabDeployKey();
  const railwayToken = await getGlobalRailwayToken();
  const railwayProjectId = await getGlobalRailwayProjectId();

  return {
    ...base,
    digitaloceanApiToken: globalDoToken || "",
    gitlabDeployKey: globalGitlabDeployKey || "",
    railwayToken: railwayToken || "",
    railwayProjectId: railwayProjectId || "",
  };
}

// --- Routed save (for settings:save handler) ---
//
// Per-user fields (every authenticated user) vs global fields (admins only).
// Non-admin attempts to set global fields are silently dropped — the renderer
// gates this in the UI, but the server enforces it too so a hand-rolled WS
// message can't sneak admin-only writes.
const GLOBAL_FIELDS = new Set(["digitaloceanApiToken", "gitlabDeployKey", "railwayToken", "railwayProjectId"]);

export async function saveRoutedSettings(userId: string, fields: Record<string, unknown>, role?: SettingsRole): Promise<void> {
  const db = getDb();

  // Per-user fields
  const userUpdates: Record<string, unknown> = {};
  if ("defaultEditor" in fields) userUpdates.defaultEditor = fields.defaultEditor || null;

  if (Object.keys(userUpdates).length > 0) {
    await db.update(users).set(userUpdates).where(eq(users.id, userId));
  }

  // Global fields — admins only.
  if (isAdminRole(role)) {
    for (const key of GLOBAL_FIELDS) {
      if (key in fields) {
        await setGlobalSetting(key, fields[key] || "");
      }
    }
  }
}

// --- Ensure defaults + history table ---

export async function ensureBaseImageDefaults(): Promise<void> {
  const db = getDb();

  // Create history table if not exists
  await db.execute(sql`CREATE TABLE IF NOT EXISTS base_image_template_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored')),
    data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_base_image_tpl_hist_name ON base_image_template_history (template_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_base_image_tpl_hist_created ON base_image_template_history (created_at)`);

  // Seed default config + template if both are empty
  const configs = await getAllBaseImageConfigs();
  if (Object.keys(configs).length === 0) {
    await saveAllBaseImageConfigs({ default: DEFAULT_BASE_IMAGE_CONFIG });
  }
  const templates = await getAllBaseImageTemplates(true);
  const activeTemplates = Object.values(templates).filter((t) => !t.deletedAt);
  if (activeTemplates.length === 0) {
    await saveBaseImageTemplateByName("default", DEFAULT_BASE_IMAGE_TEMPLATE);
  }
}
