import { spawn, type ChildProcess } from "node:child_process";
import * as projectService from "./project-service.js";
import { LogBuffer } from "../logging/log-buffer.js";

type EventCallback = (event: {
  type: string;
  payload: Record<string, unknown>;
}) => void;

const processes = new Map<string, ChildProcess>();
const logs = new LogBuffer();
let onEvent: EventCallback = () => {};

function compositeKey(projectId: string, commandId: string): string {
  return `${projectId}:${commandId}`;
}

export function getLogBuffer(projectId: string, commandId: string): string {
  return logs.get(compositeKey(projectId, commandId));
}

export function getAllLogBuffers(): Record<string, string> {
  return logs.getAll();
}

export function setEventCallback(cb: EventCallback): void {
  onEvent = cb;
}

export async function startCommand(projectId: string, commandId: string): Promise<boolean> {
  const key = compositeKey(projectId, commandId);
  if (processes.has(key)) return false;

  const project = await projectService.getById(projectId);
  if (!project) return false;

  const cmd = project.commands.find((c) => c.id === commandId);
  if (!cmd) return false;

  const child = spawn(cmd.command, {
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  processes.set(key, child);
  void projectService.updateCommandStatus(projectId, commandId, "running");
  onEvent({
    type: "project:status",
    payload: { projectId, commandId, status: "running" },
  });

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    logs.append(key, text);
    onEvent({
      type: "project:log",
      payload: { projectId, commandId, stream: "stdout", data: text },
    });
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    logs.append(key, text);
    onEvent({
      type: "project:log",
      payload: { projectId, commandId, stream: "stderr", data: text },
    });
  });

  child.on("exit", (code) => {
    processes.delete(key);
    const status = code === 0 || code === null ? "stopped" : "crashed";
    void projectService.updateCommandStatus(projectId, commandId, status);
    onEvent({
      type: "project:status",
      payload: { projectId, commandId, status },
    });
  });

  child.on("error", (err) => {
    processes.delete(key);
    void projectService.updateCommandStatus(projectId, commandId, "crashed");
    onEvent({
      type: "project:status",
      payload: { projectId, commandId, status: "crashed" },
    });
    onEvent({
      type: "error",
      payload: { message: err.message, context: `project:${projectId}:${commandId}` },
    });
  });

  return true;
}

export function stopCommand(projectId: string, commandId: string): boolean {
  const key = compositeKey(projectId, commandId);
  const child = processes.get(key);
  if (!child) return false;

  child.kill("SIGTERM");

  setTimeout(() => {
    if (processes.has(key)) {
      child.kill("SIGKILL");
    }
  }, 5000);

  return true;
}

export async function startAll(projectId: string): Promise<void> {
  const project = await projectService.getById(projectId);
  if (!project) return;

  for (const cmd of project.commands) {
    await startCommand(projectId, cmd.id);
  }
}

export async function stopAll(projectId: string): Promise<void> {
  const project = await projectService.getById(projectId);
  if (!project) return;

  for (const cmd of project.commands) {
    stopCommand(projectId, cmd.id);
  }
}

export function stopEverything(): void {
  for (const [key] of processes) {
    const [projectId, commandId] = key.split(":");
    stopCommand(projectId, commandId);
  }
}
