"use client";

/**
 * Live SSH terminal popup matching the new connectivity layer.
 * One open connection per (project, instance); status pills, traffic counter,
 * resource gauges, tmux session row, terminal pane.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon, Loader2, RotateCcw } from "lucide-react";

import { $vmConnections } from "@/store/subjects";
import {
  injectVmCommand,
  pasteVmImage,
  reconnectVmConnection,
  refreshVmStats,
  sendVmRawData,
  setVmConnectionTmuxSession,
} from "@/store/actions";
import type { VmConnectionState } from "@/store/types/vps";
import { TmuxSessionBadges } from "@/components/tazcloud/tmux-session-badges";
import { tmuxAttachShellCommand, tmuxSwitchClientKeys } from "@/lib/tmux-shell";
import { createTerminal, hasTerminal, reattachTerminal, setTerminalCursorBlink, setTerminalFontSize } from "@/lib/terminal-bridge";
import { useWindowFontSize, WINDOW_FONT_PX } from "@/components/ui/window-font-size";
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
  if (status === "reconnecting") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow/15 text-yellow">
        <Loader2 size={9} className="animate-spin" /> Reconnecting…
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
  if (status === "closed") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red/15 text-red">
        Disconnected
      </span>
    );
  }
  return null;
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

export function VmConnectionPopup({ connectionKey }: { connectionKey: string }) {
  const state = useDeepSubjectAll($vmConnections);
  const conn = state.connections[connectionKey];
  const isLive = conn?.status === "connected";
  // A Claude popup runs Claude inside a `claude-*` tmux session — switching tmux
  // sessions from inside it makes no sense, so hide the badge row there. Covers
  // both the Claude-button launch (initialCommand) and attaching a claude-* chip.
  const isClaudePopup =
    (conn?.initialCommand?.includes("claude") ?? false) ||
    (conn?.tmuxSessionName?.startsWith("claude-") ?? false);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [pasteNotice, setPasteNotice] = useState<{ kind: "pending" | "ok" | "error"; text: string } | null>(null);
  const [fontSize] = useWindowFontSize();
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  // Create or reattach the xterm into our terminal pane DIV whenever this
  // popup is rendered. createTerminal is idempotent against a missing
  // instance; reattachTerminal moves the existing DOM if the popup remounts.
  useEffect(() => {
    if (!conn || !terminalRef.current) return;
    const tid = conn.terminalId;
    if (hasTerminal(tid)) {
      reattachTerminal(tid, terminalRef.current);
    } else {
      createTerminal(terminalRef.current, tid, undefined, "terminal", WINDOW_FONT_PX[fontSizeRef.current]);
    }
    return () => {
      // Don't dispose on every effect cleanup — only on popup close. The
      // popup-close button calls closeVmConnection which disposes the term.
    };
  }, [conn?.terminalId]);

  // Live-apply font-size changes (no-op when the size already matches).
  useEffect(() => {
    if (conn?.terminalId) setTerminalFontSize(conn.terminalId, WINDOW_FONT_PX[fontSize]);
  }, [fontSize, conn?.terminalId]);

  // Cursor blinks only while connected — a steady cursor signals the terminal
  // is disconnected / reconnecting (alongside the dimmed pane + status pill).
  useEffect(() => {
    if (conn?.terminalId) setTerminalCursorBlink(conn.terminalId, conn.status === "connected");
  }, [conn?.status, conn?.terminalId]);

  // Clipboard-image paste → ship to VM → manager types the path into the PTY
  // so Claude Code (or any process at the prompt) reads it. Bound to the
  // popup's terminal container in capture phase so we run BEFORE xterm's
  // default paste handler (which would dump junk bytes for non-text items).
  useEffect(() => {
    if (!conn || !terminalRef.current) return;
    const container = terminalRef.current;
    const onPaste = (e: ClipboardEvent) => {
      if (!isLive) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
        const blob = it.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        e.stopPropagation();
        setPasteNotice({ kind: "pending", text: `Uploading ${blob.name || "image"}…` });
        void pasteVmImage(connectionKey, blob).catch((err) => {
          setPasteNotice({ kind: "error", text: err instanceof Error ? err.message : "Paste failed" });
        });
        return;
      }
    };
    container.addEventListener("paste", onPaste, true);
    return () => container.removeEventListener("paste", onPaste, true);
  }, [connectionKey, conn?.terminalId, isLive]);

  // Listen for the manager's paste-image result so we can flash a short status
  // line under the header. Auto-clears after 3s.
  useEffect(() => {
    if (!conn) return;
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent<{ terminalId: string | null; ok: boolean; remotePath?: string; error?: string }>).detail;
      if (detail.terminalId !== conn.terminalId) return;
      setPasteNotice(
        detail.ok
          ? { kind: "ok", text: `Image attached: ${detail.remotePath}` }
          : { kind: "error", text: detail.error || "Paste failed" },
      );
    };
    window.addEventListener("genie:terminal:paste-image:result", onResult);
    return () => window.removeEventListener("genie:terminal:paste-image:result", onResult);
  }, [conn?.terminalId]);

  useEffect(() => {
    if (!pasteNotice) return;
    // Keep the in-progress notice up until the result replaces it (uploads over
    // the bastion SFTP path can take a while); only auto-clear the final ok/error.
    // A 30s safety net clears a stuck "pending" if the result event never lands.
    const ms = pasteNotice.kind === "pending" ? 30_000 : 3_000;
    const t = window.setTimeout(() => setPasteNotice(null), ms);
    return () => window.clearTimeout(t);
  }, [pasteNotice]);

  // tmux sessions only come from the SSH stats probe — poll while this popup is open.
  useEffect(() => {
    if (!conn?.projectId || !conn.instanceId) return;
    refreshVmStats(connectionKey);
    const intervalMs = conn.status === "connected" ? 5_000 : 15_000;
    const t = window.setInterval(() => refreshVmStats(connectionKey), intervalMs);
    return () => window.clearInterval(t);
  }, [connectionKey, conn?.projectId, conn?.instanceId, conn?.status]);

  if (!conn) return null;

  const handleAttachTmux = (sessionName: string) => {
    if (!isLive) return;
    if (conn.tmuxSessionName === sessionName) return;
    const wasAttached = conn.tmuxSessionName != null;
    setVmConnectionTmuxSession(connectionKey, sessionName);
    if (wasAttached) {
      // Already inside a tmux client — switch via tmux command mode. The keys are
      // drawn on tmux's bottom status line, never reach the running shell/Claude,
      // and leave no trace in the scrollback. The `stty -echo` wrap can't suppress
      // canonical-mode echo of its own line, so typing the shell command would
      // dump the entire wrapper into whatever process is at the prompt.
      sendVmRawData(connectionKey, tmuxSwitchClientKeys(sessionName));
    } else {
      // First attach from a bare shell — type `tmux attach -t …` into the PTY.
      // Echoes one line briefly before tmux takes over the screen.
      injectVmCommand(connectionKey, tmuxAttachShellCommand(sessionName), { silent: true });
    }
    window.setTimeout(() => refreshVmStats(connectionKey, { force: true }), 1500);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-crust text-text">
      {/* Header — status pills + traffic counter */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 shrink-0">
        <span className="font-medium text-md truncate">{conn.vmLabel}</span>
        <StatusPill status={conn.status} />
        <span className="text-[10px] uppercase tracking-wide text-overlay0">SSH</span>
        <span className="text-[10px] text-overlay1">
          {conn.sshSessions && conn.sshSessions > 0 ? `${conn.sshSessions} on server` : "— on server"}
          {typeof conn.sshEstablished === "number" ? ` · ${conn.sshEstablished} conn` : ""}
        </span>
        {conn.sshClientAliveInterval === 0 && (
          <span
            className="text-[10px] text-yellow"
            title="sshd ClientAliveInterval is 0 — idle/dead clients are never reaped, so orphaned connections can pile up. Re-run Genie Standard Setup to apply the keepalive config."
          >
            ⚠ no reaper
          </span>
        )}
        <span className="text-[11px] font-mono tabular-nums text-overlay1 ml-1">
          ↓ {formatBytes(conn.bytesOut)} · ↑ {formatBytes(conn.bytesIn)}
        </span>
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

      {/* tmux session badges — SSH probe, re-probe via refresh row.
          Hidden in a Claude popup (you're already inside its tmux session). */}
      {!isClaudePopup && conn.projectId && conn.instanceId && (
        <TmuxSessionBadges
          variant="inline"
          projectId={conn.projectId}
          instanceId={conn.instanceId}
          host={conn.host}
          sshUser={conn.username}
          vmName={conn.vmLabel}
          sessionsOverride={conn.tmuxSessions}
          onAttach={handleAttachTmux}
          onProbe={() => refreshVmStats(connectionKey, { force: true })}
          probedAt={conn.lastTmuxAt}
          pendingProbe={conn.lastTmuxAt == null && conn.status === "connected"}
          probeError={conn.statsError}
          activeSessionName={
            conn.status === "connected" || conn.status === "connecting" || conn.status === "reconnecting"
              ? conn.tmuxSessionName ?? null
              : null
          }
          autoProbe={false}
        />
      )}

      {/* Disconnected banner — tmux may still be running on the VM */}
      {conn.status === "closed" && (
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-yellow bg-yellow/10 border-b border-yellow/30 shrink-0">
          <span className="flex-1">
            SSH connection lost — Claude may still be running in tmux on the VM.
            {conn.errorMessage ? ` (${conn.errorMessage})` : ""}
          </span>
          <button
            onClick={() => reconnectVmConnection(connectionKey)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-yellow/40 text-yellow hover:bg-yellow/15 transition-colors shrink-0"
          >
            <RotateCcw size={11} /> Reconnect
          </button>
        </div>
      )}

      {/* Error band (above the terminal pane) */}
      {conn.status === "error" && conn.errorMessage && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-red bg-red/10 border-b border-red/30 shrink-0">
          <span className="flex-1">{conn.errorMessage}</span>
          <button
            onClick={() => reconnectVmConnection(connectionKey)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red/40 text-red hover:bg-red/15 transition-colors shrink-0"
          >
            <RotateCcw size={11} /> Try again
          </button>
        </div>
      )}

      {/* Paste-image status — "uploading" stays until the result; ok/error clear after 3s. */}
      {pasteNotice && (
        <div
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 text-[11px] border-b shrink-0",
            pasteNotice.kind === "ok"
              ? "text-mauve bg-mauve/10 border-mauve/30"
              : pasteNotice.kind === "error"
                ? "text-red bg-red/10 border-red/30"
                : "text-blue bg-blue/10 border-blue/30",
          )}
        >
          {pasteNotice.kind === "pending"
            ? <Loader2 size={11} className="shrink-0 animate-spin" />
            : pasteNotice.kind === "ok"
              ? <Check size={11} className="shrink-0" />
              : <ImageIcon size={11} className="shrink-0" />}
          <span className="truncate font-mono">{pasteNotice.text}</span>
        </div>
      )}

      {/* Terminal pane — pad the xterm off the edges; back it with the terminal
          background (#1e1e2e) so the inset reads as part of the terminal. The
          FitAddon measures the padded content box, so cols/rows stay correct. */}
      <div
        className={cn(
          "flex-1 min-h-0 relative",
          !isLive && "opacity-60 pointer-events-none",
        )}
        style={{ background: "#1e1e2e" }}
      >
        <div ref={terminalRef} className="absolute inset-0 px-2.5 py-2" />
      </div>
    </div>
  );
}
