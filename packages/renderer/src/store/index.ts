import { Subject } from "subjecto/core";
import { DeepSubject, batch } from "subjecto";
import { stripAnsi } from "@/lib/utils";
import { genie, type AppSettings, type DirEntry } from "@/lib/genie-api";
import { wsSend, getStoredToken, setStoredToken, sendAuthToken, disconnectWs } from "@/lib/ws";

// --- Types ---

export type ProcessStatus = "running" | "stopped" | "crashed";

export type ConversationType = "dm" | "room";

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

export interface DoDropletInfo {
  dropletId: number;
  ipAddress: string;
  region: string;
  size: string;
}

export interface VpsInfo {
  connection: VpsConnectionConfig;
  services: VpsServiceInfo[];
  digitalocean?: DoDropletInfo;
}

export interface VpsInstance {
  id: string;
  label: string;
  connection: VpsConnectionConfig;
  services: VpsServiceInfo[];
  digitalocean?: DoDropletInfo;
  deployFailed?: boolean;
  deployError?: string;
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
  progress: string[];
  error: string | null;
  logs: { serviceName: string | null; logs: string } | null;
  startedAt: number | null;
  endedAt: number | null;
  stats: VpsStats | null;
  statsError: string | null;
  deployLogs: DeployLogEntry[];
  recipes: Record<string, RecipeState>;
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
  vpsRegion?: string;
  vpsSize?: string;
  vpsBaseImageId?: number;
  vpsBaseImageConfigName?: string;
  setupFiles?: Record<string, string>;
  doToken?: string;
  gitlabDeployKey?: string;
  dbUrl?: string;
  gitFolders?: string[];
}

export interface DoSnapshot {
  id: number;
  name: string;
  regions: string[];
}

export interface AppDef {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  status: ProcessStatus;
}

export interface AppStats {
  cpu: number;
  mem: number;
  pid: number;
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

export interface MemoryInfo {
  physical: number;
  used: number;
  cached: number;
  swap: number;
  appMem: number;
  wired: number;
  compressed: number;
}

export interface FileExplorerState {
  open: boolean;
  currentPath: string;
  entries: DirEntry[];
  loading: boolean;
  error: string | null;
  history: string[];
  historyIndex: number;
  selectedEntry: string | null;
  renamingEntry: string | null;
  panelWidth: number;
}

export interface ToolUse {
  name: string;
  input: Record<string, string>;
  result: string;
}

export interface StreamingStep {
  content: string;
  toolUse?: ToolUse;
}

export interface ChatMessageUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  modelLabel: string;
  cost: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolUses?: ToolUse[];
  steps?: StreamingStep[];
  usage?: ChatMessageUsage;
}

export interface ClaudeInfo {
  model: string;
  email: string;
  plan: string;
  version: string;
}

export interface ChatSessionSummary {
  sessionId: string;
  projectId: string | null;
  modelId: string | null;
  userName: string | null;
  name: string | null;
  firstMessage: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  streamingSteps: StreamingStep[];
  toolUses: ToolUse[];
  statusText: string;
  modelId: string;
  maxToolRounds: number;
  toolRoundsUsed: number;
  claudeInfo: ClaudeInfo | null;
  sessions: ChatSessionSummary[];
  sessionsLoading: boolean;
  activeSessionId: string | null;
}

// --- Auth types ---

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  role: "user" | "admin" | "superadmin";
}

export interface AuthState {
  status: "loading" | "unauthenticated" | "authenticated";
  user: AuthUser | null;
  token: string | null;
}

// --- Conversation chat types ---

export interface ConversationMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  isAgent: boolean;
  content: string;
  metadata: string | null;
  replyToId: string | null;
  replyTo: { id: string; senderName: string; contentPreview: string } | null;
  editedAt: string | null;
  reactions: Record<string, string[]>;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage: {
    content: string;
    senderName: string;
    createdAt: string;
  } | null;
  members: ConversationMember[];
}

export interface ChatUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAgent: boolean;
  online: boolean;
}

export interface MentionNotification {
  id: string;
  conversationId: string;
  conversationName: string;
  senderName: string;
  content: string;
  createdAt: string;
}

export interface ConversationChatState {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: ConversationMessage[];
  members: ConversationMember[];
  loading: boolean;
  streamingContent: string;
  streamingConversationId: string | null;
  toolUses: ToolUse[];
  users: ChatUser[];
  mentionNotifications: MentionNotification[];
  unreadCounts: Record<string, number>;
  replyingTo: ConversationMessage | null;
  editingMessageId: string | null;
  hasMoreMessages: boolean;
  loadingOlder: boolean;
}

export interface FolderItem { id: string; parentId: string | null; name: string; updatedAt: string; projectId?: string | null; isPublic?: boolean; ownerId?: string; ownerName?: string; }
export interface DocShare { id: string; sharedWithUserId: string; sharedWithName: string; sharedWithAvatar: string | null; permission: "read" | "write"; createdAt: string; }
export interface DocItem { id: string; title: string; updatedAt: string; folderId?: string | null; permission?: "read" | "write"; ownerName?: string; ownerId?: string; projectId?: string | null; isPublic?: boolean; publicKey?: string | null; }

export interface DocsState {
  files: DocItem[];
  sharedFiles: DocItem[];
  publicFiles: DocItem[];
  folders: FolderItem[];
  publicFolders: FolderItem[];
  selectedDocId: string | null;
  title: string;
  content: string;
  folderId: string | null;
  isPublic: boolean;
  publicKey: string | null;
  projectId: string | null;
  editing: boolean;
  loading: boolean;
  permission: "read" | "write";
  isOwner: boolean;
  downloadingZip: boolean;
  activeShareDocId: string | null;
  currentDocShares: DocShare[];
}

// --- Tracker types ---

export type TrackerStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type TrackerPriority = "none" | "urgent" | "high" | "medium" | "low";
export type TrackerViewMode = "board" | "list";
export type TrackerGroupBy = "status" | "priority" | "assignee";

