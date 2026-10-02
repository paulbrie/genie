/**
 * Durable floating-assistant turn — the backend for the `$chat` popup's
 * resilience to Railway edge drops.
 *
 * Unlike the tmux-backed `claude:stream` windows, the floating assistant streams
 * a single Anthropic turn straight over the WebSocket. A naive socket drop would
 * abort the turn (losing tool side-effects + billing if it had partly run) and
 * leave the client spinning. Instead, each turn is wrapped in a TurnState keyed
 * by a client-generated `turnId`:
 *
 *   - the AI runs to completion regardless of the socket (so tools fire exactly
 *     once and usage is billed once);
 *   - streamed tokens/tools are mirrored into a server-side reducer that matches
 *     the renderer's `$chat` reducer exactly;
 *   - while the socket is attached they're also forwarded live;
 *   - a socket drop DETACHES the turn (it keeps running) and starts a grace
 *     timer — only on grace expiry is the still-running turn aborted;
 *   - on reconnect, `resumeDurableChatTurn` rebinds the socket and replays one
 *     `chat:replay` snapshot (+ the terminal `chat:done`/`chat:error` if the turn
 *     finished while detached), so the client catches up with no duplication.
 *
 * The DB writes (assistant log + usage) stay in the chat handler and happen once
 * at real completion — this module only owns event forwarding + replay state.
 */
import type { WebSocket } from "ws";
import type { WsMessage } from "../types.js";

export interface DurableTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  modelId: string;
  modelLabel: string;
  cost: number;
}

