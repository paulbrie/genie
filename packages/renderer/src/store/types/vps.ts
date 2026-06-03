import type { ProcessStatus } from "./common";

// --- VPS / project / terminal types ---

export interface VpsConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
}

export interface VpsServiceInfo {
  name: string;
  service: string;
  status: string;
  state: string;
  ports: string;
}

export interface VpsProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cpu: number;
  mem: number;
  user: string;
  port: string;
}

export interface VpsStats {
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
  processes: VpsProcessInfo[];
  openPorts: number[];
  externalPorts: number[];
}

/** Scalar row from vps_metric_samples (Postgres history). */
export interface VpsMetricSample {
  sampledAt: string;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  memUsedBytes: number;
  diskUsedBytes: number;
}

export interface VpsMonitorState {
  history: Record<string, VpsMetricSample[]>;
  hours: number;
  loading: boolean;
  error: string | null;
}

export interface DoDropletInfo {
  dropletId: number;
  ipAddress: string;
  region: string;
  size: string;
}

export interface TazVmInfo {
  vmId: string;
  ipv6: string;
  image: string;
  size: string;
  sshUser: string;
}

export interface VpsInfo {
  connection: VpsConnectionConfig;
  services: VpsServiceInfo[];
  digitalocean?: DoDropletInfo;
  tazcloud?: TazVmInfo;
}

export interface VpsHibernateInfo {
  snapshotId: number;
  snapshotName: string;
  region: string;
  size: string;
  hibernatedAt: string;
}

export interface VpsInstance {
  id: string;
  label: string;
  connection: VpsConnectionConfig;
  services: VpsServiceInfo[];
  digitalocean?: DoDropletInfo;
  tazcloud?: TazVmInfo;
  deployFailed?: boolean;
  deployError?: string;
  hibernate?: VpsHibernateInfo;
  /** Present for a generic "bring-your-own" SSH server (neither cloud block).
   *  `genie-key` = the user authorized Genie's public key on the box;
   *  `stored-key` = an encrypted key row, materialized on the manager. */
  ssh?: SshServerInfo;
}

export interface SshServerInfo {
  authMethod: "genie-key" | "stored-key";
  credentialId?: string;
}