export interface TrackerLabel { id: string; name: string; color: string; }
export interface TrackerIssue {
  id: string;
  projectId: string;
  identifier: number;
  title: string;
  description: string;
  status: TrackerStatus;
  priority: TrackerPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  labels: TrackerLabel[];
  createdBy: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerFilters {
  status: TrackerStatus[];
  priority: TrackerPriority[];
  assigneeId: string[];
  labelId: string[];
}

export interface TrackerState {
  issues: TrackerIssue[];
  labels: TrackerLabel[];
  loading: boolean;
  viewMode: TrackerViewMode;
  groupBy: TrackerGroupBy;
  filters: TrackerFilters;
  selectedIssueId: string | null;
  selectedProjectId: string | null;
  showCreateForm: boolean;
}

// --- Floating window manager types ---

export type FloatingWindowStatus = "open" | "minimized" | "closed";

export interface FloatingWindowState {
  id: string;
  status: FloatingWindowStatus;
  title: string;
  icon: string;
  position: { x: number; y: number };
  zIndex: number;
  busy?: boolean;
}

export type NavKey = "apps" | "projects" | "processes" | "docker" | "docs" | "logs" | "terminal" | "chat" | "tracker" | "settings" | "admin" | "architecture";

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

export type DropletsSubTab = "instances" | "templates" | "configs" | "sshkey";
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
  dropletStats: Record<number, VpsStats>;
  baseImage: AdminBaseImageState;
  sshKey: {
    exists: boolean;
    publicKey: string | null;
    fingerprint: string | null;
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

interface UiState {
  activeNav: NavKey;
  selectedAppId: string | null;
  selectedProjectId: string | null;
  processSortBy: "cpu" | "mem";
  filterPortsOnly: boolean;
}

export interface LogsState {
  activeSource: string;
  sources: string[];
  buffers: Record<string, string>;
}

export interface SshConfig {
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
}

export interface TerminalTab {
  id: string;
  title: string;
  command?: string;
  cwd?: string;
  projectId?: string;
  commandId?: string;
  shared?: boolean;
  ownerId?: string;
  ownerName?: string;
  viewerIds?: string[];
  ssh?: SshConfig;
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

export interface FileEditorState {
  projectId: string | null;
  files: string[];
  selectedFile: string | null;
  content: string | null;
  savedContent: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export interface FileTemplate {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
  createdBy: string;
  createdAt: string;
}

export interface FileTemplatesState {
  templates: FileTemplate[];
  loading: boolean;
}

export interface WindowManagerState {
  windows: Record<string, FloatingWindowState>;
  nextZIndex: number;
}

export interface SystemState {
  cpu: number;
  mem: number;
  memory: MemoryInfo | null;
}

const MAX_LOG_BUFFER = 50000;
const UI_STATE_KEY = "genie-ui-state";

// --- Store (individual Subjects) ---

export const $auth = new Subject<AuthState>({ status: "loading", user: null, token: null });
export const $manager = new Subject<{ running: boolean }>({ running: false });
export const $apps = new Subject<AppDef[]>([]);
export const $appStats = new Subject<Record<string, AppStats>>({});
export const $selectedAppId = new Subject<string | null>(null);
export const $activeNav = new Subject<NavKey>("apps");
export const $processSortBy = new Subject<"cpu" | "mem">("mem");
export const $filterPortsOnly = new Subject<boolean>(false);
export const $system = new Subject<SystemState>({ cpu: 0, mem: 0, memory: null });
export const $processes = new Subject<ProcessInfo[]>([]);
export const $docker = new Subject<DockerInfo>({ daemonRunning: false, containers: [] });
export const $logBuffers = new Subject<Record<string, string>>({});
export const $viewingLogsFor = new Subject<string | null>(null);
export const $showAddForm = new Subject<boolean>(false);
export const $pendingRestoreAppId = new Subject<string | null>(null);
export const $fileExplorer = new Subject<FileExplorerState>({
  open: false, currentPath: "", entries: [], loading: false, error: null,
  history: [], historyIndex: -1, selectedEntry: null, renamingEntry: null, panelWidth: 380,
});
export const $chat = new Subject<ChatState>({
  messages: [], loading: false, streamingContent: "", streamingSteps: [],
  toolUses: [], statusText: "", modelId: "claude-code", maxToolRounds: 0, toolRoundsUsed: 0,
  claudeInfo: null, sessions: [], sessionsLoading: false, activeSessionId: null,
});
export const $conversationChat = new Subject<ConversationChatState>({
  conversations: [], activeConversationId: null, messages: [], members: [],
  loading: false, streamingContent: "", streamingConversationId: null, toolUses: [],
  users: [], mentionNotifications: [], unreadCounts: {}, replyingTo: null,
  editingMessageId: null, hasMoreMessages: false, loadingOlder: false,
});
export const $docs = new Subject<DocsState>({
  files: [], sharedFiles: [], publicFiles: [], folders: [], publicFolders: [],
  selectedDocId: null, title: "", content: "", folderId: null, isPublic: false,
  publicKey: null, projectId: null, editing: false, loading: false,
  permission: "write", isOwner: true, downloadingZip: false,
  activeShareDocId: null, currentDocShares: [],
});
export const $logs = new Subject<LogsState>({ activeSource: "manager", sources: ["manager"], buffers: {} });
export const $terminal = new Subject<TerminalState>({
  tabs: [], activeTabId: null, bottomPanelOpen: false, bottomPanelHeight: 200, shareInvites: [],
});
export const $settings = new Subject<AppSettings>({ defaultEditor: "", digitaloceanApiToken: "", gitlabDeployKey: "", gitToken: "", railwayToken: "", railwayProjectId: "" });
export const $projects = new Subject<ProjectDef[]>([]);
export const $selectedProjectId = new Subject<string | null>(null);
export const $showAddProjectForm = new Subject<boolean>(false);
export const $projectLogBuffers = new Subject<Record<string, string>>({});
export const $commandRunOutputs = new Subject<Record<string, { output: string; running: boolean; exitCode: number | null }>>({});
export const $doTokenValid = new Subject<{ valid: boolean; email?: string } | null>(null);
export const $railwayTestResult = new Subject<{ ok: boolean; message: string } | null>(null);
export const $doSnapshots = new Subject<DoSnapshot[]>([]);
export const $doSnapshotsLoading = new Subject<boolean>(false);
export const $vpsDeploy = new DeepSubject<VpsDeployState>({ instances: {}, activeDeploys: {}, testResult: null, deployLogs: [] });
export const $fileEditor = new Subject<FileEditorState>({
  projectId: null, files: [], selectedFile: null, content: null,
  savedContent: null, loading: false, saving: false, error: null,
});
export const $fileTemplates = new Subject<FileTemplatesState>({ templates: [], loading: false });
export const $tracker = new Subject<TrackerState>({
  issues: [], labels: [], loading: false, viewMode: "board", groupBy: "status",
  filters: { status: [], priority: [], assigneeId: [], labelId: [] },
  selectedIssueId: null, selectedProjectId: null, showCreateForm: false,
});
export const $admin = new DeepSubject<AdminState>({
  activeTab: "database", dropletsSubTab: "instances",
  tables: [], selectedTable: null, columns: [], primaryKey: null,
  rows: [], totalCount: 0, page: 1, pageSize: 50, orderBy: null, orderDir: "asc",
  loading: false, drawerOpen: false, drawerMode: "edit", drawerRow: null,
  sqlQuery: "", sqlResult: null, sqlError: null, sqlLoading: false, sqlOpen: false,
  droplets: [], dropletsLoading: false, dropletsError: null, dropletStats: {},
  baseImage: { configs: {}, templates: {}, deletedTemplates: {}, buildingName: null, progress: [], error: null, failedDropletId: null, failedDropletIp: null, history: [] },
  sshKey: { exists: false, publicKey: null, fingerprint: null, loading: false, regenerating: false },
  drizzlePush: { running: false, output: "", open: false },
  backups: { files: [], loading: false, creating: false },
  users: { list: [], loading: false },
  teams: { list: [], members: [], loading: false },
  audit: { logs: [], loading: false, filterUserId: null, filterAction: null },
  prodlogs: { deployments: [], logs: [], selectedDeploymentId: null, logType: "deploy", loading: false, logsLoading: false },
  ai: { subTab: "costs", costs: [], loading: false, error: null, settings: { defaultModel: "claude-sonnet", maxToolRounds: 10 }, settingsLoading: false },
});
export const $windowManager = new Subject<WindowManagerState>({ windows: {}, nextZIndex: 10000 });

// --- Actions ---

export function selectApp(id: string): void {
  const app = $apps.getValue().find((a) => a.id === id);
  if (!app) return;
  $selectedAppId.next(id);
  $viewingLogsFor.next(id);
  $activeNav.next("apps");
  $showAddForm.next(false);
  saveUiState();
}

export function deselectApp(): void {
  $selectedAppId.next(null);
  $viewingLogsFor.next(null);
  saveUiState();
}

export function switchNav(nav: NavKey): void {
  $activeNav.next(nav);
  if (nav !== "apps") $showAddForm.next(false);
  if (nav !== "projects") $showAddProjectForm.next(false);
  saveUiState();
}

export function toggleSort(): void {
  $processSortBy.next($processSortBy.getValue() === "cpu" ? "mem" : "cpu");
  saveUiState();
}

export function togglePortFilter(): void {
  $filterPortsOnly.next(!$filterPortsOnly.getValue());
  saveUiState();
}

export function showAddForm(): void {
  $selectedAppId.next(null);
  $viewingLogsFor.next(null);
  $activeNav.next("apps");
  $showAddForm.next(true);
}

export function hideAddForm(): void {
  $showAddForm.next(false);
}

export function clearLogs(appId: string): void {
  const bufs = $logBuffers.getValue();
  $logBuffers.next({ ...bufs, [appId]: "" });
}

// --- Project actions ---

export function selectProject(id: string): void {
  $selectedProjectId.next(id);
  $activeNav.next("projects");
  $showAddProjectForm.next(false);
  saveUiState();
}

export function deselectProject(): void {
  $selectedProjectId.next(null);
  saveUiState();
}

export function showAddProjectForm(): void {
  $selectedProjectId.next(null);
  $activeNav.next("projects");
  $showAddProjectForm.next(true);
}

export function hideAddProjectForm(): void {
  $showAddProjectForm.next(false);
}

export function runProjectCommand(projectId: string, commandId: string, instanceId: string): void {
  const key = `${projectId}:${commandId}`;
  const outputs = $commandRunOutputs.getValue();
  $commandRunOutputs.next({ ...outputs, [key]: { output: "", running: true, exitCode: null } });
  wsSend("project:command:run", { projectId, commandId, instanceId });
}

export function stopProjectCommand(projectId: string, commandId: string): void {
  wsSend("project:command:stop", { projectId, commandId });
}

// --- Logs actions ---

export function switchLogSource(source: string): void {
  $logs.nextAssign({ activeSource: source });
}

export function clearManagerLogs(): void {
  const l = $logs.getValue();
  $logs.next({ ...l, buffers: { ...l.buffers, [l.activeSource]: "" } });
  wsSend("logs:clear", { source: l.activeSource });
}

// --- Terminal actions ---

export function toggleTerminalBottomPanel(): void {
  const t = $terminal.getValue();
  $terminal.nextAssign({ bottomPanelOpen: !t.bottomPanelOpen });
}

export function setTerminalBottomPanelHeight(height: number): void {
  $terminal.nextAssign({ bottomPanelHeight: Math.max(100, Math.min(500, height)) });
}

let tabCounter = 0;

export function addTerminalTab(cwd?: string, title?: string, command?: string): string {
  tabCounter++;
  const id = `tab-${Date.now()}-${tabCounter}`;
  const tab: TerminalTab = { id, title: title ?? `Terminal ${tabCounter}`, cwd, command };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id, bottomPanelOpen: true });
  return id;
}

export function addSshTerminalTab(ssh: SshConfig, title?: string, command?: string): string {
  tabCounter++;
  const id = `tab-${Date.now()}-${tabCounter}`;
  const tab: TerminalTab = { id, title: title ?? `SSH ${ssh.host}`, ssh, command };
  const t = $terminal.getValue();
  $terminal.next({ ...t, tabs: [...t.tabs, tab], activeTabId: id, bottomPanelOpen: true });
  return id;
}

export function removeTerminalTab(id: string): void {
  const t = $terminal.getValue();
  const idx = t.tabs.findIndex((tab) => tab.id === id);
  if (idx === -1) return;
  const newTabs = t.tabs.filter((tab) => tab.id !== id);
  let newActiveId = t.activeTabId;
  let newOpen = t.bottomPanelOpen;
  if (t.activeTabId === id) {
    if (newTabs.length > 0) {
      newActiveId = newTabs[Math.min(idx, newTabs.length - 1)].id;
    } else {
      newActiveId = null;
      newOpen = false;
    }
  }
  $terminal.next({ ...t, tabs: newTabs, activeTabId: newActiveId, bottomPanelOpen: newOpen });
}

export function switchTerminalTab(id: string): void {
  $terminal.nextAssign({ activeTabId: id });
}

// --- Chat actions ---

export type ChatModelId = "claude-code" | "claude-opus" | "claude-sonnet" | "deepseek-v3" | "kimi-k2";

export const CHAT_MODELS: Record<ChatModelId, string> = {
  "claude-code": "Claude Code",
  "claude-opus": "Claude Opus",
  "claude-sonnet": "Claude Sonnet",
  "deepseek-v3": "DeepSeek V3",
  "kimi-k2": "Kimi K2.5",
};

export function setChatModel(modelId: ChatModelId): void {
  const c = $chat.getValue();
  if (c.modelId !== modelId) {
    $chat.next({ messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [], statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null, sessions: [], sessionsLoading: false, activeSessionId: null });
  }
}

export function sendChatMessage(text: string, context?: string, domSnapshot?: string): void {
  const c = $chat.getValue();
  const userMsg: ChatMessage = { role: "user", content: text };
  const newMessages = [...c.messages, userMsg];
  $chat.next({ ...c, messages: newMessages, loading: true, streamingContent: "", streamingSteps: [], toolRoundsUsed: 0 });
  const plain = newMessages.map((m: ChatMessage) => ({ role: m.role, content: m.content }));
  wsSend("chat:send", { messages: plain, context, domSnapshot, modelId: c.modelId });
}

export function stopChat(): void {
  const c = $chat.getValue();
  wsSend("chat:stop", {});
  const steps = [...c.streamingSteps];
  if (c.streamingContent) steps.push({ content: c.streamingContent });
  let newMessages = c.messages;
  if (steps.length > 0) {
    const toolUses = c.toolUses.length > 0 ? [...c.toolUses] : undefined;
    newMessages = [...c.messages, { role: "assistant" as const, content: steps.map(st => st.content).join(""), toolUses, steps }];
  }
  $chat.next({ ...c, messages: newMessages, streamingContent: "", streamingSteps: [], toolUses: [], loading: false, toolRoundsUsed: 0 });
}

export function resetChat(): void {
  const modelId = $chat.getValue().modelId;
  $chat.next({ messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [], statusText: "", modelId, maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null, sessions: [], sessionsLoading: false, activeSessionId: null });
}

export function loadChatSessions(): void {
  $chat.nextAssign({ sessionsLoading: true });
  wsSend("chat:sessions:list", {});
}

export function loadChatSession(sessionId: string): void {
  $chat.nextAssign({ loading: true, activeSessionId: sessionId });
  wsSend("chat:session:load", { sessionId });
}

export function newChat(): void {
  $chat.nextAssign({
    messages: [], loading: false, streamingContent: "", streamingSteps: [],
    toolUses: [], statusText: "", activeSessionId: null,
  });
}

export function renameChatSession(sessionId: string, name: string): void {
  wsSend("chat:session:rename", { sessionId, name });
}

export function deleteChatSession(sessionId: string): void {
  wsSend("chat:session:delete", { sessionId });
}

// --- Conversation Chat actions ---

export function loadConversations(): void {
  wsSend("chat:conversations:list", {});
}

export function loadChatUsers(): void {
  wsSend("chat:users:list", {});
}

export function selectConversation(id: string): void {
  const cc = $conversationChat.getValue();
  const { [id]: _, ...restCounts } = cc.unreadCounts;
  $conversationChat.next({
    ...cc, activeConversationId: id, messages: [], loading: true,
    streamingContent: "", toolUses: [],
    mentionNotifications: cc.mentionNotifications.filter((n) => n.conversationId !== id),
    unreadCounts: restCounts, hasMoreMessages: false, loadingOlder: false,
  });
  wsSend("chat:conversation:open", { conversationId: id, limit: 20 });
}

export function loadOlderMessages(): void {
  const cc = $conversationChat.getValue();
  const convId = cc.activeConversationId;
  if (!convId || cc.loadingOlder || !cc.hasMoreMessages) return;
  if (cc.messages.length === 0) return;
  $conversationChat.nextAssign({ loadingOlder: true });
  wsSend("chat:messages:load", { conversationId: convId, limit: 20, before: cc.messages[0].createdAt });
}

export function stopConversationChat(conversationId: string): void {
  wsSend("chat:message:stop", { conversationId });
  $conversationChat.nextAssign({ streamingContent: "", streamingConversationId: null, toolUses: [] });
}

export function sendConversationMessage(text: string): void {
  const cc = $conversationChat.getValue();
  const convId = cc.activeConversationId;
  if (!convId) return;
  const replyToId = cc.replyingTo?.id || undefined;
  wsSend("chat:message:send", { conversationId: convId, content: text, replyToId });
  $conversationChat.nextAssign({ replyingTo: null });
}

export function createGenieDm(): void {
  wsSend("chat:conversation:create", { type: "dm" });
}

export function createRoom(name: string, memberIds: string[]): void {
  wsSend("chat:conversation:create", { type: "room", name, memberIds });
}

export function addMemberToConversation(conversationId: string, userId: string): void {
  wsSend("chat:member:add", { conversationId, targetUserId: userId });
}

export function removeMemberFromConversation(conversationId: string, userId: string): void {
  wsSend("chat:member:remove", { conversationId, targetUserId: userId });
}

export function dismissMentionNotification(id: string): void {
  const cc = $conversationChat.getValue();
  $conversationChat.nextAssign({ mentionNotifications: cc.mentionNotifications.filter((n) => n.id !== id) });
}

export function dismissMentionsForConversation(conversationId: string): void {
  const cc = $conversationChat.getValue();
  $conversationChat.nextAssign({ mentionNotifications: cc.mentionNotifications.filter((n) => n.conversationId !== conversationId) });
}

// --- Reply / Edit / Reaction actions ---

export function setReplyingTo(message: ConversationMessage | null): void {
  $conversationChat.nextAssign({ replyingTo: message, editingMessageId: null });
}

export function startEditingMessage(messageId: string): void {
  $conversationChat.nextAssign({ editingMessageId: messageId, replyingTo: null });
}

export function cancelEditingMessage(): void {
  $conversationChat.nextAssign({ editingMessageId: null });
}

export function toggleReaction(conversationId: string, messageId: string, emoji: string): void {
  wsSend("chat:reaction:toggle", { conversationId, messageId, emoji });
}

export function sendEditedMessage(conversationId: string, messageId: string, content: string): void {
  wsSend("chat:message:edit", { conversationId, messageId, content });
  $conversationChat.nextAssign({ editingMessageId: null });
}

// --- Terminal sharing actions ---

export function shareTerminal(sessionId: string, targetUserId: string, conversationId?: string): void {
  wsSend("terminal:share", { sessionId, targetUserId, conversationId });
}

export function acceptTerminalShare(invite: TerminalShareInvite): void {
  tabCounter++;
  const tab: TerminalTab = {
    id: invite.sessionId, title: `${invite.ownerName}'s Terminal`,
    shared: true, ownerId: invite.ownerId, ownerName: invite.ownerName,
  };
  const t = $terminal.getValue();
  $terminal.next({
    ...t, tabs: [...t.tabs, tab], activeTabId: invite.sessionId,
    bottomPanelOpen: true, shareInvites: t.shareInvites.filter((i) => i.sessionId !== invite.sessionId),
  });
  wsSend("terminal:share:accept", { sessionId: invite.sessionId });
}

export function declineTerminalShare(sessionId: string): void {
  const t = $terminal.getValue();
  $terminal.nextAssign({ shareInvites: t.shareInvites.filter((i) => i.sessionId !== sessionId) });
}

export function leaveSharedTerminal(sessionId: string): void {
  wsSend("terminal:share:leave", { sessionId });
  removeTerminalTab(sessionId);
}

// --- Docs actions ---

export function loadDocsList(): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:list", {});
}

export function openDoc(docId: string): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:get", { docId });
}

