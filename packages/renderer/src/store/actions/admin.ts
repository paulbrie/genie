import { batch } from "subjecto";
import { sshStatsProbeEnabled } from "@/lib/ssh-stats-enabled";
import { wsRequest, wsSend, onWsClose } from "@/lib/ws";
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

export function setAdminTab(tab: "database" | "droplets" | "ai" | "backup" | "users" | "teams" | "orgs" | "communication" | "audit" | "prodlogs"): void {
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
  if (!sshStatsProbeEnabled()) return;
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

/** Resize a droplet. The manager orchestrates power-off → resize → power-on
 *  and streams `admin:droplets:resize:progress` events back. `disk: true` also
 *  grows the disk (permanent, irreversible); `disk: false` resizes CPU/RAM
 *  only and can be undone later. */
export function resizeAdminDroplet(dropletId: number, size: string, disk: boolean): void {
  wsSend("admin:droplets:resize", { dropletId, size, disk });
}

/** Soft-reboot a droplet (DO `dropletAction(id, "reboot")` — OS-level shutdown
 *  + start). Streams `admin:droplets:reboot:progress` and finishes with
 *  `:done` / `:error`. Open SSH sessions will drop. */
export function rebootAdminDroplet(dropletId: number): void {
  batch(() => {
    const v = $admin.getValue();
    v.dropletReboot[dropletId] = { messages: [], error: null, done: false };
  });
  wsSend("admin:droplets:reboot", { dropletId });
}

// --- Droplet custom-domain actions ---
//
// Attaches a custom subdomain + automatic HTTPS to a DO droplet: the manager
// creates an A record at Namecheap (fqdn → droplet IP) and installs Caddy on
// the VM (auto Let's Encrypt). Server streams `admin:droplets:domain:progress`
// and finishes with `…:attached` / `…:detached` / `…:error`.

export function attachAdminDropletDomain(dropletId: number, fqdn: string, appPort?: number): void {
  batch(() => {
    const v = $admin.getValue();
    v.dropletDomainBusy[dropletId] = true;
    v.dropletDomainError = null;
    v.dropletDomainProgress[dropletId] = [];
  });
  wsSend("admin:droplets:domain:attach", { dropletId, fqdn, appPort });
}

export function detachAdminDropletDomain(dropletId: number): void {
  batch(() => {
    const v = $admin.getValue();
    v.dropletDomainBusy[dropletId] = true;
    v.dropletDomainError = null;
  });
  wsSend("admin:droplets:domain:detach", { dropletId });
}

// --- TazCloud actions ---

/** SSH-probe every ACTIVE TazCloud VM for runtime port info. Mirrors the
 *  droplet stats poll. */
export function loadAdminTazcloudStats(): void {
  if (!sshStatsProbeEnabled()) {
    batch(() => { $admin.getValue().tazcloud.vmStatsLoading = false; });
    return;
  }
  $admin.getValue().tazcloud.vmStatsLoading = true;
  wsSend("admin:tazcloud:stats", {});
}

export type AdminServerTunnelPayload =
  | { provider: "tazcloud"; vmId: string; host: string; sshUser: string }
  | { provider: "do"; dropletId: number; sshUser: string }
  | { projectId: string; instanceId: string };

/** Open exactly one manager-side SSH tunnel for this server (pinned until release). */
export function ensureAdminServerTunnel(payload: AdminServerTunnelPayload): void {
  wsSend("admin:server:tunnel:ensure", payload);
}

export function ensureAdminServerTunnelAsync(
  payload: AdminServerTunnelPayload,
  timeoutMs = 60_000,
): Promise<{ key: string; host: string; username: string }> {
  return wsRequest<{ key?: string; host?: string; username?: string; message?: string }>(
    "admin:server:tunnel:ensure",
    payload,
    timeoutMs,
  ).then((p) => {
    if (p.message && !p.key) throw new Error(p.message);
    if (!p.key || !p.host || !p.username) throw new Error("SSH tunnel failed");
    return { key: p.key, host: p.host, username: p.username };
  });
}

export function releaseAdminServerTunnel(payload: AdminServerTunnelPayload): void {
  wsSend("admin:server:tunnel:release", payload);
}

/** Create a bare TazCloud VM. Mirrors `createAdminDroplet`. Pass `snapshot_id`
 *  (mutually exclusive with `image`) to boot from an existing snapshot instead
 *  of a base image. `project_id` is required on v2.0.0 tenants with multi-project
 *  mode; the API auto-picks if exactly one project exists otherwise. */
export function createAdminTazVm(opts: { name: string; size: string; image?: string; snapshot_id?: string; project_id?: string }): void {
  batch(() => {
    const v = $admin.getValue();
    v.tazcloud.creating = true;
    v.tazcloud.createError = null;
  });
  wsSend("admin:tazcloud:create", opts);
}

// --- TazCloud project actions (v2.0.0+) ---

/** Fetch base OS images (and sizes) from TazCloud `/v1/capabilities`. */
export function loadTazCapabilities(): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.capabilitiesLoading = true;
    t.capabilitiesError = null;
  });
  wsSend("admin:tazcloud:capabilities", {});
}

