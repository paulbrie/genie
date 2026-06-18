import type { HandlerMap } from "./types";
import type { StreamingStep, ToolUse } from "../types/chat";
import { updateClaudeStreamSession, handleClaudeStreamWsDisconnect } from "../actions/claude-stream";
import { onWsClose } from "@/lib/ws";

// Handlers for the durable chat-mode Claude session. Each event carries a
// `claudeStreamId`; logic mirrors store/handlers/chat.ts but is scoped to one
// session in the $claudeStream map (no shared singleton).

export const handlers: HandlerMap = {
  "claude:stream:ready": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({ ...s, ready: true, reconnecting: false, connectionError: null }));
  },

  // A user turn rebuilt from the captured output on a cold reopen. During live
  // sends the manager dedups the echo and doesn't emit this, so the optimistic
  // bubble isn't doubled; the extra guard here is defensive.
  "claude:stream:user": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => {
      const last = s.messages[s.messages.length - 1];
      if (last && last.role === "user" && last.content === payload.content) return s;
      return { ...s, messages: [...s.messages, { role: "user", content: payload.content }] };
    });
  },

  "claude:stream:token": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({
      ...s,
      streamingContent: s.streamingContent + (payload.token || ""),
      statusText: "",
      loading: true,
    }));
  },

  "claude:stream:tool": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => {
      const tool: ToolUse = {
        name: payload.name,
        input: payload.input,
        result: payload.result,
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      return {
        ...s,
        streamingSteps: [...s.streamingSteps, { content: s.streamingContent, toolUse: tool }],
        streamingContent: "",
        toolUses: [...s.toolUses, tool],
      };
    });
  },

  "claude:stream:done": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => {
      const steps: StreamingStep[] = [...s.streamingSteps];
      if (s.streamingContent) steps.push({ content: s.streamingContent });
      const toolUses = s.toolUses.length > 0 ? [...s.toolUses] : undefined;
      const message = {
        role: "assistant" as const,
        content: steps.map((st) => st.content).join(""),
        steps: steps.length > 0 ? steps : undefined,
        toolUses,
        usage: payload.usage,
        thinkingMs: payload.thinkingMs,
      };
      // Skip an entirely empty turn (e.g. a slash command with no output).
      const messages = (message.content || toolUses) ? [...s.messages, message] : s.messages;
      return { ...s, messages, streamingContent: "", streamingSteps: [], toolUses: [], loading: false, statusText: "" };
    });
  },

  "claude:stream:status": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({ ...s, statusText: payload.status || "" }));
  },

  "claude:stream:claude-info": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({
      ...s,
      claudeInfo: {
        model: payload.model || s.claudeInfo?.model || "",
        email: payload.email || s.claudeInfo?.email || "",
        plan: payload.plan || s.claudeInfo?.plan || "",
        version: payload.version || s.claudeInfo?.version || "",
      },
    }));
  },

  "claude:stream:error": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({
      ...s,
      messages: [...s.messages, { role: "assistant", content: `Error: ${payload.message}`, isError: true }],
      streamingContent: "",
      streamingSteps: [],
      toolUses: [],
      loading: false,
      statusText: "",
      connectionError: payload.message || "Claude stream failed",
    }));
  },

  // Bulk catch-up on reattach: replace the session's transcript + streaming
  // state with the manager's authoritative snapshot.
  "claude:stream:replay": (payload) => {
    const streaming = payload.streaming || {};
    const steps: StreamingStep[] = streaming.steps || [];
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({
      ...s,
      messages: payload.messages || [],
      streamingSteps: steps,
      streamingContent: streaming.partialContent || "",
      toolUses: steps.filter((st) => st.toolUse).map((st) => st.toolUse as ToolUse),
      loading: !!streaming.loading,
      statusText: streaming.loading ? "Claude is thinking..." : "",
      claudeInfo: payload.claudeInfo || s.claudeInfo,
      ready: true,
      reconnecting: false,
    }));
  },

  "claude:stream:closed": (payload) => {
    updateClaudeStreamSession(payload.claudeStreamId, (s) => ({ ...s, ready: false, loading: false, statusText: "" }));
  },
};

onWsClose(() => handleClaudeStreamWsDisconnect());
// The reconnect re-attach (re-issuing claude:stream:start) is fired from the
// auth:success handler, not onWsOpen — a cold reattach needs the manager to have
// re-confirmed our userId (canAccessProject) before the message arrives.
