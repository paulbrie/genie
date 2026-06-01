"use client";

/**
 * Live SSH terminal popup matching the new connectivity layer.
 * One open connection per (project, instance); status pills, traffic counter,
 * resource gauges, tmux session row, terminal pane.
 */
import { useEffect, useRef } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";

import { $vmConnections } from "@/store/subjects";
import { closeVmConnection, injectVmCommand, refreshVmStats } from "@/store/actions";
import type { VmConnectionState, VmTmuxSession } from "@/store/types/vps";
import { createTerminal, disposeTerminal, hasTerminal, reattachTerminal } from "@/lib/terminal-bridge";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function StatusPill({ status }: { status: VmConnectionState["status"] }) {
  if (status === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow/15 text-yellow">
        <Loader2 size={9} className="animate-spin" /> Connecting
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green/15 text-green">
        <Check size={9} /> Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red/20 text-red">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-overlay0/20 text-overlay1">
      Closed
    </span>
  );
}

function Gauge({ label, value }: { label: string; value: number | null }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const bar =
    value == null
      ? "bg-surface1"
      : pct < 50
      ? "bg-green"
      : pct < 80
      ? "bg-yellow"
      : "bg-red";
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-overlay0">{label}</span>
      <div className="relative h-1.5 w-16 rounded-full overflow-hidden bg-surface0">
        <div
          className={cn("absolute inset-y-0 left-0 transition-[width] duration-300", bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-subtext0 w-8 text-right">
        {value == null ? "—" : `${pct}%`}
      </span>
    </div>
  );
}

function TmuxTabPill({
  session,
  onClick,
}: {
  session: VmTmuxSession;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={session.attached ? "attached" : "click to attach"}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors",
        session.attached
          ? "bg-mauve/15 text-mauve"
          : "bg-surface0 text-overlay1 hover:text-text hover:bg-surface1",
      )}
    >
      <span>{session.name}</span>
      {session.windows != null && <span className="text-overlay0">{session.windows}w</span>}
    </button>
  );
}

export function VmConnectionPopup({ connectionKey }: { connectionKey: string }) {
  const state = useDeepSubjectAll($vmConnections);
  const conn = state.connections[connectionKey];
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Create or reattach the xterm into our terminal pane DIV whenever this
  // popup is rendered. createTerminal is idempotent against a missing
  // instance; reattachTerminal moves the existing DOM if the popup remounts.
  useEffect(() => {
    if (!conn || !terminalRef.current) return;
    const tid = conn.terminalId;
    if (hasTerminal(tid)) {
      reattachTerminal(tid, terminalRef.current);
    } else {
      createTerminal(terminalRef.current, tid);
    }
    return () => {
      // Don't dispose on every effect cleanup — only on popup close. The
      // popup-close button calls closeVmConnection which disposes the term.
    };
  }, [conn?.terminalId]);

  // Resource gauges update live from the VM's HTTPS stats postback (the manager
  // fans each one out over the WS subscription opened in openProjectVmConnection)
  // — no SSH polling. The manual Refresh button below still does a one-shot SSH
  // probe, the only way to enumerate tmux sessions (absent from the daemon push).

  if (!conn) return null;

  const handleClose = () => {
    disposeTerminal(conn.terminalId);
    closeVmConnection(connectionKey);
  };

  const handleAttachTmux = (sessionName: string) => {
    // Inject a tmux attach line into the live shell. Works whether the
    // session exists (attaches) or not (no-op + error line on stderr).
    injectVmCommand(connectionKey, `tmux attach -t '${sessionName}' 2>/dev/null || tmux new -s '${sessionName}'`);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-crust text-text">
      {/* Header — status pills + traffic counter + Refresh / Close */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 shrink-0">
        <span className="font-medium text-md truncate">{conn.vmLabel}</span>
        <StatusPill status={conn.status} />
        <span className="text-[10px] uppercase tracking-wide text-overlay0">SSH</span>
        <span className="text-[10px] text-overlay1">1 on server</span>
        <span className="text-[11px] font-mono tabular-nums text-overlay1 ml-1">
          ↓ {formatBytes(conn.bytesOut)} · ↑ {formatBytes(conn.bytesIn)}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => refreshVmStats(connectionKey)}
          title="Refresh stats"
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-overlay0/30 text-[11px] text-overlay1 hover:text-text hover:bg-surface0 transition-colors"
        >
          <RefreshCw size={11} /> Refresh
        </button>
        <button
          onClick={handleClose}
          title="Close connection"
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-red/30 text-[11px] text-red hover:bg-red/10 transition-colors"
        >
          <X size={11} /> Close
        </button>
      </div>

      {/* Connection line + resource gauges */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface0 shrink-0">
        <div className="text-[11px] font-mono text-green">
          {conn.username}@{conn.host}:{conn.port}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Gauge label="CPU" value={conn.stats?.cpu ?? null} />
          <Gauge label="MEM" value={conn.stats?.mem ?? null} />
          <Gauge label="DISK" value={conn.stats?.disk ?? null} />
          {conn.statsError && (
            <span className="text-[10px] text-red ml-auto">{conn.statsError}</span>
          )}
        </div>
      </div>

      {/* tmux session row */}
      {conn.tmuxSessions.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-surface0 shrink-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-overlay0 mr-1">TMUX</span>
          {conn.tmuxSessions.map((s) => (
            <TmuxTabPill key={s.name} session={s} onClick={() => handleAttachTmux(s.name)} />
          ))}
        </div>
      )}

      {/* Error band (above the terminal pane) */}
      {conn.status === "error" && conn.errorMessage && (
        <div className="px-3 py-1.5 text-[11px] text-red bg-red/10 border-b border-red/30 shrink-0">
          {conn.errorMessage}
        </div>
      )}

      {/* Terminal pane */}
      <div className="flex-1 min-h-0 relative">
        <div ref={terminalRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
