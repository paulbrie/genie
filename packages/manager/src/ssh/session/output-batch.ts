/**
 * Coalesce rapid PTY output chunks before emitting over WebSocket.
 * Full-screen TUIs (Claude Code, vim) write many small chunks per frame;
 * batching at 16ms produces one WS frame per render.
 */
import type { WebSocket } from "ws";

const SSH_OUTPUT_BATCH_MS = 16;

type OutputBatch = {
  parts: Buffer[];
  timer: ReturnType<typeof setTimeout> | null;
  terminalId: string;
  ws: WebSocket;
};

const outputBatches = new Map<string, OutputBatch>();

type SendFn = (ws: WebSocket, terminalId: string, data: Buffer) => void;
type AfterFlushFn = (terminalId: string, ws: WebSocket) => void;

export function scheduleOutputBatch(
  ws: WebSocket,
  terminalId: string,
  data: Buffer,
  send: SendFn,
  afterFlush?: AfterFlushFn,
) {
  let batch = outputBatches.get(terminalId);
  if (!batch) {
    batch = { parts: [], timer: null, terminalId, ws };
    outputBatches.set(terminalId, batch);
  }

  batch.ws = ws;
  batch.parts.push(data);

  if (batch.timer) return;

  batch.timer = setTimeout(() => {
    flushOutputBatch(terminalId, send, afterFlush);
  }, SSH_OUTPUT_BATCH_MS);
}

export function flushOutputBatch(
  terminalId: string,
  send: SendFn,
  afterFlush?: AfterFlushFn,
) {
  const batch = outputBatches.get(terminalId);
  if (!batch) return;

  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }

  const combined = batch.parts.length === 1 ? batch.parts[0]! : Buffer.concat(batch.parts);
  batch.parts.length = 0;

  if (combined.length === 0) return;

  send(batch.ws, batch.terminalId, combined);
  afterFlush?.(terminalId, batch.ws);
}

export function clearOutputBatch(
  terminalId: string,
  send: SendFn,
  afterFlush?: AfterFlushFn,
) {
  flushOutputBatch(terminalId, send, afterFlush);
  outputBatches.delete(terminalId);
}
