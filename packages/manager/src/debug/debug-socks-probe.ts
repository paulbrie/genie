// READ-ONLY diagnostic: directly measure the lifetime of one SSH-over-SOCKS
// connection to a Taz (10.128.x) VM, to isolate whether the ~60s drops are
// (a) my ssh2 keepalive killing a healthy-but-idle connection, or
// (b) the connection genuinely going half-open (bastion / wireproxy return path).
//
// Method: open ONE connection with ssh2's own keepalive DISABLED
// (keepaliveInterval: 0), then actively `exec("echo")` every PROBE_INTERVAL and
// record each round-trip's success + RTT. If round-trips keep succeeding for the
// whole window, the path is healthy and my keepalive (countMax 3 → 60s) was wrong
// to kill it → (a). If round-trips start timing out at ~60s, the path is genuinely
// dead → (b), and ssh2's keepalive was correctly catching it.
//
// Mounted at GET /api/debug/socks-probe (same auth as /api/debug/server-logs).

import type http from "node:http";
import { Client } from "ssh2";
import { buildConnectOptions, dialSock } from "../vps/ssh-client.js";
import type { SshConnectionConfig } from "../vps/ssh-client.js";
import { authorizeDebugAccess } from "./debug-api.js";
import * as projectService from "../projects/project-service.js";

export interface SocksProbeSample {
  t: number;          // ms since connection ready
  ok: boolean;
  rttMs?: number;
  error?: string;
}

export interface SocksProbeResult {
  host: string;
  username: string;
  routedViaSocks: boolean;
  socksProxy: string | null;
  readyMs?: number;   // time from connect() to ready
  diedAtMs?: number;  // ms after ready when a fatal close/error happened (null = survived window)
  diedReason?: string;
  samples: SocksProbeSample[];
  verdict: string;
}

/** Run the probe against one connection config. Self-contained: opens its own
 *  ssh2 Client (keepalive disabled), exec-probes on an interval, then closes. */
export async function runSocksProbe(
  conn: SshConnectionConfig,
  opts: { windowMs: number; intervalMs: number },
): Promise<SocksProbeResult> {
  const { tazSocksProxy } = await import("../vps/socks-dial.js");
  const result: SocksProbeResult = {
    host: conn.host,
    username: conn.username,
    routedViaSocks: false,
    socksProxy: tazSocksProxy(),
    samples: [],
    verdict: "",
  };

  const dialStart = Date.now();
  let sock: import("node:net").Socket | null = null;
  try {
    sock = await dialSock(conn, 15_000);
  } catch (err) {
    result.verdict = `SOCKS dial failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  result.routedViaSocks = sock != null;

  const client = new Client();
  // buildConnectOptions forces our production keepalive; override to 0 so ssh2
  // does NOT auto-kill — we measure liveness ourselves via exec round-trips.
  const connectOpts = buildConnectOptions(conn, { sock, timeoutMs: 15_000 });
  connectOpts.keepaliveInterval = 0;

  return await new Promise<SocksProbeResult>((resolve) => {
    let readyAt = 0;
    let finished = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const finish = (verdict: string) => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      result.verdict = verdict;
      try { client.end(); } catch { /* ignore */ }
      resolve(result);
    };

    const runExec = () => {
      if (finished) return;
      const t = Date.now() - readyAt;
      const start = Date.now();
      let settled = false;
      const to = setTimeout(() => {
        if (settled) return;
        settled = true;
        result.samples.push({ t, ok: false, error: "exec timeout (10s)" });
      }, 10_000);
      client.exec("echo OK", (err, stream) => {
        if (settled) return;
        if (err) {
          settled = true; clearTimeout(to);
          result.samples.push({ t, ok: false, error: err.message });
          return;
        }
        stream.on("close", () => {
          if (settled) return;
          settled = true; clearTimeout(to);
          result.samples.push({ t, ok: true, rttMs: Date.now() - start });
        }).on("data", () => {}).stderr.on("data", () => {});
      });
    };

    client
      .on("ready", () => {
        readyAt = Date.now();
        result.readyMs = readyAt - dialStart;
        runExec(); // immediate baseline
        timer = setInterval(runExec, opts.intervalMs);
        setTimeout(() => {
          const oks = result.samples.filter((s) => s.ok).length;
          const fails = result.samples.length - oks;
          finish(`survived ${Math.round(opts.windowMs / 1000)}s window — ${oks} ok / ${fails} failed exec round-trips. ${fails === 0 ? "Path HEALTHY: ssh2 keepalive (countMax 3→60s) would have WRONGLY killed this idle conn → cause (a)." : "Some round-trips failed mid-window → intermittent path."}`);
        }, opts.windowMs);
      })
      .on("error", (err) => {
        const t = readyAt ? Date.now() - readyAt : undefined;
        if (readyAt) { result.diedAtMs = t; result.diedReason = err.message; }
        finish(readyAt
          ? `DIED ${Math.round((t ?? 0) / 1000)}s after ready: ${err.message}. With keepalive disabled this is a GENUINE half-open/dead path → cause (b) (bastion/wireproxy return path).`
          : `failed before ready: ${err.message}`);
      })
      .on("close", () => {
        if (!finished) {
          const t = readyAt ? Date.now() - readyAt : undefined;
          result.diedAtMs = t;
          finish(`closed ${Math.round((t ?? 0) / 1000)}s after ready (no error event) → genuine path death → cause (b).`);
        }
      })
      .connect(connectOpts);
  });
}

/** Look up a live VPS connection config by host across all projects. */
async function findConnectionByHost(host: string): Promise<SshConnectionConfig | null> {
  const projects = await projectService.getAll();
  for (const p of projects) {
    const inst = p.vpsInstances.find((v) => !v.deployFailed && v.connection.host === host);
    if (inst) return inst.connection;
  }
  return null;
}

/** Self-matching + self-authing handler, mirroring handleDebugServerLogs.
 *  GET /api/debug/socks-probe?host=10.128.x.x&seconds=90&interval=10
 *  Returns true if it handled the request (matched the path). */
export async function handleSocksProbe(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (req.method !== "GET" || !req.url?.match(/^\/api\/debug\/socks-probe(?:\?|$)/)) return false;

  const auth = await authorizeDebugAccess(req);
  if (!auth.ok) {
    res.writeHead(auth.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: auth.error }));
    return true;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  const host = url.searchParams.get("host");
  if (!host) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "host query param required (a 10.128.x Taz VM IP)" }));
    return true;
  }
  const seconds = Math.min(300, Math.max(20, Number(url.searchParams.get("seconds") || 90)));
  const interval = Math.min(60, Math.max(5, Number(url.searchParams.get("interval") || 10)));

  const conn = await findConnectionByHost(host);
  if (!conn) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `no active VPS instance found for host ${host}` }));
    return true;
  }

  const result = await runSocksProbe(conn, { windowMs: seconds * 1000, intervalMs: interval * 1000 });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result, null, 2));
  return true;
}
