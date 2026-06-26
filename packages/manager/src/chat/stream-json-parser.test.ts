import { describe, it, expect } from "vitest";
import { StreamJsonParser, type ParsedStreamEvent } from "./stream-json-parser.js";

function parseAll(lines: string[]): ParsedStreamEvent[] {
  const events: ParsedStreamEvent[] = [];
  const parser = new StreamJsonParser((e) => events.push(e));
  for (const l of lines) parser.push(l + "\n");
  parser.flush();
  return events;
}

describe("StreamJsonParser", () => {
  it("emits a session event whenever session_id is present", () => {
    const events = parseAll([JSON.stringify({ type: "system", subtype: "init", session_id: "abc", model: "claude-x" })]);
    expect(events).toContainEqual({ kind: "session", sessionId: "abc" });
    expect(events).toContainEqual({ kind: "claude-info", model: "claude-x", version: "" });
  });

  it("streams text tokens from assistant events", () => {
    const events = parseAll([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello " }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "world" }] } }),
    ]);
    expect(events.filter((e) => e.kind === "token")).toEqual([
      { kind: "token", text: "Hello " },
      { kind: "token", text: "world" },
    ]);
  });

  it("streams text tokens from content_block_delta", () => {
    const events = parseAll([
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }),
    ]);
    expect(events).toContainEqual({ kind: "token", text: "hi" });
  });

  it("assembles a tool call across content_block_start/delta/stop", () => {
    const events = parseAll([
      JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: "bash" } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"cmd":' } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '"ls"}' } }),
      JSON.stringify({ type: "content_block_stop" }),
    ]);
    expect(events).toContainEqual({ kind: "tool", name: "bash", input: { cmd: "ls" }, result: "" });
  });

  it("emits a tool event from an assistant tool_use block", () => {
    const events = parseAll([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "read", input: { path: "/x" } }] } }),
    ]);
    expect(events).toContainEqual({ kind: "tool", name: "read", input: { path: "/x" }, result: "" });
  });

  it("does not double content when partials are followed by a consolidated assistant snapshot", () => {
    // Under `--output-format stream-json` the CLI streams a message via
    // content_block_* partials, then repeats it in an `assistant` snapshot. The
    // snapshot must not re-emit the already-streamed text or tool calls.
    const events = parseAll([
      JSON.stringify({ type: "message_start" }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Digging in:" } }),
      JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: "bash" } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"cmd":"du"}' } }),
      JSON.stringify({ type: "content_block_stop" }),
      // Consolidated snapshot of the SAME message — must be ignored.
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "text", text: "Digging in:" },
        { type: "tool_use", name: "bash", input: { cmd: "du" } },
      ] } }),
    ]);
    expect(events.filter((e) => e.kind === "token")).toEqual([{ kind: "token", text: "Digging in:" }]);
    expect(events.filter((e) => e.kind === "tool")).toEqual([{ kind: "tool", name: "bash", input: { cmd: "du" }, result: "" }]);
  });

  it("still emits from the assistant snapshot when no partials preceded it (assistant-only mode)", () => {
    const events = parseAll([
      JSON.stringify({ type: "message_start" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "no partials here" }] } }),
    ]);
    expect(events.filter((e) => e.kind === "token")).toEqual([{ kind: "token", text: "no partials here" }]);
  });

  it("resets the per-message dedup so a later assistant-only message still emits", () => {
    const events = parseAll([
      // Message 1: streamed via partials + snapshot (snapshot ignored).
      JSON.stringify({ type: "message_start" }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "first" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "first" }] } }),
      // Message 2: snapshot only (must emit).
      JSON.stringify({ type: "message_start" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "second" }] } }),
    ]);
    expect(events.filter((e) => e.kind === "token")).toEqual([
      { kind: "token", text: "first" },
      { kind: "token", text: "second" },
    ]);
  });

  it("signals turn completion on a result event (durable sessions never EOF)", () => {
    const events = parseAll([JSON.stringify({ type: "result", subtype: "success", session_id: "s1", result: "done" })]);
    expect(events).toContainEqual({ kind: "turn-done", result: "done" });
    expect(events).toContainEqual({ kind: "session", sessionId: "s1" });
  });

  it("emits a user event for echoed user turns (--replay-user-messages)", () => {
    expect(parseAll([JSON.stringify({ type: "user", message: { role: "user", content: "hi there" } })]))
      .toEqual([{ kind: "user", text: "hi there" }]);
    // Block-array content is flattened to text too.
    expect(parseAll([JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "blocks" }] } })]))
      .toEqual([{ kind: "user", text: "blocks" }]);
  });

  it("ignores control_response and ping without throwing", () => {
    const events = parseAll([
      JSON.stringify({ type: "control_response", response: { subtype: "ack" } }),
      JSON.stringify({ type: "ping" }),
    ]);
    expect(events).toEqual([]);
  });

  it("tolerates non-JSON lines and partial chunks split across push() calls", () => {
    const events: ParsedStreamEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));
    parser.push("garbage line\n");
    parser.push('{"type":"assistant","message":{"content":[{"type":"text",');
    parser.push('"text":"ok"}]}}\n');
    parser.flush();
    expect(events).toEqual([{ kind: "token", text: "ok" }]);
  });
});
