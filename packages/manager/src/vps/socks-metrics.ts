// Lightweight instrumentation for the SOCKS5 path (wireproxy → Taz private net).
//
// Every Taz private-IP SSH dial funnels through socksDial() in socks-dial.ts;
// this module wraps that single chokepoint so we can see whether the `socks`
// library / wireproxy tunnel is healthy: dial latency, success/failure (by
// classified code), how many dials are in flight, and — the leak detector —
// how many SOCKS sockets are currently open vs how many SSH sessions exist.
//
// Pure in-memory counters; no IO. Snapshot is read by the diagnostics panel.

const MAX_LATENCY_SAMPLES = 200;
const MAX_RECENT_FAILURES = 20;

interface SocksFailure {
  at: number;
  dest: string;
  ms: number | null;
  code: string;
  message: string;
}

export interface SocksMetricsSnapshot {
  dialsStarted: number;
  dialsOk: number;
  dialsFailed: number;
  /** Dials begun but not yet settled. A number that only grows = the proxy is wedged. */
  inFlight: number;
  /** SOCKS sockets opened but not yet closed. Should track active SSH sessions;
   *  a steadily climbing value with flat session count = a socket leak. */
  openSockets: number;
  p50Ms: number | null;
  p95Ms: number | null;
  failuresByCode: Record<string, number>;
  recentFailures: SocksFailure[];
  /** Env-gated synthetic probe (GENIE_TAZ_SOCKS_HEARTBEAT_MS). null when unconfigured. */
  heartbeat: { at: number; ok: boolean; ms: number | null; error: string | null } | null;
}

const state = {
  dialsStarted: 0,
  dialsOk: 0,
  dialsFailed: 0,
  inFlight: 0,
  openSockets: 0,
  latencies: [] as number[],
  failuresByCode: {} as Record<string, number>,
  recentFailures: [] as SocksFailure[],
  heartbeat: null as SocksMetricsSnapshot["heartbeat"],
};

export interface SocksDialToken {
  dest: string;
  start: number;
}

/** Map a thrown socks/net error to a stable code. The `socks` lib surfaces
 *  most failures as messages rather than errno, so pattern-match the common ones. */
export function classifySocksError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { message?: string };
  if (e?.code) return e.code;
  const msg = (e?.message || "").toLowerCase();
  if (/timed?\s*out|timeout/.test(msg)) return "ETIMEDOUT";
  if (/refused/.test(msg)) return "ECONNREFUSED";
  if (/unreachable/.test(msg)) return "EHOSTUNREACH";
  if (/socks/.test(msg)) return "socks-rejected";
  return "socks-failure";
}

export function socksDialStart(dest: string): SocksDialToken {
  state.dialsStarted++;
  state.inFlight++;
  return { dest, start: Date.now() };
}

export function socksDialOk(token: SocksDialToken): void {
  state.dialsOk++;
  state.inFlight = Math.max(0, state.inFlight - 1);
  state.openSockets++;
  state.latencies.push(Date.now() - token.start);
  if (state.latencies.length > MAX_LATENCY_SAMPLES) state.latencies.shift();
}

export function socksDialFail(token: SocksDialToken, err: unknown): void {
  state.dialsFailed++;
  state.inFlight = Math.max(0, state.inFlight - 1);
  const code = classifySocksError(err);
  state.failuresByCode[code] = (state.failuresByCode[code] ?? 0) + 1;
  state.recentFailures.unshift({
    at: Date.now(),
    dest: token.dest,
    ms: Date.now() - token.start,
    code,
    message: err instanceof Error ? err.message : String(err),
  });
  if (state.recentFailures.length > MAX_RECENT_FAILURES) state.recentFailures.pop();
}

/** Call once per successfully-opened SOCKS socket when it closes (attach to the
 *  socket's one-shot `close`). Decrements the open-sockets gauge. */
export function socksSocketClosed(): void {
  state.openSockets = Math.max(0, state.openSockets - 1);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function getSocksMetrics(): SocksMetricsSnapshot {
  const sorted = [...state.latencies].sort((a, b) => a - b);
  return {
    dialsStarted: state.dialsStarted,
    dialsOk: state.dialsOk,
    dialsFailed: state.dialsFailed,
    inFlight: state.inFlight,
    openSockets: state.openSockets,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    failuresByCode: { ...state.failuresByCode },
    recentFailures: state.recentFailures.slice(0, 5),
    heartbeat: state.heartbeat,
  };
}

/** Synthetic SOCKS responsiveness probe. Dials a sentinel target through the
 *  proxy and records time-to-settle: a healthy proxy completes the SOCKS
 *  negotiation fast (then succeeds or is refused); a wedged one hangs to the
 *  timeout. Recorded separately from real-traffic counters. Env-gated — off
 *  unless GENIE_TAZ_SOCKS_HEARTBEAT_MS is set.
 *
 *  Imports `socks` lazily so this module stays dependency-light and avoids any
 *  cycle with socks-dial.ts. */
export function startSocksHeartbeat(): void {
  const everyMs = Number(process.env.GENIE_TAZ_SOCKS_HEARTBEAT_MS || 0);
  if (!everyMs || everyMs < 5_000) return; // off, or too aggressive
  const target = process.env.GENIE_TAZ_SOCKS_HEARTBEAT_TARGET || "10.128.0.1:22";
  const [host, portStr] = target.split(":");
  const port = Number(portStr) || 22;

  const tick = async (): Promise<void> => {
    const proxy = process.env.GENIE_TAZ_SOCKS;
    if (!proxy) { state.heartbeat = { at: Date.now(), ok: false, ms: null, error: "GENIE_TAZ_SOCKS unset" }; return; }
    const [proxyHost, proxyPortStr] = proxy.split(":");
    const start = Date.now();
    try {
      const { SocksClient } = await import("socks");
      const { tazSocksAuth } = await import("./socks-dial.js");
      const { socket } = await SocksClient.createConnection({
        proxy: { host: proxyHost, port: Number(proxyPortStr), type: 5, ...tazSocksAuth() },
        command: "connect",
        destination: { host, port },
        timeout: 5_000,
      });
      socket.destroy();
      state.heartbeat = { at: Date.now(), ok: true, ms: Date.now() - start, error: null };
    } catch (err) {
      // A fast "refused/unreachable" still means the proxy is responsive; only a
      // timeout/hang signals a wedged proxy. Record both, flag ok by latency.
      const ms = Date.now() - start;
      const code = classifySocksError(err);
      state.heartbeat = { at: Date.now(), ok: code !== "ETIMEDOUT" && ms < 4_500, ms, error: `${code}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const timer = setInterval(() => { void tick(); }, everyMs);
  timer.unref();
  void tick();
  console.log(`[socks-metrics] heartbeat enabled: ${target} every ${everyMs}ms`);
}
