import { $chat } from "../subjects/chat";
import type { ChatMessageUsage, ToolUse } from "../types/chat";
import type { HandlerMap } from "./types";
import { onWsClose, onWsOpen } from "@/lib/ws";
import { handleChatWsDisconnect, handleChatWsReconnect } from "../actions/chat";

// --- Chat (1-on-1 AI) messages ---

export const handlers: HandlerMap = {
  "chat:token": (payload) => {
    const c = $chat.getValue();
    $chat.next({ ...c, streamingContent: c.streamingContent + payload.token, statusText: "" });
  },

  // Tool call started — emit a placeholder ToolUse with `startedAt` so the
  // floating pill can render a live elapsed-time ticker before the result
  // comes back. The matching `chat:tool` finalizes it.
  "chat:tool:start": (payload) => {
    const c = $chat.getValue();
    const tool: ToolUse = {
      id: payload.id,
      name: payload.name,
      input: payload.input,
      result: "",
      startedAt: Date.now(),
    };
    $chat.next({
      ...c,
      streamingSteps: [...c.streamingSteps, { content: c.streamingContent, toolUse: tool }],
      streamingContent: "",
      toolUses: [...c.toolUses, tool],
    });
  },

  "chat:tool": (payload) => {
    const c = $chat.getValue();
    // If a `chat:tool:start` already pushed a placeholder with this id, mutate
    // it in place so the pill flips from "running" to "done" without
    // appearing twice. Older code paths (Claude Code VPS bridge) skip
    // tool:start and only send tool — in that case we append.
    const id = payload.id as string | undefined;
    const completedAt = Date.now();
    const durationMs = payload.durationMs as number | undefined;
    const idx = id ? c.toolUses.findIndex((t) => t.id === id) : -1;
    if (idx >= 0) {
      const updated: ToolUse = {
        ...c.toolUses[idx],
        input: payload.input,
        result: payload.result,
        completedAt,
        durationMs,
      };
      const newToolUses = c.toolUses.slice();
      newToolUses[idx] = updated;
      // Also patch the matching streamingSteps entry so the inline pill flips.
      const newSteps = c.streamingSteps.map((s) =>
        s.toolUse?.id === id ? { ...s, toolUse: updated } : s,
      );
      $chat.next({
        ...c,
        streamingSteps: newSteps,
        toolUses: newToolUses,
        toolRoundsUsed: c.toolRoundsUsed + 1,
      });
      return;
    }
    const tool: ToolUse = {
      id,
      name: payload.name,
      input: payload.input,
      result: payload.result,
      // No matching start — synthesize start = now so an instant duration
      // (0 ms) is shown rather than blowing past the type contract.
      startedAt: completedAt,
      completedAt,
      durationMs,
    };
    $chat.next({
      ...c,
      streamingSteps: [...c.streamingSteps, { content: c.streamingContent, toolUse: tool }],
      streamingContent: "",
      toolUses: [...c.toolUses, tool],
      toolRoundsUsed: c.toolRoundsUsed + 1,
    });
  },

  "chat:done": (payload) => {
    const c = $chat.getValue();
    const steps = [...c.streamingSteps];
    if (c.streamingContent) {
      steps.push({ content: c.streamingContent });
    }
    const toolUses = c.toolUses.length > 0 ? [...c.toolUses] : undefined;
    const usage = payload.usage as ChatMessageUsage | undefined;
    $chat.next({
      ...c,
      messages: [...c.messages, {
        role: "assistant" as const,
        content: steps.map(st => st.content).join(""),
        toolUses,
        steps: steps.length > 0 ? steps : undefined,
        usage,
      }],
      streamingContent: "",
      streamingSteps: [],
      toolUses: [],
      loading: false,
      statusText: "",
      toolRoundsUsed: 0,
    });
  },

  "chat:error": (payload) => {
    const c = $chat.getValue();
    $chat.next({
      ...c,
      messages: [...c.messages, {
        role: "assistant" as const,
        content: `Error: ${payload.message}`,
        isError: true,
      }],
      streamingContent: "",
      streamingSteps: [],
      toolUses: [],
      loading: false,
      statusText: "",
      toolRoundsUsed: 0,
    });
  },

  "chat:status": (payload) => {
    $chat.nextAssign({ statusText: payload.status || "" });
  },

  "chat:meta": (payload) => {
    if (payload.maxToolRounds) {
      $chat.nextAssign({ maxToolRounds: payload.maxToolRounds });
    }
  },

  "chat:claude-info": (payload) => {
    const prev = $chat.getValue().claudeInfo;
    $chat.nextAssign({
      claudeInfo: {
        model: payload.model || prev?.model || "",
        email: payload.email || prev?.email || "",
        plan: payload.plan || prev?.plan || "",
        version: payload.version || prev?.version || "",
      },
    });
  },

  "chat:resumed": (payload) => {
    $chat.nextAssign({
      resumedFrom: {
        sessionId: payload.sessionId,
        lastActivity: payload.lastActivity,
      },
    });
  },

  "chat:sessions:list": (payload) => {
    $chat.nextAssign({
      sessions: payload.sessions || [],
      sessionsLoading: false,
    });
  },

  "chat:session:loaded": (payload) => {
    const msgs = (payload.messages || []).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      toolUses: m.toolUses || undefined,
      images: Array.isArray(m.images) && m.images.length > 0 ? m.images : undefined,
    }));
    $chat.nextAssign({
      messages: msgs,
      loading: false,
      activeSessionId: payload.sessionId,
    });
  },

  "chat:session:renamed": (payload) => {
    const { sessionId, name } = payload;
    const c = $chat.getValue();
    $chat.nextAssign({
      sessions: c.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, name } : s
      ),
    });
  },

  "chat:session:deleted": (payload) => {
    const { sessionId } = payload;
    const c = $chat.getValue();
    $chat.nextAssign({
      sessions: c.sessions.filter((s) => s.sessionId !== sessionId),
      ...(c.activeSessionId === sessionId ? { activeSessionId: null, messages: [] } : {}),
    });
  },
};

onWsClose((reason) => {
  handleChatWsDisconnect(reason);
});

onWsOpen(() => {
  handleChatWsReconnect();
});
