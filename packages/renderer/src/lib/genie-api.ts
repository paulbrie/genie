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

export interface DocFile {
  name: string;
  path: string;
}

export interface DocsListResult {
  ok: boolean;
  files: DocFile[];
  error?: string;
}

export interface DocsReadResult {
  ok: boolean;
  content: string;
  error?: string;
}

export interface GenieAPI {
  startManager: () => Promise<boolean>;
  stopManager: () => Promise<boolean>;
  getManagerStatus: () => Promise<boolean>;
  onManagerStatus: (cb: (running: boolean) => void) => void;
  restartApp: () => Promise<void>;
  pickFolder: () => Promise<string | null>;

  // File explorer
  getHomePath: () => Promise<string>;
  readDirectory: (path: string) => Promise<ReadDirResult>;
  readFile: (path: string) => Promise<ReadFileResult>;
  createFolder: (path: string) => Promise<FsResult>;
  renameEntry: (oldPath: string, newPath: string) => Promise<FsResult>;
  deleteEntry: (path: string) => Promise<FsResult>;
  openInFinder: (path: string) => Promise<FsResult>;
  openFile: (path: string) => Promise<FsResult>;

  // Docs
  docsListFiles: () => Promise<DocsListResult>;
  docsReadFile: (filename: string) => Promise<DocsReadResult>;
  docsWriteFile: (filename: string, content: string) => Promise<FsResult>;
  docsDeleteFile: (filename: string) => Promise<FsResult>;
}

declare global {
  interface Window {
    genie: GenieAPI;
  }
}

function getGenie(): GenieAPI | null {
  if (typeof window !== "undefined" && window.genie) {
    return window.genie;
  }
  return null;
}

const noopFs: FsResult = { ok: false, error: "Not available" };

export const genie = {
  startManager: () => getGenie()?.startManager() ?? Promise.resolve(false),
  stopManager: () => getGenie()?.stopManager() ?? Promise.resolve(false),
  getManagerStatus: () =>
    getGenie()?.getManagerStatus() ?? Promise.resolve(false),
  onManagerStatus: (cb: (running: boolean) => void) => {
    getGenie()?.onManagerStatus(cb);
  },
  restartApp: () => getGenie()?.restartApp() ?? Promise.resolve(),
  pickFolder: () => getGenie()?.pickFolder() ?? Promise.resolve(null),

  // File explorer
  getHomePath: () => getGenie()?.getHomePath() ?? Promise.resolve("/"),
  readDirectory: (path: string) =>
    getGenie()?.readDirectory(path) ??
    Promise.resolve({ ok: false, error: "Not available" } as ReadDirResult),
  readFile: (path: string) =>
    getGenie()?.readFile(path) ??
    Promise.resolve({ ok: false, error: "Not available" } as ReadFileResult),
  createFolder: (path: string) =>
    getGenie()?.createFolder(path) ?? Promise.resolve(noopFs),
  renameEntry: (oldPath: string, newPath: string) =>
    getGenie()?.renameEntry(oldPath, newPath) ?? Promise.resolve(noopFs),
  deleteEntry: (path: string) =>
    getGenie()?.deleteEntry(path) ?? Promise.resolve(noopFs),
  openInFinder: (path: string) =>
    getGenie()?.openInFinder(path) ?? Promise.resolve(noopFs),
  openFile: (path: string) =>
    getGenie()?.openFile(path) ?? Promise.resolve(noopFs),

  // Docs
  docsListFiles: () =>
    getGenie()?.docsListFiles?.() ??
    Promise.resolve({ ok: false, files: [], error: "Not available" }),
  docsReadFile: (filename: string) =>
    getGenie()?.docsReadFile?.(filename) ??
    Promise.resolve({ ok: false, content: "", error: "Not available" }),
  docsWriteFile: (filename: string, content: string) =>
    getGenie()?.docsWriteFile?.(filename, content) ?? Promise.resolve(noopFs),
  docsDeleteFile: (filename: string) =>
    getGenie()?.docsDeleteFile?.(filename) ?? Promise.resolve(noopFs),
};
