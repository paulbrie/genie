// In-memory flight recorder for per-VM SSH "requests" (exec/probe commands) and
// cumulative exec byte totals, used by the Manage popup's Traffic tab. PTY byte
// totals come from the session cache's channel counters; this module covers the
// discrete exec/probe requests (command out, response in) plus per-host running
// totals so the client can derive a live throughput graph by diffing snapshots.
//
// Dependency-free on purpose: both ssh-session-cache (execCached) and
// ssh-probe-pool (execProbe) record into it, so it must not import either.

const RING_SIZE = 1000;

export interface SshCommandRecord {
  id: string;
  ts: number;
  host: string;
  username: string;
  kind: "exec" | "probe";
  /** Sanitized + truncated command line (secrets redacted). */
  command: string;
  /** Bytes sent (command length). */
  bytesOut: number;
  /** Bytes received (response length); 0 on failure. */
  bytesIn: number;
  durationMs: number;
  ok: boolean;
}

const ring: SshCommandRecord[] = [];
const totals = new Map<string, { bytesIn: number; bytesOut: number }>();
let seq = 0;

/** Redact embedded credentials/tokens and truncate so the log never leaks
 *  secrets (commands can carry PATs, e.g. a git remote with a token). */
export function sanitizeCommand(cmd: string): string {
  let s = cmd
    // https://user:token@host or https://token@host
    .replace(/(https?:\/\/)[^@\s/]+@/gi, "$1***@")
    // common token shapes
    .replace(/\b(github_pat_|ghp_|gho_|ghs_|ghu_|glpat-|xox[baprs]-)[A-Za-z0-9_-]+/g, "$1***")
    // Authorization: Bearer/Basic <token>
    .replace(/(authorization:\s*(?:bearer|basic)\s+)\S+/gi, "$1***");
  if (s.length > 300) s = s.slice(0, 300) + "…";
  return s;
}

export function recordCommand(r: Omit<SshCommandRecord, "id" | "command"> & { command: string }): void {
  const rec: SshCommandRecord = { ...r, id: String(++seq), command: sanitizeCommand(r.command) };
  ring.push(rec);
  if (ring.length > RING_SIZE) ring.shift();
  const t = totals.get(r.host) ?? { bytesIn: 0, bytesOut: 0 };
  t.bytesIn += r.bytesIn;
  t.bytesOut += r.bytesOut;
  totals.set(r.host, t);
}

/** Most-recent-first command records for a host. */
export function listCommands(host: string, limit = 100): SshCommandRecord[] {
  const out: SshCommandRecord[] = [];
  for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
    if (ring[i].host === host) out.push(ring[i]);
  }
  return out;
}

/** Cumulative exec/probe bytes for a host (PTY bytes are added by the snapshot). */
export function execTotals(host: string): { bytesIn: number; bytesOut: number } {
  return totals.get(host) ?? { bytesIn: 0, bytesOut: 0 };
}
