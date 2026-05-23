import { wsRequest } from "@/lib/ws";

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedMs: number;
}

export interface ReadDirResult {
  ok: boolean;
  entries?: DirEntry[];
  error?: string;
}

export interface ReadFileResult {
  ok: boolean;
  content?: string | null;
  binary?: boolean;
  error?: string;
}

export interface FsResult {
  ok: boolean;
  error?: string;
}

export interface AppSettings {
  defaultEditor: string;
  digitaloceanApiToken: string;
  gitlabDeployKey: string;
  railwayToken: string;
  railwayProjectId: string;
}

export const genie = {
  // No-ops — manager runs independently
  startManager: () => Promise.resolve(true),
  stopManager: () => Promise.resolve(true),
  getManagerStatus: () => Promise.resolve(true),
  onManagerStatus: (_cb: (running: boolean) => void) => {},
  restartApp: () => Promise.resolve(),

  // No native folder picker in browser
  pickFolder: () => Promise.resolve(null as string | null),

  // Open external links in a new tab
  openExternal: (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  },

  // Settings
  getSettings: (): Promise<AppSettings> =>
    wsRequest<AppSettings>("settings:get").then(({ reqId, ...rest }: any) => ({
      defaultEditor: "",
      digitaloceanApiToken: "",
      gitlabDeployKey: "",
      railwayToken: "",
      railwayProjectId: "",
      ...rest,
    })),
  saveSettings: (settings: AppSettings): Promise<FsResult> =>
    wsRequest("settings:save", settings as any),

  // File explorer
  getHomePath: (): Promise<string> =>
    wsRequest<{ path: string }>("fs:homePath").then((r) => r.path),
  readDirectory: (path: string): Promise<ReadDirResult> =>
    wsRequest("fs:readDirectory", { path }),
  readFile: (path: string): Promise<ReadFileResult> =>
    wsRequest("fs:readFile", { path }),
  createFolder: (path: string): Promise<FsResult> =>
    wsRequest("fs:createFolder", { path }),
  renameEntry: (oldPath: string, newPath: string): Promise<FsResult> =>
    wsRequest("fs:renameEntry", { oldPath, newPath }),
  deleteEntry: (path: string): Promise<FsResult> =>
    wsRequest("fs:deleteEntry", { path }),
  openInFinder: (path: string): Promise<FsResult> =>
    wsRequest("fs:openInFinder", { path }),
  openFile: (path: string): Promise<FsResult> =>
    wsRequest("fs:openFile", { path }),
};
