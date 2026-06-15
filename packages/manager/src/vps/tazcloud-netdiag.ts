// Read-only network diagnostics for TazCloud VMs, run from the manager's
// vantage point. Powers the admin "Diagnostics" tab in the Clouds panel.
//
// The motivating failure: a legacy v6-only VM has an IPv6 `ssh_host`, but the
// manager (Railway prod, or a dev Mac) has no IPv6 egress — so the direct SSH
// dial fails with EHOSTUNREACH. Current vxlan-bastion VMs are reached over a
// private 10.128/16 IPv4 via the wireproxy SOCKS tunnel instead. This module
// makes that whole picture inspectable: the manager's own egress, the tenant
// access mode, each VM's expected route, and a live TCP reachability probe.

import net from "node:net";
import os from "node:os";
import { SocksClient } from "socks";
import { shouldRouteViaSocks, tazSocksProxy, DEFAULT_TAZ_SUBNET } from "./socks-dial.js";
import { getSshEventHistory } from "./ssh-events.js";
import { defaultSshUserForVm, type TazVm } from "./tazcloud-api-client.js";
import { getWireproxyStatus } from "../cloud/wireproxy-launcher.js";
import { getSocksMetrics, type SocksMetricsSnapshot } from "./socks-metrics.js";

export interface ManagerNetEnv {
  /** True when the manager has at least one global-scope IPv6 address — i.e. it
   *  can plausibly reach a legacy-v6 VM directly. The original bug: this is false. */
  ipv6Egress: boolean;
  ipv6Addrs: string[];
  socks: {
    configured: boolean;
    bind: string | null;
    listening: boolean;
    managed: boolean;
    restartAttempts: number;
    lastError: string | null;
    gaveUp: boolean;
  };
  wg: { endpoint: string | null; subnet: string };
  /** Live SOCKS-layer counters (latency, in-flight, open sockets, failures). */
  socksMetrics: SocksMetricsSnapshot;
}

export interface ReachabilityResult {
  ok: boolean;
  latencyMs: number | null;
  /** Classified failure code: EHOSTUNREACH | ETIMEDOUT | ECONNREFUSED |
   *  socks-failure | skipped | … . null on success. */
  code: string | null;
}

export type TazAccessMode = "legacy-v6" | "vxlan-bastion";
export type TazRoute = "direct" | "socks";

/** Trimmed SSH event for the per-VM timeline (subset of SshEventRow). */
export interface TazSshEvent {
  occurredAt: string;
  event: string;
  cause: string | null;
  detail: string | null;
  lifetimeMs: number | null;
}

export interface TazVmDiag {
  id: string;
  name: string;
  status: string;
  ip: string | null;
  ipv6: string | null;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  accessMode: TazAccessMode;
  route: TazRoute;
  reachable: boolean;
  latencyMs: number | null;
  errorCode: string | null;
  recentDisconnects: number;
  /** Most recent SSH events for this host (newest first, capped). */
  events: TazSshEvent[];
  /** Host stored on the linked Genie project's connection, if any. */
  persistedHost: string | null;
  /** True when the persisted host differs from the live `ssh_host` — the
   *  legacy-IPv6-vs-10.x drift that silently breaks reconnects. */
  hostDrift: boolean;
  verdict: string;
}

/** Global-scope IPv6 addresses on this host. Drops loopback, link-local
 *  (fe80::/10) and unique-local (fc00::/7), which can't reach a public VM. */
function listGlobalIpv6(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      // node types `family` as "IPv6" (>=18) but older runtimes used 6.
      if (a.family !== "IPv6" && (a.family as unknown) !== 6) continue;
      if (a.internal) continue;
      const ip = a.address.toLowerCase();
      if (ip === "::1" || ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd")) continue;
      out.push(a.address);
    }
  }
  return out;
}

