import type { VpsStats } from "./vps";

// --- Admin types ---

export interface AdminColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  ordinalPosition: number;
}

export interface AdminDroplet {
  id: number;
  name: string;
  status: string;
  ip: string | null;
  region: string;
  size: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  createdAt: string | null;
  createdBy: string | null;
  projectId: string | null;
  projectName: string | null;
  /** Deletion lock — when true, only a superadmin can delete this droplet (typed-name confirm). Default false. */
  locked: boolean;
}

export interface AdminTazVm {
  id: string;
  name: string;
  status: string;
  /** Display + SSH host. Public IPv6 on legacy Taz; private IPv4 on vxlan-bastion
   *  tenants (reached by the manager over the WireGuard tunnel). */
  ipv6: string;
  /** True when `ipv6` is an RFC1918 private address — used by the UI to hide
   *  the "open in browser" link (the address isn't reachable from the user's
   *  browser without WireGuard/ingress) and to signal "this is a v2 VM". */
  isPrivateHost?: boolean;
  image?: string;
  size?: string;
  /** v2.0.0 TazCloud VXLAN project this VM belongs to (API `project_id`). */
  tazProjectId: string | null;
  /** Genie project this VM is attached to, if any. */
  projectId: string | null;
  projectName: string | null;
  /** Deletion lock — when true, only a superadmin can delete this VM (typed-name confirm). Default false. */
  locked: boolean;
  /** Present when the VM has a TazCloud ingress (custom-domain HTTPS) attached.
   *  Deletion is refused while ingress is registered — remove the ingress first. */
  ingress?: {
    domain: string;
    url?: string;
    status?: string;
    /** Shared anycast IP all TazCloud ingresses resolve to. Same value for every
     *  customer/VM/domain (188.213.48.229 today). */
    ip?: string;
    /** Human-readable "Add A record: foo.example.com -> 188.213.48.229" hint
     *  returned by the API; show it to the user so they know what DNS record
     *  to add. */
    dnsAction?: string;
  } | null;
}

/** A TazCloud snapshot — server-returned shape (see API.md "Get Snapshot"). */
export interface AdminTazSnapshot {
  id: string;
  name: string;
  sourceVmId: string;          // snake-cased `source_vm_id` from the API, normalised on receipt
  status: "pending" | "active" | "error";
  sizeGb: number;
  created: string;             // ISO-8601
}

/** v2.0.0 Taz tenant project (isolated VXLAN). Every VM belongs to one. */
export interface AdminTazProject {
  id: string;
  name: string;
  subnetCidr: string;
  networkId?: string;
  vmCount?: number;
  created: string;
}

export interface AdminTazState {
  vms: AdminTazVm[];
  loading: boolean;
  error: string | null;
  /** True while an `admin:tazcloud:create` request is in flight. The deploy
   *  form watches this to auto-close on success. */
  creating: boolean;
  /** Error from the latest create attempt — separate from `error` (which is
   *  the list-load error) so the create form can show a banner without
   *  clobbering list-load state. */
  createError: string | null;
  /** v2.0.0+ tenant projects. Empty array on legacy v6 tenants. */
  projects: AdminTazProject[];
  projectsLoading: boolean;
  projectsError: string | null;
  /** True while a create-project request is in flight. */
  projectCreating: boolean;
  /** Latest project create/delete error (banner-style). */
  projectError: string | null;
  /** Base OS images from `GET /v1/capabilities`. Falls back to hardcoded list when empty. */
  capabilityImages: string[];
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
  /** Per-VM stats keyed by vmId. Populated by `admin:tazcloud:stats`. */
  vmStats: Record<string, VpsStats>;
  /** Per-VM stats-probe error keyed by vmId. Set when an SSH probe fails so the
   *  card can show "stats unavailable" with the reason instead of a blank gap. */
  vmStatsErrors: Record<string, string>;
  /** True while the periodic stats refresh is in flight. */
  vmStatsLoading: boolean;
  /** Snapshot inventory + load state. Populated by `admin:tazcloud:snapshot:list`. */
  snapshots: AdminTazSnapshot[];
  snapshotsLoading: boolean;
  snapshotsError: string | null;
  /** Per-VM "creating snapshot" flag; cleared on `:created` or `:error`. */
  snapshotCreating: Record<string, boolean>;
  /** Latest create error (banner-style) — separate from list-load error. */
  snapshotCreateError: string | null;
  /** Per-VM "ingress register/remove in flight" flag — cleared on
   *  `admin:tazcloud:ingress:registered/removed/error`. */
  ingressBusy: Record<string, boolean>;
  /** Latest ingress operation error (banner-style). */
  ingressError: string | null;
}

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
  verified?: boolean;
  deletedAt?: string | null;
}

export interface TemplateHistoryEntry {
  id: string;
  templateName: string;
  action: string;
  data: BaseImageTemplate;
  createdAt: string;
}

export interface AdminBaseImageState {
  configs: Record<string, BaseImageConfig>;
  templates: Record<string, BaseImageTemplate>;
  deletedTemplates: Record<string, BaseImageTemplate>;
  buildingName: string | null;
  progress: string[];
  error: string | null;
  failedDropletId: number | null;
  failedDropletIp: string | null;
  history: TemplateHistoryEntry[];
}

export type DropletsSubTab = "instances" | "snapshots" | "templates" | "configs" | "sshkey";
export type AiSubTab = "costs" | "settings";