export function saveDoc(docId: string, content: string, title?: string): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:save", { docId, content, title });
}

export function deleteDoc(docId: string): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:delete", { docId });
}

export function createNewDoc(title: string, folderId?: string | null, projectId?: string | null): void {
  $docs.nextAssign({ loading: true });
  wsSend("docs:create", { title, content: "", folderId: folderId || undefined, projectId: projectId || undefined });
}

export function createFolder(name: string, parentId?: string | null, projectId?: string | null): void {
  wsSend("docs:folder:create", { name, parentId: parentId || undefined, projectId: projectId || undefined });
}

export function renameFolder(folderId: string, name: string): void {
  wsSend("docs:folder:rename", { folderId, name });
}

export function deleteFolder(folderId: string): void {
  wsSend("docs:folder:delete", { folderId });
}

export function renameDoc(docId: string, title: string): void {
  wsSend("docs:save", { docId, title });
}

export function moveDoc(docId: string, folderId: string | null): void {
  wsSend("docs:move", { docId, folderId });
}

export function shareDoc(docId: string, targetUserId: string, permission: "read" | "write"): void {
  wsSend("docs:share", { docId, targetUserId, permission });
}

export function unshareDoc(docId: string, targetUserId: string): void {
  wsSend("docs:unshare", { docId, targetUserId });
}

export function openShareModal(docId: string): void {
  $docs.nextAssign({ activeShareDocId: docId, currentDocShares: [] });
  wsSend("docs:shares:get", { docId });
}

export function closeShareModal(): void {
  $docs.nextAssign({ activeShareDocId: null, currentDocShares: [] });
}

export function downloadAllDocs(): void {
  $docs.nextAssign({ downloadingZip: true });
  wsSend("docs:download:zip", {});
}

export function downloadDoc(docId: string): void {
  wsSend("docs:download:doc", { docId });
}

export function downloadFolder(folderId: string): void {
  wsSend("docs:download:folder", { folderId });
}

export function toggleDocPublic(docId: string): void {
  wsSend("docs:toggle-public", { docId });
}

export function toggleFolderPublic(folderId: string): void {
  wsSend("docs:folder:toggle-public", { folderId });
}

export function setDocProject(docId: string, projectId: string | null): void {
  wsSend("docs:set-project", { docId, projectId });
}

export function setFolderProject(folderId: string, projectId: string | null): void {
  wsSend("docs:folder:set-project", { folderId, projectId });
}

// --- Tracker actions ---

export function loadTrackerIssues(): void {
  $tracker.nextAssign({ loading: true });
  wsSend("tracker:list", {});
}

export function submitFeedback(title: string, description: string): void {
  wsSend("feedback:submit", { title, description });
}

export function createTrackerIssue(fields: {
  projectId: string;
  title: string;
  description?: string;
  status?: TrackerStatus;
  priority?: TrackerPriority;
  assigneeId?: string | null;
  labelIds?: string[];
}): void {
  wsSend("tracker:issue:create", fields);
}

export function updateTrackerIssue(issueId: string, fields: {
  title?: string;
  description?: string;
  status?: TrackerStatus;
  priority?: TrackerPriority;
  assigneeId?: string | null;
  labelIds?: string[];
  sortOrder?: number;
}): void {
  wsSend("tracker:issue:update", { issueId, ...fields });
}

export function deleteTrackerIssue(issueId: string): void {
  wsSend("tracker:issue:delete", { issueId });
}

export function reorderTrackerIssue(issueId: string, sortOrder: number): void {
  wsSend("tracker:issue:reorder", { issueId, sortOrder });
}

export function selectTrackerIssue(issueId: string | null): void {
  $tracker.nextAssign({ selectedIssueId: issueId });
}

export function setTrackerViewMode(mode: TrackerViewMode): void {
  $tracker.nextAssign({ viewMode: mode });
}

export function setTrackerGroupBy(groupBy: TrackerGroupBy): void {
  $tracker.nextAssign({ groupBy });
}

export function setTrackerFilters(filters: Partial<TrackerFilters>): void {
  const t = $tracker.getValue();
  $tracker.nextAssign({ filters: { ...t.filters, ...filters } });
}

export function clearTrackerFilters(): void {
  $tracker.nextAssign({ filters: { status: [], priority: [], assigneeId: [], labelId: [] } });
}

export function setTrackerProject(projectId: string | null): void {
  $tracker.nextAssign({ selectedProjectId: projectId });
}

export function showTrackerCreateForm(): void {
  $tracker.nextAssign({ showCreateForm: true });
}

export function hideTrackerCreateForm(): void {
  $tracker.nextAssign({ showCreateForm: false });
}

export function createTrackerLabel(name: string, color: string): void {
  wsSend("tracker:label:create", { name, color });
}

export function updateTrackerLabel(labelId: string, fields: { name?: string; color?: string }): void {
  wsSend("tracker:label:update", { labelId, ...fields });
}

export function deleteTrackerLabel(labelId: string): void {
  wsSend("tracker:label:delete", { labelId });
}

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

export function loadAdminDropletStats(): void {
  wsSend("admin:droplets:stats", {});
}

export function adminDeleteDroplet(dropletId: number): void {
  wsSend("admin:droplets:delete", { dropletId });
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

// --- Settings actions ---

export async function loadSettings(): Promise<void> {
  const result = await genie.getSettings();
  $settings.next({
    defaultEditor: result.defaultEditor || "",
    digitaloceanApiToken: result.digitaloceanApiToken || "",
    gitlabDeployKey: result.gitlabDeployKey || "",
    gitToken: result.gitToken || "",
    railwayToken: result.railwayToken || "",
    railwayProjectId: result.railwayProjectId || "",
  });
}

export async function saveSettingsField<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const s = $settings.getValue();
  const updated = { ...s, [key]: value };
  $settings.next(updated);
  await genie.saveSettings(updated);
}

// --- VPS deploy actions ---

const DEFAULT_INSTANCE_STATE: VpsInstanceState = {
  deploying: false, tearingDown: false, progress: [], error: null, logs: null,
  startedAt: null, endedAt: null, stats: null, statsError: null, deployLogs: [],
  recipes: {},
};

