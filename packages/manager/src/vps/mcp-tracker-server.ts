import http from "node:http";
import * as trackerService from "../tracker-service.js";

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
];

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function sendSseResponse(res: http.ServerResponse, payload: object) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
  res.end();
}

/**
 * Create a local MCP HTTP server that exposes tracker tools for a specific project.
 * This server is tunneled to the VPS so Claude Code can use it as an MCP server.
 */
export function createMcpTrackerServer(
  projectId: string,
  onIssueUpdated?: () => void,
): Promise<{ port: number; close(): void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === "GET") {
        res.writeHead(405).end();
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(200).end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
        return;
      }

      const { id, method, params } = parsed as {
        id?: unknown;
        method?: string;
        params?: Record<string, unknown>;
      };

      // Notifications (no id) — acknowledge with 202
      if (id === undefined || id === null) {
        res.writeHead(202).end();
        return;
      }

      try {
        let result: object;

        if (method === "initialize") {
          result = jsonRpcResponse(id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "genie-tracker-mcp", version: "1.0.0" },
            capabilities: { tools: {} },
          });
        } else if (method === "tools/list") {
          result = jsonRpcResponse(id, { tools: TOOLS });
        } else if (method === "tools/call") {
          const toolName = params?.name as string;
          const args = (params?.arguments ?? {}) as Record<string, unknown>;

          if (toolName === "tracker_list_issues") {
            const allIssues = await trackerService.listIssues();
            let issues = allIssues.filter((i) => i.projectId === projectId);

            if (args.status) {
              issues = issues.filter((i) => i.status === args.status);
            }
            if (args.priority) {
              issues = issues.filter((i) => i.priority === args.priority);
            }

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

            result = jsonRpcResponse(id, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(summary, null, 2),
                },
              ],
            });
          } else if (toolName === "tracker_get_issue") {
            const identifier = args.identifier as number;
            const allIssues = await trackerService.listIssues();
            const issue = allIssues.find(
              (i) => i.projectId === projectId && i.identifier === identifier,
            );

            if (!issue) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: `Issue #${identifier} not found in this project.` }],
                isError: true,
              });
            } else {
              result = jsonRpcResponse(id, {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
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
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }
          } else if (toolName === "tracker_update_issue") {
            const identifier = args.identifier as number;
            const allIssues = await trackerService.listIssues();
            const issue = allIssues.find(
              (i) => i.projectId === projectId && i.identifier === identifier,
            );

            if (!issue) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: `Issue #${identifier} not found in this project.` }],
                isError: true,
              });
            } else {
              const updateFields: Record<string, unknown> = {};
              if (args.status) updateFields.status = args.status;
              if (args.priority) updateFields.priority = args.priority;

              // Use a system user ID for agent updates
              const updated = await trackerService.updateIssue("system", issue.id, updateFields);
              if (updated) onIssueUpdated?.();
              result = jsonRpcResponse(id, {
                content: [
                  {
                    type: "text",
                    text: updated
                      ? `Issue #${identifier} updated successfully.`
                      : `Failed to update issue #${identifier}.`,
                  },
                ],
                isError: !updated,
              });
            }
          } else if (toolName === "tracker_comment_on_issue") {
            const identifier = args.identifier as number;
            const content = args.content as string;
            const allIssues = await trackerService.listIssues();
            const issue = allIssues.find(
              (i) => i.projectId === projectId && i.identifier === identifier,
            );

            if (!issue) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: `Issue #${identifier} not found in this project.` }],
                isError: true,
              });
            } else {
              const comment = await trackerService.createComment({
                issueId: issue.id,
                userId: null,
                authorName: "Genie",
                content,
              });
              if (comment) onIssueUpdated?.();
              result = jsonRpcResponse(id, {
                content: [
                  {
                    type: "text",
                    text: comment
                      ? `Comment added to issue #${identifier}.`
                      : `Failed to add comment to issue #${identifier}.`,
                  },
                ],
                isError: !comment,
              });
            }
          } else {
            result = jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
          }
        } else {
          result = jsonRpcError(id, -32601, `Method not found: ${method}`);
        }

        const accept = req.headers.accept || "";
        if (accept.includes("text/event-stream")) {
          sendSseResponse(res, result);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const errResp = jsonRpcError(id, -32000, message || "Internal error");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(errResp));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      console.log(`[mcp-tracker] Local HTTP server on port ${addr.port}`);
      resolve({
        port: addr.port,
        close() {
          server.close();
        },
      });
    });

    server.on("error", reject);
  });
}
