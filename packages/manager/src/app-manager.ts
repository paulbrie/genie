import { spawn, type ChildProcess } from "node:child_process";
import type { AppDef } from "./types.js";
import * as store from "./store.js";

type EventCallback = (event: {
  type: string;
  payload: Record<string, unknown>;
}) => void;

const processes = new Map<string, ChildProcess>();
const logBuffers = new Map<string, string>();
const MAX_LOG_BUFFER = 50000;
let onEvent: EventCallback = () => {};

export function getLogBuffer(id: string): string {
  return logBuffers.get(id) || "";
}

export function getAllLogBuffers(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [id, buf] of logBuffers) {
    if (buf) result[id] = buf;
  }
  return result;
}

function appendLogBuffer(id: string, data: string): void {
  let buf = logBuffers.get(id) || "";
  buf += data;
  if (buf.length > MAX_LOG_BUFFER) {
    buf = buf.slice(-MAX_LOG_BUFFER);
  }
  logBuffers.set(id, buf);
}

export function setEventCallback(cb: EventCallback): void {
  onEvent = cb;
}

export function getRunningPids(): Map<string, number> {
  const pids = new Map<string, number>();
  for (const [id, proc] of processes) {
    if (proc.pid) pids.set(id, proc.pid);
  }
  return pids;
}

export function startApp(id: string): boolean {
  if (processes.has(id)) return false;

  const apps = store.getAll();
  const app = apps.find((a) => a.id === id);
  if (!app) return false;

  const child = spawn(app.command, {
    shell: true,
    cwd: app.cwd || process.cwd(),
    env: { ...process.env, ...app.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  processes.set(id, child);
  store.updateStatus(id, "running");
  onEvent({ type: "app:status", payload: { id, status: "running" } });

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    appendLogBuffer(id, text);
    onEvent({
      type: "app:log",
      payload: { id, stream: "stdout", data: text },
    });
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    appendLogBuffer(id, text);
    onEvent({
      type: "app:log",
      payload: { id, stream: "stderr", data: text },
    });
  });

  child.on("exit", (code) => {
    processes.delete(id);
    const status = code === 0 || code === null ? "stopped" : "crashed";
    store.updateStatus(id, status);
    onEvent({ type: "app:status", payload: { id, status } });
  });

  child.on("error", (err) => {
    processes.delete(id);
    store.updateStatus(id, "crashed");
    onEvent({ type: "app:status", payload: { id, status: "crashed" } });
    onEvent({
      type: "error",
      payload: { message: err.message, context: `app:${id}` },
    });
  });

  return true;
}

export function stopApp(id: string): boolean {
  const child = processes.get(id);
  if (!child) return false;

  child.kill("SIGTERM");

  // Force kill after 5 seconds if still alive
  setTimeout(() => {
    if (processes.has(id)) {
      child.kill("SIGKILL");
    }
  }, 5000);

  return true;
}

export function stopAll(): void {
  for (const [id] of processes) {
    stopApp(id);
  }
}
