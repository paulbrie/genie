import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Render a wireproxy config from env vars. wireproxy reads a wg-quick-style
 *  ini plus a [Socks5] section it adds on top — no TUN device involved.
 *  Returns the config text (suitable to write to a temp file). */
function renderWireproxyConfig(opts: {
  privateKey: string;
  peerPublicKey: string;
  endpoint: string;
  address: string;
  allowedIps: string;
  socksBind: string;
  keepalive: number;
  mtu: number;
}): string {
  return [
    "[Interface]",
    `PrivateKey = ${opts.privateKey.trim()}`,
    `Address = ${opts.address}`,
    `MTU = ${opts.mtu}`,
    "",
    "[Peer]",
    `PublicKey = ${opts.peerPublicKey.trim()}`,
    `Endpoint = ${opts.endpoint}`,
    `AllowedIPs = ${opts.allowedIps}`,
    `PersistentKeepalive = ${opts.keepalive}`,
    "",
    "[Socks5]",
    `BindAddress = ${opts.socksBind}`,
    "",
  ].join("\n");
}

/** Resolve an env var that may hold either inline content (one-line PEM,
 *  base64 blob, or a WireGuard key) or a filesystem path. Inline beats path
 *  detection: anything that doesn't look like a path is treated as inline. */
function resolveSecret(raw: string): string {
  const trimmed = raw.trim();
  // Heuristic: paths start with /, ~, or ./. WireGuard keys are 44-char base64;
  // anything else (single short token, no slashes) is treated as inline.
  if (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed.startsWith("./")) {
    const resolved = trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
    return readFileSync(resolved, "utf-8").trim();
  }
  return trimmed;
}

function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      s.removeAllListeners();
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => finish(true));
    s.once("timeout", () => finish(false));
    s.once("error", () => finish(false));
    s.connect({ host, port });
  });
}

async function waitForPort(host: string, port: number, totalMs = 5_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (await probePort(host, port, 500)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let child: ChildProcess | null = null;
let exitHookRegistered = false;
/** True once the first startup succeeded — only then do unexpected exits trigger
 *  a respawn. Before that, `startWireproxyIfConfigured` owns failure (fail-fast). */
let supervising = false;
/** Set by stopWireproxy() — an intentional stop must never respawn. */
let shuttingDown = false;
let restartAttempts = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** What respawn() needs to relaunch the same process on the same SOCKS port. */
let lastSpawn: { bin: string; cfgPath: string; socksHost: string; socksPort: number; socksBind: string } | null = null;
/** Last spawn/exit error, used by both the first-start fail-fast and respawn. */
const earlyExit: { err: Error | null } = { err: null };

const WIREPROXY_MAX_RESTARTS = 10;
const WIREPROXY_RESTART_BASE_MS = 1_000;
const WIREPROXY_RESTART_MAX_MS = 30_000;

/** Sync handler so wireproxy doesn't outlive the manager on uncaught
 *  exceptions (where SIGINT/SIGTERM handlers don't run). Idempotent — only
 *  registered once. node's `exit` event is sync-only, hence kill() not await. */
function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.on("exit", () => {
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      child = null;
    }
  });
}

/** Spawn the wireproxy child and attach lifecycle listeners. The `exit` handler
 *  records the error (for the first-start fail-fast) and, once `supervising` is
 *  on, schedules a respawn — unless we're intentionally shutting down. */
function spawnWireproxyProcess(s: { bin: string; cfgPath: string }): void {
  // Reset here (inside a function boundary) rather than at the call sites: an
  // inline `earlyExit.err = null` before reading `.err` later in the same
  // function narrows it to `null` under TS control-flow analysis, making the
  // later `.message` read a `never`.
  earlyExit.err = null;
  child = spawn(s.bin, ["-c", s.cfgPath], { stdio: ["ignore", "inherit", "inherit"] });
  registerExitHook();
  child.once("exit", (code, signal) => {
    const msg = `wireproxy exited (code=${code} signal=${signal})`;
    if (earlyExit.err === null) earlyExit.err = new Error(msg);
    console.error(`[wireproxy] ${msg}`);
    child = null;
    if (supervising && !shuttingDown) scheduleRestart();
  });
  child.once("error", (err) => {
    earlyExit.err = err;
    console.error(`[wireproxy] failed to spawn: ${err.message}`);
  });
}

/** Kill the child without marking an intentional shutdown — used by respawn() to
 *  reap a child that came up but failed its port re-probe. */
function stopChildOnly(): void {
  if (!child) return;
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  child = null;
}

/** Backoff-schedule a respawn after an unexpected exit. Capped so a hard crash
 *  loop (e.g. the SOCKS port got stolen) gives up loudly instead of spinning. */
function scheduleRestart(): void {
  if (restartTimer) return;
  if (restartAttempts >= WIREPROXY_MAX_RESTARTS) {
    console.error(`[wireproxy] giving up after ${restartAttempts} restart attempts — Taz dials will fail until the manager restarts.`);
    return;
  }
  const delay = Math.min(WIREPROXY_RESTART_BASE_MS * 2 ** restartAttempts, WIREPROXY_RESTART_MAX_MS);
  restartAttempts++;
  console.warn(`[wireproxy] respawning in ${delay}ms (attempt ${restartAttempts}/${WIREPROXY_MAX_RESTARTS})`);
  restartTimer = setTimeout(() => { restartTimer = null; void respawn(); }, delay);
  restartTimer.unref();
}

