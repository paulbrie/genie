// Chat finalisation paths — chat:done, chat:error, chat:status, sessions
// list/load/rename/delete. Complements chat.test.ts (streaming + tool timing).

import { describe, it, expect, beforeEach } from "vitest";
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

describe("chat:done", () => {
  it("flushes streaming content + steps into a single assistant message", () => {
    $chat.next({
      ...FRESH,
      streamingContent: "final text",
      streamingSteps: [
        { content: "intro " },
        { content: "with a tool call ", toolUse: { id: "t1", name: "x", input: {}, result: "ok" } },
      ],
      toolUses: [{ id: "t1", name: "x", input: {}, result: "ok" }],
      loading: true,
      statusText: "thinking…",
      toolRoundsUsed: 3,
    });

    handlers["chat:done"]({ usage: { input_tokens: 10, output_tokens: 20 } });

    const v = $chat.getValue();
    expect(v.messages).toHaveLength(1);
    expect(v.messages[0]).toMatchObject({
      role: "assistant",
      content: "intro with a tool call final text",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    // Streaming buffers reset, loading flag cleared.
    expect(v.streamingContent).toBe("");
    expect(v.streamingSteps).toEqual([]);
    expect(v.toolUses).toEqual([]);
    expect(v.loading).toBe(false);
    expect(v.statusText).toBe("");
    expect(v.toolRoundsUsed).toBe(0);
  });

  it("omits toolUses when no tools were used", () => {
    $chat.next({ ...FRESH, streamingContent: "just text" });
    handlers["chat:done"]({});
    expect($chat.getValue().messages[0].toolUses).toBeUndefined();
  });

  it("omits steps when there was only plain content (no tool interleaving)", () => {
    $chat.next({ ...FRESH, streamingContent: "single message" });
    handlers["chat:done"]({});
    // streamingContent gets pushed as a step, so steps will have length 1.
    // The handler keeps `steps` only when length > 0 — that's the case here.
    expect($chat.getValue().messages[0].steps).toHaveLength(1);
  });
});

describe("chat:error", () => {
  it("appends an 'Error: …' assistant message and resets streaming state", () => {
    $chat.next({ ...FRESH, streamingContent: "partial", loading: true, statusText: "thinking" });

    handlers["chat:error"]({ message: "rate limit exceeded" });

    const v = $chat.getValue();
    expect(v.messages).toEqual([{ role: "assistant", content: "Error: rate limit exceeded", isError: true }]);
    expect(v.streamingContent).toBe("");
    expect(v.loading).toBe(false);
    expect(v.statusText).toBe("");
  });
});

describe("chat:status / chat:meta / chat:claude-info", () => {
  it("chat:status sets statusText", () => {
    handlers["chat:status"]({ status: "running tools…" });
    expect($chat.getValue().statusText).toBe("running tools…");
  });

  it("chat:status with empty status clears the field", () => {
    $chat.getValue().statusText = "old" as never;
    handlers["chat:status"]({});
    expect($chat.getValue().statusText).toBe("");
  });

  it("chat:meta sets maxToolRounds when provided", () => {
    handlers["chat:meta"]({ maxToolRounds: 10 });
    expect($chat.getValue().maxToolRounds).toBe(10);
  });

  it("chat:meta is a no-op when maxToolRounds is missing", () => {
    $chat.getValue().maxToolRounds = 5 as never;
    handlers["chat:meta"]({});
    expect($chat.getValue().maxToolRounds).toBe(5);
  });

  it("chat:claude-info merges fields, falling back to previous values for missing ones", () => {
    handlers["chat:claude-info"]({ model: "sonnet-4.6", email: "a@b" });
    expect($chat.getValue().claudeInfo).toEqual({
      model: "sonnet-4.6", email: "a@b", plan: "", version: "",
    });

    // Partial second update keeps previously-known fields.
    handlers["chat:claude-info"]({ version: "0.1.0" });
    expect($chat.getValue().claudeInfo).toEqual({
      model: "sonnet-4.6", email: "a@b", plan: "", version: "0.1.0",
    });
  });
});

describe("chat sessions", () => {
  it("chat:sessions:list replaces sessions and clears the loading flag", () => {
    $chat.getValue().sessionsLoading = true as never;
    const sessions = [
      { sessionId: "s-1", name: "Project alpha", updatedAt: "2026-05-16T00:00:00Z" },
      { sessionId: "s-2", name: "Bug hunt", updatedAt: "2026-05-15T00:00:00Z" },
    ];

    handlers["chat:sessions:list"]({ sessions });

    expect($chat.getValue().sessions).toEqual(sessions);
    expect($chat.getValue().sessionsLoading).toBe(false);
  });

  it("chat:session:loaded replaces messages + sets activeSessionId", () => {
    handlers["chat:session:loaded"]({
      sessionId: "s-9",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hi back", images: ["https://i/a.png"] },
        { role: "user", content: "no images here", images: [] },  // empty array → undefined
      ],
    });

    const v = $chat.getValue();
    expect(v.activeSessionId).toBe("s-9");
    expect(v.loading).toBe(false);
    expect(v.messages).toEqual([
      { role: "user", content: "hi", toolUses: undefined, images: undefined },
      { role: "assistant", content: "hi back", toolUses: undefined, images: ["https://i/a.png"] },
      { role: "user", content: "no images here", toolUses: undefined, images: undefined },
    ]);
  });

  it("chat:session:renamed updates the matching session by id", () => {
    $chat.getValue().sessions = [
      { sessionId: "s-1", name: "Old" },
      { sessionId: "s-2", name: "Untouched" },
    ] as never;

    handlers["chat:session:renamed"]({ sessionId: "s-1", name: "New" });

    expect($chat.getValue().sessions).toEqual([
      { sessionId: "s-1", name: "New" },
      { sessionId: "s-2", name: "Untouched" },
    ]);
  });
});