/** Fetch all TazCloud projects (VXLAN tenant projects). Empty on legacy v6
 *  tenants — the server returns an empty list, not an error. */
export function loadTazProjects(): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.projectsLoading = true;
    t.projectsError = null;
  });
  wsSend("admin:tazcloud:project:list", {});
}

/** Create a new TazCloud project. Server replies with
 *  `admin:tazcloud:project:created` on success and a stale broadcast for refresh. */
export function createTazProject(name: string): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.projectCreating = true;
    t.projectError = null;
  });
  wsSend("admin:tazcloud:project:create", { name });
}

/** Delete a TazCloud project. Fails (409) if any VMs still exist in it —
 *  the API surfaces a specific message we relay to the UI. */
export function deleteTazProject(projectId: string): void {
  batch(() => { $admin.getValue().tazcloud.projectError = null; });
  wsSend("admin:tazcloud:project:delete", { projectId });
}

/** Rename a TazCloud VM — Genie's DB only (TazCloud's API doesn't support
 *  renaming). */
export function renameAdminTazVm(vmId: string, name: string): void {
  wsSend("admin:tazcloud:rename", { vmId, name });
}

// --- TazCloud snapshot actions ---

/** Fetch all TazCloud snapshots. The server responds with
 *  `admin:tazcloud:snapshot:list` (full list). */
export function loadTazSnapshots(): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.snapshotsLoading = true;
    t.snapshotsError = null;
  });
  wsSend("admin:tazcloud:snapshot:list", {});
}

/** Trigger snapshot creation. The server returns 202 immediately with a pending
 *  snapshot; status transitions to `active` in 1-5 min — list-stale broadcasts
 *  and the panel's pending-poll handle the refresh. */
export function createTazSnapshot(vmId: string, name: string, stopFirst: boolean): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.snapshotCreating[vmId] = true;
    t.snapshotCreateError = null;
  });
  wsSend("admin:tazcloud:snapshot:create", { vmId, name, stopFirst });
}

export function deleteTazSnapshot(snapshotId: string): void {
  wsSend("admin:tazcloud:snapshot:delete", { snapshotId });
}

// --- Ingress actions ---
//
// Attaching an ingress maps the VM's `app_port` (default 80) to a custom domain
// over HTTPS via TazCloud's shared edge (Traefik + Let's Encrypt). The DNS A
// record must point at 188.213.48.229 (shared anycast IP for all customers).

export function registerTazIngress(vmId: string, domain: string, appPort?: number): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.ingressBusy[vmId] = true;
    t.ingressError = null;
  });
  wsSend("admin:tazcloud:ingress:register", { vmId, domain, appPort });
}

export function removeTazIngress(vmId: string): void {
  batch(() => {
    const t = $admin.getValue().tazcloud;
    t.ingressBusy[vmId] = true;
    t.ingressError = null;
  });
  wsSend("admin:tazcloud:ingress:remove", { vmId });
}

// --- Lock actions ---
//
// Setting a lock can be done by any role with cloud-panel access (tazcloud+);
// clearing a lock is enforced superadmin-only by the server ACL. The UI hides
// the unlock control from non-superadmins to keep things obvious.

export function lockAdminDroplet(dropletId: number): void {
  wsSend("admin:droplets:lock", { dropletId });
}

export function unlockAdminDroplet(dropletId: number): void {
  wsSend("admin:droplets:unlock", { dropletId });
}

export function lockAdminTazVm(vmId: string): void {
  wsSend("admin:tazcloud:lock", { vmId });
}

