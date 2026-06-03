import * as trackerService from "../tracker-service.js";
import { createMcpHttpServer, type JsonRpcRequest } from "./mcp-jsonrpc.js";

const TOOLS = [
  {
    name: "tracker_list_issues",
    description:
      "List all tracker issues for this project. Returns issues with title, description, status, priority, labels, and assignee.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
          description: "Filter by status (optional)",
        },
        priority: {
          type: "string",
          enum: ["none", "urgent", "high", "medium", "low"],
          description: "Filter by priority (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "tracker_get_issue",
    description:
      "Get a single tracker issue by its identifier number (e.g. #12). Returns full details including description.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: {
          type: "number",
          description: "The issue identifier number (e.g. 12 for issue #12)",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "tracker_update_issue",
    description:
      "Update a tracker issue's status or other fields. Use this to move issues through the workflow (e.g. mark as in_progress when starting work, in_review when you finish — never set to done directly, always use in_review so a human can verify).",
    inputSchema: {
      type: "object",
      properties: {
        identifier: {
          type: "number",
          description: "The issue identifier number",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
          description: "New status",
        },
        priority: {
          type: "string",
          enum: ["none", "urgent", "high", "medium", "low"],
          description: "New priority",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "tracker_comment_on_issue",
    description:
      "Add a comment to a tracker issue. Use this to leave progress notes, summaries of work done, or questions. When finishing a task, always leave a concise summary comment listing what was changed before setting status to in_review.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: {
          type: "number",
          description: "The issue identifier number (e.g. 12 for issue #12)",
        },
        content: {
          type: "string",
          description: "The comment content (markdown supported). When finishing a task, include a concise bullet list of changes made.",
        },
      },
      required: ["identifier", "content"],
    },
  },
  {
    name: "tracker_create_issue",
    description:
      "Create a new tracker issue (ticket) in this project. Use this when the user asks to file a bug, capture a follow-up, or record a TODO they want tracked. The project is fixed — you only choose the content. Defaults: status='todo', priority='none'. Returns the newly assigned identifier (e.g. #42).",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short imperative-form summary, e.g. 'Fix login redirect on Safari'. Required.",
        },
        description: {
          type: "string",
          description: "Body of the ticket — context, reproduction steps, links. Markdown supported. Optional but recommended for anything non-trivial.",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
          description: "Initial status. Defaults to 'todo'. Use 'backlog' for ideas you don't want on the active board yet.",
        },
        priority: {
          type: "string",
          enum: ["none", "urgent", "high", "medium", "low"],
          description: "Initial priority. Defaults to 'none' — only set when the user signals urgency.",
        },
      },
      required: ["title"],
    },
  },
];

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Pure JSON-RPC handler for the tracker MCP. Both the legacy HTTP server and
 *  the new stdio bridge (mcp-stream-tunnel) dispatch through here, so the
 *  transport is the only thing that varies. Returns the full JSON-RPC envelope
 *  (with `id`), or `null` for notifications that don't expect a reply. */
export async function handleTrackerRequest(
  projectId: string,
  req: { id?: unknown; method?: string; params?: Record<string, unknown> },
  opts?: { onIssueUpdated?: () => void },
): Promise<object | null> {
  const { id, method, params } = req;
  if (id === undefined || id === null) return null;

  try {
    if (method === "initialize") {
      return jsonRpcResponse(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "genie-tracker-mcp", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }
    if (method === "tools/list") {
      return jsonRpcResponse(id, { tools: TOOLS });
    }
    if (method !== "tools/call") {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }

    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    if (toolName === "tracker_list_issues") {
      const allIssues = await trackerService.listIssues();
      let issues = allIssues.filter((i) => i.projectId === projectId);
      if (args.status) issues = issues.filter((i) => i.status === args.status);
      if (args.priority) issues = issues.filter((i) => i.priority === args.priority);
      const summary = issues.map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        status: i.status,
        priority: i.priority,
        assignee: i.assigneeName || null,
        labels: i.labels.map((l) => l.name),
        description: i.description?.slice(0, 200) || "",
        updatedAt: i.updatedAt,
      }));
      return jsonRpcResponse(id, { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] });
    }

    if (toolName === "tracker_get_issue") {
      const identifier = args.identifier as number;
      const allIssues = await trackerService.listIssues();
      const issue = allIssues.find((i) => i.projectId === projectId && i.identifier === identifier);
      if (!issue) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Issue #${identifier} not found in this project.` }],
          isError: true,
        });
      }
      return jsonRpcResponse(id, {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            priority: issue.priority,
            assignee: issue.assigneeName || null,
            labels: issue.labels.map((l) => l.name),
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
          }, null, 2),
        }],
      });
    }

    if (toolName === "tracker_update_issue") {
      const identifier = args.identifier as number;
      const allIssues = await trackerService.listIssues();
      const issue = allIssues.find((i) => i.projectId === projectId && i.identifier === identifier);
      if (!issue) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Issue #${identifier} not found in this project.` }],
          isError: true,
        });
      }
      const updateFields: Record<string, unknown> = {};
      if (args.status) updateFields.status = args.status;
      if (args.priority) updateFields.priority = args.priority;
      const updated = await trackerService.updateIssue("system", issue.id, updateFields);
      if (updated) opts?.onIssueUpdated?.();
      return jsonRpcResponse(id, {
        content: [{ type: "text", text: updated ? `Issue #${identifier} updated successfully.` : `Failed to update issue #${identifier}.` }],
        isError: !updated,
      });
    }

    if (toolName === "tracker_create_issue") {
      const title = args.title as string | undefined;
      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Cannot create issue: 'title' is required and must be a non-empty string." }],
          isError: true,
        });
      }
      const description = typeof args.description === "string" ? args.description : undefined;
      const status = typeof args.status === "string" ? args.status : undefined;
      const priority = typeof args.priority === "string" ? args.priority : undefined;
      const created = await trackerService.createIssue("system", { projectId, title: title.trim(), description, status, priority });
      if (created) opts?.onIssueUpdated?.();
      return jsonRpcResponse(id, {
        content: [{ type: "text", text: created ? `Created issue #${created.identifier}: ${created.title}` : "Failed to create issue." }],
        isError: !created,
      });
    }

    if (toolName === "tracker_comment_on_issue") {
      const identifier = args.identifier as number;
      const content = args.content as string;
      const allIssues = await trackerService.listIssues();
      const issue = allIssues.find((i) => i.projectId === projectId && i.identifier === identifier);
      if (!issue) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Issue #${identifier} not found in this project.` }],
          isError: true,
        });
      }
      const comment = await trackerService.createComment({ issueId: issue.id, userId: null, authorName: "Genie", content });
      if (comment) opts?.onIssueUpdated?.();
      return jsonRpcResponse(id, {
        content: [{ type: "text", text: comment ? `Comment added to issue #${identifier}.` : `Failed to add comment to issue #${identifier}.` }],
        isError: !comment,
      });
    }

    return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32000, message || "Internal error");
  }
}

/** Local HTTP server for MCP reverse tunnels. */
export function createMcpTrackerServer(
  projectId: string,
  onIssueUpdated?: () => void,
): Promise<{ port: number; close(): void }> {
  return createMcpHttpServer((parsed) =>
    handleTrackerRequest(projectId, parsed as JsonRpcRequest, { onIssueUpdated }),
  );
}
