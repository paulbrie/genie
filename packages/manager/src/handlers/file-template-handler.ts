// File-template CRUD: list/create/update/delete, plus inject-into-project and
// save-from-project. Templates live in the `fileTemplates` table; inject and
// save-from-project read/write a project's setupFiles via projectService.
// Extracted from ws-server's switch — same behavior, returns false to fall
// through to the next handler when the message isn't ours.

import { type WebSocket } from "ws";
import { eq, and } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import { getDb } from "../db/index.js";
import { fileTemplates } from "../db/schema.js";
import * as projectService from "../projects/project-service.js";


export async function handleFileTemplateMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
): Promise<boolean> {
  switch (msg.type) {
    case "file-template:list": {
      const db = getDb();
      const rows = await db.select().from(fileTemplates).orderBy(fileTemplates.name);
      const templates = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        files: r.files as Record<string, string>,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
      }));
      send(ws, { type: "file-template:list", payload: { templates } });
      return true;
    }

    case "file-template:create": {
      const { name, description, files } = msg.payload;
      const db = getDb();
      const [row] = await db.insert(fileTemplates).values({
        name,
        description: description || "",
        files: files || {},
        createdBy: userId,
      }).returning();
      send(ws, { type: "file-template:created", payload: { ok: true, template: { id: row.id, name: row.name, description: row.description, files: row.files, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() } } });
      return true;
    }

    case "file-template:update": {
      const { id, name, description, files } = msg.payload;
      const db = getDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) patch.name = name;
      if (description !== undefined) patch.description = description;
      if (files !== undefined) patch.files = files;
      // Scope to the creator: a user may only edit their own templates.
      await db.update(fileTemplates).set(patch).where(and(eq(fileTemplates.id, id), eq(fileTemplates.createdBy, userId)));
      send(ws, { type: "file-template:updated", payload: { ok: true, id } });
      return true;
    }

    case "file-template:delete": {
      const { id } = msg.payload;
      const db = getDb();
      // Scope to the creator: a user may only delete their own templates.
      await db.delete(fileTemplates).where(and(eq(fileTemplates.id, id), eq(fileTemplates.createdBy, userId)));
      send(ws, { type: "file-template:deleted", payload: { ok: true, id } });
      return true;
    }

    case "file-template:inject": {
      const { projectId, templateId, mode } = msg.payload; // mode: "merge" | "replace"
      if (!(await projectService.userCanManageProject(userId, projectId))) {
        send(ws, { type: "file-template:injected", payload: { ok: false, error: "Not authorized for this project" } });
        return true;
      }
      const db = getDb();
      const [tpl] = await db.select().from(fileTemplates).where(eq(fileTemplates.id, templateId));
      if (!tpl) {
        send(ws, { type: "file-template:injected", payload: { ok: false, error: "Template not found" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "file-template:injected", payload: { ok: false, error: "Project not found" } });
        return true;
      }
      const tplFiles = (tpl.files || {}) as Record<string, string>;
      const existing = (project.setupFiles || {}) as Record<string, string>;
      const merged = mode === "replace" ? { ...tplFiles } : { ...existing, ...tplFiles };
      await projectService.patchProject(projectId, { setupFiles: merged });
      send(ws, { type: "file-template:injected", payload: { ok: true, projectId } });
      return true;
    }

    case "file-template:save-from-project": {
      const { projectId, name, description } = msg.payload;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "file-template:created", payload: { ok: false, error: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "file-template:created", payload: { ok: false, error: "Project not found" } });
        return true;
      }
      const db = getDb();
      const [row] = await db.insert(fileTemplates).values({
        name,
        description: description || "",
        files: project.setupFiles || {},
        createdBy: userId,
      }).returning();
      send(ws, { type: "file-template:created", payload: { ok: true, template: { id: row.id, name: row.name, description: row.description, files: row.files, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() } } });
      return true;
    }

    default:
      return false;
  }
}
