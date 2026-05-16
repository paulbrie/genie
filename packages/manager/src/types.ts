export const VPS_SSH_USERNAME = "genie";

export type ProcessStatus = "running" | "stopped" | "crashed";

export type ConversationType = "dm" | "room";

export interface ProjectCommand {
  id: string;
  name: string;
  command: string;
  mode?: "inline" | "terminal";
}

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

export interface DoDropletInfo {
  dropletId: number;
  ipAddress: string;
  region: string;
  size: string;
}

export interface TazVmInfo {
  vmId: string;       // TazCloud VM UUID
  ipv6: string;       // public IPv6 (== ssh_host)
  image: string;      // ubuntu-22 / almalinux-9 / debian-12 / ubuntu-24
  size: string;       // small / medium / large / xlarge
  sshUser: string;    // ubuntu / debian / almalinux
}

export type VpsProvider = "digitalocean" | "tazcloud";

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
  hibernatedAt: string; // ISO timestamp
}

export interface VpsInstance {
  id: string;        // UUID
  label: string;     // "production", "staging", etc.
  connection: VpsConnectionConfig;
  services: VpsServiceInfo[];
  digitalocean?: DoDropletInfo;
  tazcloud?: TazVmInfo;
  deployFailed?: boolean;
  deployError?: string;
  hibernate?: VpsHibernateInfo;
}

export interface ProjectDef {
  id: string;
  name: string;
  commands: ProjectCommand[];
  commandStatuses: Record<string, ProcessStatus>;
  vpsInstances: VpsInstance[];
  vpsProvider?: VpsProvider;          // defaults to "digitalocean" on DB read
  vpsRegion?: string;                  // DO only
  vpsSize?: string;
  vpsImage?: string;                   // TazCloud only
  vpsBaseImageId?: number;
  vpsBaseImageConfigName?: string;
  setupFiles?: Record<string, string>;
  secrets?: { key: string; value: string }[];
  doToken?: string;
  gitlabDeployKey?: string;
  dbUrl?: string;
  gitFolders?: string[];
  teamId?: string | null;              // Owning team — required for normal users to see the project
  teamName?: string | null;            // Resolved team name (read-only, populated on list responses)
}

export interface WsMessage {
  type: string;
  payload: unknown;
}

export interface MemoryInfo {
  physical: number;    // total physical RAM in bytes
  used: number;        // memory used in bytes
  cached: number;      // file-cached in bytes
  swap: number;        // swap used in bytes
  appMem: number;      // app memory in bytes
  wired: number;       // wired/resident in bytes
  compressed: number;  // compressed in bytes
}

export interface SystemStats {
  cpu: number;
  mem: number;
  memory?: MemoryInfo;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cpu: number;
  mem: number;
  user: string;
  port: string;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  cpu: number;
  mem: number;
  memLimit: number;
  memPercent: number;
  project: string;
  service: string;
}

export interface DockerInfo {
  daemonRunning: boolean;
  containers: DockerContainerInfo[];
}

export interface StatsPayload {
  system: SystemStats;
  processes: ProcessInfo[];
  docker: DockerInfo;
}

// --- Chrome Extension types ---

export type ClientType = "web" | "chrome-extension";

export type DomAction =
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "read_text"
  | "read_attr"
  | "get_snapshot"
  | "navigate"
  | "wait_for";

export interface DomActionParams {
  selector?: string;
  value?: string;
  url?: string;
  attribute?: string;
  direction?: "up" | "down";
  amount?: number;
  timeout?: number;
}

export type DomActionExecutor = (
  action: DomAction,
  params: DomActionParams,
) => Promise<{ success: boolean; result: string }>;

// --- VPS Agent stdio message types ---

export interface AgentInitMessage {
  type: "init";
  apiKey: string;
  projectDir: string;
  maxToolRounds?: number;
}

export interface AgentChatMessage {
  type: "chat";
  messages: { role: "user" | "assistant"; content: string }[];
  context?: string;
  domSnapshot?: string;
}

export interface AgentStopMessage {
  type: "stop";
}

export interface AgentBrowserResultMessage {
  type: "browser:result";
  requestId: string;
  success: boolean;
  result: string;
}

export type AgentInboundMessage =
  | AgentInitMessage
  | AgentChatMessage
  | AgentStopMessage
  | AgentBrowserResultMessage;

export interface AgentReadyMessage {
  type: "ready";
}

export interface AgentTokenMessage {
  type: "token";
  token: string;
}

export interface AgentToolMessage {
  type: "tool";
  name: string;
  input: Record<string, unknown>;
  result: string;
}

export interface AgentDoneMessage {
  type: "done";
  fullContent: string;
}

export interface AgentErrorMessage {
  type: "error";
  message: string;
}

export interface AgentBrowserRequestMessage {
  type: "browser:request";
  requestId: string;
  action: string;
  params: Record<string, unknown>;
}

export interface AgentStoppedMessage {
  type: "stopped";
}

export type AgentOutboundMessage =
  | AgentReadyMessage
  | AgentTokenMessage
  | AgentToolMessage
  | AgentDoneMessage
  | AgentErrorMessage
  | AgentBrowserRequestMessage
  | AgentStoppedMessage;
