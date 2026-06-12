// Tracker: issue list/CRUD/reorder, label CRUD, and comment list/create/delete.
// Mutations re-broadcast the whole list via the injected broadcastTrackerList
// (ws-server also drives it from the MCP tracker tunnel + the feedback flow, so
// it stays there); issue/comment changes additionally push a targeted broadcast.
// Extracted from ws-server's switch — behavior unchanged. Note: feedback:submit
// stays in ws-server (different namespace, though it also calls the tracker).

import { type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import * as trackerService from "../tracker-service.js";
import * as projectService from "../projects/project-service.js";
import * as analyticsService from "../logging/analytics-service.js";


// Enforce (not just in the UI) that an issue is only assigned to someone who
// can see its project. null/undefined assignee = unassigned, always allowed.
async function assertAssigneeCanSeeProject(assigneeId: string | null | undefined, projectId: string): Promise<void> {
  if (!assigneeId) return;
  if (!(await projectService.userCanSeeProject(assigneeId, projectId))) {
    throw new Error("Assignee does not have access to this project");
  }
}

export async function handleTrackerMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  broadcast: (message: WsMessage) => void,
  broadcastTrackerList: () => Promise<void>,
): Promise<boolean> {
  switch (msg.type) {
    case "tracker:list": {
      try {
        // Scope issues to the projects this user may see (mirrors project:list /
        // broadcastTrackerList). Labels are global, not project-scoped.
        const allowedProjectIds = await projectService.getAccessibleProjectIds(userId);
        const [issues, labels] = await Promise.all([
          trackerService.listIssues(allowedProjectIds),
          trackerService.listLabels(),
        ]);
        send(ws, { type: "tracker:list", payload: { issues, labels } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:assignees:list": {
      try {
        const { projectId } = msg.payload as { projectId: string };
        // Only callers who can see the project may enumerate its members.
        if (!(await projectService.userCanSeeProject(userId, projectId))) {
          send(ws, { type: "tracker:error", payload: { message: "Not authorized" } });
          return true;
        }
        const assignees = await projectService.listProjectAssignableUsers(projectId);
        send(ws, { type: "tracker:assignees", payload: { projectId, users: assignees } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:issue:create": {
      try {
        const payload = msg.payload as { projectId: string; title: string; description?: string; status?: string; priority?: string; assigneeId?: string | null; labelIds?: string[] };
        await assertAssigneeCanSeeProject(payload.assigneeId, payload.projectId);
        const issue = await trackerService.createIssue(userId, payload);
        void analyticsService.recordEvent({ userId, userName: null, event: "tracker.issue_created", projectId: payload.projectId, props: {}, ip: null });
        send(ws, { type: "tracker:issue:created", payload: issue as Record<string, unknown> });
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:issue:update": {
      try {
        const { issueId, ...fields } = msg.payload;
        if (fields.assigneeId) {
          // Validate against the issue's target project (a move may also be in flight).
          const projectId = fields.projectId ?? (await trackerService.getIssueProjectId(issueId));
          if (projectId) await assertAssigneeCanSeeProject(fields.assigneeId, projectId);
        }
        const issue = await trackerService.updateIssue(userId, issueId, fields);
        if (!issue) {
          send(ws, { type: "tracker:error", payload: { message: "Issue not found" } });
        } else {
          broadcast({ type: "tracker:issue:updated", payload: issue });
          await broadcastTrackerList();
        }
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:issue:delete": {
      try {
        const { issueId } = msg.payload;
        const deleted = await trackerService.deleteIssue(userId, issueId);
        if (!deleted) {
          send(ws, { type: "tracker:error", payload: { message: "Issue not found" } });
        } else {
          broadcast({ type: "tracker:issue:deleted", payload: { issueId } });
          await broadcastTrackerList();
        }
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:issue:reorder": {
      try {
        const { issueId, sortOrder } = msg.payload;
        await trackerService.reorderIssue(issueId, sortOrder);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:label:create": {
      try {
        const { name, color } = msg.payload;
        await trackerService.createLabel(userId, name, color);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:label:update": {
      try {
        const { labelId, ...fields } = msg.payload;
        await trackerService.updateLabel(userId, labelId, fields);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:label:delete": {
      try {
        const { labelId } = msg.payload;
        await trackerService.deleteLabel(userId, labelId);
        await broadcastTrackerList();
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:comments:list": {
      try {
        const { issueId } = msg.payload;
        const comments = await trackerService.listComments(issueId);
        send(ws, { type: "tracker:comments:list", payload: { issueId, comments } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:comment:create": {
      try {
        const { issueId, content } = msg.payload;
        const userRow = await getDb()
          .select({ name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, userId))
          .then((r) => r[0]);
        const comment = await trackerService.createComment({
          issueId,
          userId,
          authorName: userRow?.name || "Unknown",
          authorAvatar: userRow?.avatarUrl || undefined,
          content,
        });
        broadcast({ type: "tracker:comment:created", payload: { issueId, comment } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:comment:delete": {
      try {
        const { commentId, issueId } = msg.payload;
        await trackerService.deleteComment(commentId);
        broadcast({ type: "tracker:comment:deleted", payload: { commentId, issueId } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