export interface DeployLogEntry {
  id: string;
  projectId: string;
  status: "running" | "success" | "error";
  progress: string[];
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RecipeState {
  recipeId: string;
  checking: boolean;
  installed: boolean | null;
  running: boolean;
  progress: string[];
  error: string | null;
}

export interface VpsInstanceState {
  deploying: boolean;
  tearingDown: boolean;
  hibernating: boolean;
  wakingUp: boolean;
  rebooting: boolean;
  progress: string[];
  error: string | null;
  logs: { serviceName: string | null; logs: string } | null;
  startedAt: number | null;
  endedAt: number | null;
  stats: VpsStats | null;
  statsError: string | null;
  deployLogs: DeployLogEntry[];
  recipes: Record<string, RecipeState>;
  /** Live tmux sessions on the VM, from the on-demand SSH probe
   *  (`vps:stats:refresh` → `vm:conn:stats`). Drives the Manage popup's tmux
   *  badge row. Undefined until the first probe completes. */
  tmuxSessions?: VmTmuxSession[];
  /** Set on every tmux probe response (success or error) — clears the probing spinner. */
  lastTmuxAt?: number | null;
  tmuxProbeError?: string | null;
}

export interface PendingDeploy {
  projectId: string;
  instanceId: string;
  deploying: boolean;
  progress: string[];
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  failedDroplet: { dropletId: number; ipAddress?: string } | null;
  destroyingDroplet: boolean;
}

export interface VpsDeployState {
  instances: Record<string, VpsInstanceState>;
  activeDeploys: Record<string, PendingDeploy>;
  testResult: { ok: boolean; hostname?: string; error?: string } | null;
  deployLogs: DeployLogEntry[];
}

export interface ProjectCommand {
  id: string;
  name: string;
  command: string;
  mode?: "inline" | "terminal";
}

export interface ProjectDef {
  id: string;
  name: string;
  commands: ProjectCommand[];
  commandStatuses: Record<string, ProcessStatus>;
  vpsInstances: VpsInstance[];
  vpsProvider?: "digitalocean" | "tazcloud";
  vpsRegion?: string;
  vpsSize?: string;
  vpsImage?: string;
  vpsBaseImageId?: number;
  vpsBaseImageConfigName?: string;
  setupFiles?: Record<string, string>;
  doToken?: string;
  gitlabDeployKey?: string;
  dbUrl?: string;
  gitFolders?: string[];
  /** Owning team id (nullable for legacy / unassigned projects). Admins can
   *  reassign via the project settings form; normal users only see projects
   *  whose teamId is in their team membership set. */
  teamId?: string | null;
  /** Server-resolved team display name. Populated on list responses (see
   *  manager `project-service.ts → decorate()`). Read-only on the client —
   *  the source of truth is `teamId`. */
  teamName?: string | null;
}

export interface DoSnapshot {
  id: number;
  name: string;
  regions: string[];
  sizeGb?: number;
  createdAt?: string;
  minDiskSize?: number;
}

// --- Terminal types ---

export interface SshConfig {
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
}

export type TerminalLaunchKind = "shell" | "claude" | "claude-tmux" | "claude-direct";

export interface ClaudeLaunchOptions {
  cwd?: string;
  resume?: boolean;
}

export interface TerminalTab {
  id: string;
  title: string;
  /** Explicit launch mode; Claude uses server-side tmux `-c` + `claude` (no shell string). */
  kind?: TerminalLaunchKind;
  claudeLaunch?: ClaudeLaunchOptions;
  command?: string;
  cwd?: string;
  projectId?: string;
  commandId?: string;
  shared?: boolean;
  ownerId?: string;
  ownerName?: string;
  viewerIds?: string[];
  ssh?: SshConfig;
  /** True when this tab is reopening a persisted server-side session. The
   *  bottom panel sends `terminal:reattach` instead of a fresh spawn so the
   *  manager reuses the row + tmux session keyed by `id`. */
  reattach?: boolean;
  /** Set true when the manager reports a mid-session SSH drop
   *  (`terminal:disconnected`). Drives the inline "Connection lost" notice and
   *  the Reconnect affordance; cleared on a successful reattach/respawn. */
  disconnected?: boolean;
  /** Whether the dropped session is tmux-backed and can be reattached (shell /
   *  claude-tmux) vs not (plain claude). */
  reattachable?: boolean;
}

export interface PersistedTerminalSession {
  id: string;
  ownerId: string;
  kind: "shell" | "claude" | "claude-tmux";
  projectId: string | null;
  instanceId: string | null;
  vpsHost: string;
  commandLabel: string | null;
  hasSshConfig: boolean;
  createdAt: string;
  lastActivity: string;
}

export interface PersistedTerminalsState {
  sessions: PersistedTerminalSession[];
  loading: boolean;
  filters: {
    projectId: string | null;
    instanceId: string | null;
    vpsHost: string | null;
    /** Superadmin-only override. null = all users (server default for superadmin),
     *  a user id = that user, undefined = scope to caller (default for non-super). */
    ownerId: string | null | undefined;
  };
}

export interface TerminalShareInvite {
  sessionId: string;
  ownerId: string;
  ownerName: string;
  conversationId?: string;
}

export interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  shareInvites: TerminalShareInvite[];
}

// --- VM SSH connection (new terminal layer) ---

export interface VmTmuxSession {
  name: string;
  windows: number | null;
  attached: boolean | null;
}

export interface VmConnectionState {
  /** Stable key — `${projectId}:${instanceId}` for project-attached VMs,
   *  or `direct:${host}:${username}` for one-off direct SSH connections. */
  key: string;
  projectId: string | null;
  instanceId: string | null;
  host: string;
  port: number;
  username: string;
  vmLabel: string;
  /** terminalId driving the xterm in the popup. */
  terminalId: string;
  status: "connecting" | "connected" | "error" | "closed";
  errorMessage: string | null;
  bytesIn: number;
  bytesOut: number;
  stats: { cpu: number; mem: number; disk: number } | null;
  statsError: string | null;
  /** Interactive SSH login sessions on the VM (`who` count from the daemon). */
  sshSessions: number | null;
  tmuxSessions: VmTmuxSession[];
  lastStatsAt: number | null;
  /** Set only by the SSH tmux probe (`vm:conn:stats`), not daemon stats pushes. */
  lastTmuxAt: number | null;
  openedAt: number;
  /** Stored for reconnect after WS/SSH drop. */
  initialCommand?: string;
  tmuxIntent?: "new" | "attach";
  tmuxSessionName?: string;
  /** Direct SSH only — needed to re-dial after disconnect. */
  privateKeyPath?: string;
}

export interface VmConnectionsState {
  /** Keyed by `VmConnectionState.key`. */
  connections: Record<string, VmConnectionState>;
}
