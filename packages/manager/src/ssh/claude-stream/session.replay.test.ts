// Cold-reattach replay-mode for the durable Claude stream. When reopening a
// session whose tmux survived, the manager re-tails the full OUT file from line
// 1 — which would re-emit the entire history as live token events and duplicate
// the client transcript. Replay-mode instead rebuilds the transcript silently
// up to the OUT line count at reattach, then emits ONE `claude:stream:replay`
// snapshot; only lines past that boundary emit live.
//
// We mock the SSH layer (connectSsh → a fake session whose `has-session` reports
// REATTACH, `wc -l` reports the boundary, and `execStreaming` hands back an
// EventEmitter we push chunks into) and capture everything sent to the client.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const h = vi.hoisted(() => ({ wc: "3", stdout: null as unknown as EventEmitter }));

vi.mock("../../vps/ssh-client.js", () => ({
  connectSsh: vi.fn(async () => ({
    exec: vi.fn(async (cmd: string) => {
      if (cmd.includes("has-session")) return "GENIE_REATTACH"; // force the reattach path
      if (cmd.includes("wc -l")) return h.wc;                   // OUT line count → replayUntilLine
      return "";
    }),
    execStreaming: vi.fn(async () => ({ stdout: h.stdout, stdin: {}, stderr: {}, close: () => {} })),
    close: () => {},
  })),
}));
vi.mock("../../chat/assistant-session-state-service.js", () => ({ saveResumeSessionId: vi.fn(async () => {}) }));

import {
  startClaudeStream,
  setClaudeStreamSend,
  detachClaudeStream,
  type StartClaudeStreamParams,
} from "./session.js";

const ID = "cs-replay";
let captured: { type: string; payload: Record<string, unknown> }[] = [];

const tokenLine = (t: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
const feed = (line: string) => h.stdout.emit("data", Buffer.from(line + "\n"));
const types = () => captured.map((m) => m.type);
const fakeWs = {} as unknown as Parameters<typeof startClaudeStream>[0];

function params(): StartClaudeStreamParams {
  return {
    claudeStreamId: ID,
    shellOpts: { host: "h", port: 22, username: "u", privateKeyPath: "/k" },
    projectId: "p", instanceId: "i", sessionKey: "p:i:chat",
    tmuxName: "claude-chat-csreplay",
    claudePath: "/usr/bin/claude",
    dest: "/opt/project",
    context: "ctx",
    resumeSessionId: null,
    apiKey: null,
    authEmail: "e@x", authPlan: "Max",
    claudeInfo: { model: "", email: "e@x", plan: "Max", version: "" },
  };
}

describe("claude-stream cold-reattach replay-mode", () => {
  beforeEach(() => {
    captured = [];
    h.wc = "3";
    h.stdout = new EventEmitter();
    setClaudeStreamSend((_ws, msg) => captured.push(msg as { type: string; payload: Record<string, unknown> }));
  });
  afterEach(() => { detachClaudeStream(ID); });

  it("suppresses historical tokens, emits one snapshot at the boundary, then goes live", async () => {
    await startClaudeStream(fakeWs, params());

    // ready + claude-info are emitted live (before replay-mode engages); no token
    // or replay yet.
    expect(types()).toEqual(["claude:stream:ready", "claude:stream:claude-info"]);

    feed(tokenLine("A"));
    feed(tokenLine("B"));
    // Still catching up (2 < 3 lines) → nothing forwarded.
    expect(captured.filter((m) => m.type === "claude:stream:token")).toHaveLength(0);
    expect(captured.filter((m) => m.type === "claude:stream:replay")).toHaveLength(0);

    feed(tokenLine("C")); // crosses replayUntilLine (3) → one snapshot
    const replays = captured.filter((m) => m.type === "claude:stream:replay");
    expect(replays).toHaveLength(1);
    expect((replays[0].payload.streaming as { partialContent: string }).partialContent).toBe("ABC");
    // No historical token events leaked to the client during catch-up.
    expect(captured.filter((m) => m.type === "claude:stream:token")).toHaveLength(0);

    feed(tokenLine("D")); // past the boundary → live
    const tokens = captured.filter((m) => m.type === "claude:stream:token");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].payload.token).toBe("D");
  });

  it("goes live immediately when the surviving OUT is empty", async () => {
    h.wc = "0";
    await startClaudeStream(fakeWs, params());

    // Empty boundary → one (empty) snapshot right away, replay-mode off.
    const replays = captured.filter((m) => m.type === "claude:stream:replay");
    expect(replays).toHaveLength(1);
    expect((replays[0].payload.streaming as { partialContent: string }).partialContent).toBe("");

    feed(tokenLine("X")); // emits live, no suppression
    const tokens = captured.filter((m) => m.type === "claude:stream:token");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].payload.token).toBe("X");
  });
});
