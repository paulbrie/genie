"use client";

import { Fragment, useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { RefreshCw, RotateCw, Loader2, Wifi, WifiOff, ShieldAlert, AlertTriangle, ChevronRight, ChevronDown, Globe, Network, Server, Link2, Link2Off } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $admin, $auth, $ssh } from "@/store/subjects";
import { ensureAdminServerTunnelAsync, loadTazNetdiag, releaseAdminServerTunnel, restartBastionTunnelAsync } from "@/store/actions";
import { loadSshSessions } from "@/store/actions/ssh";
import type { TazVmDiag } from "@/store/types";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { ServerTunnelIndicator, clientSessionsForHost } from "@/components/tazcloud/server-tunnel-indicator";
import { cn } from "@/lib/utils";

const GRID = "grid-cols-[0.7fr_1.2fr_0.55fr_1.45fr_0.65fr_0.8fr_1.05fr_1.5fr]";

type HealthLevel = "ok" | "warn" | "down";

/** Roll a VM's signals up into one status. down = ACTIVE but unreachable;
 *  warn = not-ACTIVE, host drift, or flapping; ok = reachable & stable. */
function healthOf(vm: TazVmDiag): { level: HealthLevel; label: string } {
  if (vm.status !== "ACTIVE") return { level: "warn", label: vm.status.toLowerCase() };
  if (!vm.reachable) return { level: "down", label: "unreachable" };
  if (vm.hostDrift) return { level: "warn", label: "host drift" };
  if (vm.recentDisconnects >= 3) return { level: "warn", label: "flapping" };
  return { level: "ok", label: "healthy" };
}

function HealthBadge({ vm }: { vm: TazVmDiag }) {
  const h = healthOf(vm);
  const cls = h.level === "ok" ? "bg-green/15 text-green" : h.level === "warn" ? "bg-peach/15 text-peach" : "bg-red/15 text-red";
  const dot = h.level === "ok" ? "bg-green" : h.level === "warn" ? "bg-peach" : "bg-red";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium", cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
      {h.label}
    </span>
  );
}

function StatusDot({ ok, title }: { ok: boolean; title?: string }) {
  return <span title={title} className={cn("inline-block w-2 h-2 rounded-full shrink-0", ok ? "bg-green" : "bg-red")} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-md">
      <span className="text-overlay0 w-36 shrink-0">{label}</span>
      <span className="text-text font-mono break-all">{children}</span>
    </div>
  );
}

function modePill(mode: TazVmDiag["accessMode"]) {
  const legacy = mode === "legacy-v6";
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium", legacy ? "bg-peach/15 text-peach" : "bg-blue/15 text-blue")}>
      {mode}
    </span>
  );
}

function routePill(route: TazVmDiag["route"]) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-overlay0/15 text-subtext0">
      <Network size={10} />
      {route === "socks" ? "WireGuard/SOCKS" : "direct"}
    </span>
  );
}

