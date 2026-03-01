import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("genie", {
  startManager: () => ipcRenderer.invoke("start-manager"),
  stopManager: () => ipcRenderer.invoke("stop-manager"),
  getManagerStatus: () => ipcRenderer.invoke("get-manager-status"),
  onManagerStatus: (callback: (running: boolean) => void) => {
    ipcRenderer.on("manager-status", (_event, running) => callback(running));
  },
  restartApp: () => ipcRenderer.invoke("restart-app"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),

  // File explorer
  getHomePath: () => ipcRenderer.invoke("get-home-path"),
  readDirectory: (path: string) => ipcRenderer.invoke("read-directory", path),
  readFile: (path: string) => ipcRenderer.invoke("read-file", path),
  createFolder: (path: string) => ipcRenderer.invoke("create-folder", path),
  renameEntry: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke("rename-entry", oldPath, newPath),
  deleteEntry: (path: string) => ipcRenderer.invoke("delete-entry", path),
  openInFinder: (path: string) => ipcRenderer.invoke("open-in-finder", path),
  openFile: (path: string) => ipcRenderer.invoke("open-file", path),

  // Docs
  docsListFiles: () => ipcRenderer.invoke("docs:list"),
  docsReadFile: (filename: string) => ipcRenderer.invoke("docs:read", filename),
  docsWriteFile: (filename: string, content: string) =>
    ipcRenderer.invoke("docs:write", filename, content),
  docsDeleteFile: (filename: string) =>
    ipcRenderer.invoke("docs:delete", filename),
});
