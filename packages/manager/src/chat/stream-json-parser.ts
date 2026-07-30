/**
 * Parser for Claude Code's newline-delimited `--output-format stream-json`.
 *
 * Extracted from vps-agent-router.ts so it can be shared by:
 *   - the one-shot assistant chat (`claude -p … stream-json`), and
 *   - the durable streaming chat session (`claude --input-format stream-json
 *     --output-format stream-json`) that backs the chat-mode terminal.
 *
 * It is transport-agnostic: feed it raw stdout chunks via `push()` and it emits
 * normalized `ParsedStreamEvent`s through the `emit` callback. The caller maps
 * those onto whatever WS protocol it speaks (`chat:*` vs `claude:stream:*`).
 *
 * Durable mode never sees stdout EOF, so per-turn completion is signalled by the
 * `result` event (→ `turn-done`), not by the stream closing.
 */

/** Shape of a single stream-json line. Only the fields we read are typed. */
export interface StreamJsonEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  content_block?: { type?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  message?: {
    content?: string | Array<{ type: string; text?: string; name: string; input?: unknown }>;
    /** Per-call token usage on each `assistant` event — the snapshot for THAT
     *  single model call. The last one in a turn is the live context occupancy. */
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  model?: string;
  claude_code_version?: string;
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  [key: string]: unknown;
}

/** One question from an AskUserQuestion `can_use_tool` control request. */
export interface AskQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

/** Token/cost/timing summary from a turn's `result` event. */
export interface TurnUsage {
  /** Total prompt size: fresh input + cache reads + cache writes. */
  inputTokens: number;
  /** Portion of `inputTokens` served from the prompt cache (already-seen
   *  system prompt / files). `inputTokens - cachedInputTokens` is what the turn
   *  processed fresh — the meaningful "new" figure for the footer. */
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

/** Normalized events the parser produces, independent of any WS namespace. */
export type ParsedStreamEvent =
  | { kind: "token"; text: string }
  | { kind: "tool"; name: string; input: Record<string, unknown>; result: string }
  | { kind: "claude-info"; model: string; version: string }
  | { kind: "session"; sessionId: string }
  /** A user turn echoed back by `--replay-user-messages` (used to rebuild the
   *  user's prompts when replaying the captured output on reattach). */
  | { kind: "user"; text: string }
  /** One assistant turn finished. `result` is the final text when no streamed
   *  tokens preceded it (rare; matches the one-shot router's fallback).
   *  `usage` carries the turn's token/cost/timing summary when present. */
  | { kind: "turn-done"; result?: string; usage?: TurnUsage }
  /** AskUserQuestion routed over the control protocol (`--permission-prompt-tool
   *  stdio`): claude is BLOCKED until a control_response with this requestId is
   *  written to its stdin. */
  | { kind: "ask"; requestId: string; toolUseId: string; questions: AskQuestion[] }
  /** A tool_result arrived for this tool_use_id — used to clear a pending ask
   *  when replaying captured output (the answer frame itself isn't in OUT). */
  | { kind: "tool-result"; toolUseId: string }
  /** Any other tool's can_use_tool request (shouldn't fire while
   *  --dangerously-skip-permissions is on; auto-allowed by the session). */
  | { kind: "can-use-tool"; requestId: string; toolName: string; input: Record<string, unknown> };

export interface StreamJsonParserOptions {
  /** Optional debug logger; called once per parsed event with a short summary. */
  log?: (line: string) => void;
}

/** Claude Code injects bookkeeping messages when a slash command runs
 *  (`<local-command-caveat>`, `<command-name>/clear…`, `<local-command-stdout>`).
 *  They're protocol noise, not conversation. */
const LOCAL_COMMAND_RE = /^\s*<(local-command-caveat|command-name|command-message|command-args|local-command-stdout|command-contents)\b/;
export function isLocalCommandNoise(text: string): boolean {
  return LOCAL_COMMAND_RE.test(text);
}

export class StreamJsonParser {
  private buffer = "";
  private currentToolName = "";
  private currentToolInput = "";
  /** Usage of the most recent `assistant` model call in the current turn. The
   *  turn's `result.usage` is the SUM across every internal call (each re-reads
   *  the cached context), so it balloons past the window and is useless as a
   *  context-occupancy figure. The last single call's prompt size IS the live
   *  occupancy, so we capture it here and use it for the token fields. */
  private lastAssistantUsage: StreamJsonEvent["usage"] | undefined;
  /** True once the current message's content has been delivered via the
   *  fine-grained partial-message events (`content_block_*`). Under
   *  `--output-format stream-json` the CLI streams a message token-by-token AND
   *  then repeats it verbatim in a consolidated `assistant` snapshot; this flag
   *  lets us skip the snapshot's text/tool blocks so prose and tool pills aren't
   *  doubled. Reset at each message boundary; the snapshot is still the sole
   *  source in assistant-only mode (no partials), where it stays false. */
  private streamedThisMessage = false;

  constructor(
    private readonly emit: (event: ParsedStreamEvent) => void,
    private readonly options: StreamJsonParserOptions = {},
  ) {}

  /** Feed a raw stdout chunk. Complete lines are parsed; a partial trailing
   *  line is retained until the next chunk (or `flush()`). */
  push(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.processLine(line);
  }

  /** Parse any buffered trailing line. Call once the stream ends. */
  flush(): void {
    if (this.buffer.trim()) this.processLine(this.buffer);
    this.buffer = "";
  }

  private processLine(line: string): void {
    if (!line.trim()) return;
    let event: StreamJsonEvent;
    try {
      event = JSON.parse(line) as StreamJsonEvent;
    } catch {
      this.options.log?.(`[non-json] ${line.slice(0, 300)}`);
      return;
    }
    this.processEvent(event);
  }

