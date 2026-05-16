"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useSubject } from "subjecto/react";
import type { DockerContainerInfo, DockerInfo } from "@/store/types";
import { $docker } from "@/store/subjects";
import { ExternalLink, Loader2, ChevronRight, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DockerContextMenu } from "@/components/docker-context-menu";
import { wsSend } from "@/lib/ws";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/view-header";

function stateDot(state: string) {
  if (state === "running") return "bg-green";
  if (state === "exited" || state === "dead") return "bg-red";
  return "bg-overlay0";
}

function groupDot(containers: DockerContainerInfo[]) {
  const allRunning = containers.every((c) => c.state === "running");
  const someRunning = containers.some((c) => c.state === "running");
  if (allRunning) return "bg-green";
  if (someRunning) return "bg-yellow";
  return "bg-red";
}

interface ContainerGroup {
  project: string;
  containers: DockerContainerInfo[];
}

function groupContainers(containers: DockerContainerInfo[]): { groups: ContainerGroup[]; standalone: DockerContainerInfo[] } {
  const projectMap = new Map<string, DockerContainerInfo[]>();
  const standalone: DockerContainerInfo[] = [];

  for (const c of containers) {
    if (c.project) {
      const list = projectMap.get(c.project);
      if (list) list.push(c);
      else projectMap.set(c.project, [c]);
    } else {
      standalone.push(c);
    }
  }

  const groups: ContainerGroup[] = [];
  for (const [project, ctrs] of projectMap) {
    groups.push({ project, containers: ctrs });
  }
  groups.sort((a, b) => a.project.localeCompare(b.project));

  return { groups, standalone };
}

const COLS = "grid grid-cols-[16px_1fr_1fr_80px_1fr_56px_72px_28px] gap-2";

function ContainerRow({
  c,
  isPending,
  isContextTarget,
  onContextMenu,
  onAction,
  indent,
}: {
  c: DockerContainerInfo;
  isPending: boolean;
  isContextTarget: boolean;
  onContextMenu: (e: React.MouseEvent, c: DockerContainerInfo) => void;
  onAction: (id: string, action: "docker:start" | "docker:stop") => void;
  indent?: boolean;
}) {
  const isRunning = c.state === "running";
  return (
    <div
      onContextMenu={(e) => onContextMenu(e, c)}
      className={cn(
        COLS,
        "px-2.5 py-[5px] text-base rounded items-center",
        indent && "pl-10",
        isContextTarget ? "bg-surface0" : "hover:bg-mantle"
      )}
    >
      <span className="flex items-center justify-center">
        {isPending ? (
          <Loader2 size={12} className="animate-spin text-overlay0" />
        ) : (
          <span className={cn("w-2 h-2 rounded-full", stateDot(c.state))} />
        )}
      </span>
      <span className="whitespace-nowrap overflow-hidden text-ellipsis">
        {c.service || c.name}
      </span>
      <span className="whitespace-nowrap overflow-hidden text-ellipsis text-overlay0 text-md">
        {c.image}
      </span>
      <span className="text-md text-subtext1 capitalize">
        {isPending
          ? isRunning ? "stopping…" : "starting…"
          : c.state}
      </span>
      <span className="text-blue text-md tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
        {c.ports}
      </span>
      <span className="text-right tabular-nums text-subtext1 text-md">
        {isRunning ? `${c.cpu}%` : "-"}
      </span>
      <span className="text-right tabular-nums text-subtext1 text-md">
        {isRunning ? `${c.mem}M` : "-"}
      </span>
      <span className="flex items-center justify-center">
        <button
          onClick={(e) => { e.stopPropagation(); onAction(c.id, isRunning ? "docker:stop" : "docker:start"); }}
          disabled={isPending}
          className={cn(
            "p-1 rounded transition-colors bg-transparent border-none cursor-pointer disabled:opacity-40 disabled:cursor-default",
            isRunning
              ? "text-red hover:bg-red/10"
              : "text-green hover:bg-green/10"
          )}
          title={isRunning ? "Stop" : "Start"}
        >
          {isRunning ? <Square size={12} /> : <Play size={12} />}
        </button>
      </span>
    </div>
  );
}

