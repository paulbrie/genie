import type { DirEntry } from "@/lib/genie-api";

// --- Common / shared types ---

export type ProcessStatus = "running" | "stopped" | "crashed";

export type NavKey = "apps" | "projects" | "processes" | "docker" | "docs" | "logs" | "terminal" | "chat" | "tracker" | "settings" | "admin" | "architecture" | "users" | "security" | "tazcloud" | "clouds" | "recipes" | "help";

/** Sub-tab for the `/clouds/*` route group (the unified DigitalOcean / TazCloud
 *  admin panel). The URL segment after `/clouds/` is one of these literals. */
export type CloudSubTab = "do" | "taz";

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

export interface LogsState {
  activeSource: string;
  sources: string[];
  buffers: Record<string, string>;
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

export interface WindowManagerState {
  windows: Record<string, FloatingWindowState>;
  nextZIndex: number;
}

export interface SystemState {
  cpu: number;
  mem: number;
  memory: MemoryInfo | null;
}

export interface UiState {
  activeNav: NavKey;
  selectedAppId: string | null;
  selectedProjectId: string | null;
  processSortBy: "cpu" | "mem";
  filterPortsOnly: boolean;
}

export interface PresenceSession {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  clientType: string;
  currentNav: string | null;
  recentActions: { type: string; ts: number }[];
  ip: string | null;
  userAgent: string | null;
}
