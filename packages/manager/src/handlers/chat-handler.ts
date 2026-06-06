import { type WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { WsMessage, DomActionExecutor } from "../types.js";
import { handleChat, type ChatModelId } from "../chat.js";
import type { ToolAuthContext } from "../tools/index.js";
import * as chatService from "../chat-service.js";
import * as assistantLogService from "../assistant-log-service.js";
import * as settingsService from "../settings-service.js";
import * as projectService from "../project-service.js";
import * as analyticsService from "../analytics-service.js";
import { saveResumeSessionId, getResumeState } from "../assistant-session-state-service.js";
import { getClaudeUserId } from "../db/seed.js";
import { getDb } from "../db/index.js";
import { aiUsage } from "../db/schema.js";
import { isAdmin } from "../auth.js";
import { routeChatToVpsAgent } from "../chat/vps-agent-router.js";
import {
  type ClientState,
  activeChatAbortControllers,
  broadcastProjectList,
  broadcastToUsers,
  createDirectDomActionExecutor,
  getExtensionClient,
  sendToUser,
  getConnectedUserIds,
} from "../ws-server.js";



/** Track active conversation chat AbortControllers by conversationId. */
const activeConversationAbortControllers = new Map<string, AbortController>();

/** Run a Claude response in a unified-chat conversation, broadcasting tokens
 *  and final message to all members. */
async function handleConversationChat(
  ws: WebSocket,
  send: (ws: WebSocket, message: WsMessage) => void,
  conversationId: string,
  claudeId: string,
  memberIds: string[],
  // Identity of the member who triggered Claude (the message author). The
  // assistant's tools are scoped to *their* access — Claude in a shared room
  // can only reach projects/servers the person who summoned it can see.
  authorAuth: ToolAuthContext,
  abortSignal?: AbortSignal,
): Promise<void> {
  try {
    await handleChat(
      await chatService.getMessagesForClaude(conversationId),
      (token) => {
        broadcastToUsers(memberIds, {
          type: "chat:message:token",
          payload: { conversationId, token },
        });
      },
      async (fullContent) => {
        activeConversationAbortControllers.delete(conversationId);
        const saved = await chatService.saveMessage(conversationId, claudeId, fullContent);
        broadcastToUsers(memberIds, {
          type: "chat:message:done",
          payload: { conversationId, message: saved },
        });
      },
      (message) => {
        activeConversationAbortControllers.delete(conversationId);
        broadcastToUsers(memberIds, {
          type: "chat:message:error",
          payload: { conversationId, message },
        });
      },
      (name, input, result) => {
        broadcastToUsers(memberIds, {
          type: "chat:message:tool",
          payload: { conversationId, name, input, result },
        });
      },
      undefined,
      undefined,
      abortSignal,
      undefined, // domActionExecutor
      undefined, // modelId
      undefined, // maxToolRounds
      undefined, // pinnedVm
      undefined, // onToolStart
      authorAuth,
    );
  } catch (err: unknown) {
    activeConversationAbortControllers.delete(conversationId);
    send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) || "Chat failed" } });
  }
}

/** Handle most `chat:*` messages — chat:send and chat:stop stay in ws-server.ts
 *  because they share the AI routing + abort-controller pool. Returns true if
 *  handled. */
