// Reconnect resume for the floating assistant: the `chat:replay` / `chat:resume:gone`
// inbound handlers and the `resumeChatTurnOnReconnect` action (fired from
// auth:success). @/lib/ws is mocked so we can observe the outbound `chat:resume`.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/ws", () => ({
  wsSend: vi.fn(() => true),
  isWsConnected: vi.fn(() => true),
  onWsClose: vi.fn(),
  onWsOpen: vi.fn(),
}));

import { handlers } from "./chat";
import { $chat } from "../subjects/chat";
import { resumeChatTurnOnReconnect } from "../actions/chat";
import { wsSend } from "@/lib/ws";
import type { ChatState } from "../types/chat";

const FRESH: ChatState = {
  messages: [], loading: false, streamingContent: "", streamingSteps: [], toolUses: [],
  statusText: "", modelId: "claude-code", maxToolRounds: 0, toolRoundsUsed: 0, claudeInfo: null,
  sessions: [], sessionsLoading: false, activeSessionId: null, resumedFrom: null,
  connectionError: null, reconnecting: false, lastSendMeta: null, activeTurnId: null,
};

beforeEach(() => {
  $chat.next({ ...FRESH });
  (wsSend as ReturnType<typeof vi.fn>).mockClear();
});

describe("chat:replay", () => {
  it("replaces the streaming state with the snapshot and drops the reconnecting badge", () => {
    $chat.next({ ...FRESH, loading: true, reconnecting: true, streamingContent: "stale", activeTurnId: "t1", connectionError: "x" });
    handlers["chat:replay"]({
      turnId: "t1",
      maxToolRounds: 9,
      streaming: {
        loading: true,
        partialContent: "fresh",
        steps: [{ content: "s", toolUse: { id: "x", name: "n", input: {}, result: "r" } }],
        toolRoundsUsed: 2,
      },
    });
    const c = $chat.getValue();
    expect(c.streamingContent).toBe("fresh");
    expect(c.streamingSteps).toHaveLength(1);
    expect(c.toolUses).toHaveLength(1);   // derived from steps[].toolUse
    expect(c.loading).toBe(true);
    expect(c.reconnecting).toBe(false);
    expect(c.connectionError).toBeNull();
    expect(c.toolRoundsUsed).toBe(2);
    expect(c.maxToolRounds).toBe(9);
  });

  it("a finished-turn replay (loading false) followed by chat:done commits one message", () => {
    $chat.next({ ...FRESH, loading: true, reconnecting: true, activeTurnId: "t1" });
    handlers["chat:replay"]({ turnId: "t1", streaming: { loading: false, partialContent: "final answer", steps: [] } });
    handlers["chat:done"]({ usage: undefined });
    const c = $chat.getValue();
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ role: "assistant", content: "final answer" });
    expect(c.loading).toBe(false);
    expect(c.activeTurnId).toBeNull();
  });
});

describe("chat:resume:gone", () => {
  it("degrades to the retry UX when the buffered turn is gone", () => {
    $chat.next({ ...FRESH, loading: true, reconnecting: true, activeTurnId: "t1", streamingContent: "partial" });
    handlers["chat:resume:gone"]({ turnId: "t1" });
    const c = $chat.getValue();
    expect(c.loading).toBe(false);
    expect(c.reconnecting).toBe(false);
    expect(c.activeTurnId).toBeNull();
    expect(c.connectionError).toContain("Connection lost");
  });
});

describe("resumeChatTurnOnReconnect", () => {
  it("asks the manager to resume the in-flight turn by id", () => {
    $chat.next({ ...FRESH, loading: true, reconnecting: true, activeTurnId: "t1" });
    resumeChatTurnOnReconnect();
    expect(wsSend).toHaveBeenCalledWith("chat:resume", { turnId: "t1" });
  });

  it("is a no-op when no turn was in flight (fresh login / not reconnecting)", () => {
    $chat.next({ ...FRESH, loading: false, reconnecting: false, activeTurnId: null });
    resumeChatTurnOnReconnect();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("does not resume when there is no turn id to resume by", () => {
    $chat.next({ ...FRESH, loading: true, reconnecting: true, activeTurnId: null });
    resumeChatTurnOnReconnect();
    expect(wsSend).not.toHaveBeenCalled();
  });
});

describe("chat:done / chat:error clear the active turn id", () => {
  it("chat:done clears activeTurnId", () => {
    $chat.next({ ...FRESH, loading: true, activeTurnId: "t1", streamingContent: "hi" });
    handlers["chat:done"]({ usage: undefined });
    expect($chat.getValue().activeTurnId).toBeNull();
  });

  it("chat:error clears activeTurnId", () => {
    $chat.next({ ...FRESH, loading: true, activeTurnId: "t1" });
    handlers["chat:error"]({ message: "boom" });
    expect($chat.getValue().activeTurnId).toBeNull();
  });
});
