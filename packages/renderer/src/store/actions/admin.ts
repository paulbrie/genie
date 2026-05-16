import { batch } from "subjecto";
import { wsSend } from "@/lib/ws";
import { $admin } from "../subjects/admin";
import type {
  AdminUser,
  AiSettings,
  AiSubTab,
  BaseImageConfig,
  BaseImageTemplate,
  DropletsSubTab,
} from "../types/admin";

// --- Admin actions ---

export function loadAdminTables(): void {
  $admin.getValue().loading = true;
  wsSend("admin:tables", {});
}

export function selectAdminTable(tableName: string): void {
  const v = $admin.getValue();
  batch(() => {
    v.selectedTable = tableName;
    v.page = 1;
    v.orderBy = null;
    v.orderDir = "asc";
    v.rows = [];
    v.columns = [];
    v.primaryKey = null;
    v.loading = true;
  });
  wsSend("admin:table:columns", { tableName });
  wsSend("admin:table:rows", { tableName, page: 1, pageSize: v.pageSize });
}

export function loadAdminRows(page?: number): void {
  const v = $admin.getValue();
  if (!v.selectedTable) return;
  const p = page ?? v.page;
  batch(() => { v.page = p; v.loading = true; });
  wsSend("admin:table:rows", { tableName: v.selectedTable, page: p, pageSize: v.pageSize, orderBy: v.orderBy, orderDir: v.orderDir });
}

export function setAdminSort(column: string): void {
  const v = $admin.getValue();
  const newDir = v.orderBy === column ? (v.orderDir === "asc" ? "desc" : "asc") : "asc";
  batch(() => { v.orderBy = column; v.orderDir = newDir as "asc" | "desc"; v.page = 1; });
  loadAdminRows(1);
}

export function openAdminRowDrawer(mode: "edit" | "create", row?: Record<string, any>): void {
  batch(() => {
    const v = $admin.getValue();
    v.drawerOpen = true;
    v.drawerMode = mode;
    v.drawerRow = row ?? null;
  });
}

export function closeAdminRowDrawer(): void {
  batch(() => { const v = $admin.getValue(); v.drawerOpen = false; v.drawerRow = null; });
}

export function saveAdminRow(data: Record<string, any>): void {
  const v = $admin.getValue();
  if (!v.selectedTable) return;
  if (v.drawerMode === "create") {
    wsSend("admin:row:insert", { tableName: v.selectedTable, data });
  } else {
    if (!v.primaryKey) return;
    const pkVal = v.drawerRow?.[v.primaryKey];
    wsSend("admin:row:update", { tableName: v.selectedTable, pkCol: v.primaryKey, pkVal, data });
  }
}

export function deleteAdminRow(pkVal: string): void {
  const v = $admin.getValue();
  if (!v.selectedTable || !v.primaryKey) return;
  wsSend("admin:row:delete", { tableName: v.selectedTable, pkCol: v.primaryKey, pkVal });
}

export function executeAdminSql(query: string): void {
  batch(() => {
    const v = $admin.getValue();
    v.sqlQuery = query;
    v.sqlLoading = true;
    v.sqlError = null;
    v.sqlResult = null;
  });
  wsSend("admin:sql:execute", { query });
}

export function toggleAdminSqlPanel(): void {
  const v = $admin.getValue();
  v.sqlOpen = !v.sqlOpen;
}

export function setAdminTab(tab: "database" | "droplets" | "ai" | "backup" | "users" | "teams" | "audit" | "prodlogs"): void {
  $admin.getValue().activeTab = tab;
}

export function runDrizzlePush(): void {
  const v = $admin.getValue();
  if (v.drizzlePush.running) return;
  batch(() => {
    v.drizzlePush.running = true;
    v.drizzlePush.output = "";
    v.drizzlePush.open = true;
  });
  wsSend("admin:drizzle:push", {});
}

export function closeDrizzlePush(): void {
  $admin.getValue().drizzlePush.open = false;
}

export function loadBackups(): void {
  $admin.getValue().backups.loading = true;
  wsSend("admin:backups:list", {});
}

export function createBackup(): void {
  $admin.getValue().backups.creating = true;
  wsSend("admin:backups:create", {});
}

export function deleteBackup(name: string): void {
  wsSend("admin:backups:delete", { name });
}

export function loadAdminDroplets(): void {
  batch(() => { const v = $admin.getValue(); v.dropletsLoading = true; v.dropletsError = null; });
  wsSend("admin:droplets:list", {});
}

export function loadAdminTazVms(): void {
  batch(() => { const v = $admin.getValue(); v.tazcloud.loading = true; v.tazcloud.error = null; });
  wsSend("admin:tazcloud:list", {});
}

export function deleteAdminTazVm(vmId: string): void {
  wsSend("admin:tazcloud:delete", { vmId });
}

export function loadAdminDropletStats(): void {
  wsSend("admin:droplets:stats", {});
}

export function adminDeleteDroplet(dropletId: number): void {
  wsSend("admin:droplets:delete", { dropletId });
}

