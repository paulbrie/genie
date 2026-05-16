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
}

export interface AdminTazVm {
  id: string;
  name: string;
  status: string;
  ipv6: string;
  image?: string;
  size?: string;
  projectId: string | null;
  projectName: string | null;
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
  /** Per-VM stats keyed by vmId. Populated by `admin:tazcloud:stats`. */
  vmStats: Record<string, VpsStats>;
  /** True while the periodic stats refresh is in flight. */
  vmStatsLoading: boolean;
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
  role: "user" | "admin" | "superadmin";
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
  activeTab: "database" | "droplets" | "ai" | "backup" | "users" | "teams" | "audit" | "prodlogs";
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
