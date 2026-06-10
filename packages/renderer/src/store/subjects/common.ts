import { Subject } from "subjecto/core";
import type { AppSettings } from "@/lib/genie-api";
import type {
  AppDef,
  AppStats,
  DockerInfo,
  FileExplorerState,
  LogsState,
  NavKey,
  ProcessInfo,
  ServerMetricsState,
  SystemState,
  WindowManagerState,
  PresenceSession,
} from "../types/common";

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
export const $logs = new Subject<LogsState>({ activeSource: "manager", sources: ["manager"], buffers: {} });
export const $settings = new Subject<AppSettings>({ defaultEditor: "", digitaloceanApiToken: "", hetznerApiToken: "", gitlabDeployKey: "", railwayToken: "", railwayProjectId: "", namecheapApiUser: "", namecheapApiKey: "", namecheapUserName: "", namecheapDomain: "" });
export const $windowManager = new Subject<WindowManagerState>({ windows: {}, nextZIndex: 10000 });

/** Global text-size preference for every floating window's title-bar selector.
 *  Hydrated from localStorage at load (falling back to the legacy Manage-only
 *  key) so the last choice sticks; updates flow back via setWindowFontSize. */
function loadWindowFontSize(): "small" | "medium" | "large" {
  if (typeof window === "undefined") return "small";
  try {
    const v = window.localStorage.getItem("genie-window-font-size")
      ?? window.localStorage.getItem("manage-vm-font-size");
    return v === "medium" || v === "large" ? v : "small";
  } catch { return "small"; }
}
export const $windowFontSize = new Subject<"small" | "medium" | "large">(loadWindowFontSize());
export const $presenceSessions = new Subject<PresenceSession[]>([]);
export const $serverMetrics = new Subject<ServerMetricsState>({ startedAt: null, buckets: [] });
