import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { v4 as uuidv4 } from "uuid";
import type { AppDef } from "./types.js";

const GENIE_DIR = path.join(os.homedir(), ".genie");
const APPS_FILE = path.join(GENIE_DIR, "apps.json");

function ensureDir(): void {
  if (!fs.existsSync(GENIE_DIR)) {
    fs.mkdirSync(GENIE_DIR, { recursive: true });
  }
}

export function load(): AppDef[] {
  ensureDir();
  if (!fs.existsSync(APPS_FILE)) {
    fs.writeFileSync(APPS_FILE, "[]", "utf-8");
    return [];
  }
  const raw = fs.readFileSync(APPS_FILE, "utf-8");
  return JSON.parse(raw);
}

export function save(apps: AppDef[]): void {
  ensureDir();
  fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), "utf-8");
}

export function add(entry: {
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}): AppDef {
  const apps = load();
  const app: AppDef = {
    id: uuidv4(),
    name: entry.name,
    command: entry.command,
    cwd: entry.cwd,
    env: entry.env,
    status: "stopped",
  };
  apps.push(app);
  save(apps);
  return app;
}

export function remove(id: string): boolean {
  const apps = load();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  apps.splice(idx, 1);
  save(apps);
  return true;
}

export function getAll(): AppDef[] {
  return load();
}

export function updateStatus(
  id: string,
  status: AppDef["status"]
): void {
  const apps = load();
  const app = apps.find((a) => a.id === id);
  if (app) {
    app.status = status;
    save(apps);
  }
}
