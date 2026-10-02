// Durable floating-assistant turn — survives a socket drop and replays on
// reconnect. These tests use a fake WebSocket (just readyState + OPEN) and a
// captured send fn; they assert the live-forward / detach / resume / grace
// lifecycle without any real network.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  createDurableChatTurn,
  resumeDurableChatTurn,
  detachDurableChatTurnsForWs,
  abortDurableChatTurnForWs,
  TURN_GRACE_MS,
} from "./durable-chat-turn.js";

interface FakeWs {
  OPEN: 1;
  readyState: number;
  sent: { type: string; payload: Record<string, unknown> }[];
}

function makeWs(): { ws: WebSocket; fake: FakeWs; send: (ws: WebSocket, m: { type: string; payload: Record<string, unknown> }) => void } {
  const fake: FakeWs = { OPEN: 1, readyState: 1, sent: [] };
  // The buffer routes every forward through the send fn we pass in, so capture
  // there (and only deliver while the socket reports OPEN, like the real send).
  const send = (target: WebSocket, m: { type: string; payload: Record<string, unknown> }) => {
    const t = target as unknown as FakeWs;
    if (t.readyState === t.OPEN) t.sent.push(m);
  };
  return { ws: fake as unknown as WebSocket, fake, send };
}

let counter = 0;
const nextId = () => `turn-${counter++}`;

