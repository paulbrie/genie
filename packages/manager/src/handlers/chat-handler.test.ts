// Integration test for the chat:send → durable-buffer → chat:resume / chat:stop
// wiring in chat-handler. The AI itself (`handleChat`) and the DB/service layer
// are mocked; the durable-chat-turn module is REAL, so this exercises the actual
// seam: a turn started by chat:send must survive a socket drop and replay on a
// chat:resume from a fresh socket, exactly as it would on a Railway edge reset.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// handleChat is the AI call — capture its callbacks so the test can drive the
// stream and decide when (if ever) the turn completes.
const H = vi.hoisted(() => ({
  cb: null as null | {
    onToken: (t: string) => void;
    onDone: (full: string, usage?: unknown) => void;
    onError: (m: string) => void;
    onTool: (name: string, input: unknown, result: string, id?: string, durationMs?: number) => void;
    onToolStart: (id: string | undefined, name: string, input: unknown) => void;
    signal: AbortSignal;
  },
}));

vi.mock("../chat/chat.js", () => ({
  handleChat: vi.fn((
    _messages: unknown,
    onToken: (t: string) => void,
    onDone: (full: string, usage?: unknown) => void,
    onError: (m: string) => void,
    onTool: (name: string, input: unknown, result: string, id?: string, durationMs?: number) => void,
    _context: unknown,
    _dom: unknown,
    signal: AbortSignal,
    _exec: unknown,
    _modelId: unknown,
    _maxRounds: unknown,
    _pinnedVm: unknown,
    onToolStart: (id: string | undefined, name: string, input: unknown) => void,
  ) => {
    H.cb = { onToken, onDone, onError, onTool, onToolStart, signal };
    return new Promise<void>(() => { /* never resolves on its own — test drives it */ });
  }),
}));

// DB / service layer — all stubbed so no real database is touched.
vi.mock("../chat/chat-service.js", () => ({}));
vi.mock("../chat/assistant-log-service.js", () => ({ saveAssistantMessage: vi.fn(() => Promise.resolve()) }));
vi.mock("../settings-service.js", () => ({ getGlobalSetting: vi.fn(async () => undefined) }));
vi.mock("../projects/project-service.js", () => ({ getById: vi.fn(async () => null) }));
vi.mock("../logging/analytics-service.js", () => ({ recordEvent: vi.fn(() => Promise.resolve()) }));
vi.mock("../chat/assistant-session-state-service.js", () => ({ saveResumeSessionId: vi.fn(), getResumeState: vi.fn() }));
vi.mock("../db/seed.js", () => ({ getClaudeUserId: vi.fn(() => "claude-id") }));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(() => ({ insert: () => ({ values: () => Promise.resolve() }) })) }));
vi.mock("../db/schema.js", () => ({ aiUsage: {} }));
vi.mock("../auth/auth.js", () => ({ isAdmin: vi.fn(async () => false) }));
vi.mock("../chat/vps-agent-router.js", () => ({ routeChatToVpsAgent: vi.fn(async () => true) }));
vi.mock("../ws-server.js", () => ({
  activeChatAbortControllers: new Map(),
  broadcastProjectList: vi.fn(),
  broadcastToUsers: vi.fn(),
  createDirectDomActionExecutor: vi.fn(),
  getExtensionClient: vi.fn(() => null),
  sendToUser: vi.fn(),
  getConnectedUserIds: vi.fn(() => []),
}));

import { handleChatMessage } from "./chat-handler.js";
// detachDurableChatTurnsForWs simulates the ws-server close path; abort* is cleanup.
import { abortDurableChatTurnForWs, detachDurableChatTurnsForWs } from "../chat/durable-chat-turn.js";
import { activeChatAbortControllers } from "../ws-server.js";
import type { WsMessage } from "../types.js";

interface FakeWs { OPEN: 1; readyState: number; }
const allWs: FakeWs[] = [];
function mkWs(): FakeWs { const w: FakeWs = { OPEN: 1, readyState: 1 }; allWs.push(w); return w; }
type Sent = { type: string; payload: Record<string, unknown> };
const capture = (arr: Sent[]) => (_ws: unknown, m: WsMessage) => { arr.push(m as Sent); };
const flush = () => new Promise((r) => setTimeout(r, 0));

function state() {
  return { userId: "u1", role: "user", clientType: "web", user: { name: "U" }, ip: null, assistantSessionId: null } as unknown as Parameters<typeof handleChatMessage>[3];
}