export function DockerPanel() {
  const [docker] = useSubject($docker);

  const [daemonPending, setDaemonPending] = useState(false);
  const [pendingContainers, setPendingContainers] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const prevDaemonRunning = useRef(docker.daemonRunning);

  useEffect(() => {
    if (docker.daemonRunning !== prevDaemonRunning.current) {
      setDaemonPending(false);
      prevDaemonRunning.current = docker.daemonRunning;
    }
  }, [docker.daemonRunning]);

  useEffect(() => {
    if (pendingContainers.size === 0) return;
    setPendingContainers((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        const c = docker.containers.find((ct) => ct.id === id);
        if (!c || c.state === "running" || c.state === "exited") {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [docker.containers, pendingContainers]);

  const [contextMenu, setContextMenu] = useState<{
    id: string;
    state: string;
    x: number;
    y: number;
  } | null>(null);
  const [contextTargetId, setContextTargetId] = useState<string | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, container: DockerContainerInfo) => {
      e.preventDefault();
      setContextMenu({ id: container.id, state: container.state, x: e.clientX, y: e.clientY });
      setContextTargetId(container.id);
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setContextTargetId(null);
  }, []);

  function handleDaemonToggle() {
    setDaemonPending(true);
    wsSend(docker.daemonRunning ? "docker:daemon:stop" : "docker:daemon:start", {});
  }

  function handleContainerAction(id: string, action: "docker:start" | "docker:stop") {
    setPendingContainers((prev) => new Set(prev).add(id));
    wsSend(action, { id });
  }

  function toggleGroup(project: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  }

  const { groups, standalone } = useMemo(
    () => groupContainers(docker.containers),
    [docker.containers]
  );

  const runningCount = docker.containers.filter((c) => c.state === "running").length;
  const totalCount = docker.containers.length;

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title="Docker"
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => wsSend("docker:open", {})}>
              Open Docker
              <ExternalLink size={12} />
            </Button>
            <Button
              size="sm"
              onClick={handleDaemonToggle}
              disabled={daemonPending}
            >
              {daemonPending
                ? docker.daemonRunning ? "Stopping…" : "Starting…"
                : docker.daemonRunning ? "Stop Daemon" : "Start Daemon"}
            </Button>
            {docker.daemonRunning && (
              <span className="text-md tabular-nums text-subtext1">
                {runningCount} / {totalCount}
              </span>
            )}
          </>
        }
      />

      {/* Content */}
      {!docker.daemonRunning && !daemonPending ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-overlay0 text-base">Docker daemon is not running</p>
        </div>
      ) : !docker.daemonRunning && daemonPending ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Loader2 size={24} className="animate-spin text-overlay0" />
          <p className="text-overlay0 text-base">Starting Docker…</p>
        </div>
      ) : docker.containers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-overlay0 text-base">No containers</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col scrollbar-thin">
          {/* Header row */}
          <div className={cn(COLS, "px-2.5 py-1.5 text-md font-bold uppercase tracking-wide text-overlay0 sticky top-0 bg-background")}>
            <span />
            <span>Name</span>
            <span>Image</span>
            <span>State</span>
            <span>Ports</span>
            <span>CPU</span>
            <span>MEM</span>
            <span />
          </div>

          {/* Compose project groups */}
          {groups.map((g) => {
            const collapsed = collapsedGroups.has(g.project);
            const running = g.containers.filter((c) => c.state === "running").length;
            return (
              <div key={g.project}>
                <button
                  onClick={() => toggleGroup(g.project)}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-transparent border-none cursor-pointer hover:bg-mantle rounded text-left"
                >
                  <ChevronRight
                    size={14}
                    className={cn(
                      "text-overlay0 transition-transform duration-150 shrink-0",
                      !collapsed && "rotate-90"
                    )}
                  />
                  <span className={cn("w-2 h-2 rounded-full shrink-0", groupDot(g.containers))} />
                  <span className="text-md font-semibold text-text">{g.project}</span>
                  <span className="text-md text-overlay0">
                    {running}/{g.containers.length}
                  </span>
                </button>
                {!collapsed &&
                  g.containers.map((c) => (
                    <ContainerRow
                      key={c.id}
                      c={c}
                      isPending={pendingContainers.has(c.id)}
                      isContextTarget={contextTargetId === c.id}
                      onContextMenu={handleContextMenu}
                      onAction={handleContainerAction}
                      indent
                    />
                  ))}
              </div>
            );
          })}

          {/* Standalone containers */}
          {standalone.map((c) => (
            <ContainerRow
              key={c.id}
              c={c}
              isPending={pendingContainers.has(c.id)}
              isContextTarget={contextTargetId === c.id}
              onContextMenu={handleContextMenu}
              onAction={handleContainerAction}
            />
          ))}
        </div>
      )}

      {contextMenu && (
        <DockerContextMenu
          containerId={contextMenu.id}
          containerState={contextMenu.state}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onAction={handleContainerAction}
        />
      )}
    </div>
  );
}