function ensureInstanceState(instanceId: string): void {
  const v = $vpsDeploy.getValue();
  if (!v.instances[instanceId]) {
    v.instances[instanceId] = { ...DEFAULT_INSTANCE_STATE };
  }
}

function updateInstanceState(instanceId: string, updates: Partial<VpsInstanceState>): void {
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

export function disconnectVps(projectId: string, instanceId: string): void {
  wsSend("vps:disconnect", { projectId, instanceId });
}

export function fetchVpsStats(projectId: string, instanceId: string): void {
  wsSend("vps:stats", { projectId, instanceId });
}

export function killVpsProcess(projectId: string, instanceId: string, pid: number): void {
  wsSend("vps:process:kill", { projectId, instanceId, pid });
}

export function checkVpsRecipe(projectId: string, instanceId: string, recipeId: string, checkScript: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  inst.recipes[recipeId] = { recipeId, checking: true, installed: null, running: false, progress: [], error: null };
  wsSend("vps:recipe:check", { projectId, instanceId, recipeId, script: checkScript });
}

export function uninstallVpsRecipe(projectId: string, instanceId: string, recipeId: string, script: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  inst.recipes[recipeId] = { recipeId, checking: false, installed: true, running: true, progress: [], error: null };
  wsSend("vps:recipe:uninstall", { projectId, instanceId, recipeId, script });
}

export function startMcpTunnel(projectId: string, instanceId: string): void {
  wsSend("mcp:tunnel:start", { projectId, instanceId });
}

export function runVpsRecipe(projectId: string, instanceId: string, recipeId: string, script: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  const existing = inst.recipes[recipeId];
  inst.recipes[recipeId] = { recipeId, checking: false, installed: existing?.installed ?? null, running: true, progress: [], error: null };
  wsSend("vps:recipe:run", { projectId, instanceId, recipeId, script });
}

const execCallbacks = new Map<string, (output: string, error?: boolean) => void>();

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
  const id = instanceId || crypto.randomUUID();
  $vpsDeploy.getValue().activeDeploys[id] = {
    projectId, instanceId: id, deploying: true, progress: [], error: null,
    startedAt: Date.now(), endedAt: null, failedDroplet: null, destroyingDroplet: false,
  };
  wsSend("do:deploy", { projectId, label, instanceId: id });
}

export function cancelVpsDeploy(projectId: string): void {
  wsSend("do:cancel", { projectId });
}

export function loadDoSnapshots(): void {
  $doSnapshotsLoading.next(true);
  wsSend("do:snapshots:list", {});
}

// --- File editor actions ---

export function loadProjectFiles(projectId: string): void {
  $fileEditor.next({ projectId, files: [], selectedFile: null, content: null, savedContent: null, loading: true, saving: false, error: null });
  wsSend("project-file:list", { projectId });
}

export function selectFile(fileName: string): void {
  const fe = $fileEditor.getValue();
  $fileEditor.nextAssign({ selectedFile: fileName, content: null, savedContent: null, loading: true, error: null });
  wsSend("project-file:read", { projectId: fe.projectId, fileName });
}

export function saveFile(content: string): void {
  const fe = $fileEditor.getValue();
  $fileEditor.nextAssign({ saving: true, error: null });
  wsSend("project-file:save", { projectId: fe.projectId, fileName: fe.selectedFile, content });
}

export function updateFileContent(content: string): void {
  $fileEditor.nextAssign({ content });
}

export function clearFileEditor(): void {
  $fileEditor.next({ projectId: null, files: [], selectedFile: null, content: null, savedContent: null, loading: false, saving: false, error: null });
}

export function deleteProjectFile(fileName: string): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:delete", { projectId: fe.projectId, fileName });
}

export function addProjectFile(fileName: string): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:add", { projectId: fe.projectId, fileName });
}

export function renameProjectFile(oldName: string, newName: string): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:rename", { projectId: fe.projectId, oldName, newName });
  $fileEditor.nextAssign({
    files: fe.files.map((f) => (f === oldName ? newName : f)),
    selectedFile: fe.selectedFile === oldName ? newName : fe.selectedFile,
  });
}

export function importProjectFilesFromDisk(): void {
  const fe = $fileEditor.getValue();
  if (!fe.projectId) return;
  wsSend("project-file:import-from-disk", { projectId: fe.projectId });
}

// --- File Template actions ---

export function loadFileTemplates(): void {
  $fileTemplates.nextAssign({ loading: true });
  wsSend("file-template:list", {});
}

export function createFileTemplate(name: string, description: string, files: Record<string, string>): void {
  wsSend("file-template:create", { name, description, files });
}

export function saveTemplateFromProject(projectId: string, name: string, description: string): void {
  wsSend("file-template:save-from-project", { projectId, name, description });
}

export function updateFileTemplate(id: string, patch: { name?: string; description?: string; files?: Record<string, string> }): void {
  wsSend("file-template:update", { id, ...patch });
}

export function deleteFileTemplate(id: string): void {
  wsSend("file-template:delete", { id });
}

export function injectFileTemplate(projectId: string, templateId: string, mode: "merge" | "replace"): void {
  wsSend("file-template:inject", { projectId, templateId, mode });
}

export function injectSingleFileFromTemplate(projectId: string, fileName: string, content: string): void {
  wsSend("project-file:save", { projectId, fileName, content });
}

// --- File Explorer actions ---

export async function toggleFileExplorer(): Promise<void> {
  const fe = $fileExplorer.getValue();
  $fileExplorer.nextAssign({ open: !fe.open });
  if (!fe.open && !fe.currentPath) {
    const home = await genie.getHomePath();
    await navigateTo(home);
  }
}