export function unlockAdminTazVm(vmId: string): void {
  wsSend("admin:tazcloud:unlock", { vmId });
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

// When the WS drops (typically `tsx watch` restarting the dev manager), the
// manager will never send a `:result` for any in-flight exec — the corresponding
// SSH session on the server side died with the process. Without this drain,
// every pending promise sits for 15 minutes (the per-call timeout) and the
// Manage popup's gauges/services stay on "Loading…" even after the manager
// comes back up and new requests work fine.
onWsClose(() => {
  for (const [execId, pending] of pendingAdminExecs) {
    try { pending.resolve({ output: pending.output || "Connection lost (manager restarted)", error: true }); }
    catch { /* ignore */ }
    pendingAdminExecs.delete(execId);
  }
});

/** Internal — called by handlers. */
export function getPendingAdminExec(execId: string): PendingAdminExec | undefined {
  return pendingAdminExecs.get(execId);
}

/** Internal — handlers remove the entry on `:result`. */
export function deletePendingAdminExec(execId: string): void {
  pendingAdminExecs.delete(execId);
}

/** Tells the manager to force-close the SSH session for an in-flight admin exec.
 *  The manager replies with the normal `:result` (error: true), which resolves
 *  the pending promise — callers don't need a separate cancel callback. */
function attachAbort(execId: string, signal?: AbortSignal): void {
  if (!signal) return;
  if (signal.aborted) {
    wsSend("admin:exec:cancel", { execId });
    return;
  }
  signal.addEventListener("abort", () => {
    // Guard against races: the pending entry is gone the moment :result arrives.
    if (pendingAdminExecs.has(execId)) wsSend("admin:exec:cancel", { execId });
  }, { once: true });
}

/** Run a command on a DO droplet by id, as the genie user. Returns the
 *  combined stdout+stderr; `error` is true if the manager flagged an SSH or
 *  exec failure. `onChunk` streams output as it arrives. Pass `signal` to allow
 *  the caller to cancel the in-flight command — the manager closes the SSH
 *  session and the returned promise resolves with `error: true`. */
export function adminDropletExec(
  dropletId: number,
  command: string,
  onChunk?: ExecChunk,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const execId = crypto.randomUUID();
  return new Promise((resolve) => {
    pendingAdminExecs.set(execId, { resolve, onChunk, output: "" });
    wsSend("admin:droplets:exec", { dropletId, command, execId });
    attachAbort(execId, signal);
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

/** Run a command on a TazCloud VM. Passes the VM's known `host` so the manager
 *  doesn't have to hit the TazCloud API on every call — on v2 vxlan-bastion
 *  tenants this matters because the Manage popup fires 3-4 parallel probes on
 *  mount (gauges, services, ports, recipes) and each one was previously
 *  waiting on a fresh `/v1/vm/{id}` round-trip. */
export function adminTazcloudExec(
  vmId: string,
  sshUser: string,
  command: string,
  host?: string,
  onChunk?: ExecChunk,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const execId = crypto.randomUUID();
  return new Promise((resolve) => {
    pendingAdminExecs.set(execId, { resolve, onChunk, output: "" });
    wsSend("admin:tazcloud:exec", { vmId, sshUser, host, command, execId });
    attachAbort(execId, signal);
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

// --- Orgs Admin actions ---

export function loadAdminOrgs(): void {
  $admin.getValue().orgs.loading = true;
  wsSend("admin:orgs:list", {});
}

export function createOrg(name: string): void {
  wsSend("admin:orgs:create", { name });
}

export function updateOrg(orgId: string, name: string): void {
  wsSend("admin:orgs:update", { orgId, name });
}

export function deleteOrg(orgId: string): void {
  wsSend("admin:orgs:delete", { orgId });
}

export function selectOrg(orgId: string | null): void {
  $admin.getValue().orgs.selectedOrgId = orgId;
}

export function addOrgMember(orgId: string, userId: string, role: "owner" | "admin" | "member" = "member"): void {
  wsSend("admin:orgs:members:add", { orgId, userId, role });
}

export function removeOrgMember(orgId: string, userId: string): void {
  wsSend("admin:orgs:members:remove", { orgId, userId });
}

export function setOrgMemberRole(orgId: string, userId: string, role: "owner" | "admin" | "member"): void {
  wsSend("admin:orgs:members:set-role", { orgId, userId, role });
}

// --- Invite user ---

export function inviteUser(opts: { email: string; name?: string; role?: "user" | "tazcloud" | "admin" | "superadmin"; orgIds: string[] }): void {
  wsSend("admin:users:invite", opts);
}

// --- Project members ---

export function loadProjectMembers(projectId: string): void {
  wsSend("project:members:list", { projectId });
}

export function addProjectMember(projectId: string, userId: string, role: "owner" | "member" = "member"): void {
  wsSend("project:members:add", { projectId, userId, role });
}

export function removeProjectMember(projectId: string, userId: string): void {
  wsSend("project:members:remove", { projectId, userId });
}

export function setProjectMemberRole(projectId: string, userId: string, role: "owner" | "member"): void {
  wsSend("project:members:set-role", { projectId, userId, role });
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

// --- Communication actions ---

export function loadEmailLogs(): void {
  $admin.getValue().communication.loading = true;
  wsSend("admin:email:logs", {});
}

/** Send a platform email. Target either every validated user (`allUsers: true`)
 *  or an explicit set of user ids. The server writes one email-log row per
 *  recipient and replies with `admin:email:sent` (summary) + a fresh
 *  `admin:email:logs`, or `admin:email:send:error`. */
export function sendCommunicationEmail(opts: {
  allUsers: boolean;
  recipientUserIds: string[];
  subject: string;
  body: string;
}): void {
  batch(() => {
    const c = $admin.getValue().communication;
    c.sending = true;
    c.error = null;
    c.lastResult = null;
  });
  wsSend("admin:email:send", opts);
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
