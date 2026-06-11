import { batch } from "subjecto";
import { sshStatsPostbackEnabled, sshStatsProbeEnabled } from "@/lib/ssh-stats-enabled";
import { tmuxKillSessionCommand, tmuxRenameCommand } from "@/lib/tmux-shell";
import { wsSend } from "@/lib/ws";
import {
  $attachVm,
  $doSnapshotsLoading,
  $railwayTestResult,
  $vpsDeploy,
  $vpsMonitor,
  $vpsStatsSync,
} from "../subjects/vps";
import type { VpsConnectionConfig, VpsInstanceState, VpsMetricSample, VpsStats } from "../types/vps";

// --- VPS deploy actions ---

export const DEFAULT_INSTANCE_STATE: VpsInstanceState = {
  deploying: false, tearingDown: false, hibernating: false, wakingUp: false, rebooting: false,
  progress: [], error: null, logs: null,
  startedAt: null, endedAt: null, stats: null, statsError: null,
  recipes: {},
  claudePlugins: {},
  // Seeded so the DeepSubject tracks this key from creation — a field added
  // only by a later mutation isn't reactive (subscribers never re-render).
  tmuxSessions: [],
  lastTmuxAt: null,
  tmuxProbeError: null,
};

export function ensureInstanceState(instanceId: string): void {
  const v = $vpsDeploy.getValue();
  if (!v.instances[instanceId]) {
    v.instances[instanceId] = { ...DEFAULT_INSTANCE_STATE };
  }
}

export function updateInstanceState(instanceId: string, updates: Partial<VpsInstanceState>): void {
  batch(() => {
    const v = $vpsDeploy.getValue();
    if (!v.instances[instanceId]) {
      v.instances[instanceId] = { ...DEFAULT_INSTANCE_STATE };
    }
    Object.assign(v.instances[instanceId], updates);
  });
}

export function testVpsConnection(connection: VpsConnectionConfig): void {
  $vpsDeploy.getValue().testResult = null;
  wsSend("vps:test-connection", connection);
}

/** Connect details for a generic ("bring-your-own") SSH server. */
export interface ConnectServerInput {
  host: string;
  port?: number;
  username: string;
  label?: string;
  authMethod: "genie-key" | "stored-key";
  /** Raw private key — only for authMethod === "stored-key". */
  privateKey?: string;
}

/** Validate a generic SSH connection (genie-key reuses the shared key path
 *  server-side; stored-key sends the pasted key for a one-off test). */
export function testServerConnection(input: ConnectServerInput): void {
  $vpsDeploy.getValue().testResult = null;
  wsSend("vps:test-connection", {
    host: input.host,
    port: input.port,
    username: input.username,
    authMethod: input.authMethod,
    ...(input.privateKey ? { privateKey: input.privateKey } : {}),
  });
}

/** Register a generic SSH server on a project (connect-only, no provisioning). */
export function connectServer(projectId: string, input: ConnectServerInput): void {
  wsSend("vps:connect", { projectId, ...input });
}

export function deployToVps(projectId: string, connection: VpsConnectionConfig, label?: string, instanceId?: string): void {
  const id = instanceId || crypto.randomUUID();
  $vpsDeploy.getValue().activeDeploys[id] = {
    projectId, instanceId: id, deploying: true, progress: [], error: null,
    startedAt: Date.now(), endedAt: null, failedDroplet: null, destroyingDroplet: false,
  };
  wsSend("vps:deploy", { projectId, connection, label, instanceId: id });
}

export function checkVpsStatus(projectId: string, instanceId: string): void {
  wsSend("vps:status", { projectId, instanceId });
}

export function teardownVps(projectId: string, instanceId: string): void {
  ensureInstanceState(instanceId);
  batch(() => {
    const inst = $vpsDeploy.getValue().instances[instanceId];
    inst.tearingDown = true;
    inst.progress = [];
    inst.error = null;
  });
  wsSend("vps:teardown", { projectId, instanceId });
}

export function hibernateVps(projectId: string, instanceId: string): void {
  ensureInstanceState(instanceId);
  batch(() => {
    const inst = $vpsDeploy.getValue().instances[instanceId];
    inst.hibernating = true;
    inst.progress = [];
    inst.error = null;
  });
  wsSend("vps:hibernate", { projectId, instanceId });
}