export interface AiUsageRow {
  id: string;
  userId: string | null;
  userName: string | null;
  modelId: string;
  modelLabel: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  source: string | null;
  createdAt: string;
}

export interface AiSettings {
  defaultModel: string;
  maxToolRounds: number;
}

export interface AdminAiState {
  subTab: AiSubTab;
  costs: AiUsageRow[];
  loading: boolean;
  error: string | null;
  settings: AiSettings;
  settingsLoading: boolean;
}

export interface AdminUser {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAgent: boolean;
  validated: boolean;
  role: "user" | "tazcloud" | "admin" | "superadmin";
  createdAt: string;
}

export interface AdminTeam {
  id: string;
  name: string;
  createdAt: string;
}

export interface AdminTeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: "member" | "owner" | "superadmin";
  joinedAt: string;
}

export type OrgRole = "owner" | "admin" | "member";

export interface AdminOrg {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  /** Role of the *current* user in this org. "owner" when superadmin sees an
   *  org they don't actually belong to (server hands back "owner" for ergonomics). */
  role?: OrgRole | null;
}

export interface AdminOrgMember {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

export interface ProjectMemberInfo {
  id: string;
  projectId: string;
  userId: string;
  role: "owner" | "member";
  addedBy: string | null;
  joinedAt: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string | null;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string;
  serviceId: string;
  serviceName: string;
}

export interface RailwayLogEntry {
  timestamp: string;
  message: string;
  severity: string;
}

export interface AdminState {
  activeTab: "database" | "droplets" | "ai" | "backup" | "users" | "teams" | "orgs" | "audit" | "prodlogs";
  dropletsSubTab: DropletsSubTab;
  ai: AdminAiState;
  tables: { name: string; rowCount: number }[];
  selectedTable: string | null;
  columns: AdminColumnInfo[];
  primaryKey: string | null;
  rows: Record<string, any>[];
  totalCount: number;
  page: number;
  pageSize: number;
  orderBy: string | null;
  orderDir: "asc" | "desc";
  loading: boolean;
  drawerOpen: boolean;
  drawerMode: "edit" | "create";
  drawerRow: Record<string, any> | null;
  sqlQuery: string;
  sqlResult: { rows: Record<string, any>[]; columns: string[]; rowCount: number } | null;
  sqlError: string | null;
  sqlLoading: boolean;
  sqlOpen: boolean;
  droplets: AdminDroplet[];
  dropletsLoading: boolean;
  dropletsError: string | null;
  /** True while an `admin:droplets:create` request is in flight. The deploy
   *  form watches this to auto-close on success. */
  dropletsCreating: boolean;
  /** Error from the latest create attempt — separate from `dropletsError`
   *  (list-load) so the deploy form can show a dedicated banner. */
  dropletsCreateError: string | null;
  dropletStats: Record<number, VpsStats>;
  /** Per-droplet resize progress. Keyed by dropletId. While present, the row
   *  shows a streaming progress strip and other actions are disabled.
   *  Entries are cleared on `:done` or `:error`. */
  dropletResize: Record<number, { messages: string[]; targetSize: string; error: string | null; done: boolean }>;
  tazcloud: AdminTazState;
  baseImage: AdminBaseImageState;
  sshKey: {
    exists: boolean;
    publicKey: string | null;
    fingerprint: string | null;
    createdAt: string | null;
    history: { publicKey: string; fingerprint: string; createdAt: string; archivedAt: string }[];
    loading: boolean;
    regenerating: boolean;
  };
  drizzlePush: {
    running: boolean;
    output: string;
    open: boolean;
  };
  backups: {
    files: { name: string; size: number; createdAt: string }[];
    loading: boolean;
    creating: boolean;
  };
  users: {
    list: AdminUser[];
    loading: boolean;
  };
  teams: {
    list: AdminTeam[];
    members: AdminTeamMember[];
    loading: boolean;
  };
  orgs: {
    list: AdminOrg[];
    members: Record<string, AdminOrgMember[]>;
    loading: boolean;
    selectedOrgId: string | null;
  };
  /** Members of individual projects, keyed by projectId. Populated on demand
   *  when the project-detail Members section is opened. */
  projectMembers: Record<string, ProjectMemberInfo[]>;
  audit: {
    logs: AuditLogEntry[];
    loading: boolean;
    filterUserId: string | null;
    filterAction: string | null;
  };
  prodlogs: {
    deployments: RailwayDeployment[];
    logs: RailwayLogEntry[];
    selectedDeploymentId: string | null;
    logType: "deploy" | "build";
    loading: boolean;
    logsLoading: boolean;
  };
}

// --- Security Types ---

export type ScanStatus = "idle" | "running" | "stopping" | "completed" | "error";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface PortResult {
  port: number;
  state: "open" | "closed" | "filtered";
  service: string;
  banner?: string;
}

export interface WebFinding {
  id: string;
  category: "header" | "directory" | "ssl" | "disclosure" | "sqli" | "xss" | "redirect" | "cors" | "cookie" | "method" | "host" | "ssti" | "other";
  severity: Severity;
  title: string;
  description: string;
  url: string;
  evidence?: string;
}

export interface SecurityScan {
  id: string;
  target: string;
  status: ScanStatus;
  startedAt: number;
  completedAt?: number;
  progress: number;
  phase: string;
  ports: PortResult[];
  findings: WebFinding[];
  operations: string[];
  error?: string;
}

export interface SecurityState {
  target: string;
  activeScanId: string | null;
  scans: SecurityScan[];
}