export async function gatherManagerNetEnv(): Promise<ManagerNetEnv> {
  const ipv6Addrs = listGlobalIpv6();
  const wp = await getWireproxyStatus();
  return {
    ipv6Egress: ipv6Addrs.length > 0,
    ipv6Addrs,
    socks: {
      configured: wp.configured,
      bind: wp.socksBind,
      listening: wp.listening,
      managed: wp.managed,
      restartAttempts: wp.restartAttempts,
      lastError: wp.lastError,
      gaveUp: wp.gaveUp,
    },
    wg: {
      endpoint: process.env.WG_ENDPOINT || null,
      subnet: process.env.GENIE_TAZ_SUBNET || DEFAULT_TAZ_SUBNET,
    },
    socksMetrics: getSocksMetrics(),
  };
}

/** Map a thrown dial error to a stable code. ssh2/socks surface errors as
 *  messages rather than errno; pattern-match the common ones. */
function classifyDialError(err: unknown, fallback: string): string {
  const e = err as NodeJS.ErrnoException & { message?: string };
  if (e?.code) return e.code;
  const msg = e?.message || "";
  if (/timed?\s*out/i.test(msg)) return "ETIMEDOUT";
  if (/refused/i.test(msg)) return "ECONNREFUSED";
  if (/unreachable/i.test(msg)) return "EHOSTUNREACH";
  return fallback;
}

/** TCP-level reachability probe to (host, port), honoring the same SOCKS/WireGuard
 *  routing decision connectSsh uses. TCP — not a full SSH handshake — so a network
 *  fault (route/tunnel) is cleanly separated from an auth fault. Always tears the
 *  socket down. */
export async function probeReachability(host: string, port: number, timeoutMs = 5_000): Promise<ReachabilityResult> {
  const proxy = tazSocksProxy();
  const start = Date.now();
  if (shouldRouteViaSocks(host) && proxy) {
    const [proxyHost, proxyPortStr] = proxy.split(":");
    const proxyPort = Number(proxyPortStr);
    try {
      const { socket } = await SocksClient.createConnection({
        proxy: { host: proxyHost, port: proxyPort, type: 5 },
        command: "connect",
        destination: { host, port },
        timeout: timeoutMs,
      });
      const latencyMs = Date.now() - start;
      socket.destroy();
      return { ok: true, latencyMs, code: null };
    } catch (err) {
      return { ok: false, latencyMs: null, code: classifyDialError(err, "socks-failure") };
    }
  }
  return await new Promise<ReachabilityResult>((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (r: ReachabilityResult) => {
      if (done) return;
      done = true;
      s.removeAllListeners();
      s.destroy();
      resolve(r);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => finish({ ok: true, latencyMs: Date.now() - start, code: null }));
    s.once("timeout", () => finish({ ok: false, latencyMs: null, code: "ETIMEDOUT" }));
    s.once("error", (err: NodeJS.ErrnoException) => finish({ ok: false, latencyMs: null, code: err.code || "EUNKNOWN" }));
    s.connect({ host, port });
  });
}

function deriveAccessMode(vm: Pick<TazVm, "ipv6">): TazAccessMode {
  // Same rule as defaultSshUserForVm: v2.0.0 vxlan-bastion VMs have no public IPv6.
  return vm.ipv6 ? "legacy-v6" : "vxlan-bastion";
}

