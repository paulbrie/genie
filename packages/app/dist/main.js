"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_child_process_1 = require("node:child_process");
// Hot-reload in development: watches the dist/ folder for changes
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("electron-reload")(node_path_1.default.join(__dirname, ".."), {
        electron: process.execPath,
        forceHardReset: true,
    });
}
catch {
    // electron-reload not available in production — ignore
}
let tray = null;
let win = null;
let managerProcess = null;
// __dirname at runtime = packages/app/dist, so 3 levels up = project root
const PROJECT_ROOT = node_path_1.default.resolve(__dirname, "../../..");
const TSX_BIN = node_path_1.default.join(PROJECT_ROOT, "node_modules/.bin/tsx");
const MANAGER_ENTRY = node_path_1.default.join(PROJECT_ROOT, "packages/manager/src/index.ts");
const STATE_FILE = node_path_1.default.join(electron_1.app.getPath("userData"), "window-state.json");
function loadWindowState() {
    try {
        const data = node_fs_1.default.readFileSync(STATE_FILE, "utf-8");
        return JSON.parse(data);
    }
    catch {
        return { width: 900, height: 600 };
    }
}
function saveWindowState(win) {
    const bounds = win.getBounds();
    const state = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    };
    try {
        node_fs_1.default.writeFileSync(STATE_FILE, JSON.stringify(state));
    }
    catch {
        // ignore write errors
    }
}
let saveTimeout = null;
function debouncedSave(win) {
    if (saveTimeout)
        clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveWindowState(win), 500);
}
function createWindow() {
    const state = loadWindowState();
    const opts = {
        width: state.width,
        height: state.height,
        minWidth: 680,
        minHeight: 400,
        show: false,
        frame: true,
        resizable: true,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#1e1e2e",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    };
    if (state.x !== undefined && state.y !== undefined) {
        opts.x = state.x;
        opts.y = state.y;
    }
    const window = new electron_1.BrowserWindow(opts);
    const isDev = !electron_1.app.isPackaged;
    if (isDev) {
        window.loadURL("http://localhost:3000");
    }
    else {
        window.loadFile(node_path_1.default.join(__dirname, "../../renderer/out/index.html"));
    }
    window.once("ready-to-show", () => {
        window.show();
    });
    window.on("resize", () => debouncedSave(window));
    window.on("move", () => debouncedSave(window));
    return window;
}
function sendToRenderer(channel, ...args) {
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
    }
}
function startManager() {
    if (managerProcess)
        return false;
    console.log(`[manager] Starting: ${TSX_BIN} ${MANAGER_ENTRY}`);
    console.log(`[manager] cwd: ${PROJECT_ROOT}`);
    managerProcess = (0, node_child_process_1.spawn)(TSX_BIN, [MANAGER_ENTRY], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
    });
    managerProcess.stdout?.on("data", (data) => {
        console.log(`[manager] ${data.toString().trim()}`);
    });
    managerProcess.stderr?.on("data", (data) => {
        console.error(`[manager] ${data.toString().trim()}`);
    });
    managerProcess.on("exit", (code) => {
        console.log(`Manager exited with code ${code}`);
        managerProcess = null;
        sendToRenderer("manager-status", false);
    });
    managerProcess.on("error", (err) => {
        console.error(`Manager error: ${err.message}`);
        managerProcess = null;
        sendToRenderer("manager-status", false);
    });
    // Give it a moment to start, then notify renderer
    setTimeout(() => {
        sendToRenderer("manager-status", true);
    }, 1000);
    return true;
}
function stopManager() {
    if (!managerProcess)
        return false;
    managerProcess.kill("SIGTERM");
    setTimeout(() => {
        if (managerProcess) {
            managerProcess.kill("SIGKILL");
            managerProcess = null;
        }
    }, 3000);
    return true;
}
electron_1.app.whenReady().then(() => {
    // Create tray icon — load @2x template image for retina, fall back to @1x
    const assetsDir = node_path_1.default.join(PROJECT_ROOT, "packages/app/assets");
    let icon;
    try {
        const img2x = electron_1.nativeImage.createFromPath(node_path_1.default.join(assetsDir, "trayIcon@2x.png"));
        if (!img2x.isEmpty()) {
            icon = img2x;
        }
        else {
            icon = electron_1.nativeImage.createFromPath(node_path_1.default.join(assetsDir, "trayIcon.png"));
        }
        icon = icon.resize({ width: 22, height: 22 });
        icon.setTemplateImage(true);
    }
    catch {
        icon = electron_1.nativeImage.createEmpty();
    }
    tray = new electron_1.Tray(icon);
    tray.setToolTip("Genie — App Manager");
    tray.on("click", () => {
        try {
            if (win && !win.isDestroyed()) {
                win.show();
                win.focus();
            }
        }
        catch {
            // Tray or window already destroyed during reload — ignore
        }
    });
    win = createWindow();
    electron_1.ipcMain.handle("start-manager", () => {
        return startManager();
    });
    electron_1.ipcMain.handle("stop-manager", () => {
        return stopManager();
    });
    electron_1.ipcMain.handle("get-manager-status", () => {
        return managerProcess !== null;
    });
    electron_1.ipcMain.handle("restart-app", () => {
        // Spawn a detached process that waits for this process tree to die,
        // then re-runs `npm run dev` in the project root.
        const child = (0, node_child_process_1.spawn)("sh", ["-c", `sleep 2 && npm run dev`], {
            cwd: PROJECT_ROOT,
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        // Exit Electron — concurrently's -k flag will kill the rest (Next.js, etc.)
        electron_1.app.exit(0);
    });
    electron_1.ipcMain.handle("pick-folder", async () => {
        const result = await electron_1.dialog.showOpenDialog({ properties: ["openDirectory"] });
        return result.filePaths[0] || null;
    });
    // --- File explorer IPC handlers ---
    electron_1.ipcMain.handle("get-home-path", () => {
        return node_os_1.default.homedir();
    });
    electron_1.ipcMain.handle("read-directory", async (_event, dirPath) => {
        try {
            const items = await (0, promises_1.readdir)(dirPath);
            const entries = [];
            for (const name of items) {
                try {
                    const fullPath = node_path_1.default.join(dirPath, name);
                    const s = await (0, promises_1.stat)(fullPath);
                    entries.push({
                        name,
                        path: fullPath,
                        isDirectory: s.isDirectory(),
                        size: s.size,
                        modifiedMs: s.mtimeMs,
                    });
                }
                catch {
                    // skip entries we can't stat
                }
            }
            return { ok: true, entries };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle("read-file", async (_event, filePath) => {
        try {
            const s = await (0, promises_1.stat)(filePath);
            if (s.size > 1024 * 1024) {
                return { ok: true, content: null, binary: true };
            }
            const content = await (0, promises_1.readFile)(filePath, "utf-8");
            return { ok: true, content, binary: false };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle("create-folder", async (_event, folderPath) => {
        try {
            await (0, promises_1.mkdir)(folderPath);
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle("rename-entry", async (_event, oldPath, newPath) => {
        try {
            await (0, promises_1.rename)(oldPath, newPath);
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle("delete-entry", async (_event, entryPath) => {
        try {
            await electron_1.shell.trashItem(entryPath);
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle("open-in-finder", async (_event, entryPath) => {
        electron_1.shell.showItemInFolder(entryPath);
        return { ok: true };
    });
    electron_1.ipcMain.handle("open-file", async (_event, filePath) => {
        try {
            await electron_1.shell.openPath(filePath);
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    // Auto-start the manager
    startManager();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    try {
        if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
        }
    }
    catch {
        // Window destroyed during reload — ignore
    }
});
electron_1.app.on("before-quit", () => {
    if (tray) {
        tray.destroy();
        tray = null;
    }
    if (managerProcess) {
        managerProcess.kill("SIGTERM");
        managerProcess = null;
    }
});
//# sourceMappingURL=main.js.map