export interface WsLogEntry {
  direction: "sent" | "received";
  type: string;
  payload: unknown;
  timestamp: number;
}

const MAX_ENTRIES = 500;
let buffer: WsLogEntry[] = [];
const subscribers: Set<() => void> = new Set();

function notify() {
  for (const cb of subscribers) cb();
}

export function logSent(type: string, payload: unknown) {
  buffer = [...buffer, { direction: "sent", type, payload, timestamp: Date.now() }];
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  notify();
}

export function logReceived(type: string, payload: unknown) {
  buffer = [...buffer, { direction: "received", type, payload, timestamp: Date.now() }];
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  notify();
}

export function getLog(): readonly WsLogEntry[] {
  return buffer;
}

export function clearLog() {
  buffer = [];
  notify();
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