export async function navigateTo(dirPath: string): Promise<void> {
  $fileExplorer.nextAssign({ loading: true, error: null, selectedEntry: null, renamingEntry: null });
  const result = await genie.readDirectory(dirPath);
  const fe = $fileExplorer.getValue();
  if (result.ok && result.entries) {
    const newHistory = fe.history.slice(0, fe.historyIndex + 1);
    newHistory.push(dirPath);
    $fileExplorer.nextAssign({ entries: result.entries, currentPath: dirPath, history: newHistory, historyIndex: newHistory.length - 1, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export async function navigateBack(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (fe.historyIndex <= 0) return;
  const prevPath = fe.history[fe.historyIndex - 1];
  $fileExplorer.nextAssign({ loading: true, error: null, selectedEntry: null, renamingEntry: null });
  const result = await genie.readDirectory(prevPath);
  if (result.ok && result.entries) {
    $fileExplorer.nextAssign({ entries: result.entries, currentPath: prevPath, historyIndex: fe.historyIndex - 1, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export async function navigateForward(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (fe.historyIndex >= fe.history.length - 1) return;
  const nextPath = fe.history[fe.historyIndex + 1];
  $fileExplorer.nextAssign({ loading: true, error: null, selectedEntry: null, renamingEntry: null });
  const result = await genie.readDirectory(nextPath);
  if (result.ok && result.entries) {
    $fileExplorer.nextAssign({ entries: result.entries, currentPath: nextPath, historyIndex: fe.historyIndex + 1, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export async function navigateUp(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (!fe.currentPath || fe.currentPath === "/") return;
  const parent = fe.currentPath.replace(/\/[^/]+\/?$/, "") || "/";
  await navigateTo(parent);
}

export async function refreshDirectory(): Promise<void> {
  const fe = $fileExplorer.getValue();
  if (!fe.currentPath) return;
  $fileExplorer.nextAssign({ loading: true, error: null });
  const result = await genie.readDirectory(fe.currentPath);
  if (result.ok && result.entries) {
    $fileExplorer.nextAssign({ entries: result.entries, loading: false });
  } else {
    $fileExplorer.nextAssign({ error: result.error || "Failed to read directory", loading: false });
  }
}

export function selectFileEntry(entryPath: string | null): void {
  $fileExplorer.nextAssign({ selectedEntry: entryPath });
}

export function setRenamingEntry(entryPath: string | null): void {
  $fileExplorer.nextAssign({ renamingEntry: entryPath });
}

export function setFileExplorerPanelWidth(width: number): void {
  $fileExplorer.nextAssign({ panelWidth: Math.max(280, Math.min(800, width)) });
}

// --- WebSocket message handler ---

export function handleWsMessage(msg: { type: string; payload: any }): void {
  switch (msg.type) {
    case "app:list": {
      const newApps: AppDef[] = msg.payload.apps;
      $apps.next(newApps);

      // Restore saved app selection on first load
      const pending = $pendingRestoreAppId.getValue();
      if (pending) {
        const restoreApp = newApps.find((a) => a.id === pending);
        $pendingRestoreAppId.next(null);
        if (restoreApp) {
          selectApp(restoreApp.id);
          break;
        }
      }
      // If selected app was removed, deselect
      const selId = $selectedAppId.getValue();
      if (selId && !newApps.find((a) => a.id === selId)) {
        $selectedAppId.next(null);
        $viewingLogsFor.next(null);
      }
      break;
    }

    case "app:status": {
      const currentApps = $apps.getValue();
      $apps.next(currentApps.map((a) =>
        a.id === msg.payload.id ? { ...a, status: msg.payload.status } : a
      ));
      if (msg.payload.status === "crashed") {
        selectApp(msg.payload.id);
      }
      break;
    }

    case "app:log": {
      const logId = msg.payload.id;
      const clean = stripAnsi(msg.payload.data);
      const bufs = $logBuffers.getValue();
      let buf = (bufs[logId] || "") + clean;
      if (buf.length > MAX_LOG_BUFFER) {
        buf = buf.slice(-MAX_LOG_BUFFER);
      }
      $logBuffers.next({ ...bufs, [logId]: buf });
      break;
    }

    case "stats": {
      const sysUpdate: SystemState = {
        cpu: msg.payload.system.cpu,
        mem: msg.payload.system.mem,
        memory: msg.payload.system.memory || $system.getValue().memory,
      };
      $system.next(sysUpdate);
      $appStats.next(msg.payload.apps);
      if (msg.payload.processes) {
        $processes.next(msg.payload.processes);
      }
      if (msg.payload.docker) {
        $docker.next(msg.payload.docker);
      }
      break;
    }

    case "chat:token": {
      const c = $chat.getValue();
      $chat.next({ ...c, streamingContent: c.streamingContent + msg.payload.token, statusText: "" });
      break;
    }

    case "chat:tool": {
      const c = $chat.getValue();
      const tool: ToolUse = {
        name: msg.payload.name,
        input: msg.payload.input,
        result: msg.payload.result,
      };
      $chat.next({
        ...c,
        streamingSteps: [...c.streamingSteps, { content: c.streamingContent, toolUse: tool }],
        streamingContent: "",
        toolUses: [...c.toolUses, tool],
        toolRoundsUsed: c.toolRoundsUsed + 1,
      });
      break;
    }

    case "chat:done": {
      const c = $chat.getValue();
      const steps = [...c.streamingSteps];
      if (c.streamingContent) {
        steps.push({ content: c.streamingContent });
      }
      const toolUses = c.toolUses.length > 0 ? [...c.toolUses] : undefined;
      const usage = msg.payload.usage as ChatMessageUsage | undefined;
      $chat.next({
        ...c,
        messages: [...c.messages, {
          role: "assistant" as const,
          content: steps.map(st => st.content).join(""),
          toolUses,
          steps: steps.length > 0 ? steps : undefined,
          usage,
        }],
        streamingContent: "",
        streamingSteps: [],
        toolUses: [],
        loading: false,
        statusText: "",
        toolRoundsUsed: 0,
      });
      break;
    }

    case "chat:error": {
      const c = $chat.getValue();
      $chat.next({
        ...c,
        messages: [...c.messages, {
          role: "assistant" as const,
          content: `Error: ${msg.payload.message}`,
        }],
        streamingContent: "",
        streamingSteps: [],
        toolUses: [],
        loading: false,
        statusText: "",
        toolRoundsUsed: 0,
      });
      break;
    }

    case "chat:status": {
      $chat.nextAssign({ statusText: msg.payload.status || "" });
      break;
    }

    case "chat:meta": {
      if (msg.payload.maxToolRounds) {
        $chat.nextAssign({ maxToolRounds: msg.payload.maxToolRounds });
      }
      break;
    }

    case "chat:claude-info": {
      const prev = $chat.getValue().claudeInfo;
      $chat.nextAssign({
        claudeInfo: {
          model: msg.payload.model || prev?.model || "",
          email: msg.payload.email || prev?.email || "",
          plan: msg.payload.plan || prev?.plan || "",
          version: msg.payload.version || prev?.version || "",
        },
      });
      break;
    }

    case "chat:sessions:list": {
      $chat.nextAssign({
        sessions: msg.payload.sessions || [],
        sessionsLoading: false,
      });
      break;
    }

    case "chat:session:loaded": {
      const msgs = (msg.payload.messages || []).map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        toolUses: m.toolUses || undefined,
      }));
      $chat.nextAssign({
        messages: msgs,
        loading: false,
        activeSessionId: msg.payload.sessionId,
      });
      break;
    }

    case "chat:session:renamed": {
      const { sessionId, name } = msg.payload;
      const c = $chat.getValue();
      $chat.nextAssign({
        sessions: c.sessions.map((s) =>
          s.sessionId === sessionId ? { ...s, name } : s
        ),
      });
      break;
    }

    case "chat:session:deleted": {
      const { sessionId } = msg.payload;
      const c = $chat.getValue();
      $chat.nextAssign({
        sessions: c.sessions.filter((s) => s.sessionId !== sessionId),
        ...(c.activeSessionId === sessionId ? { activeSessionId: null, messages: [] } : {}),
      });
      break;
    }

    case "logs:data": {
      const { source, data } = msg.payload;
      const clean = stripAnsi(data);
      const l = $logs.getValue();
      let buf = (l.buffers[source] || "") + clean;
      if (buf.length > MAX_LOG_BUFFER) {
        buf = buf.slice(-MAX_LOG_BUFFER);
      }
      $logs.next({ ...l, buffers: { ...l.buffers, [source]: buf } });
      break;
    }

    case "logs:backlog": {
      const { source, data } = msg.payload;
      const l = $logs.getValue();
      $logs.next({ ...l, buffers: { ...l.buffers, [source]: stripAnsi(data) } });
      break;
    }

    case "logs:sources": {
      $logs.nextAssign({ sources: msg.payload.sources });
      break;
    }

    case "terminal:data": {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("genie:terminal:data", { detail: msg.payload })
        );
      }
      break;
    }

    case "terminal:exit": {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("genie:terminal:exit", { detail: msg.payload })
        );
      }
      break;
    }

    case "terminal:error": {
      console.error("Terminal error:", msg.payload.message);
      break;
    }

    case "terminal:sessions:list": {
      const { sessions } = msg.payload as {
        sessions: Array<{
          id: string;
          ownerId: string;
          ownerName: string;
          collaboratorIds: string[];
          isOwner: boolean;
          viewerIds: string[];
        }>;
      };
      if (sessions.length > 0) {
        const t = $terminal.getValue();
        const existingIds = new Set(t.tabs.map((tab) => tab.id));
        // Update viewerIds on existing tabs immutably
        let updatedTabs = t.tabs.map((tab) => {
          const sess = sessions.find((s) => s.id === tab.id);
          return sess ? { ...tab, viewerIds: sess.viewerIds } : tab;
        });
        const newTabs: TerminalTab[] = [];
        for (const sess of sessions) {
          if (existingIds.has(sess.id)) continue;
          newTabs.push({
            id: sess.id,
            title: sess.isOwner ? "Terminal (restored)" : `${sess.ownerName}'s Terminal`,
            shared: !sess.isOwner,
            ownerId: sess.ownerId,
            ownerName: sess.ownerName,
            viewerIds: sess.viewerIds,
          });
        }
        if (newTabs.length > 0) {
          updatedTabs = [...updatedTabs, ...newTabs];
          $terminal.next({
            ...t,
            tabs: updatedTabs,
            activeTabId: t.activeTabId || newTabs[0].id,
            bottomPanelOpen: true,
          });
        } else if (updatedTabs !== t.tabs) {
          $terminal.next({ ...t, tabs: updatedTabs });
        }
      }
      break;
    }

    case "project:list": {
      const newProjects: ProjectDef[] = msg.payload.projects;
      $projects.next(newProjects);
      const selProjId = $selectedProjectId.getValue();
      if (selProjId && !newProjects.find((p) => p.id === selProjId)) {
        $selectedProjectId.next(null);
      }
      break;
    }

    case "project:log": {
      const logKey = `${msg.payload.projectId}:${msg.payload.commandId}`;
      const clean = stripAnsi(msg.payload.data);
      const pBufs = $projectLogBuffers.getValue();
      let buf = (pBufs[logKey] || "") + clean;
      if (buf.length > MAX_LOG_BUFFER) {
        buf = buf.slice(-MAX_LOG_BUFFER);
      }
      $projectLogBuffers.next({ ...pBufs, [logKey]: buf });
      break;
    }

    case "project:command:started": {
      const key = `${msg.payload.projectId}:${msg.payload.commandId}`;
      const outputs = $commandRunOutputs.getValue();
      $commandRunOutputs.next({ ...outputs, [key]: { output: "", running: true, exitCode: null } });
      break;
    }

    case "project:command:output": {
      const key = `${msg.payload.projectId}:${msg.payload.commandId}`;
      const outputs = $commandRunOutputs.getValue();
      const prev = outputs[key] || { output: "", running: true, exitCode: null };
      let output = prev.output + msg.payload.data;
      if (output.length > MAX_LOG_BUFFER) output = output.slice(-MAX_LOG_BUFFER);
      $commandRunOutputs.next({ ...outputs, [key]: { ...prev, output } });
      break;
    }

    case "project:command:done": {
      const key = `${msg.payload.projectId}:${msg.payload.commandId}`;
      const outputs = $commandRunOutputs.getValue();
      const prev = outputs[key] || { output: "", running: false, exitCode: null };
      const errMsg = msg.payload.error ? `\n${msg.payload.error}` : "";
      $commandRunOutputs.next({ ...outputs, [key]: { output: prev.output + errMsg, running: false, exitCode: msg.payload.exitCode } });
      break;
    }

    case "project:command:terminal": {
      const { projectId, commandId, instanceId, commandName, command } = msg.payload;
      // Dispatch event for extension / main app to open an SSH terminal tab with the command
      window.dispatchEvent(new CustomEvent("genie:command:terminal", {
        detail: { projectId, instanceId, commandName, command },
      }));
      // Main app: open a terminal tab (the terminal panel will handle spawning SSH)
      const cmdTabId = addTerminalTab(undefined, commandName || "Command", undefined);
      const t = $terminal.getValue();
      const cmdTab = t.tabs.find((tab) => tab.id === cmdTabId);
      if (cmdTab) {
        $terminal.nextAssign({
          tabs: t.tabs.map((tab) =>
            tab.id === cmdTabId ? { ...tab, projectId, commandId: commandId as string, command } : tab,
          ),
        });
      }
      break;
    }

    // --- Auth messages ---

    case "auth:required": {
      // Server asks for auth — try stored token or show login
      const token = getStoredToken();
      if (token) {
        $auth.nextAssign({ status: "loading" });
        sendAuthToken(token);
      } else {
        $auth.nextAssign({ status: "unauthenticated" });
      }
      break;
    }

    case "auth:success": {
      const { token, user } = msg.payload;
      $auth.next({ status: "authenticated", user, token });
      setStoredToken(token);
      break;
    }

    case "auth:failed": {
      $auth.next({ status: "unauthenticated", user: null, token: null });
      setStoredToken(null);
      break;
    }

    case "auth:error": {
      console.warn("[auth]", msg.payload.message);
      $auth.next({ status: "unauthenticated", user: null, token: null });
      setStoredToken(null);
      break;
    }

    case "auth:logged-out": {
      $auth.next({ status: "unauthenticated", user: null, token: null });
      break;
    }

    case "auth:revoked": {
      setStoredToken(null);
      $auth.next({ status: "unauthenticated", user: null, token: null });
      disconnectWs();
      if (typeof window !== "undefined") {
        alert(msg.payload.message || "Your access has been revoked.");
      }
      break;
    }

    case "auth:google:url": {
      const { url } = msg.payload;
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      break;
    }

    // --- Conversation Chat messages ---

    case "chat:users:list": {
      $conversationChat.nextAssign({ users: msg.payload.users });
      break;
    }

    case "chat:presence": {
      // Re-fetch full user list so online status is accurate
      wsSend("chat:users:list", {});
      break;
    }

    case "chat:conversations:list": {
      $conversationChat.nextAssign({ conversations: msg.payload.conversations });
      break;
    }

    case "chat:conversation:created": {
      const { conversation } = msg.payload;
      // Auto-open the new conversation
      $conversationChat.nextAssign({
        activeConversationId: conversation.id,
        messages: [],
        loading: false,
      });
      break;
    }

    case "chat:messages:list": {
      const { conversationId, messages: msgs, members, hasMore } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        if (cc.loadingOlder) {
          // Prepend older messages
          $conversationChat.nextAssign({
            messages: [...msgs, ...cc.messages],
            loadingOlder: false,
            hasMoreMessages: hasMore ?? false,
            ...(members ? { members } : {}),
          });
        } else {
          // Initial load
          $conversationChat.nextAssign({
            messages: msgs,
            hasMoreMessages: msgs.length >= 20,
            loading: false,
            ...(members ? { members } : {}),
          });
        }
      }
      break;
    }

    case "chat:message:new": {
      const { conversationId, message } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({ messages: [...cc.messages, message] });
      } else {
        // Increment unread count for conversations we're not viewing
        $conversationChat.nextAssign({
          unreadCounts: {
            ...cc.unreadCounts,
            [conversationId]: (cc.unreadCounts[conversationId] || 0) + 1,
          },
        });
      }
      // Update conversation list preview immutably
      const convIdx = cc.conversations.findIndex((c) => c.id === conversationId);
      if (convIdx >= 0) {
        $conversationChat.nextAssign({
          conversations: cc.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessage: {
                    content: message.content.slice(0, 100),
                    senderName: message.senderName,
                    createdAt: message.createdAt,
                  },
                  updatedAt: message.createdAt,
                }
              : c
          ),
        });
      } else {
        // Conversation not in our list yet — re-fetch
        wsSend("chat:conversations:list", {});
      }
      break;
    }

    case "chat:message:token": {
      const { conversationId, token } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({
          streamingContent: cc.streamingContent + token,
          streamingConversationId: conversationId,
        });
      }
      break;
    }

    case "chat:message:done": {
      const { conversationId, message } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({
          messages: [...cc.messages, message],
          streamingContent: "",
          streamingConversationId: null,
          toolUses: [],
        });
      }
      // Update conversation list preview immutably
      $conversationChat.nextAssign({
        conversations: cc.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: {
                  content: message.content.slice(0, 100),
                  senderName: message.senderName,
                  createdAt: message.createdAt,
                },
              }
            : c
        ),
      });
      break;
    }

    case "chat:message:tool": {
      const { conversationId } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({
          toolUses: [...cc.toolUses, {
            name: msg.payload.name,
            input: msg.payload.input,
            result: msg.payload.result,
          }],
        });
      }
      break;
    }

    case "chat:members:updated": {
      const { conversationId, members: updatedMembers } = msg.payload;
      const cc = $conversationChat.getValue();
      // Update members if this is the active conversation
      const memberUpdate: Partial<ConversationChatState> = {};
      if (cc.activeConversationId === conversationId) {
        memberUpdate.members = updatedMembers;
      }
      // Update conversation summary members immutably
      memberUpdate.conversations = cc.conversations.map((c) =>
        c.id === conversationId ? { ...c, members: updatedMembers } : c
      );
      $conversationChat.nextAssign(memberUpdate);
      break;
    }

    case "chat:mention": {
      const { conversationId, conversationName, senderName, content, messageId } = msg.payload;
      const cc = $conversationChat.getValue();
      // Only add notification if not currently viewing that conversation
      if (cc.activeConversationId !== conversationId) {
        $conversationChat.nextAssign({
          mentionNotifications: [
            ...cc.mentionNotifications,
            {
              id: messageId || `mention-${Date.now()}`,
              conversationId,
              conversationName,
              senderName,
              content,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      break;
    }

    case "chat:reaction:updated": {
      const { conversationId, messageId, reactions } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({
          messages: cc.messages.map((m) =>
            m.id === messageId ? { ...m, reactions } : m
          ),
        });
      }
      break;
    }

    case "chat:message:edited": {
      const { conversationId, messageId, content, editedAt } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({
          messages: cc.messages.map((m) =>
            m.id === messageId ? { ...m, content, editedAt } : m
          ),
        });
      }
      break;
    }

    case "terminal:share:invite": {
      const { sessionId, ownerId, ownerName, conversationId } = msg.payload;
      const t = $terminal.getValue();
      $terminal.nextAssign({
        shareInvites: [
          ...t.shareInvites,
          { sessionId, ownerId, ownerName, conversationId },
        ],
      });
      break;
    }

    case "terminal:share:joined": {
      // Write scrollback history to the terminal
      const { sessionId, scrollback } = msg.payload;
      if (scrollback) {
        window.dispatchEvent(new CustomEvent("genie:terminal:scrollback", { detail: { sessionId, scrollback } }));
      }
      break;
    }

    case "terminal:share:viewers": {
      const { sessionId, viewerIds } = msg.payload;
      const t = $terminal.getValue();
      $terminal.nextAssign({
        tabs: t.tabs.map((tab) =>
          tab.id === sessionId ? { ...tab, viewerIds } : tab
        ),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("genie:terminal:share:viewers", { detail: { sessionId, viewerIds } }));
      }
      break;
    }

    case "terminal:share:revoked": {
      const { sessionId } = msg.payload;
      const t = $terminal.getValue();
      const newTabs = t.tabs.filter((tab) => tab.id !== sessionId);
      $terminal.next({
        ...t,
        tabs: newTabs,
        activeTabId: t.activeTabId === sessionId
          ? (newTabs.length > 0 ? newTabs[0].id : null)
          : t.activeTabId,
      });
      break;
    }

    case "chat:message:error": {
      const { conversationId, message: errMsg } = msg.payload;
      const cc = $conversationChat.getValue();
      if (cc.activeConversationId === conversationId) {
        $conversationChat.nextAssign({
          streamingContent: "",
          streamingConversationId: null,
          toolUses: [],
          // Add error as a system message
          messages: [...cc.messages, {
            id: `error-${Date.now()}`,
            conversationId,
            senderId: "system",
            senderName: "System",
            senderAvatar: null,
            isAgent: false,
            content: `Error: ${errMsg}`,
            metadata: null,
            replyToId: null,
            replyTo: null,
            editedAt: null,
            reactions: {},
            createdAt: new Date().toISOString(),
          }],
        });
      }
      break;
    }

    // --- Docs messages ---

    case "docs:list": {
      // New format: { own, shared, publicDocs, folders, publicFolders } or legacy { files }
      if (msg.payload.own) {
        $docs.nextAssign({
          files: msg.payload.own,
          sharedFiles: msg.payload.shared || [],
          publicFiles: msg.payload.publicDocs || [],
          folders: msg.payload.folders || [],
          publicFolders: msg.payload.publicFolders || [],
          loading: false,
        });
      } else {
        $docs.nextAssign({ files: msg.payload.files, loading: false });
      }
      break;
    }

    case "docs:content": {
      $docs.nextAssign({
        selectedDocId: msg.payload.id,
        title: msg.payload.title,
        content: msg.payload.content,
        folderId: msg.payload.folderId ?? null,
        isPublic: msg.payload.isPublic ?? false,
        publicKey: msg.payload.publicKey ?? null,
        projectId: msg.payload.projectId ?? null,
        isOwner: msg.payload.isOwner ?? true,
        permission: msg.payload.permission ?? "write",
        editing: false,
        loading: false,
      });
      break;
    }

    case "docs:created": {
      $docs.nextAssign({
        selectedDocId: msg.payload.id,
        title: msg.payload.title,
        content: msg.payload.content,
        folderId: msg.payload.folderId ?? null,
        isPublic: msg.payload.isPublic ?? false,
        publicKey: msg.payload.publicKey ?? null,
        projectId: msg.payload.projectId ?? null,
        isOwner: true,
        permission: "write",
        editing: false,
        loading: false,
      });
      break;
    }

    case "docs:saved": {
      const d = $docs.getValue();
      if (d.selectedDocId === msg.payload.id) {
        $docs.nextAssign({ title: msg.payload.title, content: msg.payload.content, editing: false, loading: false });
      } else {
        $docs.nextAssign({ loading: false });
      }
      break;
    }

    case "docs:deleted": {
      const d = $docs.getValue();
      if (d.selectedDocId === msg.payload.docId) {
        $docs.nextAssign({
          selectedDocId: null, title: "", content: "", folderId: null,
          isPublic: false, publicKey: null, projectId: null,
          editing: false, isOwner: true, permission: "write", loading: false,
        });
      } else {
        $docs.nextAssign({ loading: false });
      }
      break;
    }

    case "docs:shares": {
      const { docId, shares } = msg.payload;
      const d = $docs.getValue();
      if (d.activeShareDocId === docId) {
        $docs.nextAssign({ currentDocShares: shares });
      }
      break;
    }

    case "docs:public-toggled": {
      const { id, isPublic, publicKey } = msg.payload;
      const d = $docs.getValue();
      const updates: Partial<DocsState> = {};
      if (d.selectedDocId === id) {
        updates.isPublic = isPublic;
        updates.publicKey = publicKey;
      }
      updates.files = d.files.map((f) =>
        f.id === id ? { ...f, isPublic, publicKey } : f
      );
      $docs.nextAssign(updates);
      break;
    }

    case "docs:folder:public-toggled": {
      const { id, isPublic } = msg.payload;
      const d = $docs.getValue();
      $docs.nextAssign({
        folders: d.folders.map((f) =>
          f.id === id ? { ...f, isPublic } : f
        ),
      });
      break;
    }

    case "docs:download:zip": {
      $docs.nextAssign({ downloadingZip: false });
      // Trigger browser download
      if (typeof window !== "undefined" && msg.payload.data) {
        const byteChars = atob(msg.payload.data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "docs.zip";
        a.click();
        URL.revokeObjectURL(url);
      }
      break;
    }

    case "docs:download:item": {
      if (typeof window !== "undefined" && msg.payload.data) {
        const byteChars = atob(msg.payload.data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = msg.payload.fileName || "download.zip";
        a.click();
        URL.revokeObjectURL(url);
      }
      break;
    }

    case "docs:error": {
      console.error("Docs error:", msg.payload.message);
      $docs.nextAssign({ loading: false, downloadingZip: false });
      break;
    }

    // --- File editor messages ---

    case "project-file:files": {
      const { projectId, files, error } = msg.payload;
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId) {
        $fileEditor.nextAssign({ files, loading: false, error });
        if (files.length > 0 && !fe.selectedFile) {
          selectFile(files[0]);
        }
      }
      break;
    }

    case "project-file:content": {
      const { projectId, fileName, content, error } = msg.payload;
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId && fe.selectedFile === fileName) {
        $fileEditor.nextAssign({ content, savedContent: content, loading: false, error });
      }
      break;
    }

    case "project-file:saved": {
      const { projectId, fileName, ok, error } = msg.payload;
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId && fe.selectedFile === fileName) {
        $fileEditor.nextAssign({
          saving: false,
          savedContent: ok ? fe.content : fe.savedContent,
          error: ok ? null : error,
        });
      }
      break;
    }

    case "project-file:deleted": {
      const { projectId } = msg.payload;
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId) {
        loadProjectFiles(projectId);
      }
      break;
    }

    case "project-file:added": {
      const { projectId } = msg.payload;
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId) {
        loadProjectFiles(projectId);
      }
      break;
    }

    case "project-file:imported": {
      const { projectId } = msg.payload;
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId) {
        loadProjectFiles(projectId);
      }
      break;
    }

    case "file-template:list": {
      $fileTemplates.next({ templates: msg.payload.templates, loading: false });
      break;
    }

    case "file-template:created":
    case "file-template:updated":
    case "file-template:deleted": {
      // Reload full list after any mutation
      loadFileTemplates();
      break;
    }

    case "file-template:injected": {
      if (msg.payload.ok && msg.payload.projectId) {
        const fe = $fileEditor.getValue();
        if (fe.projectId === msg.payload.projectId) {
          loadProjectFiles(msg.payload.projectId);
        }
      }
      break;
    }

    case "admin:railway:test": {
      $railwayTestResult.next(msg.payload);
      break;
    }

    case "do:token-valid": {
      $doTokenValid.next(msg.payload);
      break;
    }

    case "do:snapshots:list": {
      $doSnapshots.next(msg.payload.snapshots || []);
      $doSnapshotsLoading.next(false);
      break;
    }

    // --- VPS handlers ---

    case "vps:test-connection:ok": {
      $vpsDeploy.getValue().testResult = { ok: true, hostname: msg.payload.hostname };
      break;
    }

    case "vps:test-connection:error": {
      $vpsDeploy.getValue().testResult = { ok: false, error: msg.payload.message };
      break;
    }

    case "vps:deploy:progress": {
      const { instanceId: progInstId } = msg.payload;
      if (progInstId) {
        ensureInstanceState(progInstId);
        const v = $vpsDeploy.getValue();
        v.instances[progInstId].progress = [...v.instances[progInstId].progress, msg.payload.message];
        const deploy = v.activeDeploys[progInstId];
        if (deploy) deploy.progress = [...deploy.progress, msg.payload.message];
      }
      break;
    }

    case "vps:deploy:done": {
      const { instanceId: doneInstId } = msg.payload;
      if (doneInstId) {
        ensureInstanceState(doneInstId);
        const v = $vpsDeploy.getValue();
        batch(() => {
          const inst = v.instances[doneInstId];
          inst.deploying = false;
          inst.endedAt = Date.now();
          const deploy = v.activeDeploys[doneInstId];
          if (deploy) { deploy.deploying = false; deploy.endedAt = Date.now(); }
        });
      }
      break;
    }

    case "vps:deploy:error": {
      const { instanceId: errInstId } = msg.payload;
      if (errInstId) {
        ensureInstanceState(errInstId);
        const v = $vpsDeploy.getValue();
        batch(() => {
          const inst = v.instances[errInstId];
          inst.deploying = false;
          inst.endedAt = Date.now();
          inst.error = msg.payload.message;
          const deploy = v.activeDeploys[errInstId];
          if (deploy) {
            deploy.deploying = false;
            deploy.endedAt = Date.now();
            deploy.error = msg.payload.message;
            deploy.failedDroplet = msg.payload.failedDroplet || null;
          }
        });
      }
      break;
    }

    case "do:destroy-failed-droplet:done": {
      const { dropletId } = msg.payload;
      const v = $vpsDeploy.getValue();
      batch(() => {
        for (const d of Object.values(v.activeDeploys)) {
          if (d.failedDroplet?.dropletId === dropletId) {
            d.failedDroplet = null;
            d.destroyingDroplet = false;
          }
        }
      });
      break;
    }

    case "do:destroy-failed-droplet:error": {
      const { dropletId: failDId, message: failMsg } = msg.payload;
      const v = $vpsDeploy.getValue();
      batch(() => {
        for (const d of Object.values(v.activeDeploys)) {
          if (d.failedDroplet?.dropletId === failDId) {
            d.destroyingDroplet = false;
            d.error = `Failed to destroy droplet: ${failMsg}`;
          }
        }
      });
      break;
    }

    case "vps:status:update": {
      // Services updated via project:list broadcast
      break;
    }

    case "vps:stats:result": {
      const { instanceId: statsInstId } = msg.payload;
      if (statsInstId) {
        ensureInstanceState(statsInstId);
        updateInstanceState(statsInstId, { stats: msg.payload.stats, statsError: null });
      }
      break;
    }

    case "vps:stats:error": {
      const { instanceId: statsErrInstId } = msg.payload;
      if (statsErrInstId) {
        ensureInstanceState(statsErrInstId);
        updateInstanceState(statsErrInstId, { statsError: msg.payload.message });
      }
      break;
    }

    case "vps:process:kill:result": {
      const { instanceId: killInstId } = msg.payload;
      if (killInstId) {
        const inst = $vpsDeploy.getValue().instances[killInstId];
        if (msg.payload.ok && inst?.stats?.processes) {
          inst.stats.processes = inst.stats.processes.filter(
            (p: VpsProcessInfo) => p.pid !== msg.payload.pid,
          );
        }
      }
      break;
    }

    case "vps:teardown:done": {
      const { instanceId: tdInstId } = msg.payload;
      if (tdInstId) {
        delete $vpsDeploy.getValue().instances[tdInstId];
      }
      break;
    }

    case "vps:teardown:progress": {
      const { instanceId: tdpInstId } = msg.payload;
      if (tdpInstId) {
        ensureInstanceState(tdpInstId);
        const inst = $vpsDeploy.getValue().instances[tdpInstId];
        inst.progress = [...inst.progress, msg.payload.message];
      }
      break;
    }

    case "vps:teardown:error": {
      const { instanceId: tdeInstId } = msg.payload;
      if (tdeInstId) {
        ensureInstanceState(tdeInstId);
        updateInstanceState(tdeInstId, { error: msg.payload.message });
      }
      break;
    }

    case "vps:recipe:check:result": {
      const { instanceId: rcInstId, recipeId: rcId, installed: rcInstalled } = msg.payload;
      if (rcInstId && rcId) {
        ensureInstanceState(rcInstId);
        const inst = $vpsDeploy.getValue().instances[rcInstId];
        if (inst.recipes[rcId]) {
          inst.recipes[rcId].checking = false;
          inst.recipes[rcId].installed = rcInstalled;
        }
      }
      break;
    }

    case "vps:recipe:progress": {
      const { instanceId: rpInstId, recipeId: rpId, message: rpMsg } = msg.payload;
      if (rpInstId && rpId) {
        ensureInstanceState(rpInstId);
        const inst = $vpsDeploy.getValue().instances[rpInstId];
        if (inst.recipes[rpId]) {
          inst.recipes[rpId].progress = [...inst.recipes[rpId].progress, rpMsg];
        }
      }
      break;
    }

    case "vps:recipe:done": {
      const { instanceId: rdInstId, recipeId: rdId } = msg.payload;
      if (rdInstId && rdId) {
        ensureInstanceState(rdInstId);
        const inst = $vpsDeploy.getValue().instances[rdInstId];
        if (inst.recipes[rdId]) {
          inst.recipes[rdId].running = false;
          inst.recipes[rdId].installed = true;
        }
      }
      break;
    }

    case "vps:recipe:uninstall:done": {
      const { instanceId: ruInstId, recipeId: ruId } = msg.payload;
      if (ruInstId && ruId) {
        ensureInstanceState(ruInstId);
        const inst = $vpsDeploy.getValue().instances[ruInstId];
        if (inst.recipes[ruId]) {
          inst.recipes[ruId].running = false;
          inst.recipes[ruId].installed = false;
        }
      }
      break;
    }

    case "vps:recipe:error": {
      const { instanceId: reInstId, recipeId: reId, message: reMsg } = msg.payload;
      if (reInstId && reId) {
        ensureInstanceState(reInstId);
        const inst = $vpsDeploy.getValue().instances[reInstId];
        if (inst.recipes[reId]) {
          inst.recipes[reId].running = false;
          inst.recipes[reId].error = reMsg;
        }
      }
      break;
    }

    case "vps:exec:result": {
      const { execId, output, error } = msg.payload;
      const cb = execCallbacks.get(execId);
      if (cb) {
        execCallbacks.delete(execId);
        cb(output, error);
      }
      break;
    }

    case "vps:logs:data": {
      const { instanceId: logsInstId, serviceName, logs } = msg.payload;
      if (logsInstId) {
        ensureInstanceState(logsInstId);
        updateInstanceState(logsInstId, { logs: { serviceName: serviceName || null, logs } });
      }
      break;
    }

    case "deploy:logs:list": {
      $vpsDeploy.getValue().deployLogs = msg.payload.logs;
      break;
    }

    // --- Tracker WS handlers ---

    case "tracker:list": {
      $tracker.nextAssign({ issues: msg.payload.issues, labels: msg.payload.labels, loading: false });
      break;
    }

    case "tracker:issue:created": {
      $tracker.nextAssign({ showCreateForm: false });
      break;
    }

    case "tracker:issue:updated": {
      // Patch the local issue immediately for responsiveness
      const tr = $tracker.getValue();
      $tracker.nextAssign({
        issues: tr.issues.map((i) => i.id === msg.payload.id ? msg.payload : i),
      });
      break;
    }

    case "tracker:issue:deleted": {
      const { issueId } = msg.payload;
      const tr = $tracker.getValue();
      $tracker.nextAssign({
        issues: tr.issues.filter((i) => i.id !== issueId),
        selectedIssueId: tr.selectedIssueId === issueId ? null : tr.selectedIssueId,
      });
      break;
    }

    case "tracker:error": {
      console.error("Tracker error:", msg.payload.message);
      $tracker.nextAssign({ loading: false });
      break;
    }

    // --- Admin ---

    case "admin:tables": {
      batch(() => { const v = $admin.getValue(); v.tables = msg.payload.tables; v.loading = false; });
      break;
    }

    case "admin:table:columns": {
      batch(() => { const v = $admin.getValue(); v.columns = msg.payload.columns; v.primaryKey = msg.payload.primaryKey; });
      break;
    }

    case "admin:table:rows": {
      batch(() => {
        const v = $admin.getValue();
        v.rows = msg.payload.rows;
        v.totalCount = msg.payload.totalCount;
        v.page = msg.payload.page;
        v.pageSize = msg.payload.pageSize;
        v.loading = false;
      });
      break;
    }

    case "admin:row:get": {
      if (msg.payload.row) {
        $admin.getValue().drawerRow = msg.payload.row;
      }
      break;
    }

    case "admin:row:inserted": {
      const v = $admin.getValue();
      batch(() => { v.drawerOpen = false; v.drawerRow = null; });
      if (v.selectedTable === msg.payload.tableName) {
        loadAdminRows();
        loadAdminTables();
      }
      break;
    }

    case "admin:row:updated": {
      const v = $admin.getValue();
      batch(() => { v.drawerOpen = false; v.drawerRow = null; });
      if (v.selectedTable === msg.payload.tableName) {
        loadAdminRows();
      }
      break;
    }

    case "admin:row:deleted": {
      if ($admin.getValue().selectedTable === msg.payload.tableName) {
        loadAdminRows();
        loadAdminTables();
      }
      break;
    }

    case "admin:sql:result": {
      batch(() => { const v = $admin.getValue(); v.sqlResult = msg.payload; v.sqlLoading = false; v.sqlError = null; });
      break;
    }

    case "admin:sql:error": {
      batch(() => { const v = $admin.getValue(); v.sqlError = msg.payload.message; v.sqlLoading = false; v.sqlResult = null; });
      break;
    }

    case "admin:error": {
      console.error("Admin error:", msg.payload.message);
      $admin.getValue().loading = false;
      break;
    }

    case "admin:drizzle:push:output": {
      $admin.getValue().drizzlePush.output += msg.payload.data;
      break;
    }

    case "admin:drizzle:push:done": {
      $admin.getValue().drizzlePush.running = false;
      loadAdminTables();
      break;
    }

    case "admin:backups:list": {
      batch(() => {
        const b = $admin.getValue().backups;
        b.files = msg.payload.files;
        b.loading = false;
        b.creating = false;
      });
      break;
    }

    case "admin:backups:created": {
      batch(() => {
        const b = $admin.getValue().backups;
        b.files = msg.payload.files;
        b.loading = false;
        b.creating = false;
      });
      break;
    }

    case "admin:backups:deleted": {
      $admin.getValue().backups.files = msg.payload.files;
      break;
    }

    case "admin:droplets:list": {
      const v = $admin.getValue();
      if (msg.payload.error) {
        batch(() => { v.dropletsError = msg.payload.error; v.droplets = []; v.dropletsLoading = false; });
      } else {
        const projectMap = msg.payload.projectMap || {};
        const running: AdminDroplet[] = (msg.payload.droplets || []).map((d: any) => {
          const pub = d.networks?.v4?.find((n: any) => n.type === "public");
          const pm = projectMap[d.id];
          return {
            id: d.id,
            name: d.name,
            status: d.status,
            ip: pub?.ip_address || null,
            region: d.region?.slug || "",
            size: d.size_slug || "",
            vcpus: d.vcpus || 0,
            memoryMb: d.memory || 0,
            diskGb: d.disk || 0,
            createdAt: d.created_at || null,
            createdBy: pm?.createdBy || null,
            projectId: pm?.projectId || null,
            projectName: pm?.projectName || null,
          } as AdminDroplet;
        });
        batch(() => { v.droplets = running; v.dropletsError = null; v.dropletsLoading = false; });
      }
      break;
    }

    case "admin:droplets:deleted": {
      const v = $admin.getValue();
      const deletedId = msg.payload.dropletId;
      batch(() => {
        v.droplets = v.droplets.filter((d) => d.id !== deletedId);
        delete v.dropletStats[deletedId];
      });
      break;
    }

    case "admin:droplets:stats": {
      if (msg.payload.stats) {
        Object.assign($admin.getValue().dropletStats, msg.payload.stats);
      }
      break;
    }

    case "admin:baseimage:configs:list": {
      batch(() => {
        const bi = $admin.getValue().baseImage;
        bi.configs = msg.payload.configs;
        bi.templates = msg.payload.templates || {};
        bi.deletedTemplates = msg.payload.deletedTemplates || {};
        bi.buildingName = msg.payload.buildingName;
      });
      break;
    }

    case "admin:baseimage:progress": {
      const { configName, message } = msg.payload;
      const bi = $admin.getValue().baseImage;
      if (configName === bi.buildingName) {
        bi.progress = [...bi.progress.slice(-49), message];
      }
      break;
    }

    case "admin:baseimage:done": {
      const { configName, snapshotId, snapshotName } = msg.payload;
      const bi = $admin.getValue().baseImage;
      batch(() => {
        const tmpl = bi.templates[configName];
        if (tmpl) {
          tmpl.snapshotId = snapshotId;
          tmpl.snapshotName = snapshotName;
          tmpl.verified = true;
        }
        bi.buildingName = null;
        bi.error = null;
        bi.failedDropletId = null;
        bi.failedDropletIp = null;
      });
      break;
    }

    case "admin:baseimage:error": {
      const errPrefix = msg.payload.configName ? `[${msg.payload.configName}] ` : "";
      batch(() => {
        const bi = $admin.getValue().baseImage;
        bi.buildingName = null;
        bi.error = errPrefix + msg.payload.message;
        bi.failedDropletId = msg.payload.failedDropletId || null;
        bi.failedDropletIp = msg.payload.failedDropletIp || null;
      });
      break;
    }

    case "admin:baseimage:template:history": {
      $admin.getValue().baseImage.history = msg.payload.history || [];
      break;
    }

    case "admin:sshkey:result": {
      batch(() => {
        const sk = $admin.getValue().sshKey;
        sk.exists = msg.payload.exists;
        sk.publicKey = msg.payload.publicKey;
        sk.fingerprint = msg.payload.fingerprint;
        sk.loading = false;
        sk.regenerating = false;
      });
      break;
    }

    case "admin:sshkey:error": {
      batch(() => {
        const sk = $admin.getValue().sshKey;
        sk.loading = false;
        sk.regenerating = false;
      });
      break;
    }

    case "admin:ai:costs": {
      batch(() => {
        const ai = $admin.getValue().ai;
        ai.costs = msg.payload.rows || [];
        ai.error = msg.payload.error || null;
        ai.loading = false;
      });
      break;
    }

    case "admin:ai:settings": {
      batch(() => {
        const ai = $admin.getValue().ai;
        if (msg.payload.defaultModel !== undefined) {
          ai.settings.defaultModel = msg.payload.defaultModel;
        }
        if (msg.payload.maxToolRounds !== undefined) {
          ai.settings.maxToolRounds = msg.payload.maxToolRounds;
        }
        ai.settingsLoading = false;
      });
      break;
    }

    case "admin:users:list": {
      batch(() => {
        const u = $admin.getValue().users;
        u.list = msg.payload.users;
        u.loading = false;
      });
      break;
    }

    case "admin:users:updated": {
      const list = $admin.getValue().users.list;
      const idx = list.findIndex((u: AdminUser) => u.id === msg.payload.user.id);
      if (idx >= 0) list[idx] = msg.payload.user;
      break;
    }

    case "admin:users:deleted": {
      const u = $admin.getValue().users;
      u.list = u.list.filter((x: AdminUser) => x.id !== msg.payload.userId);
      break;
    }

    case "admin:teams:list": {
      batch(() => {
        const t = $admin.getValue().teams;
        t.list = msg.payload.teams;
        t.members = msg.payload.members;
        t.loading = false;
      });
      break;
    }

    case "admin:teams:created": {
      $admin.getValue().teams.list.push(msg.payload.team);
      break;
    }

    case "admin:teams:updated": {
      const list = $admin.getValue().teams.list;
      const idx = list.findIndex((t: AdminTeam) => t.id === msg.payload.team.id);
      if (idx >= 0) list[idx] = msg.payload.team;
      break;
    }

    case "admin:teams:deleted": {
      const t = $admin.getValue().teams;
      t.list = t.list.filter((x: AdminTeam) => x.id !== msg.payload.teamId);
      t.members = t.members.filter((m: AdminTeamMember) => m.teamId !== msg.payload.teamId);
      break;
    }

    case "admin:teams:member-added": {
      $admin.getValue().teams.members.push(msg.payload.member);
      break;
    }

    case "admin:teams:member-removed": {
      const t = $admin.getValue().teams;
      t.members = t.members.filter((m: AdminTeamMember) => m.id !== msg.payload.memberId);
      break;
    }

    case "admin:teams:role-updated": {
      const members = $admin.getValue().teams.members;
      const idx = members.findIndex((m: AdminTeamMember) => m.id === msg.payload.member.id);
      if (idx >= 0) members[idx] = msg.payload.member;
      break;
    }

    case "admin:audit:list": {
      batch(() => {
        const a = $admin.getValue().audit;
        a.logs = msg.payload.logs;
        a.loading = false;
      });
      break;
    }

    case "admin:prodlogs:deployments": {
      batch(() => {
        const p = $admin.getValue().prodlogs;
        p.deployments = msg.payload.deployments;
        p.loading = false;
      });
      break;
    }

    case "admin:prodlogs:logs": {
      batch(() => {
        const p = $admin.getValue().prodlogs;
        p.logs = msg.payload.logs;
        p.logsLoading = false;
      });
      break;
    }

    case "terminal:share:kicked": {
      const { sessionId } = msg.payload;
      // Remove the shared tab and dispatch event for extension to handle
      removeTerminalTab(sessionId);
      window.dispatchEvent(new CustomEvent("genie:terminal:share:kicked", { detail: { sessionId } }));
      break;
    }

    case "terminal:share:error": {
      const errMsg = msg.payload.message || "Failed to share terminal";
      console.error("Terminal share error:", errMsg);
      window.dispatchEvent(new CustomEvent("genie:terminal:share:error", { detail: { message: errMsg } }));
      break;
    }

    case "terminal:share:sent": {
      window.dispatchEvent(new CustomEvent("genie:terminal:share:sent", { detail: msg.payload }));
      break;
    }

    case "error":
      console.error("Manager error:", msg.payload.message);
      break;
  }
}

