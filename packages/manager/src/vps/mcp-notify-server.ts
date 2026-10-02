import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import * as chatService from "../chat/chat-service.js";
import { getClaudeUserId } from "../db/seed.js";
import { type JsonRpcRequest, jsonRpcResponse, jsonRpcError, isNotification, initializeResult } from "./mcp-jsonrpc.js";

/** Side-channel the notify handler needs back into the manager. */
export interface NotifyMcpContext {
  /** Broadcast a saved chat message to the connected WS clients of these users. */
  broadcastChatMessage: (memberIds: string[], conversationId: string, message: unknown) => void;
}

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
 * Handle one JSON-RPC request for the genie-notify MCP service: send email or a
 * chat message to the admin. Returns a JSON-RPC response object, or null for a
 * notification.
 */
export async function handleNotifyMcpRequest(parsed: JsonRpcRequest, ctx: NotifyMcpContext): Promise<object | null> {
  if (isNotification(parsed)) return null;
  const { id, method, params } = parsed;

  try {
    if (method === "initialize") {
      return initializeResult(id, "genie-notify-mcp");
    }
    if (method === "tools/list") {
      return jsonRpcResponse(id, { tools: TOOLS });
    }
    if (method !== "tools/call") {
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }

    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    if (toolName === "notify_send_email") {
      const subject = args.subject as string;
      const emailBody = args.body as string;
      if (!subject || !emailBody) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: subject and body are required." }],
          isError: true,
        });
      }
      const sgApiKey = process.env.SENDGRID_API_KEY;
      const adminEmail = await getAdminEmail();
      if (!sgApiKey || !adminEmail) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Email not configured: SENDGRID_API_KEY or admin email missing." }],
          isError: true,
        });
      }
      try {
        const sgMail = (await import("@sendgrid/mail")).default;
        sgMail.setApiKey(sgApiKey);
        await sgMail.send({
          to: adminEmail,
          from: process.env.BACKUP_EMAIL || "noreply@teleporthq.io",
          subject: `[Genie VPS] ${subject}`,
          text: emailBody,
        });
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Email sent to admin (${adminEmail}).` }],
        });
      } catch (emailErr: unknown) {
        const errMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Failed to send email: ${errMsg}` }],
          isError: true,
        });
      }
    }

    if (toolName === "notify_send_chat_message") {
      const message = args.message as string;
      if (!message) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Error: message is required." }],
          isError: true,
        });
      }
      const adminId = await getAdminUserId();
      if (!adminId) {
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "No admin user found." }],
          isError: true,
        });
      }
      try {
        const claudeId = getClaudeUserId();
        // Get or create the DM conversation between admin and Claude
        const conv = await chatService.getOrCreateClaudeDm(adminId, claudeId);
        // Save message as Claude
        const savedMsg = await chatService.saveMessage(conv.id, claudeId, message);
        // Broadcast to connected WS clients
        const members = await chatService.getConversationMembers(conv.id);
        const memberIds = members.map((m) => m.userId);
        ctx.broadcastChatMessage(memberIds, conv.id, savedMsg);

        return jsonRpcResponse(id, {
          content: [{ type: "text", text: "Message sent to admin in Genie chat." }],
        });
      } catch (chatErr: unknown) {
        const errMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: `Failed to send chat message: ${errMsg}` }],
          isError: true,
        });
      }
    }

    return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
  } catch (err: unknown) {
    console.error("[mcp-notify] tool call failed:", err);
    return jsonRpcError(id, -32000, "Internal error — the request could not be completed.");
  }
}
