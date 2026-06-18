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
  message?: { content?: string | Array<{ type: string; text?: string; name: string; input?: unknown }> };
  model?: string;
  claude_code_version?: string;
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  [key: string]: unknown;
}

/** Token/cost/timing summary from a turn's `result` event. */
export interface TurnUsage {
  inputTokens: number;
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
  | { kind: "turn-done"; result?: string; usage?: TurnUsage };

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
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
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
        if (Array.isArray(event.message?.content)) {
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
        break;
      }

      case "system":
        this.options.log?.(`system event: ${JSON.stringify(event).slice(0, 1000)}`);
        this.emit({ kind: "claude-info", model: event.model || "", version: event.claude_code_version || "" });
        break;

      case "result": {
        const u = event.usage;
        const usage: TurnUsage | undefined = (u || typeof event.duration_ms === "number" || typeof event.total_cost_usd === "number")
          ? {
              inputTokens: (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
              outputTokens: u?.output_tokens ?? 0,
              costUsd: event.total_cost_usd ?? 0,
              durationMs: event.duration_ms ?? 0,
            }
          : undefined;
        this.emit({ kind: "turn-done", result: event.result, usage });
        break;
      }

      // Control acks / SSE bookkeeping — nothing to surface.
      case "control_response":
      case "message_start":
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
