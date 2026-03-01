import { DeepSubject } from "subjecto";
import { stripAnsi } from "@/lib/utils";
import { genie, type DirEntry } from "@/lib/genie-api";
import { wsSend } from "@/lib/ws";

// --- Types ---

export interface AppDef {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  status: "running" | "stopped" | "crashed";
}

export interface AppStats {
  cpu: number;
  mem: number;
  pid: number;
}

export interface ProcessInfo {
  pid: number;
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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolUses?: ToolUse[];
}

export interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  toolUses: ToolUse[];
}

type NavKey = "apps" | "processes" | "docker";

interface UiState {
  activeNav: NavKey;
  selectedAppId: string | null;
  processSortBy: "cpu" | "mem";
  filterPortsOnly: boolean;
}

export interface AppState {
  manager: { running: boolean };
  apps: AppDef[];
  appStats: Record<string, AppStats>;
  selectedAppId: string | null;
  activeNav: NavKey;
  processSortBy: "cpu" | "mem";
  filterPortsOnly: boolean;
  system: { cpu: number; mem: number; memory: MemoryInfo | null };
  processes: ProcessInfo[];
  docker: DockerInfo;
  logBuffers: Record<string, string>;
  viewingLogsFor: string | null;
  showAddForm: boolean;
  pendingRestoreAppId: string | null;
  fileExplorer: FileExplorerState;
  chat: ChatState;
}

const MAX_LOG_BUFFER = 50000;
const UI_STATE_KEY = "genie-ui-state";

// --- Store ---

export const store = new DeepSubject<AppState>({
  manager: { running: false },
  apps: [],
  appStats: {},
  selectedAppId: null,
  activeNav: "apps",
  processSortBy: "mem",
  filterPortsOnly: false,
  system: { cpu: 0, mem: 0, memory: null },
  processes: [],
  docker: { daemonRunning: false, containers: [] },
  logBuffers: {},
  viewingLogsFor: null,
  showAddForm: false,
  pendingRestoreAppId: null,
  fileExplorer: {
    open: false,
    currentPath: "",
    entries: [],
    loading: false,
    error: null,
    history: [],
    historyIndex: -1,
    selectedEntry: null,
    renamingEntry: null,
    panelWidth: 380,
  },
  chat: {
    messages: [],
    loading: false,
    streamingContent: "",
    toolUses: [],
  },
});

// --- Actions ---

export function selectApp(id: string): void {
  const s = store.getValue();
  const app = s.apps.find((a) => a.id === id);
  if (!app) return;

  s.selectedAppId = id;
  s.viewingLogsFor = id;
  s.activeNav = "apps";
  s.showAddForm = false;
}

export function deselectApp(): void {
  const s = store.getValue();
  s.selectedAppId = null;
  s.viewingLogsFor = null;
  saveUiState();
}

export function switchNav(nav: NavKey): void {
  const s = store.getValue();
  s.activeNav = nav;
  if (nav !== "apps") {
    s.showAddForm = false;
  }
  saveUiState();
}

export function toggleSort(): void {
  const s = store.getValue();
  s.processSortBy = s.processSortBy === "cpu" ? "mem" : "cpu";
  saveUiState();
}

export function togglePortFilter(): void {
  const s = store.getValue();
  s.filterPortsOnly = !s.filterPortsOnly;
  saveUiState();
}

export function showAddForm(): void {
  const s = store.getValue();
  s.selectedAppId = null;
  s.viewingLogsFor = null;
  s.activeNav = "apps";
  s.showAddForm = true;
}

export function hideAddForm(): void {
  store.getValue().showAddForm = false;
}

export function clearLogs(appId: string): void {
  const s = store.getValue();
  s.logBuffers[appId] = "";
}

// --- Chat actions ---

export function sendChatMessage(text: string): void {
  const s = store.getValue();
  const userMsg: ChatMessage = { role: "user", content: text };
  s.chat.messages = [...s.chat.messages, userMsg];
  s.chat.loading = true;
  s.chat.streamingContent = "";
  // Send plain objects to avoid proxy serialization issues
  const plain = s.chat.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content }));
  wsSend("chat:send", { messages: plain });
}

// --- File Explorer actions ---

export async function toggleFileExplorer(): Promise<void> {
  const s = store.getValue();
  s.fileExplorer.open = !s.fileExplorer.open;
  if (s.fileExplorer.open && !s.fileExplorer.currentPath) {
    const home = await genie.getHomePath();
    await navigateTo(home);
  }
}

export async function navigateTo(dirPath: string): Promise<void> {
  const s = store.getValue();
  const fe = s.fileExplorer;
  fe.loading = true;
  fe.error = null;
  fe.selectedEntry = null;
  fe.renamingEntry = null;

  const result = await genie.readDirectory(dirPath);
  if (result.ok && result.entries) {
    fe.entries = result.entries;
    fe.currentPath = dirPath;
    // Push to history, trimming any forward entries
    const newHistory = fe.history.slice(0, fe.historyIndex + 1);
    newHistory.push(dirPath);
    fe.history = newHistory;
    fe.historyIndex = newHistory.length - 1;
  } else {
    fe.error = result.error || "Failed to read directory";
  }
  fe.loading = false;
}

export async function navigateBack(): Promise<void> {
  const fe = store.getValue().fileExplorer;
  if (fe.historyIndex <= 0) return;
  const prevPath = fe.history[fe.historyIndex - 1];
  fe.loading = true;
  fe.error = null;
  fe.selectedEntry = null;
  fe.renamingEntry = null;

  const result = await genie.readDirectory(prevPath);
  if (result.ok && result.entries) {
    fe.entries = result.entries;
    fe.currentPath = prevPath;
    fe.historyIndex -= 1;
  } else {
    fe.error = result.error || "Failed to read directory";
  }
  fe.loading = false;
}

