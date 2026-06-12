import { type WebSocket } from "ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { WsMessage, StatsPayload } from "../types.js";
import * as projectService from "../projects/project-service.js";
import * as trackerService from "../tracker-service.js";
import * as settingsService from "../settings-service.js";
import { setMonitoringInterval, getDockerBin } from "../logging/monitor.js";
import { getLogBuffer, clearLogBuffer, getErrorBuffer, clearErrorBuffer } from "../logging/log-capture.js";
import { getDb } from "../db/index.js";
import { savedQueries, users } from "../db/schema.js";
import {
  type ClientState,
  broadcastStats,
  broadcastTrackerList,
} from "../ws-server.js";


const execFileAsync = promisify(execFile);

/** Handle assorted small namespaces: process:kill, docker:*, logs:*,
 *  monitor:set-interval, compose:*, feedback:submit,
 *  settings:*, db:saved-queries:*. Returns true if handled. */
export async function handleMiscMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  broadcast: (message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  const userId = state.userId;
  switch (msg.type) {
    case "process:kill": {
      const { pid } = msg.payload;
      try {
        process.kill(pid, "SIGTERM");
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to kill process ${pid}: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      return true;
    }

    case "docker:open":
    case "docker:daemon:start": {
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Docker"]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to ${msg.type === "docker:open" ? "open" : "start"} Docker: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      return true;
    }

    case "docker:daemon:stop": {
      try {
        await execFileAsync("/usr/bin/killall", ["Docker Desktop"]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to stop Docker: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      return true;
    }

    case "docker:start": {
      const { id } = msg.payload;
      const bin = getDockerBin();
      if (!bin) {
        send(ws, { type: "error", payload: { message: "Docker CLI not found" } });
        return true;
      }
      try {
        await execFileAsync(bin, ["start", id]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to start container ${id}: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      return true;
    }

    case "docker:stop": {
      const { id } = msg.payload;
      const bin = getDockerBin();
      if (!bin) {
        send(ws, { type: "error", payload: { message: "Docker CLI not found" } });
        return true;
      }
      try {
        await execFileAsync(bin, ["stop", id]);
      } catch (err: unknown) {
        send(ws, {
          type: "error",
          payload: { message: `Failed to stop container ${id}: ${(err instanceof Error ? err.message : String(err))}` },
        });
      }
      return true;
    }

    case "logs:subscribe": {
      const source = (msg.payload as { source?: string } | undefined)?.source ?? "manager";
      if (source === "errors") {
        send(ws, { type: "logs:errors:backlog", payload: { source: "errors", data: getErrorBuffer() } });
      } else {
        send(ws, { type: "logs:backlog", payload: { source: "manager", data: getLogBuffer() } });
      }
      return true;
    }

    case "logs:unsubscribe":
      return true;

    case "logs:clear": {
      const source = (msg.payload as { source?: string } | undefined)?.source ?? "manager";
      if (source === "errors") {
        // ws-acl gates reading the errors buffer to superadmin; the writer side
        // (logs:clear) rides the admin-level "logs:*" send default, so require
        // superadmin explicitly here — otherwise an admin who can't read the
        // buffer could still wipe it.
        if (state.role !== "superadmin") return true;
        clearErrorBuffer();
      } else {
        clearLogBuffer();
      }
      return true;
    }

    case "monitor:set-interval": {
      const ms = msg.payload.intervalMs;
      if (typeof ms === "number" && ms >= 500 && ms <= 30000) {
        setMonitoringInterval((stats: StatsPayload) => {
          broadcastStats(stats);
        }, ms);
        broadcast({ type: "monitor:interval", payload: { intervalMs: ms } });
      }
      return true;
    }

    case "compose:read": {
      const { projectId } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "compose:content", payload: { projectId, content: null, error: "Project not found" } });
        return true;
      }
      const composeNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
      const files = project.setupFiles || {};
      let composeContent: string | null = null;
      let composeFileName: string | null = null;
      for (const name of composeNames) {
        if (name in files) { composeContent = files[name]; composeFileName = name; break; }
      }
      send(ws, { type: "compose:content", payload: { projectId, content: composeContent, filePath: composeFileName, error: null } });
      return true;
    }

    case "compose:save": {
      const { projectId, content } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "compose:saved", payload: { projectId, ok: false, error: "Project not found" } });
        return true;
      }
      const composeNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
      const files = project.setupFiles || {};
      let targetName = "docker-compose.yml";
      for (const name of composeNames) {
        if (name in files) { targetName = name; break; }
      }
      const setupFiles = { ...files, [targetName]: content };
      await projectService.patchProject(projectId, { setupFiles });
      send(ws, { type: "compose:saved", payload: { projectId, ok: true, filePath: targetName, error: null } });
      return true;
    }

    case "feedback:submit": {
      try {
        if (!userId) return true;
        const { title, description } = msg.payload as { title: string; description: string };
        if (!title?.trim()) { send(ws, { type: "feedback:error", payload: { message: "Title is required" } }); return true; }

        // Feedback lands as a tracker issue on the first project (Genie keeps
        // a dedicated "feedback" project at the top).
        const allProjects = await projectService.getAll();
        if (allProjects.length === 0) { send(ws, { type: "feedback:error", payload: { message: "No projects available" } }); return true; }
        const feedbackProject = allProjects[0];

        const userName = state.user?.name || "Unknown";
        const userEmail = state.user?.email || "";
        const issueTitle = `[Feedback] ${title.trim()}`;
        const issueDesc = `${description?.trim() || ""}\n\n---\nSubmitted by: ${userName} (${userEmail})`;
        await trackerService.createIssue(userId, {
          projectId: feedbackProject.id,
          title: issueTitle,
          description: issueDesc,
          status: "todo",
          priority: "medium",
        });
        await broadcastTrackerList();

        try {
          const sgApiKey = process.env.SENDGRID_API_KEY;
          if (sgApiKey) {
            const sgMail = (await import("@sendgrid/mail")).default;
            sgMail.setApiKey(sgApiKey);
            await sgMail.send({
              to: "paul.brie@teleporthq.io",
              from: process.env.BACKUP_EMAIL || "noreply@teleporthq.io",
              subject: `[Genie Feedback] ${title.trim()}`,
              text: `New feedback from ${userName} (${userEmail}):\n\nTitle: ${title.trim()}\n\n${description?.trim() || "(no description)"}`,
            });
          }
        } catch (emailErr) {
          console.error("Failed to send feedback email:", emailErr);
        }

        send(ws, { type: "feedback:submitted", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "feedback:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "settings:get": {
      const reqId = msg.payload?.reqId;
      try {
        if (!userId) { send(ws, { type: "settings:result", payload: { reqId } }); return true; }
        const data = await settingsService.getComposedSettings(userId, state.role);
        send(ws, { type: "settings:result", payload: { ...data, reqId } });
      } catch {
        send(ws, { type: "settings:result", payload: { reqId } });
      }
      return true;
    }

    case "settings:save": {
      const { reqId, ...fields } = msg.payload;
      try {
        if (!userId) { send(ws, { type: "settings:result", payload: { ok: false, error: "Not authenticated", reqId } }); return true; }
        await settingsService.saveRoutedSettings(userId, fields, state.role);
        send(ws, { type: "settings:result", payload: { ok: true, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "settings:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "db:saved-queries:list": {
      const { projectId, reqId } = msg.payload;
      try {
        const db = getDb();
        const rows = await db.select({
          id: savedQueries.id,
          projectId: savedQueries.projectId,
          userId: savedQueries.userId,
          name: savedQueries.name,
          description: savedQueries.description,
          query: savedQueries.query,
          createdAt: savedQueries.createdAt,
          updatedAt: savedQueries.updatedAt,
          userName: users.name,
          userAvatar: users.avatarUrl,
        })
          .from(savedQueries)
          .leftJoin(users, eq(savedQueries.userId, users.id))
          .where(eq(savedQueries.projectId, projectId))
          .orderBy(savedQueries.name);
        send(ws, { type: "db:saved-queries:result", payload: { ok: true, queries: rows, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "db:saved-queries:save": {
      const { projectId, name, description, query, queryId, reqId } = msg.payload;
      if (!userId) { send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: "Not authenticated", reqId } }); return true; }
      try {
        const db = getDb();
        if (queryId) {
          await db.update(savedQueries).set({ name, description, query, updatedAt: new Date() }).where(eq(savedQueries.id, queryId));
        } else {
          await db.insert(savedQueries).values({ projectId, userId, name, description, query });
        }
        const rows = await db.select({
          id: savedQueries.id,
          projectId: savedQueries.projectId,
          userId: savedQueries.userId,
          name: savedQueries.name,
          description: savedQueries.description,
          query: savedQueries.query,
          createdAt: savedQueries.createdAt,
          updatedAt: savedQueries.updatedAt,
          userName: users.name,
          userAvatar: users.avatarUrl,
        })
          .from(savedQueries)
          .leftJoin(users, eq(savedQueries.userId, users.id))
          .where(eq(savedQueries.projectId, projectId))
          .orderBy(savedQueries.name);
        send(ws, { type: "db:saved-queries:result", payload: { ok: true, queries: rows, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "db:saved-queries:delete": {
      const { projectId, queryId, reqId } = msg.payload;
      try {
        const db = getDb();
        await db.delete(savedQueries).where(eq(savedQueries.id, queryId));
        const rows = await db.select({
          id: savedQueries.id,
          projectId: savedQueries.projectId,
          userId: savedQueries.userId,
          name: savedQueries.name,
          description: savedQueries.description,
          query: savedQueries.query,
          createdAt: savedQueries.createdAt,
          updatedAt: savedQueries.updatedAt,
          userName: users.name,
          userAvatar: users.avatarUrl,
        })
          .from(savedQueries)
          .leftJoin(users, eq(savedQueries.userId, users.id))
          .where(eq(savedQueries.projectId, projectId))
          .orderBy(savedQueries.name);
        send(ws, { type: "db:saved-queries:result", payload: { ok: true, queries: rows, reqId } });
      } catch (err: unknown) {
        send(ws, { type: "db:saved-queries:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    default:
      return false;
  }
}