function fmtLifetime(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function TazNetDiagnostics() {
  const admin = useDeepSubjectAll($admin);
  const [auth] = useSubject($auth);
  const [ssh] = useSubject($ssh);
  const nd = admin.tazcloud.netdiag;
  const env = nd.env;

  const role = auth.user?.role;
  // The SSH registry (ssh:list) is admin-only by ACL — tazcloud may use this
  // panel but must NOT poll it, so the Connect/Disconnect column is gated.
  const canViewSshRegistry = role === "admin" || role === "superadmin";
  // Restarting wireproxy bounces every tenant's Taz access — superadmin only.
  const isSuperadmin = role === "superadmin";

  const [tunnelBusy, setTunnelBusy] = useState<Record<string, boolean>>({});
  const [tunnelError, setTunnelError] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!nd.lastRunAt && !nd.loading) loadTazNetdiag();
    if (canViewSshRegistry) loadSshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(vm: TazVmDiag) {
    setTunnelBusy((b) => ({ ...b, [vm.id]: true }));
    setTunnelError((e) => ({ ...e, [vm.id]: null }));
    try {
      await ensureAdminServerTunnelAsync({ provider: "tazcloud", vmId: vm.id, host: vm.sshHost, sshUser: vm.sshUser });
      loadSshSessions();
    } catch (err) {
      setTunnelError((e) => ({ ...e, [vm.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTunnelBusy((b) => ({ ...b, [vm.id]: false }));
    }
  }

  function disconnect(vm: TazVmDiag) {
    releaseAdminServerTunnel({ provider: "tazcloud", vmId: vm.id, host: vm.sshHost, sshUser: vm.sshUser });
    setTunnelError((e) => ({ ...e, [vm.id]: null }));
    window.setTimeout(() => loadSshSessions(), 400);
  }

  async function restartTunnel() {
    if (!window.confirm("Restart the WireGuard tunnel?\n\nThis briefly drops ALL Taz VM connections for every user while wireproxy relaunches.")) return;
    setRestartBusy(true);
    setRestartMsg(null);
    try {
      const r = await restartBastionTunnelAsync();
      setRestartMsg(r.ok ? "Tunnel restarted — healthy." : `Restart failed: ${r.error ?? "unknown"}`);
      loadTazNetdiag();
    } catch (err) {
      setRestartMsg(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestartBusy(false);
    }
  }

  const canRestart = isSuperadmin && !!env?.socks.managed;

  return (
    <div className="py-3">
      <div className="flex items-center gap-2 mb-3">
        <Network size={16} className="text-blue" />
        <span className="text-md font-medium text-subtext0">Network Diagnostics</span>
        {nd.lastRunAt && <span className="text-xs text-overlay0">checked {new Date(nd.lastRunAt).toLocaleTimeString()}</span>}
        <div className="flex-1" />
        <Button size="sm" onClick={() => loadTazNetdiag()} disabled={nd.loading}>
          <RefreshCw size={14} className={cn("mr-1", nd.loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {nd.error && <ErrorMessage className="mb-3">{nd.error}</ErrorMessage>}

      {/* Manager egress + tenant config cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="border border-overlay0/20 rounded-lg bg-mantle/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Server size={13} className="text-overlay0" />
            <span className="text-md font-medium text-subtext0">Manager egress</span>
            <div className="flex-1" />
            {isSuperadmin && (
              <button
                onClick={restartTunnel}
                disabled={restartBusy || !canRestart}
                title={canRestart ? "Restart the WireGuard sidecar (wireproxy)" : "Tunnel is external / kernel-managed — not controllable from here"}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-peach/15 text-peach hover:bg-peach/25 disabled:opacity-40"
              >
                {restartBusy ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
                Restart tunnel
              </button>
            )}
          </div>
          {env ? (
            <div className="flex flex-col gap-1.5">
              <Row label="IPv6 egress">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot ok={env.ipv6Egress} />
                  {env.ipv6Egress ? env.ipv6Addrs.join(", ") || "yes" : "none — legacy-v6 VMs unreachable"}
                </span>
              </Row>
              <Row label="WireGuard SOCKS">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot ok={env.socks.configured && env.socks.listening} />
                  {env.socks.configured
                    ? `${env.socks.bind ?? "?"} — ${env.socks.listening ? "listening" : "DOWN"}${env.socks.managed ? " (managed)" : " (external)"}`
                    : "not configured (kernel-WG or direct)"}
                </span>
              </Row>
              {env.socks.gaveUp && (
                <Row label="wireproxy"><span className="text-red">gave up after {env.socks.restartAttempts} restarts</span></Row>
              )}
              {env.socks.lastError && (
                <Row label="last socks error"><span className="text-peach">{env.socks.lastError}</span></Row>
              )}
              <Row label="WG endpoint">{env.wg.endpoint ?? "—"}</Row>
              <Row label="Taz subnet">{env.wg.subnet}</Row>

              {/* SOCKS layer (the `socks` lib chokepoint) */}
              <div className="mt-1.5 pt-1.5 border-t border-overlay0/15 flex flex-col gap-1.5">
                {(() => {
                  const m = env.socksMetrics;
                  const total = m.dialsOk + m.dialsFailed;
                  const okPct = total > 0 ? Math.round((m.dialsOk / total) * 100) : null;
                  // Open sockets climbing while in-flight is low is the leak signal.
                  const leakish = m.openSockets > 8;
                  return (
                    <>
                      <Row label="SOCKS dials">
                        {m.dialsOk}✓ / {m.dialsFailed}✗{okPct != null ? ` (${okPct}% ok)` : ""}
                      </Row>
                      <Row label="in-flight / open">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot ok={!leakish} title={leakish ? "open sockets unusually high — possible leak" : undefined} />
                          {m.inFlight} in-flight · {m.openSockets} open{leakish ? " — possible leak" : ""}
                        </span>
                      </Row>
                      <Row label="dial latency">{m.p50Ms != null ? `p50 ${m.p50Ms}ms · p95 ${m.p95Ms}ms` : "—"}</Row>
                      {m.heartbeat && (
                        <Row label="heartbeat">
                          <span className="inline-flex items-center gap-1.5">
                            <StatusDot ok={m.heartbeat.ok} />
                            {m.heartbeat.ms != null ? `${m.heartbeat.ms}ms` : "—"}{m.heartbeat.error ? ` · ${m.heartbeat.error}` : ""}
                          </span>
                        </Row>
                      )}
                      {m.recentFailures[0] && (
                        <Row label="last failure">
                          <span className="text-peach">{m.recentFailures[0].code}: {m.recentFailures[0].message.slice(0, 60)}</span>
                        </Row>
                      )}
                    </>
                  );
                })()}
              </div>

              {restartMsg && (
                <div className={cn("text-xs mt-1", restartMsg.startsWith("Tunnel restarted") ? "text-green" : "text-red")}>{restartMsg}</div>
              )}
            </div>
          ) : (
            <div className="text-overlay0 text-md">{nd.loading ? "Probing…" : "No data."}</div>
          )}
        </div>

        <div className="border border-overlay0/20 rounded-lg bg-mantle/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={13} className="text-overlay0" />
            <span className="text-md font-medium text-subtext0">Tenant config</span>
          </div>
          {nd.capabilities ? (
            <div className="flex flex-col gap-1.5">
              <Row label="Access mode">{nd.capabilities.mode ?? "—"}</Row>
              <Row label="Bastion IP">{nd.capabilities.bastionIp ?? "—"}</Row>
              <Row label="SSH via bastion">{String(nd.capabilities.sshViaBastion ?? "—")}</Row>
              <Row label="Ingress">{nd.capabilities.ingressAvailable ? "available" : "—"}</Row>
            </div>
          ) : (
            <div className="text-overlay0 text-md">{nd.loading ? "Loading…" : "No capabilities (token missing?)."}</div>
          )}
        </div>
      </div>

      {/* Per-VM probe table */}
      <div className="border border-overlay0/20 rounded-lg overflow-hidden">
        <div className={cn("grid gap-2 px-3 py-2 bg-crust/60 text-xs font-medium text-overlay0 uppercase tracking-wide", GRID)}>
          <span>Health</span>
          <span>VM</span>
          <span>Mode</span>
          <span>SSH host</span>
          <span>Route</span>
          <span>Reachability</span>
          <span>Tunnel</span>
          <span>Verdict</span>
        </div>
        {nd.vms.length === 0 && (
          <div className="px-3 py-4 text-overlay0 text-md">{nd.loading ? "Probing VMs…" : "No VMs."}</div>
        )}
        {nd.vms.map((vm) => {
          const probing = nd.probing[vm.id];
          const connected = clientSessionsForHost(vm.sshHost, ssh.sessions) > 0;
          const busy = tunnelBusy[vm.id];
          const tErr = tunnelError[vm.id];
          const isOpen = expanded[vm.id];
          const hasEvents = vm.events.length > 0;
          return (
            <Fragment key={vm.id}>
              <div className={cn("grid gap-2 px-3 py-2 border-t border-overlay0/10 text-md items-center", GRID)}>
                <div><HealthBadge vm={vm} /></div>
                <div className="min-w-0">
                  <div className="text-text truncate">{vm.name}</div>
                  <div className="text-xs text-overlay0">{vm.status}</div>
                </div>
                <div>{modePill(vm.accessMode)}</div>
                <div className="font-mono text-xs text-subtext0 break-all">
                  {vm.sshHost}:{vm.sshPort}
                  <div className="text-overlay0">as {vm.sshUser}</div>
                  {vm.hostDrift && (
                    <div className="inline-flex items-center gap-1 text-peach mt-0.5" title={`Linked project points at ${vm.persistedHost}`}>
                      <AlertTriangle size={10} /> stale: {vm.persistedHost}
                    </div>
                  )}
                </div>
                <div>{routePill(vm.route)}</div>
                <div className="flex items-center gap-1.5">
                  {probing ? <Loader2 size={13} className="animate-spin text-overlay0" /> : vm.reachable ? <Wifi size={13} className="text-green" /> : <WifiOff size={13} className="text-red" />}
                  <span className={cn(vm.reachable ? "text-green" : "text-red", "text-xs font-mono")}>{vm.reachable ? `${vm.latencyMs}ms` : vm.errorCode}</span>
                  <button onClick={() => loadTazNetdiag(vm.id)} disabled={probing} title="Re-probe this VM" className="ml-1 p-0.5 text-overlay0 hover:text-text disabled:opacity-40">
                    <RefreshCw size={11} className={cn(probing && "animate-spin")} />
                  </button>
                </div>
                <div className="min-w-0">
                  {canViewSshRegistry ? (
                    <div className="flex items-center gap-1.5">
                      <ServerTunnelIndicator host={vm.sshHost} sessions={ssh.sessions} loading={ssh.loading} />
                      <button
                        onClick={() => (connected ? disconnect(vm) : connect(vm))}
                        disabled={busy}
                        className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50", connected ? "bg-red/15 text-red hover:bg-red/25" : "bg-blue/15 text-blue hover:bg-blue/25")}
                        title={connected ? "Close the SSH tunnel to this VM" : "Open an SSH tunnel to this VM"}
                      >
                        {busy ? <Loader2 size={11} className="animate-spin" /> : connected ? <Link2Off size={11} /> : <Link2 size={11} />}
                        {connected ? "Disconnect" : "Connect"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-overlay0">—</span>
                  )}
                  {tErr && <div className="text-xs text-red mt-0.5 break-all" title={tErr}>{tErr}</div>}
                </div>
                <div className="text-xs text-subtext0 flex items-start gap-1">
                  {!vm.reachable && vm.status === "ACTIVE" && <ShieldAlert size={12} className="text-peach shrink-0 mt-0.5" />}
                  <span>
                    {vm.verdict}
                    {vm.recentDisconnects > 0 && (
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [vm.id]: !e[vm.id] }))}
                        className="ml-1 inline-flex items-center gap-0.5 text-overlay0 hover:text-text"
                        title="Show recent SSH events"
                      >
                        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        {vm.recentDisconnects} disconnects/24h
                      </button>
                    )}
                  </span>
                </div>
              </div>
              {isOpen && (
                <div className="px-3 py-2 border-t border-overlay0/10 bg-crust/30">
                  {hasEvents ? (
                    <div className="flex flex-col gap-1">
                      {vm.events.map((ev, i) => (
                        <div key={i} className="flex items-baseline gap-2 text-xs font-mono">
                          <span className="text-overlay0 w-32 shrink-0">{new Date(ev.occurredAt).toLocaleString()}</span>
                          <span className={cn("w-28 shrink-0", ev.event === "disconnect" ? "text-red" : "text-subtext0")}>{ev.event}{ev.cause ? `:${ev.cause}` : ""}</span>
                          {ev.lifetimeMs != null && <span className="text-overlay0 w-14 shrink-0">{fmtLifetime(ev.lifetimeMs)}</span>}
                          {ev.detail && <span className="text-subtext0 break-all">{ev.detail}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-overlay0">No recorded events.</div>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
