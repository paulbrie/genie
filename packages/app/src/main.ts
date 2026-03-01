import {
  app,
  Tray,
  BrowserWindow,
  ipcMain,
  nativeImage,
  dialog,
  shell,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  stat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
} from "node:fs/promises";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

// Hot-reload in development: watches the dist/ folder for changes
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("electron-reload")(path.join(__dirname, ".."), {
    electron: process.execPath,
    forceHardReset: true,
  });
} catch {
  // electron-reload not available in production — ignore
}

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let managerProcess: ChildProcess | null = null;

// __dirname at runtime = packages/app/dist, so 3 levels up = project root
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules/.bin/tsx");
const MANAGER_ENTRY = path.join(
  PROJECT_ROOT,
  "packages/manager/src/index.ts"
);

// --- Window state persistence ---
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { width: 900, height: 600 };
  }
}

function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    // ignore write errors
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(win: BrowserWindow): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveWindowState(win), 500);
}

function createWindow(): BrowserWindow {
  const state = loadWindowState();

  const opts: Electron.BrowserWindowConstructorOptions = {
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
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  if (state.x !== undefined && state.y !== undefined) {
    opts.x = state.x;
    opts.y = state.y;
  }

  const window = new BrowserWindow(opts);

  const isDev = !app.isPackaged;
  if (isDev) {
    window.loadURL("http://localhost:3000");
  } else {
    window.loadFile(
      path.join(__dirname, "../../renderer/out/index.html")
    );
  }

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("resize", () => debouncedSave(window));
  window.on("move", () => debouncedSave(window));

  return window;
}

function sendToRenderer(channel: string, ...args: any[]): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function startManager(): boolean {
  if (managerProcess) return false;

  console.log(`[manager] Starting: ${TSX_BIN} ${MANAGER_ENTRY}`);
  console.log(`[manager] cwd: ${PROJECT_ROOT}`);

  managerProcess = spawn(TSX_BIN, [MANAGER_ENTRY], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  managerProcess.stdout?.on("data", (data: Buffer) => {
    console.log(`[manager] ${data.toString().trim()}`);
  });

  managerProcess.stderr?.on("data", (data: Buffer) => {
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

function stopManager(): boolean {
  if (!managerProcess) return false;
  managerProcess.kill("SIGTERM");
  setTimeout(() => {
    if (managerProcess) {
      managerProcess.kill("SIGKILL");
      managerProcess = null;
    }
  }, 3000);
  return true;
}

app.whenReady().then(() => {
  // Create tray icon — load @2x template image for retina, fall back to @1x
  const assetsDir = path.join(PROJECT_ROOT, "packages/app/assets");
  let icon: Electron.NativeImage;
  try {
    const img2x = nativeImage.createFromPath(
      path.join(assetsDir, "trayIcon@2x.png")
    );
    if (!img2x.isEmpty()) {
      icon = img2x;
    } else {
      icon = nativeImage.createFromPath(
        path.join(assetsDir, "trayIcon.png")
      );
    }
    icon = icon.resize({ width: 22, height: 22 });
    icon.setTemplateImage(true);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("Genie — App Manager");
  tray.on("click", () => {
    try {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    } catch {
      // Tray or window already destroyed during reload — ignore
    }
  });

  win = createWindow();

  ipcMain.handle("start-manager", () => {
    return startManager();
  });

  ipcMain.handle("stop-manager", () => {
    return stopManager();
  });

  ipcMain.handle("get-manager-status", () => {
    return managerProcess !== null;
  });

  ipcMain.handle("restart-app", () => {
    // Spawn a detached process that waits for this process tree to die,
    // then re-runs `npm run dev` in the project root.
    const child = spawn("sh", ["-c", `sleep 2 && npm run dev`], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Exit Electron — concurrently's -k flag will kill the rest (Next.js, etc.)
    app.exit(0);
  });

  ipcMain.handle("pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.filePaths[0] || null;
  });

  // --- File explorer IPC handlers ---

  ipcMain.handle("get-home-path", () => {
    return os.homedir();
  });

  ipcMain.handle("read-directory", async (_event, dirPath: string) => {
    try {
      const items = await readdir(dirPath);
      const entries = [];
      for (const name of items) {
        try {
          const fullPath = path.join(dirPath, name);
          const s = await stat(fullPath);
          entries.push({
            name,
            path: fullPath,
            isDirectory: s.isDirectory(),
            size: s.size,
            modifiedMs: s.mtimeMs,
          });
        } catch {
          // skip entries we can't stat
        }
      }
      return { ok: true, entries };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("read-file", async (_event, filePath: string) => {
    try {
      const s = await stat(filePath);
      if (s.size > 1024 * 1024) {
        return { ok: true, content: null, binary: true };
      }
      const content = await readFile(filePath, "utf-8");
      return { ok: true, content, binary: false };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("create-folder", async (_event, folderPath: string) => {
    try {
      await mkdir(folderPath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(
    "rename-entry",
    async (_event, oldPath: string, newPath: string) => {
      try {
        await rename(oldPath, newPath);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }
  );

  ipcMain.handle("delete-entry", async (_event, entryPath: string) => {
    try {
      await shell.trashItem(entryPath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("open-in-finder", async (_event, entryPath: string) => {
    shell.showItemInFolder(entryPath);
    return { ok: true };
  });

  ipcMain.handle("open-file", async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // --- Docs IPC handlers ---

  const DOCS_DIR = path.join(PROJECT_ROOT, "docs");

  ipcMain.handle("docs:list", async () => {
    try {
      await mkdir(DOCS_DIR, { recursive: true });
      const items = await readdir(DOCS_DIR);
      const files = items
        .filter((name) => name.endsWith(".md"))
        .map((name) => ({ name, path: path.join(DOCS_DIR, name) }));
      return { ok: true, files };
    } catch (err: any) {
      return { ok: false, error: err.message, files: [] };
    }
  });

  ipcMain.handle("docs:read", async (_event, filename: string) => {
    try {
      const filePath = path.join(DOCS_DIR, filename);
      const content = await readFile(filePath, "utf-8");
      return { ok: true, content };
    } catch (err: any) {
      return { ok: false, error: err.message, content: "" };
    }
  });

  ipcMain.handle(
    "docs:write",
    async (_event, filename: string, content: string) => {
      try {
        await mkdir(DOCS_DIR, { recursive: true });
        const filePath = path.join(DOCS_DIR, filename);
        await writeFile(filePath, content, "utf-8");
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }
  );

  ipcMain.handle("docs:delete", async (_event, filename: string) => {
    try {
      const filePath = path.join(DOCS_DIR, filename);
      await shell.trashItem(filePath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // Auto-start the manager
  startManager();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  try {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  } catch {
    // Window destroyed during reload — ignore
  }
});

app.on("before-quit", () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (managerProcess) {
    managerProcess.kill("SIGTERM");
    managerProcess = null;
  }
});