export async function handleChatMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  const userId = state.userId;
  switch (msg.type) {
    case "chat:send": {
      if (!userId) return true;
      const { messages, context: chatContext, domSnapshot, source, modelId, pinnedVm } = msg.payload;
      const abortController = new AbortController();
      activeChatAbortControllers.set(ws, abortController);

      const effectiveClientType: string = source === "chrome-extension"
        ? "chrome-extension"
        : (state.clientType || "web");

      const clientLabel = effectiveClientType === "chrome-extension"
        ? "chrome-extension (Chrome browser plugin)"
        : "web (Genie desktop app)";
      const enrichedContext = chatContext
        ? `Client: ${clientLabel}\n${chatContext}`
        : `Client: ${clientLabel}`;

      // Session tracking for assistant chat logs
      if (messages.length <= 1) {
        state.assistantSessionId = uuidv4();
      }
      const sessionId = state.assistantSessionId || uuidv4();

      const ctxProjectIdMatch = enrichedContext.match(/Project ID:\s*([a-f0-9-]+)/i)
        || enrichedContext.match(/projectId[=:]\s*["']?([a-f0-9-]+)/i)
        || enrichedContext.match(/\(id:\s+([a-f0-9-]+)\)/);
      const contextProjectId = ctxProjectIdMatch?.[1] || null;
      const instanceIdMatch = enrichedContext.match(/instance.*?id="([a-f0-9-]+)"/i);
      const contextInstanceId = instanceIdMatch?.[1] || null;

      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg?.role === "user") {
        assistantLogService.saveAssistantMessage({
          sessionId,
          projectId: contextProjectId,
          instanceId: contextInstanceId,
          userId: userId || null,
          clientType: effectiveClientType,
          role: "user",
          content: lastUserMsg.content,
          modelId: modelId || null,
        }).catch(err => console.error("Failed to log user message:", err));
      }

      void (async () => {
        if (modelId === "claude-code") {
          try {
            console.log(`[claude-code] Routing chat: contextProjectId=${contextProjectId}, enrichedContext length=${enrichedContext?.length}`);
            send(ws, { type: "chat:meta", payload: { maxToolRounds: 40 } });
            const routed = await routeChatToVpsAgent(
              ws, send as Parameters<typeof routeChatToVpsAgent>[1], userId, messages, enrichedContext, domSnapshot, abortController.signal,
              (fullContent, toolUses) => {
                if (fullContent) {
                  assistantLogService.saveAssistantMessage({
                    sessionId,
                    projectId: contextProjectId,
                    instanceId: contextInstanceId,
                    userId: userId || null,
                    clientType: effectiveClientType,
                    role: "assistant",
                    content: fullContent,
                    modelId: "claude-code",
                    toolUses: toolUses.length > 0 ? toolUses : null,
                  }).catch(err => console.error("Failed to log Claude Code message:", err));
                }
              },
              contextProjectId,
              sessionId,
            );
            if (routed) return;
            send(ws, { type: "chat:error", payload: { message: "Claude Code requires a VPS instance. Select a project with a VPS deployment." } });
            activeChatAbortControllers.delete(ws);
            return;
          } catch (routeErr: unknown) {
            console.error("Claude Code routing failed:", (routeErr instanceof Error ? routeErr.message : String(routeErr)));
            send(ws, { type: "chat:error", payload: { message: `Claude Code error: ${(routeErr instanceof Error ? routeErr.message : String(routeErr))}` } });
            activeChatAbortControllers.delete(ws);
            return;
          }
        }

        const [dbDefaultModel, dbMaxToolRounds] = await Promise.all([
          settingsService.getGlobalSetting<string>("aiDefaultModel"),
          settingsService.getGlobalSetting<number>("aiMaxToolRounds"),
        ]);
        const resolvedModelId = (modelId || dbDefaultModel || "claude-sonnet") as ChatModelId;
        const resolvedMaxToolRounds = dbMaxToolRounds ?? 10;
        send(ws, { type: "chat:meta", payload: { maxToolRounds: resolvedMaxToolRounds } });
        void analyticsService.recordEvent({
          userId: state.userId, userName: state.user?.name ?? null, event: "assistant.message",
          props: { model: resolvedModelId, source: source === "chrome-extension" ? "extension" : "web" }, ip: state.ip,
        });

        let domActionExecutor: DomActionExecutor | undefined;
        const extensionWs = source === "chrome-extension"
          ? ws
          : getExtensionClient(userId);
        if (extensionWs && extensionWs.readyState === extensionWs.OPEN) {
          // The renderer only sets the extension's clientType to "chrome-extension"
          // after authenticating, so a direct executor is safe here even though we
          // don't have a peek-by-ws helper exported.
          domActionExecutor = createDirectDomActionExecutor(extensionWs);
        }

        const collectedToolUses: { name: string; input: unknown; result: string }[] = [];

        await handleChat(
          messages,
          (token) => send(ws, { type: "chat:token", payload: { token } }),
          (fullContent, usage) => {
            activeChatAbortControllers.delete(ws);
            send(ws, { type: "chat:done", payload: { usage } });
            if (usage) {
              const projectIdMatch = chatContext?.match(/Project ID:\s*([a-f0-9-]+)/i);
              const sourcePromise = projectIdMatch
                ? projectService.getById(projectIdMatch[1]).then(p => p?.name ?? projectIdMatch[1]).catch(() => projectIdMatch![1])
                : Promise.resolve(source === "chrome-extension" ? "Extension" : "Genie");
              sourcePromise.then((sourceName) => {
                getDb().insert(aiUsage).values({
                  userId: userId || null,
                  modelId: usage.modelId,
                  modelLabel: usage.modelLabel,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cost: usage.cost,
                  source: sourceName,
                }).catch((err) => console.error("Failed to save AI usage:", err));
              });
            }
            assistantLogService.saveAssistantMessage({
              sessionId,
              projectId: contextProjectId,
              instanceId: contextInstanceId,
              userId: userId || null,
              clientType: effectiveClientType,
              role: "assistant",
              content: fullContent,
              modelId: resolvedModelId,
              toolUses: collectedToolUses.length > 0 ? collectedToolUses : null,
              usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } : null,
            }).catch(err => console.error("Failed to log assistant message:", err));
          },
          (message) => {
            activeChatAbortControllers.delete(ws);
            send(ws, { type: "chat:error", payload: { message } });
          },
          (name, input, result, id, durationMs) => {
            send(ws, { type: "chat:tool", payload: { id, name, input, result, durationMs } });
            collectedToolUses.push({ name, input, result });
            if (name === "write_project_file") {
              void broadcastProjectList();
            }
          },
          enrichedContext,
          domSnapshot,
          abortController.signal,
          domActionExecutor,
          resolvedModelId,
          resolvedMaxToolRounds,
          pinnedVm || null,
          (id, name, input) => {
            send(ws, { type: "chat:tool:start", payload: { id, name, input } });
          },
          // Scope every tool call to this caller — the assistant may only reach
          // projects/servers the user can see (privileged roles bypass).
          { userId, role: state.role },
        );
      })().catch((err) => {
        activeChatAbortControllers.delete(ws);
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) || "Chat failed" } });
      });
      return true;
    }

    case "chat:stop": {
      const controller = activeChatAbortControllers.get(ws);
      if (controller) {
        controller.abort();
        activeChatAbortControllers.delete(ws);
      }
      return true;
    }

    case "chat:sessions:list": {
      if (!userId) return true;
      try {
        const admin = await isAdmin(userId);
        const sessions = await assistantLogService.listUserSessions(admin ? null : userId, 50);
        send(ws, { type: "chat:sessions:list", payload: { sessions } });
      } catch (err: unknown) {
        console.error("[chat:sessions:list] error:", err);
      }
      return true;
    }

    case "chat:session:load": {
      const { sessionId } = msg.payload;
      if (!sessionId) return true;
      try {
        const rows = await assistantLogService.getSessionMessages(sessionId);
        const messages = rows.map((r) => ({
          role: r.role as "user" | "assistant",
          content: r.content,
          toolUses: r.toolUses as unknown[] | null,
          createdAt: r.createdAt,
        }));
        send(ws, { type: "chat:session:loaded", payload: { sessionId, messages } });

        // Reinstall the Claude Code resume mapping for this session's VPS so
        // the next chat:send picks up `--resume <id>`. Bind the ws-state's
        // assistantSessionId to the loaded session so subsequent log writes
        // attach to it rather than spawning a fresh session id.
        const resumeMeta = await assistantLogService.getSessionResumeMeta(sessionId);
        if (resumeMeta) {
          const sessionKey = `${resumeMeta.projectId}:${resumeMeta.instanceId}`;
          await saveResumeSessionId(sessionKey, resumeMeta.claudeCodeSessionId, resumeMeta.projectId, resumeMeta.instanceId);
          state.assistantSessionId = sessionId;
          const resumeState = await getResumeState(sessionKey);
          if (resumeState) {
            send(ws, { type: "chat:resumed", payload: {
              sessionId: resumeState.sessionId,
              lastActivity: resumeState.lastActivity.toISOString(),
            }});
          }
        }
      } catch (err: unknown) {
        console.error("[chat:session:load] error:", err);
      }
      return true;
    }

    case "chat:session:rename": {
      const { sessionId, name } = msg.payload;
      if (!sessionId || !name) return true;
      try {
        await assistantLogService.renameSession(sessionId, name);
        send(ws, { type: "chat:session:renamed", payload: { sessionId, name } });
      } catch (err: unknown) {
        console.error("[chat:session:rename] error:", err);
      }
      return true;
    }

    case "chat:session:delete": {
      const { sessionId } = msg.payload;
      if (!sessionId) return true;
      try {
        await assistantLogService.deleteSession(sessionId);
        send(ws, { type: "chat:session:deleted", payload: { sessionId } });
      } catch (err: unknown) {
        console.error("[chat:session:delete] error:", err);
      }
      return true;
    }

    case "chat:users:list": {
      try {
        if (!userId) {
          send(ws, { type: "chat:users:list", payload: { users: [] } });
          return true;
        }
        // Scope the roster to teammates (members of the user's teams) plus
        // agents and self — a user only sees users from the teams they're in.
        const visibleUsers = await chatService.getVisibleUsers(userId);
        const connectedUserIds = getConnectedUserIds();
        const usersWithStatus = visibleUsers.map((u) => ({
          ...u,
          online: connectedUserIds.includes(u.id),
        }));
        send(ws, { type: "chat:users:list", payload: { users: usersWithStatus } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:conversations:list": {
      try {
        if (!userId) return true;
        const conversations = await chatService.getUserConversations(userId);
        send(ws, { type: "chat:conversations:list", payload: { conversations } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:conversation:create": {
      try {
        if (!userId) return true;
        const { name, memberIds, type, targetUserId } = msg.payload;
        let conversation;
        if (type === "dm") {
          const otherId = targetUserId || getClaudeUserId();
          conversation = await chatService.getOrCreateClaudeDm(userId, otherId);
        } else {
          const claudeId = getClaudeUserId();
          const resolvedMemberIds = (memberIds || []).map((id: string) =>
            id === "claude" ? claudeId : id,
          );
          conversation = await chatService.createRoom(userId, name, resolvedMemberIds);
        }
        send(ws, { type: "chat:conversation:created", payload: { conversation } });
        const newMembers = await chatService.getConversationMembers(conversation.id);
        for (const member of newMembers) {
          const memberConvs = await chatService.getUserConversations(member.userId);
          sendToUser(member.userId, { type: "chat:conversations:list", payload: { conversations: memberConvs } });
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:conversation:open": {
      try {
        const { conversationId, limit, before } = msg.payload;
        const effectiveLimit = limit || 20;
        const messages = await chatService.getMessages(conversationId, effectiveLimit, before);
        const members = await chatService.getConversationMembers(conversationId);
        send(ws, { type: "chat:messages:list", payload: { conversationId, messages, members, hasMore: messages.length === effectiveLimit } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:messages:load": {
      try {
        const { conversationId, limit, before } = msg.payload;
        const messages = await chatService.getMessages(conversationId, limit || 50, before);
        send(ws, { type: "chat:messages:list", payload: { conversationId, messages, hasMore: messages.length === (limit || 50) } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:message:send": {
      try {
        if (!userId) return true;
        const { conversationId, content, replyToId, metadata: msgMetadata } = msg.payload;
        const message = await chatService.saveMessage(conversationId, userId, content, msgMetadata, replyToId);
        void analyticsService.recordEvent({ userId, userName: state.user?.name ?? null, event: "chat.message", props: {}, ip: state.ip });
        const members = await chatService.getConversationMembers(conversationId);
        const memberIds = members.map((m) => m.userId);

        broadcastToUsers(memberIds, {
          type: "chat:message:new",
          payload: { conversationId, message },
        });

        const claudeId = getClaudeUserId();
        const claudeIsMember = memberIds.includes(claudeId);
        const conversation = await chatService.getConversation(conversationId);

        const shouldClaudeRespond =
          (conversation?.type === "dm" && claudeIsMember) ||
          (conversation?.type === "room" && claudeIsMember && content.toLowerCase().includes("@claude"));

        if (shouldClaudeRespond) {
          const convAbort = new AbortController();
          activeConversationAbortControllers.set(conversationId, convAbort);
          void handleConversationChat(ws, send, conversationId, claudeId, memberIds, { userId, role: state.role }, convAbort.signal);
        }

        const mentionMatches = content.match(/@(\w+)/g);
        if (mentionMatches) {
          const allUsers = await chatService.getAllUsers();
          const senderUser = state.user;
          const convName = conversation?.name || "a conversation";
          for (const mention of mentionMatches) {
            const word = mention.slice(1).toLowerCase();
            if (word === "claude") continue;
            const matchedUser = allUsers.find(
              (u) => u.name.split(" ")[0].toLowerCase() === word,
            );
            if (matchedUser && matchedUser.id !== userId) {
              const mentionPayload = {
                type: "chat:mention" as const,
                payload: {
                  conversationId,
                  conversationName: convName,
                  senderName: senderUser?.name || "Someone",
                  content: content.slice(0, 100),
                  messageId: message.id,
                },
              };
              sendToUser(matchedUser.id, mentionPayload);
            }
          }
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:message:stop": {
      const { conversationId } = msg.payload;
      const convController = activeConversationAbortControllers.get(conversationId);
      if (convController) {
        convController.abort();
        activeConversationAbortControllers.delete(conversationId);
      }
      return true;
    }

    case "chat:member:add": {
      try {
        const { conversationId, targetUserId } = msg.payload;
        await chatService.addMember(conversationId, targetUserId);
        const members = await chatService.getConversationMembers(conversationId);
        const memberIds = members.map((m) => m.userId);
        broadcastToUsers(memberIds, {
          type: "chat:members:updated",
          payload: { conversationId, members },
        });
        const addedUserConvs = await chatService.getUserConversations(targetUserId);
        sendToUser(targetUserId, { type: "chat:conversations:list", payload: { conversations: addedUserConvs } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:member:remove": {
      try {
        const { conversationId, targetUserId } = msg.payload;
        const membersBefore = await chatService.getConversationMembers(conversationId);
        const memberIdsBefore = membersBefore.map((m) => m.userId);
        await chatService.removeMember(conversationId, targetUserId);
        const membersAfter = await chatService.getConversationMembers(conversationId);
        broadcastToUsers(memberIdsBefore, {
          type: "chat:members:updated",
          payload: { conversationId, members: membersAfter },
        });
        const removedUserConvs = await chatService.getUserConversations(targetUserId);
        sendToUser(targetUserId, { type: "chat:conversations:list", payload: { conversations: removedUserConvs } });
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:reaction:toggle": {
      try {
        if (!userId) return true;
        const { conversationId, messageId, emoji } = msg.payload;
        const result = await chatService.toggleReaction(messageId, userId, emoji);
        if (result) {
          const members = await chatService.getConversationMembers(conversationId);
          const memberIds = members.map((m) => m.userId);
          broadcastToUsers(memberIds, {
            type: "chat:reaction:updated",
            payload: { conversationId, messageId, reactions: result.reactions },
          });
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "chat:message:edit": {
      try {
        if (!userId) return true;
        const { conversationId, messageId, content } = msg.payload;
        const result = await chatService.editMessage(messageId, userId, content);
        if (!result) {
          send(ws, { type: "chat:error", payload: { message: "Cannot edit this message" } });
        } else {
          const members = await chatService.getConversationMembers(conversationId);
          const memberIds = members.map((m) => m.userId);
          broadcastToUsers(memberIds, {
            type: "chat:message:edited",
            payload: { conversationId, messageId, content: result.content, editedAt: result.editedAt },
          });
        }
      } catch (err: unknown) {
        send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
