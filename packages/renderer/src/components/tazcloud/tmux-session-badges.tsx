"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Terminal } from "lucide-react";
import { batch } from "subjecto";

import { ClaudeLogo } from "@/components/project/project-detail";
import { openVmConnectionWindow } from "@/components/tazcloud/vm-connection-window";
import {
  TmuxCompactContextMenu,
  TmuxSessionContextMenu,
} from "@/components/tazcloud/tmux-session-context-menu";
import { TmuxRenameDialog } from "@/components/tazcloud/tmux-rename-dialog";
import { killVmTmuxSession, refreshVmTmuxSessions, renameVmTmuxSession } from "@/store/actions";
import { $projects, $vmConnections, $vpsDeploy } from "@/store/subjects";
import type { VmConnectionState, VmTmuxSession } from "@/store/types/vps";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { ProjectDef } from "@/store/types";

const PROBE_TIMEOUT_MS = 16_000;
const AUTO_PROBE_MS = 8_000;

/** tmux session names the user currently has open in a live VM connection popup. */
function resolveActiveTmuxSessions(
  projectId: string,
  instanceId: string,
  connections: Record<string, VmConnectionState>,
  sessions: VmTmuxSession[],
  extraActive?: string | null,
): Set<string> {
  const names = new Set<string>();
  let liveCount = 0;
  for (const c of Object.values(connections)) {
    if (c.projectId !== projectId || c.instanceId !== instanceId) continue;
    if (c.status !== "connected" && c.status !== "connecting") continue;
    if (c.status === "connected") liveCount++;
    if (c.tmuxSessionName && (c.status === "connected" || c.status === "connecting")) {
      names.add(c.tmuxSessionName);
    }
  }
  if (extraActive) names.add(extraActive);
  // Fallback: one live popup but no tracked name — trust tmux `attached` flag.
  if (names.size === 0 && liveCount > 0) {
    const attached = sessions.filter((s) => s.attached === true);
    if (attached.length === 1) names.add(attached[0].name);
  }
  return names;
}

function useActiveTmuxSessions(
  projectId: string,
  instanceId: string,
  sessions: VmTmuxSession[],
  extraActive?: string | null,
): Set<string> {
  const vmConnections = useDeepSubjectAll($vmConnections);
  // Recompute every render — DeepSubject mutates nested fields in place so
  // memoizing on `connections` object identity misses status/tmuxSessionName updates.
  return resolveActiveTmuxSessions(
    projectId,
    instanceId,
    vmConnections.connections,
    sessions,
    extraActive,
  );
}

/** Resolve project + instance for a Manage VM (same rules as ManageVmInline). */
export function resolveManageVmLinked(
  vm: {
    id: string;
    projectId: string | null;
    provider: "tazcloud" | "do" | "ssh";
    instanceId?: string;
  },
  projects: ProjectDef[],
): { project: { id: string }; instance: { id: string } } | null {
  if (!vm.projectId) return null;
  const project = projects.find((p) => p.id === vm.projectId);
  if (!project) return null;
  const instance = project.vpsInstances.find((i) =>
    vm.provider === "ssh"
      ? i.id === vm.instanceId
        : vm.provider === "tazcloud"
          ? i.tazcloud?.vmId === vm.id
          : i.digitalocean?.dropletId === Number(vm.id),
  );
  if (!instance) return null;
  return { project: { id: project.id }, instance: { id: instance.id } };
}

function useInstanceTmuxProbe(instanceId: string | null | undefined): {
  sessions: VmTmuxSession[];
  lastTmuxAt: number | null;
  tmuxProbeError: string | null;
} {
  const vpsDeploy = useDeepSubjectAll($vpsDeploy);
  if (!instanceId) return { sessions: [], lastTmuxAt: null, tmuxProbeError: null };
  const inst = vpsDeploy.instances[instanceId];
  return {
    sessions: inst?.tmuxSessions ?? [],
    lastTmuxAt: inst?.lastTmuxAt ?? null,
    tmuxProbeError: inst?.tmuxProbeError ?? null,
  };
}

