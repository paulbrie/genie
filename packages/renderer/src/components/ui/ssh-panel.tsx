"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { RefreshCw, RotateCcw, X } from "lucide-react";
import { $ssh } from "@/store/subjects/ssh";
import { killSshSession, killSshSessionsForHost, loadSshSessions, reconnectSshTunnelForHost } from "@/store/actions/ssh";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";

const REFRESH_MS = 3000;

function formatAge(openedAt: number, now: number): string {
  const ms = Math.max(0, now - openedAt);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function SshPanel() {
  const [ssh] = useSubject($ssh);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"connections" | "tunnels">("connections");
  const [kindFilter, setKindFilter] = useState<"all" | "client" | "pty">("all");

  useEffect(() => {
    loadSshSessions();
    const tick = window.setInterval(() => {
      loadSshSessions();
      setNow(Date.now());
    }, REFRESH_MS);
    return () => window.clearInterval(tick);
  }, []);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return ssh.sessions.filter((s) => {
      if (kindFilter !== "all" && s.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        s.host.toLowerCase().includes(q)
        || s.username.toLowerCase().includes(q)
        || s.opener.toLowerCase().includes(q)
      );
    });
  }, [ssh.sessions, filter, kindFilter]);

  const tunnelRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return ssh.tunnels.filter((t) => {
      if (!q) return true;
      return t.host.toLowerCase().includes(q) || t.projectName.toLowerCase().includes(q);
    });
  }, [ssh.tunnels, filter]);

  const byHost = useMemo(() => {
    const m = new Map<string, { count: number; users: Set<string> }>();
    for (const s of ssh.sessions) {
      const slot = m.get(s.host) ?? { count: 0, users: new Set<string>() };
      slot.count++;
      slot.users.add(s.username);
      m.set(s.host, slot);
    }
    return [...m.entries()]
      .map(([host, info]) => ({ host, count: info.count, users: [...info.users].sort() }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [ssh.sessions]);

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-6 py-3">
        <ViewHeader
          title="SSH connections"
          subtitle={`${ssh.sessions.length} live connections · ${ssh.tunnels.length} shared tunnels`}
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
            ["connections", `connections (${ssh.sessions.length})`],
            ["tunnels", `tunnels (${ssh.tunnels.length})`],
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
          placeholder={view === "connections" ? "filter host / user / opener" : "filter host / project"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {view === "connections" && (
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
        {byHost.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-md text-subtext0">
            <span>top hosts:</span>
            {byHost.map(({ host, count, users }) => (
              <span key={host} className="inline-flex items-center gap-0.5">
                <button
                  className="px-2 py-0.5 rounded bg-surface0 hover:bg-surface1 text-text font-mono"
                  onClick={() => setFilter(host)}
                  title={`${count} connections to ${host} (${users.join(", ")})`}
                >
                  {host} <span className="text-subtext0">×{count}</span>
                  <span className="text-overlay0">· {users.join(",")}</span>
                </button>
                <button
                  className="px-1.5 py-0.5 rounded bg-blue/10 hover:bg-blue/20 text-blue text-md disabled:opacity-50"
                  disabled={!!ssh.reconnectingHosts[host]}
                  onClick={() => reconnectSshTunnelForHost(host)}
                  title={`Reconnect shared tunnel for ${host}`}
                >
                  reconnect tunnel
                </button>
                {count > 1 && (
                  <>
                    <button
                      className="px-1.5 py-0.5 rounded bg-red/10 hover:bg-red/20 text-red text-md"
                      onClick={() => killSshSessionsForHost(host)}
                      title={`Kill all ${count} connections to ${host}`}
                    >
                      kill all
                    </button>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {view === "connections" ? (
          <table className="w-full text-md font-mono">
            <thead className="text-subtext0 text-left sticky top-0 bg-base">
              <tr className="border-b border-surface0">
                <th className="py-2 pr-3 font-normal">Host</th>
                <th className="py-2 pr-3 font-normal">Port</th>
                <th className="py-2 pr-3 font-normal">User</th>
                <th className="py-2 pr-3 font-normal">Kind</th>
                <th className="py-2 pr-3 font-normal">Age</th>
                <th className="py-2 pr-3 font-normal">Opener</th>
                <th className="py-2 pr-3 font-normal w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const killing = ssh.killing[s.id];
                return (
                  <tr key={s.id} className="border-b border-surface0/50 hover:bg-surface0/30">
                    <td className="py-1.5 pr-3 text-text">{s.host}</td>
                    <td className="py-1.5 pr-3 text-subtext1">{s.port}</td>
                    <td className="py-1.5 pr-3 text-subtext1">{s.username}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={
                          "px-1.5 py-0.5 rounded text-md "
                          + (s.kind === "pty" ? "bg-mauve/20 text-mauve" : "bg-teal/20 text-teal")
                        }
                      >
                        {s.kind}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-subtext1 tabular-nums">{formatAge(s.openedAt, now)}</td>
                    <td className="py-1.5 pr-3 text-subtext0 truncate max-w-md" title={s.opener}>{s.opener}</td>
                    <td className="py-1.5 pr-3">
                      <button
                        className="px-2 py-1 rounded text-md bg-red/10 hover:bg-red/20 text-red disabled:opacity-50"
                        disabled={killing}
                        onClick={() => killSshSession(s.id)}
                        title="Close this SSH connection"
                      >
                        {killing ? "…" : <X size={12} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-subtext0">
                    {ssh.sessions.length === 0 ? "No active SSH connections." : "No matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-md font-mono">
            <thead className="text-subtext0 text-left sticky top-0 bg-base">
              <tr className="border-b border-surface0">
                <th className="py-2 pr-3 font-normal">Host</th>
                <th className="py-2 pr-3 font-normal">Project</th>
                <th className="py-2 pr-3 font-normal">Age</th>
                <th className="py-2 pr-3 font-normal">Services</th>
                <th className="py-2 pr-3 font-normal w-16"></th>
              </tr>
            </thead>
            <tbody>
              {tunnelRows.map((t) => (
                <tr key={`${t.host}:${t.openedAt}`} className="border-b border-surface0/50 hover:bg-surface0/30">
                  <td className="py-1.5 pr-3 text-text">{t.host}</td>
                  <td className="py-1.5 pr-3 text-subtext1">{t.projectName}</td>
                  <td className="py-1.5 pr-3 text-subtext1 tabular-nums">{formatAge(t.openedAt, now)}</td>
                  <td className="py-1.5 pr-3 text-subtext0">
                    {[
                      t.browser ? "browser" : null,
                      t.stream ? "stream" : null,
                      t.security ? "security" : null,
                      t.notify ? "notify" : null,
                      t.storage ? "storage" : null,
                    ].filter(Boolean).join(", ")}
                  </td>
                  <td className="py-1.5 pr-3">
                    <button
                      className="mr-1 px-2 py-1 rounded text-md bg-blue/10 hover:bg-blue/20 text-blue disabled:opacity-50"
                      disabled={!!ssh.reconnectingHosts[t.host]}
                      onClick={() => reconnectSshTunnelForHost(t.host)}
                      title="Reconnect shared tunnel for this host"
                    >
                      {ssh.reconnectingHosts[t.host] ? "…" : <RotateCcw size={12} />}
                    </button>
                    <button
                      className="px-2 py-1 rounded text-md bg-red/10 hover:bg-red/20 text-red"
                      onClick={() => killSshSessionsForHost(t.host)}
                      title="Kill all SSH sessions and shared tunnels for this host"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {tunnelRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-subtext0">
                    {ssh.tunnels.length === 0 ? "No shared MCP tunnels." : "No matches."}
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