function buildVerdict(args: {
  accessMode: TazAccessMode;
  route: TazRoute;
  reach: ReachabilityResult;
  active: boolean;
  env: ManagerNetEnv;
  host: string;
  hostDrift: boolean;
  persistedHost: string | null;
}): string {
  const { accessMode, route, reach, active, env, host, hostDrift, persistedHost } = args;
  if (!active) return "VM is not ACTIVE — probe skipped.";
  const driftNote = hostDrift
    ? ` Note: the linked project still points at ${persistedHost} — stale host; reconnects will use the wrong address.`
    : "";
  if (reach.ok) return `Reachable via ${route === "socks" ? "WireGuard/SOCKS" : "direct"} in ${reach.latencyMs}ms.${driftNote}`;
  let base: string;
  if (accessMode === "legacy-v6" && !env.ipv6Egress) {
    base = `Legacy v6-only VM (${host}) but the manager has no IPv6 egress → ${reach.code}. Migrate the VM to vxlan-bastion, or run the manager with working IPv6/WireGuard.`;
  } else if (route === "socks" && !env.socks.listening) {
    base = `Routed via WireGuard/SOCKS but the wireproxy SOCKS port is not listening → ${reach.code}. Check the wireproxy sidecar.`;
  } else {
    switch (reach.code) {
      case "EHOSTUNREACH": base = `No route to ${host} (EHOSTUNREACH) — check the WireGuard tunnel / VM network.`; break;
      case "ETIMEDOUT": base = `Connection to ${host} timed out — firewall blocking, or the VM is down.`; break;
      case "ECONNREFUSED": base = `${host} refused the connection — sshd not listening on this port.`; break;
      default: base = `Unreachable (${reach.code}).`;
    }
  }
  return base + driftNote;
}

async function diagnoseVm(vm: TazVm, env: ManagerNetEnv, persistedHost: string | null): Promise<TazVmDiag> {
  const accessMode = deriveAccessMode(vm);
  const route: TazRoute = shouldRouteViaSocks(vm.ssh_host) ? "socks" : "direct";
  const port = vm.ssh_port || 22;
  const active = vm.status === "ACTIVE";
  const reach: ReachabilityResult = active && vm.ssh_host
    ? await probeReachability(vm.ssh_host, port)
    : { ok: false, latencyMs: null, code: "skipped" };
  let recentDisconnects = 0;
  let events: TazSshEvent[] = [];
  try {
    const rows = await getSshEventHistory({ host: vm.ssh_host, hours: 24, limit: 200 });
    recentDisconnects = rows.filter((e) => e.event === "disconnect").length;
    events = rows.slice(0, 6).map((e) => ({
      occurredAt: e.occurredAt,
      event: e.event,
      cause: e.cause,
      detail: e.detail,
      lifetimeMs: e.lifetimeMs,
    }));
  } catch { /* event history is best-effort */ }
  const hostDrift = !!persistedHost && persistedHost !== vm.ssh_host;
  return {
    id: vm.id,
    name: vm.name,
    status: vm.status,
    ip: vm.ip ?? null,
    ipv6: vm.ipv6 ?? null,
    sshHost: vm.ssh_host,
    sshPort: port,
    sshUser: defaultSshUserForVm(vm),
    accessMode,
    route,
    reachable: reach.ok,
    latencyMs: reach.latencyMs,
    errorCode: reach.ok ? null : reach.code,
    recentDisconnects,
    events,
    persistedHost,
    hostDrift,
    verdict: buildVerdict({ accessMode, route, reach, active, env, host: vm.ssh_host, hostDrift, persistedHost }),
  };
}

/** Probe each VM concurrently (bounded), mirroring the pool style used by
 *  `admin:tazcloud:stats`. Pass `onlyVmId` for a single-row re-probe, and
 *  `persistedHosts` (vmId → host stored on the linked project) to flag drift. */
export async function buildVmDiagnostics(
  vms: TazVm[],
  env: ManagerNetEnv,
  opts: { onlyVmId?: string; concurrency?: number; persistedHosts?: Map<string, string> } = {},
): Promise<TazVmDiag[]> {
  const targets = opts.onlyVmId ? vms.filter((v) => v.id === opts.onlyVmId) : vms;
  const results: TazVmDiag[] = new Array(targets.length);
  const POOL = opts.concurrency ?? 6;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const i = cursor++;
      const vm = targets[i];
      results[i] = await diagnoseVm(vm, env, opts.persistedHosts?.get(vm.id) ?? null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, targets.length) }, worker));
  return results;
}
