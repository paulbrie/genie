// Project setup-file editor: list/read/save/delete/add/rename the files stored
// in a project's setupFiles map (import-from-disk is a deprecated no-op). All
// cases resolve the project via projectService and reply on a project-file:*
// channel. Extracted from ws-server's switch — behavior unchanged.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as projectService from "../project-service.js";
import { isPrivilegedRole, type Role } from "../ws-acl.js";


export async function handleProjectFileMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string | null,
  role: Role | null,
): Promise<boolean> {
  if (!msg.type.startsWith("project-file:")) return false;
  // These cases read/write a project's setupFiles purely from a client-supplied
  // projectId. Gate on project access (privileged roles bypass) so a user can't
  // read or overwrite another project's files. Scoped to project-file:* above so
  // we never intercept a different handler's message.
  const gateProjectId = msg.payload?.projectId as string | undefined;
  if (gateProjectId && !isPrivilegedRole(role)
    && !(await projectService.userCanSeeProject(userId, gateProjectId))) {
    send(ws, { type: "error", payload: { message: "Not authorized for this project" } });
    return true;
  }
  switch (msg.type) {
    case "project-file:list": {
      const { projectId } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:files", payload: { projectId, files: [], error: "Project not found" } });
        return true;
      }
      const files = Object.keys(project.setupFiles || {});
      send(ws, { type: "project-file:files", payload: { projectId, files, error: null } });
      return true;
    }

    case "project-file:read": {
      const { projectId, fileName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:content", payload: { projectId, fileName, content: null, error: "Project not found" } });
        return true;
      }
      const content = (project.setupFiles || {})[fileName] ?? null;
      send(ws, { type: "project-file:content", payload: { projectId, fileName, content, error: null } });
      return true;
    }

    case "project-file:save": {
      const { projectId, fileName, content } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:saved", payload: { projectId, fileName, ok: false, error: "Project not found" } });
        return true;
      }
      const setupFiles = { ...(project.setupFiles || {}), [fileName]: content };
      await projectService.patchProject(projectId, { setupFiles });
      send(ws, { type: "project-file:saved", payload: { projectId, fileName, ok: true, error: null } });
      return true;
    }

    case "project-file:delete": {
      const { projectId, fileName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:deleted", payload: { projectId, fileName, ok: false, error: "Project not found" } });
        return true;
      }
      const remaining = { ...(project.setupFiles || {}) };
      delete remaining[fileName];
      await projectService.patchProject(projectId, { setupFiles: remaining });
      send(ws, { type: "project-file:deleted", payload: { projectId, fileName, ok: true, error: null } });
      return true;
    }

    case "project-file:add": {
      const { projectId, fileName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:added", payload: { projectId, fileName, ok: false, error: "Project not found" } });
        return true;
      }
      const withNew = { ...(project.setupFiles || {}), [fileName]: "" };
      await projectService.patchProject(projectId, { setupFiles: withNew });
      send(ws, { type: "project-file:added", payload: { projectId, fileName, ok: true, error: null } });
      return true;
    }

    case "project-file:rename": {
      const { projectId, oldName, newName } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "project-file:renamed", payload: { projectId, ok: false, error: "Project not found" } });
        return true;
      }
      const files = { ...(project.setupFiles || {}) };
      if (!(oldName in files)) {
        send(ws, { type: "project-file:renamed", payload: { projectId, ok: false, error: "File not found" } });
        return true;
      }
      const content = files[oldName];
      delete files[oldName];
      files[newName] = content;
      await projectService.patchProject(projectId, { setupFiles: files });
      send(ws, { type: "project-file:renamed", payload: { projectId, oldName, newName, ok: true, error: null } });
      return true;
    }

    case "project-file:import-from-disk": {
      const { projectId } = msg.payload;
      send(ws, { type: "project-file:imported", payload: { projectId, files: [], error: "Import from disk is no longer supported. Create files directly in the editor." } });
      return true;
    }

    default:
      return false;
  }
}
