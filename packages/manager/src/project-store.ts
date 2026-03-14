import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { v4 as uuidv4 } from "uuid";
import type { ProjectDef, ProjectCommand, ProcessStatus } from "./types.js";

const GENIE_DIR = path.join(os.homedir(), ".genie");
const PROJECTS_FILE = path.join(GENIE_DIR, "projects.json");

function ensureDir(): void {
  fs.mkdirSync(GENIE_DIR, { recursive: true });
}

export function load(): ProjectDef[] {
  ensureDir();
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function save(projects: ProjectDef[]): void {
  ensureDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

export function getAll(): ProjectDef[] {
  return load();
}

export function add(entry: {
  name: string;
  commands?: { name: string; command: string }[];
}): ProjectDef {
  const projects = load();
  const commands: ProjectCommand[] = (entry.commands || []).map((c) => ({
    id: uuidv4(),
    name: c.name,
    command: c.command,
  }));
  const commandStatuses: Record<string, ProcessStatus> = {};
  for (const cmd of commands) {
    commandStatuses[cmd.id] = "stopped";
  }
  const project: ProjectDef = {
    id: uuidv4(),
    name: entry.name,
    commands,
    commandStatuses,
    vpsInstances: [],
  };
  projects.push(project);
  save(projects);
  return project;
}

export function update(
  id: string,
  fields: {
    name?: string;
    commands?: { id?: string; name: string; command: string }[];
  }
): ProjectDef | null {
  const projects = load();
  const project = projects.find((p) => p.id === id);
  if (!project) return null;

  if (fields.name !== undefined) project.name = fields.name;

  if (fields.commands) {
    const existingIds = new Set(project.commands.map((c) => c.id));
    const newCommands: ProjectCommand[] = fields.commands.map((c) => {
      if (c.id && existingIds.has(c.id)) {
        return { id: c.id, name: c.name, command: c.command };
      }
      return { id: uuidv4(), name: c.name, command: c.command };
    });
    const newStatuses: Record<string, ProcessStatus> = {};
    for (const cmd of newCommands) {
      newStatuses[cmd.id] = project.commandStatuses[cmd.id] || "stopped";
    }
    project.commands = newCommands;
    project.commandStatuses = newStatuses;
  }

  save(projects);
  return project;
}

export function remove(id: string): boolean {
  const projects = load();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  save(projects);
  return true;
}

export function updateCommandStatus(
  projectId: string,
  commandId: string,
  status: ProcessStatus
): void {
  const projects = load();
  const project = projects.find((p) => p.id === projectId);
  if (project) {
    project.commandStatuses[commandId] = status;
    save(projects);
  }
}