export function wakeVps(projectId: string, instanceId: string): void {
  ensureInstanceState(instanceId);
  batch(() => {
    const inst = $vpsDeploy.getValue().instances[instanceId];
    inst.wakingUp = true;
    inst.progress = [];
    inst.error = null;
  });
  wsSend("vps:wake", { projectId, instanceId });
}

/** Soft-reboot a DigitalOcean droplet (DO power-cycle, no SSH). */
export function rebootVps(projectId: string, instanceId: string): void {
  ensureInstanceState(instanceId);
  batch(() => {
    const inst = $vpsDeploy.getValue().instances[instanceId];
    inst.rebooting = true;
    inst.progress = [];
    inst.error = null;
  });
  wsSend("vps:reboot", { projectId, instanceId });
}

export function disconnectVps(projectId: string, instanceId: string): void {
  wsSend("vps:disconnect", { projectId, instanceId });
}

export function fetchVpsStats(projectId: string, instanceId: string): void {
  if (!sshStatsProbeEnabled()) return;
  wsSend("vps:stats", { projectId, instanceId });
}

/** One-shot SSH probe that enumerates live tmux sessions on the VM. The manager
 *  replies with `vm:conn:stats` (handled in handlers/vps.ts), which mirrors
 *  the session list onto $vmConnections + the instance deploy-state. Drives the
 *  Manage popup's tmux badge row; works without an open terminal connection. */
export function refreshVmTmuxSessions(
  projectId: string,
  instanceId: string,
  opts?: { force?: boolean },
): void {
  wsSend("vps:stats:refresh", { projectId, instanceId, force: opts?.force ?? false });
}

export async function killVmTmuxSession(
  projectId: string,
  instanceId: string,
  sessionName: string,
): Promise<{ output: string; error?: boolean }> {
  const result = await vpsExec(projectId, instanceId, tmuxKillSessionCommand(sessionName));
  refreshVmTmuxSessions(projectId, instanceId, { force: true });
  return result;
}

export async function renameVmTmuxSession(
  projectId: string,
  instanceId: string,
  sessionName: string,
  newName: string,
): Promise<{ output: string; error?: boolean }> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === sessionName) {
    return { output: "Invalid session name", error: true };
  }
  const result = await vpsExec(projectId, instanceId, tmuxRenameCommand(sessionName, trimmed));
  const output = result.output?.trim() ?? "";
  const looksFailed =
    result.error
    || /can't find session|session not found|no server running|rename verification failed|tmux: command not found/i.test(output);
  if (looksFailed) {
    return { output: output || "Rename failed", error: true };
  }
  refreshVmTmuxSessions(projectId, instanceId, { force: true });
  return { output, error: false };
}

// Live daemon stats (pushed by the VM over HTTPS, fanned out by the manager as
// `vps:stats:update`). Multiple UI surfaces — the Manage popup, the instance
// card, the topology graph, each open VM-connection window — can watch the same
// VM at once, but the browser has a single shared WS. Ref-count per key so one
// surface unmounting doesn't tear down another's subscription.
const watchRefs = new Map<string, number>();
const watchKey = (projectId: string, instanceId: string) => `${projectId}:${instanceId}`;

export function watchVpsStats(projectId: string, instanceId: string): void {
  if (!sshStatsPostbackEnabled()) return;
  const key = watchKey(projectId, instanceId);
  const n = (watchRefs.get(key) ?? 0) + 1;
  watchRefs.set(key, n);
  if (n === 1) wsSend("vps:stats:watch", { projectId, instanceId });
}

export function unwatchVpsStats(projectId: string, instanceId: string): void {
  const key = watchKey(projectId, instanceId);
  const n = (watchRefs.get(key) ?? 0) - 1;
  if (n <= 0) {
    watchRefs.delete(key);
    wsSend("vps:stats:unwatch", { projectId, instanceId });
  } else {
    watchRefs.set(key, n);
  }
}

/** Re-send watch messages after WS reconnect (manager drops watchers on disconnect). */
export function resubscribeVpsStatsWatches(): void {
  if (!sshStatsPostbackEnabled()) return;
  for (const key of watchRefs.keys()) {
    const sep = key.indexOf(":");
    if (sep <= 0) continue;
    const projectId = key.slice(0, sep);
    const instanceId = key.slice(sep + 1);
    wsSend("vps:stats:watch", { projectId, instanceId });
  }
}