describe("durable chat turn", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("forwards live events while the socket is attached", () => {
    const id = nextId();
    const { ws, fake, send } = makeWs();
    const turn = createDurableChatTurn(id, ws, send);
    turn.onMeta(10);
    turn.onToken("hello ");
    turn.onToken("world");
    turn.onToolStart("t1", "read", { path: "a" });
    turn.onTool("t1", "read", { path: "a" }, "ok", 42);
    turn.finishDone({ inputTokens: 1, outputTokens: 2, modelId: "m", modelLabel: "M", cost: 0.01 });

    const types = fake.sent.map((m) => m.type);
    expect(types).toEqual(["chat:meta", "chat:token", "chat:token", "chat:tool:start", "chat:tool", "chat:done"]);
    expect(fake.sent.at(-1)!.payload.usage).toMatchObject({ outputTokens: 2 });
  });

  it("detaches without aborting and replays a snapshot on resume (still running)", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.onToken("partial answer");
    turn.onToolStart("t1", "read", {});

    // Socket drops mid-turn.
    detachDurableChatTurnsForWs(a.ws);
    expect(turn.abort.signal.aborted).toBe(false); // NOT aborted — keeps running

    // A token that arrives while detached is buffered, not lost.
    turn.onToken("more");

    // Reconnect on a fresh socket → one replay snapshot, no terminal event yet.
    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(true);
    expect(b.fake.sent).toHaveLength(1);
    const replay = b.fake.sent[0];
    expect(replay.type).toBe("chat:replay");
    const streaming = replay.payload.streaming as { loading: boolean; partialContent: string; steps: unknown[] };
    expect(streaming.loading).toBe(true);
    // partialContent is the text accumulated AFTER the open tool step ("more"),
    // and the open step carries the pre-tool text.
    expect(streaming.partialContent).toBe("more");
    expect(streaming.steps).toHaveLength(1);

    // Live forwarding resumes on the new socket.
    turn.finishDone(null);
    expect(b.fake.sent.at(-1)!.type).toBe("chat:done");
  });

  it("buffers a turn that finishes while detached, then replays result on resume", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.onToken("done text");
    detachDurableChatTurnsForWs(a.ws);
    // Completes with no socket attached — nothing forwarded.
    turn.finishDone({ inputTokens: 5, outputTokens: 6, modelId: "m", modelLabel: "M", cost: 0.02 });
    expect(a.fake.sent.find((m) => m.type === "chat:done")).toBeUndefined();

    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(true);
    const types = b.fake.sent.map((m) => m.type);
    expect(types).toEqual(["chat:replay", "chat:done"]);

    // Delivered → evicted; a second resume finds nothing.
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(false);
  });

  it("aborts and evicts a still-running turn when the grace window expires", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.onToken("x");
    detachDurableChatTurnsForWs(a.ws);

    expect(turn.abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(TURN_GRACE_MS + 1);
    expect(turn.abort.signal.aborted).toBe(true);

    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(false); // gone
  });

  it("forwards an error and lets a reconnect replay it", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    detachDurableChatTurnsForWs(a.ws);
    turn.finishError("boom");

    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(true);
    const last = b.fake.sent.at(-1)!;
    expect(last.type).toBe("chat:error");
    expect(last.payload.message).toBe("boom");
  });

  it("explicit stop aborts + evicts the turn for that socket", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    abortDurableChatTurnForWs(a.ws);
    expect(turn.abort.signal.aborted).toBe(true);
    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(false);
  });

  it("keeps a finished turn fetchable within grace (covers half-open delivery)", () => {
    // finishDone forwards to the (apparently-open) socket, but the turn is NOT
    // evicted immediately — if that socket was actually half-open the client
    // reconnects still `loading` and re-fetches the result.
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.onToken("answer");
    turn.finishDone({ inputTokens: 1, outputTokens: 1, modelId: "m", modelLabel: "M", cost: 0 });
    expect(a.fake.sent.at(-1)!.type).toBe("chat:done");

    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(true);
    expect(b.fake.sent.map((m) => m.type)).toEqual(["chat:replay", "chat:done"]);
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(false); // delivered → evicted
  });

  it("evicts a finished-but-unfetched turn after grace", () => {
    const id = nextId();
    const a = makeWs();
    createDurableChatTurn(id, a.ws, a.send).finishDone(null);
    vi.advanceTimersByTime(TURN_GRACE_MS + 1);
    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(false);
  });

  it("a finish before detach keeps the evict-only timer (never aborts a done turn)", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.finishDone(null);                 // arms an evict-only grace timer
    detachDurableChatTurnsForWs(a.ws);     // must NOT replace it with an aborting one
    expect(turn.abort.signal.aborted).toBe(false);
    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(true); // still there, gets replayed
  });

  it("synthesizes a finished step for a tool with no matching start", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.onToken("pre");
    turn.onTool("tX", "read", { p: 1 }, "result", 5); // no prior onToolStart
    expect(a.fake.sent.at(-1)!.type).toBe("chat:tool");

    detachDurableChatTurnsForWs(a.ws);
    const b = makeWs();
    resumeDurableChatTurn(id, b.ws, b.send);
    const replay = b.fake.sent.find((m) => m.type === "chat:replay")!;
    const streaming = replay.payload.streaming as { steps: { content: string; toolUse?: Record<string, unknown> }[]; toolRoundsUsed: number };
    expect(streaming.steps).toHaveLength(1);
    expect(streaming.steps[0].content).toBe("pre");
    expect(streaming.steps[0].toolUse).toMatchObject({ name: "read", result: "result", durationMs: 5 });
    expect(streaming.toolRoundsUsed).toBe(1);
    abortDurableChatTurnForWs(b.ws);
  });

  it("captures pre-tool text into the step on tool:start and counts tool rounds", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    turn.onToken("before ");
    turn.onToolStart("t1", "read", {});
    turn.onTool("t1", "read", {}, "ok");
    turn.onToken("after");

    detachDurableChatTurnsForWs(a.ws);
    const b = makeWs();
    resumeDurableChatTurn(id, b.ws, b.send);
    const streaming = b.fake.sent.find((m) => m.type === "chat:replay")!.payload.streaming as {
      partialContent: string; steps: { content: string; toolUse?: Record<string, unknown> }[]; toolRoundsUsed: number;
    };
    expect(streaming.steps[0].content).toBe("before "); // pre-tool text captured into the step
    expect(streaming.steps[0].toolUse).toMatchObject({ result: "ok" }); // matched by id, finalized
    expect(streaming.partialContent).toBe("after");     // post-tool text resumes the running buffer
    expect(streaming.toolRoundsUsed).toBe(1);
    abortDurableChatTurnForWs(b.ws);
  });

  it("aborts and replaces an existing turn with the same id", () => {
    const id = nextId();
    const a = makeWs();
    const turn1 = createDurableChatTurn(id, a.ws, a.send);
    const turn2 = createDurableChatTurn(id, a.ws, a.send); // same id reused
    expect(turn1.abort.signal.aborted).toBe(true);
    expect(turn2.abort.signal.aborted).toBe(false);
    turn2.finishDone(null);
    expect(a.fake.sent.at(-1)!.type).toBe("chat:done");
    abortDurableChatTurnForWs(a.ws);
  });

  it("detach only affects turns owned by the dropped socket", () => {
    const a = makeWs();
    const b = makeWs();
    const idA = nextId();
    const idB = nextId();
    const turnA = createDurableChatTurn(idA, a.ws, a.send);
    const turnB = createDurableChatTurn(idB, b.ws, b.send);

    detachDurableChatTurnsForWs(b.ws); // drop B's socket only

    turnA.onToken("hi"); // A is untouched → still forwards live
    expect(a.fake.sent.some((m) => m.type === "chat:token")).toBe(true);
    expect(turnA.abort.signal.aborted).toBe(false);
    expect(turnB.abort.signal.aborted).toBe(false); // B detached, not aborted

    abortDurableChatTurnForWs(a.ws);
    vi.advanceTimersByTime(TURN_GRACE_MS + 1); // let B's grace lapse
    expect(turnB.abort.signal.aborted).toBe(true);
  });

  it("ignores a finish that arrives after the turn was already evicted", () => {
    const id = nextId();
    const a = makeWs();
    const turn = createDurableChatTurn(id, a.ws, a.send);
    detachDurableChatTurnsForWs(a.ws);
    vi.advanceTimersByTime(TURN_GRACE_MS + 1); // aborted + evicted
    expect(() => turn.finishDone(null)).not.toThrow(); // late completion is a no-op
    const b = makeWs();
    expect(resumeDurableChatTurn(id, b.ws, b.send)).toBe(false);
  });
});
