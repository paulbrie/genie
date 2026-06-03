"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { RefreshCw, Terminal, X } from "lucide-react";
import { $ssh } from "@/store/subjects/ssh";
import {
  killSshChannel,
  killSshSession,
  killSshSessionsForHost,
  loadSshSessions,
} from "@/store/actions/ssh";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { formatBytes, formatSshAge, tunnelStatusDot } from "@/lib/ssh-format";
import { cn } from "@/lib/utils";
import type { SharedTunnelSnapshot } from "@/store/types/ssh";

const REFRESH_MS = 3000;

function fmtDuration(ms?: number): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

function causeColor(cause?: string): string {
  if (cause === "keepalive-timeout" || cause === "socks-failure") return "text-red";
  if (cause && cause !== "process-exit" && cause !== "tcp-close" && cause !== "wireproxy-respawn") return "text-yellow";
  return "text-subtext0";
}

function tunnelHealthClass(tunnels: SharedTunnelSnapshot[]): string {
  if (tunnels.some((t) => t.status === "disconnected")) return "text-red";
  if (tunnels.some((t) => t.status === "connecting")) return "text-yellow";
  return "text-green";
}

export function SshPanel() {
  const [ssh] = useSubject($ssh);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"tunnels" | "registry" | "disconnects">("tunnels");
  const [kindFilter, setKindFilter] = useState<"all" | "client" | "pty">("all");

  useEffect(() => {
    loadSshSessions();
    const tick = window.setInterval(() => {
      loadSshSessions({ silent: true });
      setNow(Date.now());
    }, REFRESH_MS);
    return () => window.clearInterval(tick);
  }, []);

  const totalChannels = useMemo(
    () => ssh.sharedTunnels.reduce((n, t) => n + t.channelCount, 0),
    [ssh.sharedTunnels],
  );

  const sharedRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return ssh.sharedTunnels.filter((t) => {
      if (!q) return true;
      return (
        t.host.toLowerCase().includes(q)
        || t.username.toLowerCase().includes(q)
        || t.key.toLowerCase().includes(q)
      );
    });
  }, [ssh.sharedTunnels, filter]);

  const registryRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return ssh.sessions.filter((s) => {
      if (kindFilter !== "all" && s.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        s.host.toLowerCase().includes(q)
        || s.username.toLowerCase().includes(q)
        || s.opener.toLowerCase().includes(q)
        || (s.parentKey ?? "").toLowerCase().includes(q)
      );
    });
  }, [ssh.sessions, filter, kindFilter]);

  const eventRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const events = ssh.events ?? [];
    if (!q) return events;
    return events.filter((e) =>
      e.host.toLowerCase().includes(q)
      || (e.cause ?? e.event).toLowerCase().includes(q)
      || (e.detail ?? "").toLowerCase().includes(q),
    );
  }, [ssh.events, filter]);

  const byHost = useMemo(() => {
    const m = new Map<string, { tunnels: number; channels: number; users: Set<string>; unhealthy: boolean }>();
    for (const t of ssh.sharedTunnels) {
      const slot = m.get(t.host) ?? { tunnels: 0, channels: 0, users: new Set<string>(), unhealthy: false };
      slot.tunnels++;
      slot.channels += t.channelCount;
      slot.users.add(t.username);
      if (t.status !== "connected") slot.unhealthy = true;
      m.set(t.host, slot);
    }
    return [...m.entries()]
      .map(([host, info]) => ({
        host,
        tunnels: info.tunnels,
        channels: info.channels,
        users: [...info.users].sort(),
        unhealthy: info.unhealthy,
      }))
      .sort((a, b) => b.channels - a.channels || b.tunnels - a.tunnels)
      .slice(0, 8);
  }, [ssh.sharedTunnels]);

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-6 py-3">
        <ViewHeader
          title="SSH tunnels & channels"
          subtitle={
            <span className={cn("font-mono", tunnelHealthClass(ssh.sharedTunnels))}>
              {ssh.sharedTunnels.length} tunnel{ssh.sharedTunnels.length === 1 ? "" : "s"}
              {" · "}
              {totalChannels} channel{totalChannels === 1 ? "" : "s"}
            </span>
          }
          actions={
            <Button size="sm" variant="ghost" onClick={() => loadSshSessions()} title="Refresh">
              <RefreshCw size={14} className={ssh.loading ? "animate-spin" : ""} />
            </Button>
          }
        />
      </div>

      <div className="px-6 pb-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          {([
            ["tunnels", `tunnels (${ssh.sharedTunnels.length} · ${totalChannels} ch)`],
            ["registry", `registry (${ssh.sessions.length})`],
            ["disconnects", `disconnects (${(ssh.events ?? []).length})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={
                "px-2 py-1 rounded text-md font-mono "
                + (view === id ? "bg-blue/20 text-blue" : "bg-surface0 text-subtext0 hover:text-text")
              }
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text font-mono w-64"
          placeholder={
            view === "tunnels" ? "filter host / user / tunnel key"
            : view === "registry" ? "filter host / user / parent key"
            : "filter host / project"
          }
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {view === "registry" && (
          <div className="flex items-center gap-1">
            {(["all", "client", "pty"] as const).map((k) => (
              <button
                key={k}
                className={
                  "px-2 py-1 rounded text-md font-mono "
                  + (kindFilter === k ? "bg-blue/20 text-blue" : "bg-surface0 text-subtext0 hover:text-text")
                }
                onClick={() => setKindFilter(k)}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        {byHost.length > 0 && view === "tunnels" && (
          <div className="ml-auto flex items-center gap-2 text-md text-subtext0 flex-wrap">
            <span>hosts:</span>
            {byHost.map(({ host, tunnels, channels, users, unhealthy }) => (
              <span key={host} className="inline-flex items-center gap-0.5">
                <button
                  className={cn(
                    "px-2 py-0.5 rounded bg-surface0 hover:bg-surface1 font-mono",
                    unhealthy ? "text-yellow" : "text-text",
                  )}
                  onClick={() => setFilter(host)}
                  title={`${tunnels} tunnel(s), ${channels} channel(s) — ${users.join(", ")}`}
                >
                  {host}
                  <span className="text-subtext0"> · {tunnels}t · {channels}ch</span>
                </button>
                <button
                  className="px-1.5 py-0.5 rounded bg-red/10 hover:bg-red/20 text-red text-md"
                  onClick={() => killSshSessionsForHost(host)}
                  title={`Kill shared tunnel + all channels on ${host}`}
                >
                  kill
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {view === "tunnels" ? (
          <div className="flex flex-col gap-3">
            {sharedRows.map((tunnel) => (
              <div key={tunnel.key} className="rounded border border-surface0 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-surface0/40 border-b border-surface0 text-md font-mono flex-wrap">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", tunnelStatusDot(tunnel.status))} />
                  <span className="text-text">{tunnel.username}@{tunnel.host}:{tunnel.port}</span>
                  <span className="text-overlay0 text-xs">{tunnel.status}</span>
                  <span className="text-overlay0 text-xs tabular-nums">{formatSshAge(tunnel.openedAt, now)}</span>
                  {tunnel.pinned && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-teal/15 text-teal">
                      Manage pinned
                    </span>
                  )}
                  {tunnel.execInFlight && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-yellow/15 text-yellow">
                      exec
                    </span>
                  )}
                  <span className="ml-auto text-overlay0 tabular-nums">
                    {tunnel.channelCount} ch · manage refs {tunnel.manageRefs}
                  </span>
                  <button
                    className="px-2 py-1 rounded text-md bg-red/10 hover:bg-red/20 text-red"
                    onClick={() => killSshSessionsForHost(tunnel.host)}
                    title="Kill shared tunnel and all PTY channels on this host"
                  >
                    <X size={12} />
                  </button>
                </div>
                {tunnel.channels.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-overlay0">No PTY channels — exec-only tunnel.</div>
                ) : (
                  <table className="w-full text-md font-mono">
                    <thead className="text-subtext0 text-left bg-surface0/20">
                      <tr className="border-b border-surface0/50">
                        <th className="py-1.5 px-2 font-normal">Channel</th>
                        <th className="py-1.5 px-2 font-normal">Project</th>
                        <th className="py-1.5 px-2 font-normal">Size</th>
                        <th className="py-1.5 px-2 font-normal">Traffic</th>
                        <th className="py-1.5 px-2 font-normal">Age</th>
                        <th className="py-1.5 px-2 font-normal w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {tunnel.channels.map((ch) => (
                        <tr key={ch.terminalId} className="border-b border-surface0/30 hover:bg-surface0/20">
                          <td className="py-1.5 px-2">
                            <span className="inline-flex items-center gap-1 text-mauve" title={ch.terminalId}>
                              <Terminal size={10} />
                              {ch.terminalId.slice(0, 24)}
                              {ch.terminalId.length > 24 ? "…" : ""}
                            </span>
                            <span className={cn(
                              "ml-2 text-[10px] uppercase",
                              ch.status === "open" ? "text-green" : "text-red",
                            )}
                            >
                              {ch.status}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-subtext0 text-xs truncate max-w-[10rem]" title={ch.instanceId ?? undefined}>
                            {ch.projectId ? `${ch.projectId.slice(0, 8)}…` : "—"}
                          </td>
                          <td className="py-1.5 px-2 text-subtext0 tabular-nums">{ch.cols}×{ch.rows}</td>
                          <td className="py-1.5 px-2 text-subtext0 tabular-nums">
                            ↓ {formatBytes(ch.bytesOut)} · ↑ {formatBytes(ch.bytesIn)}
                          </td>
                          <td className="py-1.5 px-2 text-subtext0 tabular-nums">{formatSshAge(ch.openedAt, now)}</td>
                          <td className="py-1.5 px-2">
                            <button
                              className="px-1.5 py-0.5 rounded text-xs bg-red/10 hover:bg-red/20 text-red"
                              onClick={() => killSshChannel(ch.terminalId)}
                              title="Close this PTY channel"
                            >
                              <X size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            {sharedRows.length === 0 && (
              <div className="py-8 text-center text-subtext0">
                No shared SSH tunnels. Open Manage or a terminal popup to dial.
              </div>
            )}
          </div>
        ) : view === "registry" ? (
          <table className="w-full text-md font-mono">
            <thead className="text-subtext0 text-left sticky top-0 bg-base">
              <tr className="border-b border-surface0">
                <th className="py-2 pr-3 font-normal">Host</th>
                <th className="py-2 pr-3 font-normal">User</th>
                <th className="py-2 pr-3 font-normal">Kind</th>
                <th className="py-2 pr-3 font-normal">Parent tunnel</th>
                <th className="py-2 pr-3 font-normal">Age</th>
                <th className="py-2 pr-3 font-normal">Opener</th>
                <th className="py-2 pr-3 font-normal w-16" />
              </tr>
            </thead>
            <tbody>
              {registryRows.map((s) => {
                const killing = ssh.killing[s.id];
                return (
                  <tr key={s.id} className="border-b border-surface0/50 hover:bg-surface0/30">
                    <td className="py-1.5 pr-3 text-text">
                      <span
                        className={cn(
                          "inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle",
                          s.status === "connecting" ? "bg-yellow animate-pulse" : "bg-green",
                        )}
                        title={s.status === "connecting" ? "handshake in flight" : "connected"}
                      />
                      {s.host}:{s.port}
                    </td>
                    <td className="py-1.5 pr-3 text-subtext1">{s.username}</td>
                    <td className="py-1.5 pr-3">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-md",
                        s.kind === "pty" ? "bg-mauve/20 text-mauve" : "bg-teal/20 text-teal",
                      )}
                      >
                        {s.kind}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-subtext0 text-xs truncate max-w-[12rem]" title={s.parentKey}>
                      {s.parentKey ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-subtext1 tabular-nums">{formatSshAge(s.openedAt, now)}</td>
                    <td className="py-1.5 pr-3 text-subtext0 truncate max-w-md" title={s.opener}>{s.opener}</td>
                    <td className="py-1.5 pr-3">
                      <button
                        className="px-2 py-1 rounded text-md bg-red/10 hover:bg-red/20 text-red disabled:opacity-50"
                        disabled={killing}
                        onClick={() => killSshSession(s.id)}
                        title="Close this registry entry"
                      >
                        {killing ? "…" : <X size={12} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {registryRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-subtext0">
                    {ssh.sessions.length === 0 ? "No registry entries." : "No matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-md font-mono">
            <thead className="text-subtext0 text-left sticky top-0 bg-base">
              <tr className="border-b border-surface0">
                <th className="py-2 pr-3 font-normal">When</th>
                <th className="py-2 pr-3 font-normal">Host</th>
                <th className="py-2 pr-3 font-normal">Kind</th>
                <th className="py-2 pr-3 font-normal">Cause</th>
                <th className="py-2 pr-3 font-normal">Lived</th>
                <th className="py-2 pr-3 font-normal">Idle</th>
                <th className="py-2 pr-3 font-normal">Detail</th>
              </tr>
            </thead>
            <tbody>
              {eventRows.map((e, i) => (
                <tr key={`${e.occurredAt}-${i}`} className="border-b border-surface0/50 hover:bg-surface0/30">
                  <td className="py-1.5 pr-3 text-subtext1 tabular-nums whitespace-nowrap">{formatSshAge(e.occurredAt, now)} ago</td>
                  <td className="py-1.5 pr-3 text-text">{e.host}{e.username ? <span className="text-subtext0">@{e.username}</span> : null}</td>
                  <td className="py-1.5 pr-3 text-subtext1">{e.kind}</td>
                  <td className={"py-1.5 pr-3 font-medium " + causeColor(e.cause ?? e.event)}>{e.cause ?? e.event}</td>
                  <td className="py-1.5 pr-3 text-subtext1 tabular-nums">{fmtDuration(e.lifetimeMs)}</td>
                  <td className="py-1.5 pr-3 text-subtext1 tabular-nums" title="silence before the drop">{fmtDuration(e.lastDataAgeMs)}</td>
                  <td className="py-1.5 pr-3 text-subtext0 truncate max-w-xs" title={e.detail}>{e.detail}</td>
                </tr>
              ))}
              {eventRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-subtext0">
                    {(ssh.events ?? []).length === 0 ? "No disconnects recorded since the manager started." : "No matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
