import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { handlers } from "./chat";
import { $chat } from "../subjects/chat";
import type { ChatState } from "../types/chat";

const FRESH: ChatState = {
  messages: [],
  loading: false,
  streamingContent: "",
  streamingSteps: [],
  toolUses: [],
  statusText: "",
  modelId: "claude-code",
  maxToolRounds: 0,
  toolRoundsUsed: 0,
  claudeInfo: null,
  sessions: [],
  sessionsLoading: false,
  activeSessionId: null,
  resumedFrom: null,
  connectionError: null,
  lastSendMeta: null,
};

beforeEach(() => {
  $chat.next({ ...FRESH });
});

describe("chat:token streaming", () => {
  it("appends tokens to streamingContent and clears statusText", () => {
    $chat.next({ ...FRESH, statusText: "thinking…" });
    handlers["chat:token"]({ token: "Hello" });
    handlers["chat:token"]({ token: " world" });
    expect($chat.getValue().streamingContent).toBe("Hello world");
    expect($chat.getValue().statusText).toBe("");
  });
});

describe("chat tool timing", () => {
  // Pin Date.now so we can assert deterministic timestamps.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chat:tool:start pushes a placeholder ToolUse with startedAt", () => {
    handlers["chat:tool:start"]({
      id: "tool-1",
      name: "web_search",
      input: { query: "playwright vs cypress" },
    });

    const v = $chat.getValue();
    expect(v.toolUses).toHaveLength(1);
    expect(v.toolUses[0]).toMatchObject({
      id: "tool-1",
      name: "web_search",
      input: { query: "playwright vs cypress" },
      result: "",
      startedAt: new Date("2026-05-16T10:00:00Z").getTime(),
    });
    // streamingContent should have been folded into a step and reset.
    expect(v.streamingContent).toBe("");
    expect(v.streamingSteps).toHaveLength(1);
  });

  it("chat:tool finalises an existing placeholder by id", () => {
    // First send the start
    handlers["chat:tool:start"]({ id: "tool-1", name: "web_search", input: {} });
    const startedAt = $chat.getValue().toolUses[0].startedAt;

    // 2.5 seconds pass…
    vi.advanceTimersByTime(2500);

    handlers["chat:tool"]({
      id: "tool-1",
      name: "web_search",
      input: { query: "foo" },
      result: "200 OK",
      durationMs: 2500,
    });

    const v = $chat.getValue();
    expect(v.toolUses).toHaveLength(1); // no duplicate appended
    expect(v.toolUses[0]).toMatchObject({
      id: "tool-1",
      result: "200 OK",
      durationMs: 2500,
      startedAt, // preserved from the start event
      completedAt: startedAt! + 2500,
    });
    expect(v.toolRoundsUsed).toBe(1);
  });

  it("chat:tool without a matching start appends and synthesises startedAt", () => {
    // VPS-bridge codepath: never sends `tool:start`, only `tool`.
    handlers["chat:tool"]({
      id: undefined,
      name: "ssh_exec",
      input: { command: "uptime" },
      result: "load 0.0",
      durationMs: 80,
    });

    const v = $chat.getValue();
    expect(v.toolUses).toHaveLength(1);
    const t = v.toolUses[0];
    expect(t.startedAt).toBe(t.completedAt); // synthesised to avoid undefined
    expect(t.durationMs).toBe(80);
    expect(t.result).toBe("load 0.0");
    expect(v.toolRoundsUsed).toBe(1);
  });

  it("two concurrent tool calls don't collide — each id is finalised independently", () => {
    handlers["chat:tool:start"]({ id: "a", name: "web_search", input: {} });
    handlers["chat:tool:start"]({ id: "b", name: "ssh_exec", input: {} });
    expect($chat.getValue().toolUses).toHaveLength(2);

    handlers["chat:tool"]({ id: "b", name: "ssh_exec", input: {}, result: "done-b", durationMs: 50 });
    handlers["chat:tool"]({ id: "a", name: "web_search", input: {}, result: "done-a", durationMs: 1200 });

    const uses = $chat.getValue().toolUses;
    expect(uses.find((t) => t.id === "a")?.result).toBe("done-a");
    expect(uses.find((t) => t.id === "b")?.result).toBe("done-b");
    expect($chat.getValue().toolRoundsUsed).toBe(2);
  });
});
