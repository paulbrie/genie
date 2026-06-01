import { batch } from "subjecto";
import { sshStatsPostbackEnabled, sshStatsProbeEnabled } from "@/lib/ssh-stats-enabled";
import { wsSend } from "@/lib/ws";
import {
  $doSnapshotsLoading,
  $railwayTestResult,
  $vpsDeploy,
  $vpsMonitor,
  $vpsStatsSync,
} from "../subjects/vps";
import type { VpsConnectionConfig, VpsInstanceState } from "../types/vps";

// --- VPS deploy actions ---

export const DEFAULT_INSTANCE_STATE: VpsInstanceState = {
  deploying: false, tearingDown: false, hibernating: false, wakingUp: false, progress: [], error: null, logs: null,
  startedAt: null, endedAt: null, stats: null, statsError: null, deployLogs: [],
  recipes: {},
};

export function ensureInstanceState(instanceId: string): void {
  const v = $vpsDeploy.getValue();
  if (!v.instances[instanceId]) {
    v.instances[instanceId] = { ...DEFAULT_INSTANCE_STATE };
  }
}

export function updateInstanceState(instanceId: string, updates: Partial<VpsInstanceState>): void {
  const v = $vpsDeploy.getValue();
  if (!v.instances[instanceId]) {
    v.instances[instanceId] = { ...DEFAULT_INSTANCE_STATE };
  }
  Object.assign(v.instances[instanceId], updates);
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

export function disconnectVps(projectId: string, instanceId: string): void {
  wsSend("vps:disconnect", { projectId, instanceId });
}

export function fetchVpsStats(projectId: string, instanceId: string): void {
  if (!sshStatsProbeEnabled()) return;
  wsSend("vps:stats", { projectId, instanceId });
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

export function fetchVpsStatsHistory(projectId: string, instanceId: string, hours = 1): void {
  wsSend("vps:stats:history", { projectId, instanceId, hours });
}

export function killVpsProcess(projectId: string, instanceId: string, pid: number): void {
  wsSend("vps:process:kill", { projectId, instanceId, pid });
}

export function startMcpTunnel(projectId: string, instanceId: string): void {
  wsSend("mcp:tunnel:start", { projectId, instanceId });
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
  provider: "digitalocean" | "tazcloud",
  vmId: string | number,
  label?: string,
): void {
  wsSend("vps:attach-existing", { projectId, provider, vmId, label });
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

export function loadDeployLogs(projectId: string): void {
  wsSend("deploy:logs:list", { projectId });
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

export function deployToProvider(
  projectId: string,
  provider: "digitalocean" | "tazcloud",
  label?: string,
  instanceId?: string,
): void {
  const id = instanceId || crypto.randomUUID();
  $vpsDeploy.getValue().activeDeploys[id] = {
    projectId, instanceId: id, deploying: true, progress: [], error: null,
    startedAt: Date.now(), endedAt: null, failedDroplet: null, destroyingDroplet: false,
  };
  const wsType = provider === "tazcloud" ? "tazcloud:deploy" : "do:deploy";
  wsSend(wsType, { projectId, label, instanceId: id });
}

export function cancelVpsDeploy(projectId: string, provider: "digitalocean" | "tazcloud" = "digitalocean"): void {
  wsSend(provider === "tazcloud" ? "tazcloud:cancel" : "do:cancel", { projectId });
}

export function loadDoSnapshots(): void {
  $doSnapshotsLoading.next(true);
  wsSend("do:snapshots:list", {});
}

export function deleteDoSnapshot(snapshotId: number): void {
  wsSend("do:snapshot:delete", { snapshotId });
}