// --- UI state persistence ---

export function saveUiState(): void {
  if (typeof window === "undefined") return;
  const state: UiState = {
    activeNav: $activeNav.getValue(),
    selectedAppId: $selectedAppId.getValue(),
    selectedProjectId: $selectedProjectId.getValue(),
    processSortBy: $processSortBy.getValue(),
    filterPortsOnly: $filterPortsOnly.getValue(),
  };
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
}

export function loadUiState(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as UiState;
    $processSortBy.next(saved.processSortBy);
    $filterPortsOnly.next(saved.filterPortsOnly ?? false);
    // Nav state (activeNav, selectedAppId, selectedProjectId) is now
    // driven by the URL via useRouteSync. We only restore activeNav
    // here so the root "/" redirect knows the last-used nav.
    if (saved.activeNav) {
      $activeNav.next(saved.activeNav);
    }
  } catch {
    // ignore
  }
}

// --- Window manager actions ---

function wmSetWindow(wm: WindowManagerState, win: FloatingWindowState): WindowManagerState {
  return { ...wm, windows: { ...wm.windows, [win.id]: win } };
}

export function registerWindow(id: string, title: string, icon: string): void {
  const wm = $windowManager.getValue();
  if (wm.windows[id]) return;
  $windowManager.next(wmSetWindow(
    { ...wm, nextZIndex: wm.nextZIndex + 1 },
    { id, status: "closed", title, icon, position: { x: -1, y: -1 }, zIndex: wm.nextZIndex },
  ));
}

export function openWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, status: "open" }));
}

export function minimizeWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, status: "minimized" }));
}

export function restoreWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) {
    $windowManager.next(wmSetWindow(
      { ...wm, nextZIndex: wm.nextZIndex + 1 },
      { ...win, status: "open", zIndex: wm.nextZIndex },
    ));
  }
}

export function closeWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, status: "closed" }));
}

export function focusWindow(id: string): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) {
    $windowManager.next(wmSetWindow(
      { ...wm, nextZIndex: wm.nextZIndex + 1 },
      { ...win, zIndex: wm.nextZIndex },
    ));
  }
}

export function updateWindowPosition(id: string, pos: { x: number; y: number }): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, position: pos }));
}

export function setWindowBusy(id: string, busy: boolean): void {
  const wm = $windowManager.getValue();
  const win = wm.windows[id];
  if (win) $windowManager.next(wmSetWindow(wm, { ...win, busy }));
}
