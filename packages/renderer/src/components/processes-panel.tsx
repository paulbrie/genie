"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import type { ProcessInfo } from "@/store/types";
import { $filterPortsOnly, $processSortBy, $processes } from "@/store/subjects";
import { togglePortFilter, toggleSort } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { ProcessContextMenu } from "@/components/process-context-menu";
import { ProcessCity } from "@/components/process-city";
import { wsSend } from "@/lib/ws";
import { cn } from "@/lib/utils";

const CITY_KILL_EXPLOSION_MS = 720;
const CITY_KILL_EXPLOSION_FALLBACK_MS = 1800;
const CITY_KILL_FAILURE_RESTORE_MS = 4500;

export function ProcessesPanel() {
  const [processes] = useSubject($processes);
  const [processSortBy] = useSubject($processSortBy);
  const [filterPortsOnly] = useSubject($filterPortsOnly);
  const [filterText, setFilterText] = useState("");
  const [refreshRate, setRefreshRate] = useState(2000);
  const [viewMode, setViewMode] = useState<"table" | "city">("city");
  const [cityLayoutMode, setCityLayoutMode] = useState<"stable" | "landmark">("stable");
  const [cityNeighborhoodMode, setCityNeighborhoodMode] = useState<"user" | "process-tree">(
    "user",
  );

  const [contextMenu, setContextMenu] = useState<{
    pid: number;
    x: number;
    y: number;
  } | null>(null);
  const [contextTargetPid, setContextTargetPid] = useState<number | null>(null);
  const [explodingPid, setExplodingPid] = useState<number | null>(null);
  const [explosionStartedAt, setExplosionStartedAt] = useState<number | null>(null);
  const [optimisticallyHiddenPids, setOptimisticallyHiddenPids] = useState<Set<number>>(new Set());
  const killDispatchTimeout = useRef<number | null>(null);
  const explosionCleanupTimeout = useRef<number | null>(null);
  const hiddenPidRestoreTimeouts = useRef<Map<number, number>>(new Map());
  const latestProcesses = useRef<ProcessInfo[]>(processes);

  const geniePids = useMemo(() => new Set<number>(), []);

  let filtered = filterPortsOnly
    ? processes.filter((p) => p.port !== "")
    : processes;
  if (filterText) {
    const q = filterText.toLowerCase();
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  }
  const visibleProcessIds = useMemo(
    () => new Set(filtered.map((proc) => proc.pid)),
    [filtered],
  );
  const cityProcesses = useMemo(
    () => processes.filter((proc) => !optimisticallyHiddenPids.has(proc.pid)),
    [optimisticallyHiddenPids, processes],
  );
  const cityVisibleProcessIds = useMemo(
    () => new Set(filtered.filter((proc) => !optimisticallyHiddenPids.has(proc.pid)).map((proc) => proc.pid)),
    [filtered, optimisticallyHiddenPids],
  );
  const sorted = [...filtered].sort(
    (a, b) => b[processSortBy] - a[processSortBy]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, pid: number) => {
      e.preventDefault();
      setContextMenu({ pid, x: e.clientX, y: e.clientY });
      setContextTargetPid(pid);
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setContextTargetPid(null);
  }, []);

  useEffect(() => {
    latestProcesses.current = processes;
  }, [processes]);

  useEffect(() => {
    return () => {
      if (killDispatchTimeout.current !== null) {
        window.clearTimeout(killDispatchTimeout.current);
      }
      if (explosionCleanupTimeout.current !== null) {
        window.clearTimeout(explosionCleanupTimeout.current);
      }
      for (const timeoutId of hiddenPidRestoreTimeouts.current.values()) {
        window.clearTimeout(timeoutId);
      }
      hiddenPidRestoreTimeouts.current.clear();
    };
  }, []);

  useEffect(() => {
    const activePids = new Set(processes.map((proc) => proc.pid));
    setOptimisticallyHiddenPids((current) => {
      let changed = false;
      const next = new Set(current);
      for (const pid of current) {
        if (activePids.has(pid)) continue;
        next.delete(pid);
        changed = true;
        const timeoutId = hiddenPidRestoreTimeouts.current.get(pid);
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
          hiddenPidRestoreTimeouts.current.delete(pid);
        }
      }
      return changed ? next : current;
    });
  }, [processes]);

  useEffect(() => {
    if (explodingPid === null) return;
    if (processes.some((proc) => proc.pid === explodingPid)) return;

    setExplodingPid(null);
    setExplosionStartedAt(null);
    setContextTargetPid((current) => (current === explodingPid ? null : current));
    if (explosionCleanupTimeout.current !== null) {
      window.clearTimeout(explosionCleanupTimeout.current);
      explosionCleanupTimeout.current = null;
    }
  }, [explodingPid, processes]);

  const handleKillProcess = useCallback(
    (pid: number) => {
      if (viewMode !== "city") {
        wsSend("process:kill", { pid });
        return;
      }

      if (killDispatchTimeout.current !== null) {
        window.clearTimeout(killDispatchTimeout.current);
      }
      if (explosionCleanupTimeout.current !== null) {
        window.clearTimeout(explosionCleanupTimeout.current);
      }

      setContextTargetPid(pid);
      setExplodingPid(pid);
      setExplosionStartedAt(Date.now());

      killDispatchTimeout.current = window.setTimeout(() => {
        wsSend("process:kill", { pid });
        setOptimisticallyHiddenPids((current) => {
          const next = new Set(current);
          next.add(pid);
          return next;
        });
        const existingRestoreTimeout = hiddenPidRestoreTimeouts.current.get(pid);
        if (existingRestoreTimeout !== undefined) {
          window.clearTimeout(existingRestoreTimeout);
        }
        hiddenPidRestoreTimeouts.current.set(
          pid,
          window.setTimeout(() => {
            hiddenPidRestoreTimeouts.current.delete(pid);
            if (!latestProcesses.current.some((proc) => proc.pid === pid)) return;
            setOptimisticallyHiddenPids((current) => {
              if (!current.has(pid)) return current;
              const next = new Set(current);
              next.delete(pid);
              return next;
            });
          }, CITY_KILL_FAILURE_RESTORE_MS),
        );
        killDispatchTimeout.current = null;
      }, CITY_KILL_EXPLOSION_MS);

      explosionCleanupTimeout.current = window.setTimeout(() => {
        setExplodingPid((current) => (current === pid ? null : current));
        setExplosionStartedAt(null);
        setContextTargetPid((current) => (current === pid ? null : current));
        explosionCleanupTimeout.current = null;
      }, CITY_KILL_EXPLOSION_FALLBACK_MS);
    },
    [viewMode],
  );

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title="Processes"
        subtitle={
          viewMode === "city"
            ? cityNeighborhoodMode === "process-tree"
              ? cityLayoutMode === "landmark"
                ? "Process trees become neighborhoods with roots at the center"
                : "Root processes become neighborhoods for their subprocesses"
              : cityLayoutMode === "landmark"
                ? "Top memory process anchors each neighborhood"
                : "Users become neighborhoods, memory becomes skyline"
            : undefined
        }
        actions={
          <>
            <Button
              size="sm"
              variant={viewMode === "city" ? "active" : "default"}
              onClick={() => setViewMode(viewMode === "table" ? "city" : "table")}
            >
              {viewMode === "city" ? "List" : "City"}
            </Button>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter process names…"
              className="bg-surface0 border border-surface1 rounded-md px-2 py-1 text-md text-text placeholder:text-overlay0 outline-none focus:border-blue w-44"
            />
            <Button
              size="sm"
              variant={filterPortsOnly ? "active" : "default"}
              onClick={() => togglePortFilter()}
            >
              {filterPortsOnly ? "With Ports" : "All"}
            </Button>
            {viewMode === "city" && (
              <Button
                size="sm"
                variant={cityLayoutMode === "landmark" ? "active" : "default"}
                onClick={() =>
                  setCityLayoutMode((current) =>
                    current === "stable" ? "landmark" : "stable",
                  )
                }
              >
                {cityLayoutMode === "landmark" ? "Landmark" : "Stable Grid"}
              </Button>
            )}
            {viewMode === "table" && (
              <Button size="sm" onClick={() => toggleSort()}>
                {processSortBy === "cpu" ? "CPU \u2193" : "MEM \u2193"}
              </Button>
            )}
            <select
              value={refreshRate}
              onChange={(e) => {
                const ms = Number(e.target.value);
                setRefreshRate(ms);
                wsSend("monitor:set-interval", { intervalMs: ms });
              }}
              className="bg-surface0 border border-surface1 rounded-md px-1.5 py-0.5 text-md text-text outline-none focus:border-blue"
            >
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
            <span className="text-right text-md tabular-nums text-subtext1 whitespace-nowrap">
              {filterPortsOnly || filterText
                ? `${sorted.length} / ${processes.length}`
                : `${processes.length}`}
            </span>
          </>
        }
      />

      {viewMode === "city" ? (
        <ProcessCity
          processes={cityProcesses}
          geniePids={geniePids}
          layoutMode={cityLayoutMode}
          neighborhoodMode={cityNeighborhoodMode}
          onNeighborhoodModeChange={setCityNeighborhoodMode}
          visibleProcessIds={cityVisibleProcessIds}
          filterActive={filterPortsOnly || Boolean(filterText)}
          onProcessContextMenu={handleContextMenu}
          contextTargetPid={contextTargetPid}
          explodingPid={explodingPid}
          explosionStartedAt={explosionStartedAt}
        />
      ) : (
        /* Process table */
        <div className="flex-1 overflow-y-auto flex flex-col scrollbar-thin">
          {/* Header row */}
          <div className="grid grid-cols-[60px_80px_1fr_56px_64px_64px] gap-2 px-2.5 py-1.5 text-md font-bold uppercase tracking-wide text-overlay0 sticky top-0 bg-background">
            <span>PID</span>
            <span>User</span>
            <span>Name</span>
            <span>Port</span>
            <span>CPU</span>
            <span>MEM</span>
          </div>

          {sorted.map((proc) => {
            const isGenie = geniePids.has(proc.pid);
            return (
              <div
                key={proc.pid}
                onContextMenu={(e) => handleContextMenu(e, proc.pid)}
                className={cn(
                  "grid grid-cols-[60px_80px_1fr_56px_64px_64px] gap-2 px-2.5 py-[5px] text-base rounded items-center",
                  contextTargetPid === proc.pid
                    ? "bg-surface0"
                    : "hover:bg-mantle"
                )}
              >
                <span className="text-overlay0 tabular-nums text-md">
                  {proc.pid}
                </span>
                <span className="whitespace-nowrap overflow-hidden text-ellipsis text-overlay0 text-md">
                  {proc.user}
                </span>
                <span className="whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1">
                  {proc.name}
                  {isGenie && (
                    <span className="inline-block bg-mauve text-background text-md font-bold px-[5px] py-px rounded-lg uppercase tracking-tight shrink-0">
                      Genie
                    </span>
                  )}
                </span>
                <span className="text-blue text-md tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
                  {proc.port}
                </span>
                <span className="text-right tabular-nums text-subtext1 text-md">
                  {proc.cpu}%
                </span>
                <span className="text-right tabular-nums text-subtext1 text-md">
                  {proc.mem}M
                </span>
              </div>
            );
          })}
        </div>
      )}

      {contextMenu && (
        <ProcessContextMenu
          pid={contextMenu.pid}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onKill={handleKillProcess}
        />
      )}
    </div>
  );
}