/** Probe tmux sessions over SSH and mirror results onto instance deploy-state. */
export function useTmuxSessionProbe(
  projectId: string | null | undefined,
  instanceId: string | null | undefined,
  opts?: { auto?: boolean; skipInitial?: boolean },
): { probing: boolean; probe: (showSpinner?: boolean) => void; sessions: VmTmuxSession[] } {
  const { sessions, lastTmuxAt } = useInstanceTmuxProbe(instanceId);
  const [probing, setProbing] = useState(!opts?.skipInitial);
  const probeGenRef = useRef(0);
  const probeStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastTmuxAt == null || probeStartedAtRef.current == null) return;
    if (lastTmuxAt >= probeStartedAtRef.current) {
      setProbing(false);
      probeStartedAtRef.current = null;
    }
  }, [lastTmuxAt]);

  useEffect(() => {
    if (!probing) return;
    const gen = probeGenRef.current;
    const t = window.setTimeout(() => {
      if (probeGenRef.current === gen) {
        setProbing(false);
        probeStartedAtRef.current = null;
      }
    }, PROBE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [probing]);

  const probe = (showSpinner = true) => {
    if (!projectId || !instanceId) return;
    if (showSpinner) {
      probeGenRef.current += 1;
      probeStartedAtRef.current = Date.now();
      setProbing(true);
    }
    refreshVmTmuxSessions(projectId, instanceId, { force: showSpinner });
  };

  useEffect(() => {
    if (opts?.skipInitial) return;
    if (!projectId || !instanceId) return;
    probe(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, instanceId]);

  useEffect(() => {
    if (!opts?.auto || !projectId || !instanceId) return;
    const t = window.setInterval(() => probe(false), AUTO_PROBE_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.auto, projectId, instanceId]);

  return { probing, probe, sessions };
}

export type TmuxSessionBadgesProps = {
  projectId: string;
  instanceId: string;
  host: string;
  sshUser: string;
  vmName: string;
  /** Full badge row (Manage tab), compact count (title bar), or inline (VM popup). */
  variant?: "row" | "compact" | "inline";
  /** When set, render these sessions instead of the instance deploy-state list. */
  sessionsOverride?: VmTmuxSession[];
  /** Parent-driven probe (e.g. refreshVmStats); skips internal refreshVmTmuxSessions. */
  onProbe?: () => void;
  /** Timestamp of last tmux probe response — clears the probing spinner. */
  probedAt?: number | null;
  /** Show spinner until the first probe response (parent-driven refresh on mount). */
  pendingProbe?: boolean;
  /** Probe error message when sessionsOverride is used (VM popup). */
  probeError?: string | null;
  /** Attach via inject into an open popup instead of opening a new window. */
  onAttach?: (sessionName: string) => void;
  /** Explicit active session (e.g. the hosting VM-connection popup). */
  activeSessionName?: string | null;
  autoProbe?: boolean;
};

function TmuxPill({
  session,
  isClaude,
  isActive,
  onClick,
  onContextMenu,
  compact,
}: {
  session: VmTmuxSession;
  isClaude: boolean;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  compact?: boolean;
}) {
  const titleParts = [`tmux session "${session.name}"`];
  if (isActive) titleParts.push("connected here");
  else if (session.attached) titleParts.push("attached on server");
  titleParts.push("left-click to attach", "right-click for rename/delete");

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={titleParts.join(" — ")}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded font-mono transition-colors shrink-0",
        compact ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[11px]",
        isActive
          ? isClaude
            ? "border-2 border-mauve bg-mauve/35 text-mauve font-semibold shadow-sm shadow-mauve/25"
            : "border-2 border-green bg-green/20 text-green font-semibold shadow-sm shadow-green/20"
          : isClaude
            ? "border border-transparent bg-mauve/15 text-mauve hover:bg-mauve/25"
            : "border border-transparent bg-surface0 text-overlay1 hover:text-text hover:bg-surface1",
        !isActive && session.attached && "ring-1 ring-overlay0/40",
      )}
    >
      {isClaude ? <ClaudeLogo size={compact ? 9 : 10} /> : <Terminal size={compact ? 9 : 10} className="shrink-0" />}
      <span className={compact ? "max-w-[5rem] truncate" : undefined}>{session.name}</span>
      {session.windows != null && (
        <span className="text-overlay0" title={`${session.windows} tmux window${session.windows === 1 ? "" : "s"}`}>
          {session.windows}w
        </span>
      )}
    </button>
  );
}

