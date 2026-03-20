import http from "node:http";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import * as chatService from "../chat-service.js";
import { getClaudeUserId } from "../db/seed.js";

const TOOLS = [
  {
    name: "notify_send_email",
    description:
      "Send an email to the admin. Use this to alert the admin about important events, errors, completed tasks, or anything that requires their attention.",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body (plain text)",
        },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "notify_send_chat_message",
    description:
      "Send a message to the admin through Genie's chat. The message appears in the admin's DM conversation with Claude. Use this to communicate progress, ask questions, or report results.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message content (markdown supported)",
        },
      },
      required: ["message"],
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

/** Find admin user ID — superadmin/admin role, or first non-agent user */
async function getAdminUserId(): Promise<string | null> {
  const db = getDb();

  // Check for superadmin first, then admin
  const [superAdmin] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.role, "superadmin"))
    .limit(1);
  if (superAdmin) return superAdmin.id;

  const [admin] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  if (admin) return admin.id;

  // Fallback: first non-agent user
  const [first] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.isAgent, false))
    .limit(1);
  return first?.id ?? null;
}

/** Get admin email address */
async function getAdminEmail(): Promise<string | null> {
  const db = getDb();
  const [superAdmin] = await db.select({ email: users.email })
    .from(users)
    .where(eq(users.role, "superadmin"))
    .limit(1);
  if (superAdmin) return superAdmin.email;

  const [admin] = await db.select({ email: users.email })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  if (admin) return admin.email;

  const [first] = await db.select({ email: users.email })
    .from(users)
    .where(eq(users.isAgent, false))
    .limit(1);
  return first?.email ?? null;
}

/**
 * Create a local MCP HTTP server that exposes notification tools.
 * This server is tunneled to the VPS so Claude Code can send emails
 * and chat messages to the admin.
 *
 * @param broadcastChatMessage - callback to broadcast a new chat message to connected WS clients
 */
export function createMcpNotifyServer(
  broadcastChatMessage: (memberIds: string[], conversationId: string, message: unknown) => void,
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
            serverInfo: { name: "genie-notify-mcp", version: "1.0.0" },
            capabilities: { tools: {} },
          });
        } else if (method === "tools/list") {
          result = jsonRpcResponse(id, { tools: TOOLS });
        } else if (method === "tools/call") {
          const toolName = params?.name as string;
          const args = (params?.arguments ?? {}) as Record<string, unknown>;

          if (toolName === "notify_send_email") {
            const subject = args.subject as string;
            const emailBody = args.body as string;
            if (!subject || !emailBody) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: subject and body are required." }],
                isError: true,
              });
            } else {
              const sgApiKey = process.env.SENDGRID_API_KEY;
              const adminEmail = await getAdminEmail();
              if (!sgApiKey || !adminEmail) {
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: "Email not configured: SENDGRID_API_KEY or admin email missing." }],
                  isError: true,
                });
              } else {
                try {
                  const sgMail = (await import("@sendgrid/mail")).default;
                  sgMail.setApiKey(sgApiKey);
                  await sgMail.send({
                    to: adminEmail,
                    from: process.env.BACKUP_EMAIL || "noreply@teleporthq.io",
                    subject: `[Genie VPS] ${subject}`,
                    text: emailBody,
                  });
                  result = jsonRpcResponse(id, {
                    content: [{ type: "text", text: `Email sent to admin (${adminEmail}).` }],
                  });
                } catch (emailErr: unknown) {
                  const errMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
                  result = jsonRpcResponse(id, {
                    content: [{ type: "text", text: `Failed to send email: ${errMsg}` }],
                    isError: true,
                  });
                }
              }
            }
          } else if (toolName === "notify_send_chat_message") {
            const message = args.message as string;
            if (!message) {
              result = jsonRpcResponse(id, {
                content: [{ type: "text", text: "Error: message is required." }],
                isError: true,
              });
            } else {
              const adminId = await getAdminUserId();
              if (!adminId) {
                result = jsonRpcResponse(id, {
                  content: [{ type: "text", text: "No admin user found." }],
                  isError: true,
                });
              } else {
                try {
                  const claudeId = getClaudeUserId();
                  // Get or create the DM conversation between admin and Claude
                  const conv = await chatService.getOrCreateClaudeDm(adminId, claudeId);
                  // Save message as Claude
                  const savedMsg = await chatService.saveMessage(conv.id, claudeId, message);
                  // Broadcast to connected WS clients
                  const members = await chatService.getConversationMembers(conv.id);
                  const memberIds = members.map((m) => m.userId);
                  broadcastChatMessage(memberIds, conv.id, savedMsg);

                  result = jsonRpcResponse(id, {
                    content: [{ type: "text", text: "Message sent to admin in Genie chat." }],
                  });
                } catch (chatErr: unknown) {
                  const errMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
                  result = jsonRpcResponse(id, {
                    content: [{ type: "text", text: `Failed to send chat message: ${errMsg}` }],
                    isError: true,
                  });
                }
              }
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
      console.log(`[mcp-notify] Local HTTP server on port ${addr.port}`);
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