/** Push the latest stats daemon + postback config to a VM and restart its
 *  service — without re-running the whole Genie Standard Setup recipe. */
export function syncVmStatsAgent(projectId: string, instanceId: string): void {
  const key = `${projectId}:${instanceId}`;
  $vpsStatsSync.next({
    ...$vpsStatsSync.getValue(),
    [key]: { running: true, message: "Syncing stats agent…", error: null },
  });
  wsSend("vps:stats:sync", { projectId, instanceId });
}

/** Load historical scalar metrics for all VMs the user can see (Monitor tab). */
export function loadVpsMonitor(hours = 1): void {
  $vpsMonitor.next({ ...$vpsMonitor.getValue(), loading: true, error: null, hours });
  wsSend("vps:monitor:load", { hours });
}

// --- Live Monitor chart feed ---------------------------------------------
// The Monitor tab seeds its charts from a one-shot history backfill
// (loadVpsMonitor) and then keeps them live by appending each pushed
// `vps:stats:update` sample — no periodic re-poll. Only VMs the Monitor tab is
// actively charting are tracked here; the stats handler fires for every watched
// surface (cards, topology, Manage popup), so this gate stops unrelated watches
// from growing the history store.
const monitorChartKeys = new Set<string>();

/** Replace the set of `${projectId}:${instanceId}` keys the Monitor tab charts. */
export function setMonitorChartKeys(keys: string[]): void {
  monitorChartKeys.clear();
  for (const k of keys) monitorChartKeys.add(k);
}

/** Append one live daemon sample to a charted VM's history, trimmed to the
 *  active window. No-op unless the Monitor tab is charting this VM. */
export function appendLiveMonitorSample(projectId: string, instanceId: string, stats: VpsStats): void {
  const key = watchKey(projectId, instanceId);
  if (!monitorChartKeys.has(key)) return;
  const mon = $vpsMonitor.getValue();
  const sample: VpsMetricSample = {
    // The broadcast carries no timestamp; the chart is ordinal (sampledAt isn't
    // plotted), so receive-time is accurate enough and keeps order ascending.
    sampledAt: new Date().toISOString(),
    cpuPercent: stats.cpuPercent,
    memPercent: stats.memPercent,
    diskPercent: stats.diskPercent,
    memUsedBytes: stats.memUsedBytes,
    diskUsedBytes: stats.diskUsedBytes,
  };
  const cutoff = Date.now() - mon.hours * 3_600_000;
  const next = [...(mon.history[key] ?? []), sample].filter((s) => Date.parse(s.sampledAt) >= cutoff);
  $vpsMonitor.next({ ...mon, history: { ...mon.history, [key]: next } });
}

export function fetchVpsStatsHistory(projectId: string, instanceId: string, hours = 1): void {
  wsSend("vps:stats:history", { projectId, instanceId, hours });
}

export function killVpsProcess(projectId: string, instanceId: string, pid: number): void {
  wsSend("vps:process:kill", { projectId, instanceId, pid });
}

/** (Re)write the genie-* MCP REST entries into the VM's .mcp.json so Claude on
 *  the VM can use them. Fire-and-forget; the Manage popup uses a request/response
 *  variant for feedback. */
export function installGenieMcps(projectId: string, instanceId: string): void {
  wsSend("mcp:install", { projectId, instanceId });
}

// execCallbacks is shared between vpsExec (sender) and the vps:exec:result
// handler. Exported so the handler can resolve pending promises.
export const execCallbacks = new Map<string, (output: string, error?: boolean) => void>();

export function vpsExec(projectId: string, instanceId: string, command: string): Promise<{ output: string; error?: boolean }> {
  const execId = crypto.randomUUID();
  return new Promise((resolve) => {
    execCallbacks.set(execId, (output, error) => resolve({ output, error }));
    wsSend("vps:exec", { projectId, instanceId, command, execId });
    // Timeout after 35s
    setTimeout(() => {
      if (execCallbacks.has(execId)) {
        execCallbacks.delete(execId);
        resolve({ output: "Command timed out", error: true });
      }
    }, 35_000);
  });
}