/** Relaunch wireproxy on the SAME config + SOCKS port. GENIE_TAZ_SOCKS is left
 *  untouched (the bind address never changes) so in-flight callers keep routing
 *  through it the moment the port is back. On a failed re-probe, back off again. */
async function respawn(): Promise<void> {
  if (shuttingDown || !lastSpawn) return;
  spawnWireproxyProcess({ bin: lastSpawn.bin, cfgPath: lastSpawn.cfgPath });
  const ok = await waitForPort(lastSpawn.socksHost, lastSpawn.socksPort, 5_000);
  if (shuttingDown) return;
  if (!ok) {
    console.error(`[wireproxy] respawn failed to bind ${lastSpawn.socksBind}${earlyExit.err ? `: ${earlyExit.err.message}` : ""}`);
    stopChildOnly();
    scheduleRestart();
    return;
  }
  restartAttempts = 0;
  console.log(`[wireproxy] respawned and healthy on ${lastSpawn.socksBind}.`);
}

/** Spawn wireproxy as a sidecar when the WG_* env vars are present. On success
 *  exports `GENIE_TAZ_SOCKS=127.0.0.1:<port>` so connectSsh routes Taz private
 *  traffic through it. No-op when:
 *    - `WG_PRIVATE_KEY` is unset (local dev with kernel WG, or non-Taz host),
 *    - `GENIE_TAZ_SOCKS` is already set (operator manages wireproxy externally).
 *
 *  Fails loudly: throws when wireproxy can't be spawned, refuses to listen, or
 *  exits in the first 2s. The manager would otherwise look healthy while every
 *  Taz SSH attempt hung for `readyTimeout`. */
export async function startWireproxyIfConfigured(): Promise<void> {
  if (process.env.GENIE_TAZ_SOCKS) {
    console.log(`[wireproxy] GENIE_TAZ_SOCKS already set (${process.env.GENIE_TAZ_SOCKS}) — assuming external wireproxy.`);
    return;
  }
  const wgPriv = process.env.WG_PRIVATE_KEY;
  if (!wgPriv) {
    console.log("[wireproxy] WG_PRIVATE_KEY not set — skipping launch (local kernel-WG path).");
    return;
  }
  const peerPub = process.env.WG_PEER_PUBLIC_KEY;
  const endpoint = process.env.WG_ENDPOINT;
  const address = process.env.WG_ADDRESS;
  if (!peerPub || !endpoint || !address) {
    throw new Error(
      "[wireproxy] WG_PRIVATE_KEY is set but WG_PEER_PUBLIC_KEY / WG_ENDPOINT / WG_ADDRESS are missing. " +
      "All four are required to start wireproxy.",
    );
  }
  const allowedIps = process.env.WG_ALLOWED_IPS || "10.128.0.0/16";
  const keepalive = Number(process.env.WG_KEEPALIVE || 25);
  const mtu = Number(process.env.WG_MTU || 1420);
  const socksHost = process.env.GENIE_TAZ_SOCKS_HOST || "127.0.0.1";
  const socksPort = Number(process.env.GENIE_TAZ_SOCKS_PORT || 25344);
  const socksBind = `${socksHost}:${socksPort}`;

  const cfg = renderWireproxyConfig({
    privateKey: resolveSecret(wgPriv),
    peerPublicKey: resolveSecret(peerPub),
    endpoint,
    address,
    allowedIps,
    socksBind,
    keepalive,
    mtu,
  });

  const cfgDir = path.join(os.tmpdir(), "genie-wireproxy");
  mkdirSync(cfgDir, { recursive: true });
  const cfgPath = path.join(cfgDir, "wireproxy.conf");
  writeFileSync(cfgPath, cfg);
  chmodSync(cfgPath, 0o600);

  const bin = process.env.WIREPROXY_BIN || "wireproxy";
  console.log(`[wireproxy] starting: ${bin} -c ${cfgPath} → SOCKS5 ${socksBind} → ${endpoint}`);

  lastSpawn = { bin, cfgPath, socksHost, socksPort, socksBind };
  spawnWireproxyProcess({ bin, cfgPath });

  // Short race: either the port comes up, or wireproxy died (binary missing,
  // bad config, port collision). 5s is generous — wireproxy starts in <100ms.
  const listening = await waitForPort(socksHost, socksPort, 5_000);
  if (!listening) {
    // First-start failure → fail fast. stopChildOnly (not stopWireproxy) so we
    // don't latch shuttingDown for what is a startup error, not a shutdown.
    stopChildOnly();
    if (earlyExit.err) {
      throw new Error(`[wireproxy] ${earlyExit.err.message}. Is the binary at "${bin}" present and the config valid?`);
    }
    throw new Error(`[wireproxy] SOCKS5 port ${socksBind} did not come up within 5s`);
  }

  process.env.GENIE_TAZ_SOCKS = socksBind;
  supervising = true; // from here on, an unexpected exit triggers respawn-with-backoff
  console.log(`[wireproxy] ready — Taz traffic now routes via SOCKS5 ${socksBind}.`);
}

export function stopWireproxy(): void {
  shuttingDown = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  stopChildOnly();
}