/** Create a bare DigitalOcean droplet via the manager. No Genie setup.sh runs —
 *  this is the admin "Deploy Droplet" button next to the project deploy flow.
 *  The server replies with `admin:droplets:created` (success) or
 *  `admin:droplets:create:error` (failure). */
export function createAdminDroplet(opts: { name: string; region: string; size: string; image: string }): void {
  batch(() => {
    const v = $admin.getValue();
    v.dropletsCreating = true;
    v.dropletsCreateError = null;
  });
  wsSend("admin:droplets:create", opts);
}

/** Rename a droplet — written to Genie's DB alias and best-effort propagated
 *  to DO via the API. The DB write is the source of truth. */
export function renameAdminDroplet(dropletId: number, name: string): void {
  wsSend("admin:droplets:rename", { dropletId, name });
}

// --- TazCloud actions ---

/** SSH-probe every ACTIVE TazCloud VM for runtime port info. Mirrors the
 *  droplet stats poll. */
export function loadAdminTazcloudStats(): void {
  $admin.getValue().tazcloud.vmStatsLoading = true;
  wsSend("admin:tazcloud:stats", {});
}

/** Create a bare TazCloud VM. Mirrors `createAdminDroplet`. */
export function createAdminTazVm(opts: { name: string; image: string; size: string }): void {
  batch(() => {
    const v = $admin.getValue();
    v.tazcloud.creating = true;
    v.tazcloud.createError = null;
  });
  wsSend("admin:tazcloud:create", opts);
}

/** Rename a TazCloud VM — Genie's DB only (TazCloud's API doesn't support
 *  renaming). */
export function renameAdminTazVm(vmId: string, name: string): void {
  wsSend("admin:tazcloud:rename", { vmId, name });
}

// --- Promise-based admin exec helpers ---
//
// Both droplet and TazCloud exec callbacks resolve once `:exec:result` arrives.
// Progress chunks are forwarded to the optional onChunk callback so long-running
// installs (apt etc.) can stream output. Mirrors `vpsExec` but with cloud-VM
// targeting (dropletId for DO, vmId+sshUser+host for Taz).

interface ExecResult { output: string; error?: boolean }
type ExecResolve = (r: ExecResult) => void;
type ExecChunk = (chunk: string) => void;

interface PendingAdminExec {
  resolve: ExecResolve;
  onChunk?: ExecChunk;
  output: string;
}

const pendingAdminExecs = new Map<string, PendingAdminExec>();

/** Internal — called by handlers. */
export function getPendingAdminExec(execId: string): PendingAdminExec | undefined {
  return pendingAdminExecs.get(execId);
}

/** Internal — handlers remove the entry on `:result`. */
export function deletePendingAdminExec(execId: string): void {
  pendingAdminExecs.delete(execId);
}

/** Run a command on a DO droplet by id, as the genie user. Returns the
 *  combined stdout+stderr; `error` is true if the manager flagged an SSH or
 *  exec failure. `onChunk` streams output as it arrives. */
export function adminDropletExec(dropletId: number, command: string, onChunk?: ExecChunk): Promise<ExecResult> {
  const execId = crypto.randomUUID();
  return new Promise((resolve) => {
    pendingAdminExecs.set(execId, { resolve, onChunk, output: "" });
    wsSend("admin:droplets:exec", { dropletId, command, execId });
    // Recipe installs can take many minutes — match the server-side
    // `idleTimeoutMs: 600_000` plus headroom.
    setTimeout(() => {
      const pending = pendingAdminExecs.get(execId);
      if (pending) {
        pendingAdminExecs.delete(execId);
        pending.resolve({ output: pending.output || "Command timed out", error: true });
      }
    }, 900_000);
  });
}

/** Run a command on a TazCloud VM. Passes the VM's known host so the manager
 *  doesn't have to hit the (sometimes flaky) TazCloud API on every call. */
export function adminTazcloudExec(
  vmId: string,
  sshUser: string,
  command: string,
  host?: string,
  onChunk?: ExecChunk,
): Promise<ExecResult> {
  const execId = crypto.randomUUID();
  return new Promise((resolve) => {
    pendingAdminExecs.set(execId, { resolve, onChunk, output: "" });
    wsSend("admin:tazcloud:exec", { vmId, sshUser, host, command, execId });
    setTimeout(() => {
      const pending = pendingAdminExecs.get(execId);
      if (pending) {
        pendingAdminExecs.delete(execId);
        pending.resolve({ output: pending.output || "Command timed out", error: true });
      }
    }, 900_000);
  });
}

// --- Base Image actions ---

export function destroyFailedBuildDroplet(dropletId: number): void {
  batch(() => {
    const v = $admin.getValue();
    v.baseImage.failedDropletId = null;
    v.baseImage.failedDropletIp = null;
  });
  wsSend("admin:baseimage:destroy-failed", { dropletId });
}

export function createAdminBaseImage(templateName: string): void {
  batch(() => {
    const v = $admin.getValue();
    v.baseImage.buildingName = templateName;
    v.baseImage.progress = [];
    v.baseImage.error = null;
    v.baseImage.failedDropletId = null;
    v.baseImage.failedDropletIp = null;
  });
  wsSend("admin:baseimage:create", { templateName });
}