export async function navigateForward(): Promise<void> {
  const fe = store.getValue().fileExplorer;
  if (fe.historyIndex >= fe.history.length - 1) return;
  const nextPath = fe.history[fe.historyIndex + 1];
  fe.loading = true;
  fe.error = null;
  fe.selectedEntry = null;
  fe.renamingEntry = null;

  const result = await genie.readDirectory(nextPath);
  if (result.ok && result.entries) {
    fe.entries = result.entries;
    fe.currentPath = nextPath;
    fe.historyIndex += 1;
  } else {
    fe.error = result.error || "Failed to read directory";
  }
  fe.loading = false;
}

export async function navigateUp(): Promise<void> {
  const fe = store.getValue().fileExplorer;
  if (!fe.currentPath || fe.currentPath === "/") return;
  const parent = fe.currentPath.replace(/\/[^/]+\/?$/, "") || "/";
  await navigateTo(parent);
}

export async function refreshDirectory(): Promise<void> {
  const fe = store.getValue().fileExplorer;
  if (!fe.currentPath) return;
  fe.loading = true;
  fe.error = null;

  const result = await genie.readDirectory(fe.currentPath);
  if (result.ok && result.entries) {
    fe.entries = result.entries;
  } else {
    fe.error = result.error || "Failed to read directory";
  }
  fe.loading = false;
}

export function selectFileEntry(entryPath: string | null): void {
  store.getValue().fileExplorer.selectedEntry = entryPath;
}

export function setRenamingEntry(entryPath: string | null): void {
  store.getValue().fileExplorer.renamingEntry = entryPath;
}

export function setFileExplorerPanelWidth(width: number): void {
  store.getValue().fileExplorer.panelWidth = Math.max(280, Math.min(800, width));
}

// --- WebSocket message handler ---

export function handleWsMessage(msg: { type: string; payload: any }): void {
  const s = store.getValue();

  switch (msg.type) {
    case "app:list": {
      s.apps = msg.payload.apps;

      // Restore saved app selection on first load
      if (s.pendingRestoreAppId) {
        const restoreApp = s.apps.find(
          (a) => a.id === s.pendingRestoreAppId
        );
        s.pendingRestoreAppId = null;
        if (restoreApp) {
          selectApp(restoreApp.id);
          break;
        }
      }
      // If selected app was removed, deselect
      if (s.selectedAppId && !s.apps.find((a) => a.id === s.selectedAppId)) {
        s.selectedAppId = null;
        s.viewingLogsFor = null;
      }
      break;
    }

    case "app:status": {
      const app = s.apps.find((a) => a.id === msg.payload.id);
      if (app) {
        app.status = msg.payload.status;
        if (msg.payload.status === "crashed") {
          selectApp(msg.payload.id);
        }
      }
      break;
    }

    case "app:log": {
      const logId = msg.payload.id;
      const clean = stripAnsi(msg.payload.data);
      if (!s.logBuffers[logId]) s.logBuffers[logId] = "";
      s.logBuffers[logId] += clean;
      if (s.logBuffers[logId].length > MAX_LOG_BUFFER) {
        s.logBuffers[logId] = s.logBuffers[logId].slice(-MAX_LOG_BUFFER);
      }
      break;
    }

    case "stats": {
      s.system.cpu = msg.payload.system.cpu;
      s.system.mem = msg.payload.system.mem;
      if (msg.payload.system.memory) {
        s.system.memory = msg.payload.system.memory;
      }
      s.appStats = msg.payload.apps;
      if (msg.payload.processes) {
        s.processes = msg.payload.processes;
      }
      if (msg.payload.docker) {
        s.docker = msg.payload.docker;
      }
      break;
    }

    case "chat:token": {
      s.chat.streamingContent = s.chat.streamingContent + msg.payload.token;
      break;
    }

    case "chat:tool": {
      const tool: ToolUse = {
        name: msg.payload.name,
        input: msg.payload.input,
        result: msg.payload.result,
      };
      s.chat.toolUses = [...s.chat.toolUses, tool];
      break;
    }

    case "chat:done": {
      const toolUses = s.chat.toolUses.length > 0 ? [...s.chat.toolUses] : undefined;
      s.chat.messages = [...s.chat.messages, {
        role: "assistant" as const,
        content: s.chat.streamingContent,
        toolUses,
      }];
      s.chat.streamingContent = "";
      s.chat.toolUses = [];
      s.chat.loading = false;
      break;
    }

    case "chat:error": {
      s.chat.messages = [...s.chat.messages, {
        role: "assistant" as const,
        content: `Error: ${msg.payload.message}`,
      }];
      s.chat.streamingContent = "";
      s.chat.toolUses = [];
      s.chat.loading = false;
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
  const s = store.getValue();
  const state: UiState = {
    activeNav: s.activeNav,
    selectedAppId: s.selectedAppId,
    processSortBy: s.processSortBy,
    filterPortsOnly: s.filterPortsOnly,
  };
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
}

export function loadUiState(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as UiState;
    const s = store.getValue();
    s.processSortBy = saved.processSortBy;
    s.filterPortsOnly = saved.filterPortsOnly ?? false;
    if (saved.activeNav === "processes" || saved.activeNav === "docker") {
      s.activeNav = saved.activeNav;
    } else if (saved.selectedAppId) {
      s.pendingRestoreAppId = saved.selectedAppId;
    }
  } catch {
    // ignore
  }
}
