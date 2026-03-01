"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("genie", {
    startManager: () => electron_1.ipcRenderer.invoke("start-manager"),
    stopManager: () => electron_1.ipcRenderer.invoke("stop-manager"),
    getManagerStatus: () => electron_1.ipcRenderer.invoke("get-manager-status"),
    onManagerStatus: (callback) => {
        electron_1.ipcRenderer.on("manager-status", (_event, running) => callback(running));
    },
    restartApp: () => electron_1.ipcRenderer.invoke("restart-app"),
    pickFolder: () => electron_1.ipcRenderer.invoke("pick-folder"),
    // File explorer
    getHomePath: () => electron_1.ipcRenderer.invoke("get-home-path"),
    readDirectory: (path) => electron_1.ipcRenderer.invoke("read-directory", path),
    readFile: (path) => electron_1.ipcRenderer.invoke("read-file", path),
    createFolder: (path) => electron_1.ipcRenderer.invoke("create-folder", path),
    renameEntry: (oldPath, newPath) => electron_1.ipcRenderer.invoke("rename-entry", oldPath, newPath),
    deleteEntry: (path) => electron_1.ipcRenderer.invoke("delete-entry", path),
    openInFinder: (path) => electron_1.ipcRenderer.invoke("open-in-finder", path),
    openFile: (path) => electron_1.ipcRenderer.invoke("open-file", path),
});
//# sourceMappingURL=preload.js.map