async function chatSend(ws: FakeWs, sent: Sent[], turnId: string, modelId = "claude-sonnet") {
  const msg: WsMessage = { type: "chat:send", payload: { messages: [{ role: "user", content: "hi" }], modelId, turnId } };
  await handleChatMessage(ws as never, msg, capture(sent), state());
  await flush();
}
async function chatMsg(ws: FakeWs, sent: Sent[], type: string, payload: Record<string, unknown>) {
  await handleChatMessage(ws as never, { type, payload }, capture(sent), state());
  await flush();
}

beforeEach(() => {
  H.cb = null;
  activeChatAbortControllers.clear();
});
afterEach(() => {
  for (const w of allWs) abortDurableChatTurnForWs(w as never); // evict + clear any grace timers
  allWs.length = 0;
});

describe("chat:send → durable turn → reconnect resume", () => {
  it("buffers an in-flight turn and replays it on chat:resume from a new socket", async () => {
    const ws1 = mkWs();
    const sent1: Sent[] = [];
    await chatSend(ws1, sent1, "turn-1");
    expect(H.cb).toBeTruthy();

    // chat:meta forwarded live, then a streamed token.
    expect(sent1.map((m) => m.type)).toContain("chat:meta");
    H.cb!.onToken("partial answer");
    expect(sent1.filter((m) => m.type === "chat:token")).toHaveLength(1);

    // Socket drops (the ws-server close path).
    detachDurableChatTurnsForWs(ws1 as never);

    // Reconnect on a fresh socket and resume the same turn id.
    const ws2 = mkWs();
    const sent2: Sent[] = [];
    await chatMsg(ws2, sent2, "chat:resume", { turnId: "turn-1" });
    const replay = sent2.find((m) => m.type === "chat:replay");
    expect(replay).toBeTruthy();
    expect((replay!.payload.streaming as { partialContent: string }).partialContent).toBe("partial answer");

    // Live forwarding now goes to the new socket.
    H.cb!.onToken(" continues");
    expect(sent2.filter((m) => m.type === "chat:token").at(-1)!.payload.token).toBe(" continues");
  });

  it("replays the result of a turn that COMPLETED while disconnected (no re-run)", async () => {
    const ws1 = mkWs();
    const sent1: Sent[] = [];
    await chatSend(ws1, sent1, "turn-2");
    H.cb!.onToken("the answer");

    detachDurableChatTurnsForWs(ws1 as never);
    // Turn finishes server-side while no socket is attached.
    H.cb!.onDone("the answer", { inputTokens: 1, outputTokens: 2, modelId: "m", modelLabel: "M", cost: 0.01 });
    expect(sent1.find((m) => m.type === "chat:done")).toBeUndefined(); // nothing delivered to the dead socket

    const ws2 = mkWs();
    const sent2: Sent[] = [];
    await chatMsg(ws2, sent2, "chat:resume", { turnId: "turn-2" });
    // Snapshot then the buffered terminal event — the turn ran exactly once.
    expect(sent2.map((m) => m.type)).toEqual(["chat:replay", "chat:done"]);

    // A second resume finds nothing (delivered → evicted).
    const sent3: Sent[] = [];
    await chatMsg(mkWs(), sent3, "chat:resume", { turnId: "turn-2" });
    expect(sent3.map((m) => m.type)).toEqual(["chat:resume:gone"]);
  });

  it("tells the client when the buffered turn is gone (unknown / grace-expired id)", async () => {
    const sent: Sent[] = [];
    await chatMsg(mkWs(), sent, "chat:resume", { turnId: "does-not-exist" });
    expect(sent.map((m) => m.type)).toEqual(["chat:resume:gone"]);
  });

  it("chat:stop aborts the in-flight durable turn", async () => {
    const ws1 = mkWs();
    const sent1: Sent[] = [];
    await chatSend(ws1, sent1, "turn-3");
    expect(H.cb!.signal.aborted).toBe(false);

    await chatMsg(ws1, sent1, "chat:stop", {});
    expect(H.cb!.signal.aborted).toBe(true);

    // The turn is evicted — a resume finds nothing.
    const sent2: Sent[] = [];
    await chatMsg(mkWs(), sent2, "chat:resume", { turnId: "turn-3" });
    expect(sent2.map((m) => m.type)).toEqual(["chat:resume:gone"]);
  });

  it("the claude-code path uses the abort-controller pool, not the durable buffer", async () => {
    const ws1 = mkWs();
    const sent1: Sent[] = [];
    await chatSend(ws1, sent1, "turn-4", "claude-code");
    // claude-code routes via the VPS agent + the legacy abort-controller pool.
    expect(activeChatAbortControllers.has(ws1 as never)).toBe(true);
    // No durable turn was created, so it can't be resumed.
    const sent2: Sent[] = [];
    await chatMsg(mkWs(), sent2, "chat:resume", { turnId: "turn-4" });
    expect(sent2.map((m) => m.type)).toEqual(["chat:resume:gone"]);
  });
});