  private processEvent(event: StreamJsonEvent): void {
    if (event.session_id) this.emit({ kind: "session", sessionId: event.session_id });

    this.options.log?.(`event type=${event.type} subtype=${event.subtype || ""} keys=${Object.keys(event).join(",")}`);

    switch (event.type) {
      case "content_block_start":
        if (event.content_block?.type === "tool_use") {
          this.currentToolName = event.content_block.name || "";
          this.currentToolInput = "";
          this.streamedThisMessage = true;
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
          this.streamedThisMessage = true;
          this.emit({ kind: "token", text: event.delta.text || "" });
        } else if (event.delta?.type === "input_json_delta") {
          this.currentToolInput += event.delta.partial_json || "";
        }
        break;

      case "content_block_stop":
        if (this.currentToolName) {
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(this.currentToolInput); } catch { /* keep empty input on parse failure */ }
          this.emit({ kind: "tool", name: this.currentToolName, input: parsedInput, result: "" });
          this.currentToolName = "";
          this.currentToolInput = "";
        }
        break;

      case "assistant":
        if (event.message?.usage) this.lastAssistantUsage = event.message.usage;
        // The consolidated `assistant` snapshot repeats this message's content
        // verbatim. When the partial-message events already streamed it (text via
        // `text_delta`, tool calls via `content_block_*`), re-emitting here would
        // double the prose and the tool pills — so skip. Only emit from the
        // snapshot in assistant-only mode, where no partials preceded it.
        if (!this.streamedThisMessage && Array.isArray(event.message?.content)) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              this.emit({ kind: "token", text: block.text });
            } else if (block.type === "tool_use") {
              const input = (block.input && typeof block.input === "object")
                ? (block.input as Record<string, unknown>)
                : {};
              this.emit({ kind: "tool", name: block.name, input, result: "" });
            }
          }
        }
        this.streamedThisMessage = false; // next message starts fresh
        break;

      // User turn echoed by --replay-user-messages — surfaced so a cold replay of
      // the captured output can rebuild the user's prompts (deduped downstream
      // against the optimistic send so live turns aren't doubled).
      case "user": {
        const content = event.message?.content;
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter((b) => b.type === "text").map((b) => b.text || "").join("")
            : "";
        // Skip Claude Code's slash-command bookkeeping (`<local-command-caveat>`,
        // `<command-name>…`, `<local-command-stdout>`) — protocol noise, not a turn.
        if (text && !isLocalCommandNoise(text)) this.emit({ kind: "user", text });
        // Surface tool_result ids so a pending ask can be marked answered when
        // the captured output is replayed on reattach.
        if (Array.isArray(content)) {
          for (const b of content as Array<{ type: string; tool_use_id?: string }>) {
            if (b.type === "tool_result" && b.tool_use_id) this.emit({ kind: "tool-result", toolUseId: b.tool_use_id });
          }
        }
        break;
      }

      // Inbound control request (`--permission-prompt-tool stdio`). AskUserQuestion
      // is the human-in-the-loop path; anything else is auto-allowed upstream.
      case "control_request": {
        const requestId = typeof event.request_id === "string" ? event.request_id : "";
        const request = (event.request && typeof event.request === "object" ? event.request : {}) as {
          subtype?: string; tool_name?: string; tool_use_id?: string; input?: unknown;
        };
        if (!requestId || request.subtype !== "can_use_tool") break;
        const input = (request.input && typeof request.input === "object" ? request.input : {}) as Record<string, unknown>;
        if (request.tool_name === "AskUserQuestion" && Array.isArray(input.questions)) {
          this.emit({ kind: "ask", requestId, toolUseId: request.tool_use_id || "", questions: input.questions as AskQuestion[] });
        } else {
          this.emit({ kind: "can-use-tool", requestId, toolName: request.tool_name || "", input });
        }
        break;
      }

      case "system":
        this.options.log?.(`system event: ${JSON.stringify(event).slice(0, 1000)}`);
        this.emit({ kind: "claude-info", model: event.model || "", version: event.claude_code_version || "" });
        break;

      case "result": {
        const u = event.usage;
        // Token fields describe CONTEXT OCCUPANCY, so take them from the last
        // model call (lastAssistantUsage) — its prompt size is the live window
        // fill. Fall back to the result aggregate only if no per-call usage was
        // seen. Cost/duration stay from the result (they ARE turn-cumulative).
        const occ = this.lastAssistantUsage ?? u;
        const usage: TurnUsage | undefined = (u || this.lastAssistantUsage || typeof event.duration_ms === "number" || typeof event.total_cost_usd === "number")
          ? {
              inputTokens: (occ?.input_tokens ?? 0) + (occ?.cache_read_input_tokens ?? 0) + (occ?.cache_creation_input_tokens ?? 0),
              cachedInputTokens: occ?.cache_read_input_tokens ?? 0,
              outputTokens: occ?.output_tokens ?? 0,
              costUsd: event.total_cost_usd ?? 0,
              durationMs: event.duration_ms ?? 0,
            }
          : undefined;
        this.lastAssistantUsage = undefined; // reset for the next turn
        this.emit({ kind: "turn-done", result: event.result, usage });
        break;
      }

      // A new message begins: clear the per-message "already streamed" flag so the
      // upcoming partials (or, if none, the consolidated snapshot) are emitted.
      case "message_start":
        this.streamedThisMessage = false;
        break;

      // Control acks / SSE bookkeeping — nothing to surface.
      case "control_response":
      case "message_delta":
      case "message_stop":
      case "ping":
        break;

      default:
        this.options.log?.(`UNHANDLED event: ${JSON.stringify(event).slice(0, 500)}`);
        break;
    }
  }
}