interface ToolEntry {
  id?: string;
  name: string;
  input: unknown;
  result: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

interface StepEntry {
  content: string;
  toolUse?: ToolEntry;
}

interface TurnState {
  turnId: string;
  ws: WebSocket | null;
  abort: AbortController;
  send: (ws: WebSocket, msg: WsMessage) => void;
  // --- streaming reducer state (mirror of the renderer's $chat reducer) ---
  streamingContent: string;
  steps: StepEntry[];
  statusText: string;
  maxToolRounds: number;
  toolRoundsUsed: number;
  loading: boolean;
  // Terminal outcome, set once handleChat finishes. Kept (not delivered-and-
  // dropped) so a reconnect that lands after the socket went half-open at the
  // exact moment of completion can still fetch the result.
  outcome:
    | { kind: "done"; usage: DurableTurnUsage | null }
    | { kind: "error"; message: string }
    | null;
  // Drives both the orphan abort (while running) and the post-finish eviction.
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/** Keep a detached / finished-but-undelivered turn this long before
 *  aborting+evicting. Matches the renderer's reconnect-degrade window and the
 *  SSH/Claude-stream grace windows so every reconnect timeout moves together. */
export const TURN_GRACE_MS = 120_000;

const turns = new Map<string, TurnState>();

function isOpen(ws: WebSocket | null): ws is WebSocket {
  return !!ws && ws.readyState === ws.OPEN;
}

function forward(t: TurnState, type: string, payload: Record<string, unknown>): void {
  if (isOpen(t.ws)) t.send(t.ws, { type, payload });
}

function clearGrace(t: TurnState): void {
  if (t.graceTimer) { clearTimeout(t.graceTimer); t.graceTimer = null; }
}

function evict(turnId: string): void {
  const t = turns.get(turnId);
  if (!t) return;
  clearGrace(t);
  turns.delete(turnId);
}

/** Returned by createDurableChatTurn — the chat handler drives the AI through
 *  these so the buffer stays in lockstep with what the client sees. */
export interface DurableChatTurnHandle {
  readonly abort: AbortController;
  onMeta(maxToolRounds: number): void;
  onToolStart(id: string | undefined, name: string, input: unknown): void;
  onToken(token: string): void;
  onTool(id: string | undefined, name: string, input: unknown, result: string, durationMs?: number): void;
  onStatus(status: string): void;
  finishDone(usage: DurableTurnUsage | null): void;
  finishError(message: string): void;
}

/** Register a new durable turn bound to the socket that started it. A turnId
 *  that's somehow already live is aborted+replaced (the client only reuses a
 *  turnId across reconnects, never concurrently). */
export function createDurableChatTurn(
  turnId: string,
  ws: WebSocket,
  send: (ws: WebSocket, msg: WsMessage) => void,
): DurableChatTurnHandle {
  const existing = turns.get(turnId);
  if (existing) { try { existing.abort.abort(); } catch { /* ignore */ } evict(turnId); }

  const t: TurnState = {
    turnId,
    ws,
    abort: new AbortController(),
    send,
    streamingContent: "",
    steps: [],
    statusText: "",
    maxToolRounds: 0,
    toolRoundsUsed: 0,
    loading: true,
    outcome: null,
    graceTimer: null,
  };
  turns.set(turnId, t);

  const finish = (outcome: TurnState["outcome"]): void => {
    const cur = turns.get(turnId);
    if (!cur) return; // already evicted (e.g. grace expired / aborted)
    cur.loading = false;
    cur.outcome = outcome;
    if (outcome?.kind === "done") forward(cur, "chat:done", { usage: outcome.usage ?? undefined });
    else if (outcome?.kind === "error") forward(cur, "chat:error", { message: outcome.message });
    // Keep the result available for a brief window in case the live delivery
    // above went into a half-open socket; the client only re-fetches while it's
    // still `loading`, so a genuine live delivery just evicts on this timer.
    clearGrace(cur);
    cur.graceTimer = setTimeout(() => evict(turnId), TURN_GRACE_MS);
  };

  return {
    abort: t.abort,
    onMeta(maxToolRounds) {
      t.maxToolRounds = maxToolRounds;
      forward(t, "chat:meta", { maxToolRounds });
    },
    onToolStart(id, name, input) {
      t.steps.push({ content: t.streamingContent, toolUse: { id, name, input, result: "", startedAt: Date.now() } });
      t.streamingContent = "";
      forward(t, "chat:tool:start", { id, name, input });
    },
    onToken(token) {
      t.streamingContent += token;
      forward(t, "chat:token", { token });
    },
    onTool(id, name, input, result, durationMs) {
      const completedAt = Date.now();
      const step = id ? t.steps.find((s) => s.toolUse?.id === id) : undefined;
      if (step?.toolUse) {
        step.toolUse.result = result;
        step.toolUse.completedAt = completedAt;
        step.toolUse.durationMs = durationMs;
      } else {
        // No matching start (older paths) — synthesize a finished step.
        t.steps.push({ content: t.streamingContent, toolUse: { id, name, input, result, startedAt: completedAt, completedAt, durationMs } });
        t.streamingContent = "";
      }
      t.toolRoundsUsed += 1;
      forward(t, "chat:tool", { id, name, input, result, durationMs });
    },
    onStatus(status) {
      t.statusText = status;
      forward(t, "chat:status", { status });
    },
    finishDone(usage) { finish({ kind: "done", usage }); },
    finishError(message) { finish({ kind: "error", message }); },
  };
}

/** A snapshot of the live streaming state, shaped like the `claude:stream:replay`
 *  payload so the renderer can replace its `$chat` streaming state wholesale. */
function snapshot(t: TurnState) {
  return {
    streaming: {
      loading: t.loading,
      partialContent: t.streamingContent,
      steps: t.steps,
      statusText: t.statusText,
      toolRoundsUsed: t.toolRoundsUsed,
    },
    maxToolRounds: t.maxToolRounds,
  };
}

/** Rebind a (running or finished) turn to a freshly reconnected socket and replay
 *  it. Returns false when no buffered turn exists (grace expired / unknown id) —
 *  the caller then tells the client the turn is gone so it can offer a retry. */
export function resumeDurableChatTurn(
  turnId: string,
  ws: WebSocket,
  send: (ws: WebSocket, msg: WsMessage) => void,
): boolean {
  const t = turns.get(turnId);
  if (!t) return false;
  clearGrace(t);
  t.send = send;
  t.ws = ws;
  // Capture + deliver the snapshot before any further live token can interleave
  // (synchronous — no await between bind and send), so there's no gap or dup.
  send(ws, { type: "chat:replay", payload: { turnId, ...snapshot(t) } });
  if (t.outcome?.kind === "done") {
    send(ws, { type: "chat:done", payload: { usage: t.outcome.usage ?? undefined } });
    evict(turnId);
  } else if (t.outcome?.kind === "error") {
    send(ws, { type: "chat:error", payload: { message: t.outcome.message } });
    evict(turnId);
  } else {
    // Still running — keep it attached; live forwarding resumes via t.ws.
    t.loading = true;
  }
  return true;
}

/** Socket dropped: detach every turn it owned (they keep running) and arm the
 *  grace timer. Only on expiry is a still-running turn aborted + evicted. */
export function detachDurableChatTurnsForWs(ws: WebSocket): void {
  for (const [turnId, t] of turns) {
    if (t.ws !== ws) continue;
    t.ws = null;
    if (t.graceTimer) continue; // a finish() already armed eviction
    t.graceTimer = setTimeout(() => {
      const cur = turns.get(turnId);
      if (cur && cur.loading) { try { cur.abort.abort(); } catch { /* ignore */ } }
      evict(turnId);
    }, TURN_GRACE_MS);
  }
}

/** Explicit stop (the popup's stop button) for whatever turn this socket owns. */
export function abortDurableChatTurnForWs(ws: WebSocket): void {
  for (const [turnId, t] of turns) {
    if (t.ws !== ws) continue;
    try { t.abort.abort(); } catch { /* ignore */ }
    evict(turnId);
  }
}