export function testBaseImageTemplate(templateName: string): void {
  batch(() => {
    const v = $admin.getValue();
    v.baseImage.buildingName = templateName;
    v.baseImage.progress = [];
    v.baseImage.error = null;
    v.baseImage.failedDropletId = null;
    v.baseImage.failedDropletIp = null;
  });
  wsSend("admin:baseimage:test", { templateName });
}

export function loadBaseImageConfigs(): void {
  wsSend("admin:baseimage:configs:list", {});
}

export function saveBaseImageConfig(name: string, config: BaseImageConfig, originalName?: string): void {
  wsSend("admin:baseimage:config:save", { name, config, originalName });
}

export function deleteBaseImageConfig(name: string): void {
  wsSend("admin:baseimage:config:delete", { name });
}

export function saveBaseImageTemplate(name: string, template: BaseImageTemplate, originalName?: string): void {
  wsSend("admin:baseimage:template:save", { name, template, originalName });
}

export function deleteBaseImageTemplate(name: string): void {
  wsSend("admin:baseimage:template:delete", { name });
}

export function restoreBaseImageTemplate(name: string): void {
  wsSend("admin:baseimage:template:restore", { name });
}

export function hardDeleteBaseImageTemplate(name: string): void {
  wsSend("admin:baseimage:template:hard-delete", { name });
}

export function loadTemplateHistory(name?: string): void {
  wsSend("admin:baseimage:template:history", { name });
}

export function setDropletsSubTab(tab: DropletsSubTab): void {
  $admin.getValue().dropletsSubTab = tab;
}

export function loadSshKey(): void {
  $admin.getValue().sshKey.loading = true;
  wsSend("admin:sshkey:get", {});
}

export function regenerateSshKey(): void {
  $admin.getValue().sshKey.regenerating = true;
  wsSend("admin:sshkey:regenerate", {});
}

export function deleteSshKey(): void {
  $admin.getValue().sshKey.loading = true;
  wsSend("admin:sshkey:delete", {});
}

// --- AI Admin actions ---

export function setAiSubTab(tab: AiSubTab): void {
  $admin.getValue().ai.subTab = tab;
}

export function loadAiCosts(): void {
  batch(() => {
    const v = $admin.getValue();
    v.ai.loading = true;
    v.ai.error = null;
  });
  wsSend("admin:ai:costs", {});
}

export function loadAiSettings(): void {
  $admin.getValue().ai.settingsLoading = true;
  wsSend("admin:ai:settings:get", {});
}

export function saveAiSettings(settings: Partial<AiSettings>): void {
  wsSend("admin:ai:settings:save", settings);
}

// --- Users Admin actions ---

export function loadAdminUsers(): void {
  $admin.getValue().users.loading = true;
  wsSend("admin:users:list", {});
}

export function validateUser(userId: string, validated: boolean): void {
  wsSend("admin:users:validate", { userId, validated });
}

export function deleteUser(userId: string): void {
  wsSend("admin:users:delete", { userId });
}

export function saveUser(userId: string, data: Partial<AdminUser>): void {
  wsSend("admin:users:update", { userId, data });
}

// --- Teams Admin actions ---

export function loadAdminTeams(): void {
  $admin.getValue().teams.loading = true;
  wsSend("admin:teams:list", {});
}

export function createTeam(name: string): void {
  wsSend("admin:teams:create", { name });
}

export function updateTeam(teamId: string, name: string): void {
  wsSend("admin:teams:update", { teamId, name });
}

export function deleteTeam(teamId: string): void {
  wsSend("admin:teams:delete", { teamId });
}

export function addTeamMember(teamId: string, userId: string, role?: string): void {
  wsSend("admin:teams:add-member", { teamId, userId, role: role || "member" });
}

export function removeTeamMember(memberId: string): void {
  wsSend("admin:teams:remove-member", { memberId });
}

export function setTeamMemberRole(memberId: string, role: string): void {
  wsSend("admin:teams:set-role", { memberId, role });
}

export function loadAuditLogs(opts?: { userId?: string; action?: string }): void {
  const v = $admin.getValue();
  v.audit.loading = true;
  if (opts?.userId !== undefined) v.audit.filterUserId = opts.userId || null;
  if (opts?.action !== undefined) v.audit.filterAction = opts.action || null;
  wsSend("admin:audit:list", {
    userId: v.audit.filterUserId || undefined,
    action: v.audit.filterAction || undefined,
    limit: 200,
  });
}

// --- Prod Logs actions ---

export function loadProdDeployments(limit = 20): void {
  const v = $admin.getValue();
  v.prodlogs.loading = true;
  wsSend("admin:prodlogs:deployments", { limit });
}

export function loadProdLogs(deploymentId: string, logType: "deploy" | "build" = "deploy"): void {
  const v = $admin.getValue();
  batch(() => {
    v.prodlogs.selectedDeploymentId = deploymentId;
    v.prodlogs.logType = logType;
    v.prodlogs.logsLoading = true;
    v.prodlogs.logs = [];
  });
  wsSend("admin:prodlogs:logs", { deploymentId, logType, limit: 500 });
}
