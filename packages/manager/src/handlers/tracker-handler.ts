// Tracker: issue list/CRUD/reorder, label CRUD, and comment list/create/delete.
// Mutations re-broadcast the whole list via the injected broadcastTrackerList
// (ws-server also drives it from the MCP tracker tunnel + the feedback flow, so
// it stays there); issue/comment changes additionally push a targeted broadcast.
// Extracted from ws-server's switch — behavior unchanged. Note: feedback:submit
// stays in ws-server (different namespace, though it also calls the tracker).

import { type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { WsMessage as WsMessageBase } from "../types.js";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import * as trackerService from "../tracker-service.js";

export interface WsMessage extends Omit<WsMessageBase, "payload"> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
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
        const [issues, labels] = await Promise.all([
          trackerService.listIssues(),
          trackerService.listLabels(),
        ]);
        send(ws, { type: "tracker:list", payload: { issues, labels } });
      } catch (err: unknown) {
        send(ws, { type: "tracker:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "tracker:issue:create": {
      try {
        const issue = await trackerService.createIssue(userId, msg.payload as { projectId: string; title: string; description?: string; status?: string; priority?: string; assigneeId?: string | null; labelIds?: string[] });
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