export function fetchVpsLogs(projectId: string, instanceId: string, serviceName?: string): void {
  wsSend("vps:logs", { projectId, instanceId, serviceName });
}

export function clearVpsDeployState(instanceId?: string): void {
  const v = $vpsDeploy.getValue();
  if (instanceId) {
    delete v.activeDeploys[instanceId];
  } else {
    batch(() => {
      v.activeDeploys = {};
      v.testResult = null;
    });
  }
}

/** Link an already-existing cloud VM to a Genie project without re-provisioning.
 *  Used by the "Link →" inline action in the unified Clouds panel. Server-side
 *  message: `vps:attach-existing` (admin-only); replies with
 *  `vps:attach-existing:ok` or `vps:attach-existing:error`. */
export function attachExistingVmToProject(
  projectId: string,
  provider: "digitalocean" | "tazcloud" | "hetzner",
  vmId: string | number,
  label?: string,
  /** When set, the VM is *moved*: its existing link is removed before attaching. */
  detachFrom?: { projectId: string; instanceId: string },
): void {
  $attachVm.next({ progress: [], status: "running", error: null });
  wsSend("vps:attach-existing", { projectId, provider, vmId, label, detachFrom });
}

/** Reset the attach modal's progress/result state (e.g. when it opens). */
export function resetAttachVm(): void {
  $attachVm.next({ progress: [], status: "idle", error: null });
}

export function destroyFailedDroplet(instanceId: string): void {
  const v = $vpsDeploy.getValue();
  const deploy = v.activeDeploys[instanceId];
  if (!deploy?.failedDroplet) return;
  deploy.destroyingDroplet = true;
  wsSend("do:destroy-failed-droplet", { dropletId: deploy.failedDroplet.dropletId, projectId: deploy.projectId, instanceId });
}

export function keepFailedDroplet(instanceId: string): void {
  const deploy = $vpsDeploy.getValue().activeDeploys[instanceId];
  if (!deploy) return;
  deploy.failedDroplet = null;
}

export function clearVpsInstanceState(instanceId: string): void {
  delete $vpsDeploy.getValue().instances[instanceId];
}

// --- DigitalOcean actions ---

export function validateDoToken(): void {
  wsSend("do:validate-token", {});
}

export function testRailwayToken(): void {
  $railwayTestResult.next(null);
  wsSend("admin:railway:test", {});
}

export function deployToDo(projectId: string, label?: string, instanceId?: string): void {
  deployToProvider(projectId, "digitalocean", label, instanceId);
}

type DeployProvider = "digitalocean" | "tazcloud" | "hetzner";

const DEPLOY_WS_TYPE: Record<DeployProvider, string> = {
  digitalocean: "do:deploy",
  tazcloud: "tazcloud:deploy",
  hetzner: "hetzner:deploy",
};

const CANCEL_WS_TYPE: Record<DeployProvider, string> = {
  digitalocean: "do:cancel",
  tazcloud: "tazcloud:cancel",
  hetzner: "hetzner:cancel",
};

export function deployToProvider(
  projectId: string,
  provider: DeployProvider,
  label?: string,
  instanceId?: string,
  /** Optional provider config overrides (region/location, size/type, image) —
   *  used by the Clouds deploy modal so the form's selection wins over the
   *  project's stored vps settings. */
  overrides?: { region?: string; size?: string; image?: string },
): void {
  const id = instanceId || crypto.randomUUID();
  $vpsDeploy.getValue().activeDeploys[id] = {
    projectId, instanceId: id, deploying: true, progress: [], error: null,
    startedAt: Date.now(), endedAt: null, failedDroplet: null, destroyingDroplet: false,
  };
  wsSend(DEPLOY_WS_TYPE[provider], { projectId, label, instanceId: id, ...(overrides ?? {}) });
}

export function cancelVpsDeploy(projectId: string, provider: DeployProvider = "digitalocean"): void {
  wsSend(CANCEL_WS_TYPE[provider], { projectId });
}

export function loadDoSnapshots(): void {
  $doSnapshotsLoading.next(true);
  wsSend("do:snapshots:list", {});
}

export function deleteDoSnapshot(snapshotId: number): void {
  wsSend("do:snapshot:delete", { snapshotId });
}