export function TmuxSessionBadges({
  projectId,
  instanceId,
  host,
  sshUser,
  vmName,
  variant = "row",
  sessionsOverride,
  onAttach,
  onProbe,
  probedAt,
  pendingProbe = false,
  probeError = null,
  activeSessionName = null,
  autoProbe = variant !== "compact",
}: TmuxSessionBadgesProps) {
  const { probing, probe: internalProbe, sessions: probedSessions } = useTmuxSessionProbe(
    projectId,
    instanceId,
    { auto: autoProbe && sessionsOverride == null && !onProbe, skipInitial: !!onProbe },
  );
  const sessions = sessionsOverride ?? probedSessions;
  const activeSessions = useActiveTmuxSessions(projectId, instanceId, sessions, activeSessionName);
  const [localProbing, setLocalProbing] = useState(false);
  const [pendingExpired, setPendingExpired] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionName?: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const probeGenRef = useRef(0);
  const parentProbeStartedAtRef = useRef<number | null>(null);
  const parentPending = pendingProbe && !pendingExpired && probedAt == null;
  const probingActive = onProbe ? (localProbing || parentPending) : probing;

  useEffect(() => {
    if (!pendingProbe || probedAt != null) {
      setPendingExpired(false);
      return;
    }
    const t = window.setTimeout(() => setPendingExpired(true), PROBE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [pendingProbe, probedAt]);

  useEffect(() => {
    if (probedAt == null || parentProbeStartedAtRef.current == null) return;
    if (probedAt >= parentProbeStartedAtRef.current) {
      setLocalProbing(false);
      parentProbeStartedAtRef.current = null;
    }
  }, [probedAt]);

  useEffect(() => {
    if (!probingActive) return;
    const gen = probeGenRef.current;
    const t = window.setTimeout(() => {
      if (probeGenRef.current === gen) setLocalProbing(false);
    }, PROBE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [probingActive]);

  const probe = (showSpinner = true) => {
    if (onProbe) {
      if (showSpinner) {
        probeGenRef.current += 1;
        parentProbeStartedAtRef.current = Date.now();
        setLocalProbing(true);
      }
      onProbe();
      return;
    }
    internalProbe(showSpinner);
  };

  const { tmuxProbeError } = useInstanceTmuxProbe(onProbe ? null : instanceId);
  const emptyLabel = (onProbe ? probeError : tmuxProbeError) || "no sessions";

  const attach = (sessionName: string) => {
    if (onAttach) {
      onAttach(sessionName);
      return;
    }
    openVmConnectionWindow({
      projectId,
      instanceId,
      host,
      port: 22,
      username: sshUser,
      vmLabel: `${sessionName} · ${vmName}`,
      tmuxIntent: "attach",
      tmuxSessionName: sessionName,
    });
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleRename = useCallback((sessionName: string) => {
    setRenameTarget(sessionName);
  }, []);

  const submitRename = useCallback(
    (newName: string) => {
      if (!renameTarget) return;
      const sessionName = renameTarget;
      void renameVmTmuxSession(projectId, instanceId, sessionName, newName).then((res) => {
        setRenameTarget(null);
        if (res.error) window.alert(res.output || "Rename failed");
        else {
          batch(() => {
            for (const c of Object.values($vmConnections.getValue().connections)) {
              if (c.tmuxSessionName === sessionName) c.tmuxSessionName = newName;
            }
          });
          if (onProbe) onProbe();
        }
      });
    },
    [projectId, instanceId, renameTarget, onProbe],
  );

  const handleDelete = useCallback(
    async (sessionName: string) => {
      const res = await killVmTmuxSession(projectId, instanceId, sessionName);
      if (res.error) {
        window.alert(res.output || "Delete failed");
        throw new Error(res.output || "Delete failed");
      }
      if (onProbe) onProbe();
    },
    [projectId, instanceId, onProbe],
  );

  const openSessionMenu = useCallback((e: React.MouseEvent, sessionName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionName });
  }, []);

  if (variant === "compact") {
    if (sessions.length === 0 && !probingActive) return null;
    const compactTitle = sessions.length
      ? sessions.map((s) => `${s.name}${activeSessions.has(s.name) ? " (connected)" : ""}`).join(", ")
      : "Probing tmux…";
    return (
      <>
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-surface0/60 text-mauve",
            activeSessions.size > 0 && "border-2 border-green bg-green/10",
          )}
          title={compactTitle}
          onContextMenu={sessions.length > 0 ? (e) => openSessionMenu(e) : undefined}
        >
          <Terminal size={11} className="shrink-0" />
          {probingActive && sessions.length === 0 ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <>
              {sessions.length}
              {sessions.length > 0 && (
                <span className="text-overlay0 max-w-[8rem] truncate hidden sm:inline">
                  ·{" "}
                  {sessions.map((s, i) => (
                    <span
                      key={s.name}
                      className={activeSessions.has(s.name) ? "text-green font-medium" : undefined}
                    >
                      {i > 0 ? ", " : ""}
                      {s.name}
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); probe(true); }}
            className="p-0.5 rounded text-overlay0 hover:text-text"
            title="Re-probe tmux sessions"
          >
            <RefreshCw size={10} className={cn(probingActive && "animate-spin")} />
          </button>
        </span>
        {contextMenu && sessions.length > 0 && (
          <TmuxCompactContextMenu
            sessions={sessions}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={closeContextMenu}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}
        {renameTarget && (
          <TmuxRenameDialog
            sessionName={renameTarget}
            onConfirm={submitRename}
            onClose={() => setRenameTarget(null)}
          />
        )}
      </>
    );
  }

  const showLabel = variant === "row";

  return (
    <>
      <div className={cn(
        "flex items-center gap-1.5 flex-wrap",
        variant === "inline" && "px-3 py-1.5 border-b border-surface0 shrink-0",
      )}
      >
        {showLabel && (
          <span className="text-[10px] uppercase tracking-wide text-overlay0 mr-0.5">tmux</span>
        )}
        {!showLabel && variant === "inline" && (
          <span className="text-[10px] uppercase tracking-wide text-overlay0 mr-1">TMUX</span>
        )}
        {sessions.length === 0 && probingActive ? (
          <span className="text-xs text-overlay0 inline-flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> probing…
          </span>
        ) : sessions.length === 0 ? (
          <span className={cn("text-xs truncate max-w-[20rem]", emptyLabel !== "no sessions" ? "text-red" : "text-overlay0")} title={emptyLabel}>
            {emptyLabel}
          </span>
        ) : (
          sessions.map((s) => (
            <TmuxPill
              key={s.name}
              session={s}
              isClaude={s.name.startsWith("claude")}
              isActive={activeSessions.has(s.name)}
              onClick={() => attach(s.name)}
              onContextMenu={(e) => openSessionMenu(e, s.name)}
              compact={variant === "inline"}
            />
          ))
        )}
        <button
          type="button"
          onClick={() => probe(true)}
          title="Re-probe tmux sessions"
          className="p-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
        >
          <RefreshCw size={11} className={cn(probingActive && "animate-spin")} />
        </button>
      </div>
      {contextMenu?.sessionName && (
        <TmuxSessionContextMenu
          sessionName={contextMenu.sessionName}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
      {renameTarget && (
        <TmuxRenameDialog
          sessionName={renameTarget}
          onConfirm={submitRename}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </>
  );
}
