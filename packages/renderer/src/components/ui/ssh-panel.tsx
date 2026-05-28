"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { RefreshCw, X } from "lucide-react";
import { $ssh } from "@/store/subjects/ssh";
import { killSshSession, loadSshSessions } from "@/store/actions/ssh";
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

  const byHost = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of ssh.sessions) m.set(s.host, (m.get(s.host) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [ssh.sessions]);

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-6 py-3">
        <ViewHeader
          title="SSH connections"
          subtitle={`${ssh.sessions.length} live`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => loadSshSessions()} title="Refresh">
              <RefreshCw size={14} className={ssh.loading ? "animate-spin" : ""} />
            </Button>
          }
        />
      </div>

      <div className="px-6 pb-3 flex items-center gap-3 flex-wrap">
        <input
          className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text font-mono w-64"
          placeholder="filter host / user / opener"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
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
        {byHost.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-md text-subtext0">
            <span>top hosts:</span>
            {byHost.map(([host, count]) => (
              <button
                key={host}
                className="px-2 py-0.5 rounded bg-surface0 hover:bg-surface1 text-text font-mono"
                onClick={() => setFilter(host)}
                title={`${count} connections to ${host}`}
              >
                {host} <span className="text-subtext0">×{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
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
      </div>
    </div>
  );
}
