"use client";

import { useState, useCallback } from "react";
import { useDeepSubject } from "subjecto/react";
import { store, toggleSort, togglePortFilter, type ProcessInfo, type AppStats } from "@/store";
import { Button } from "@/components/ui/button";
import { MemoryStats } from "@/components/memory-stats";
import { ProcessContextMenu } from "@/components/process-context-menu";
import { cn } from "@/lib/utils";

export function ProcessesPanel() {
  const processes = useDeepSubject(store, "processes") as ProcessInfo[];
  const processSortBy = useDeepSubject(store, "processSortBy") as "cpu" | "mem";
  const filterPortsOnly = useDeepSubject(store, "filterPortsOnly") as boolean;
  const appStats = useDeepSubject(store, "appStats") as Record<string, AppStats>;
  const [filterText, setFilterText] = useState("");

  const [contextMenu, setContextMenu] = useState<{
    pid: number;
    x: number;
    y: number;
  } | null>(null);
  const [contextTargetPid, setContextTargetPid] = useState<number | null>(null);

  const geniePids = new Set<number>();
  for (const stats of Object.values(appStats)) {
    geniePids.add(stats.pid);
  }

  let filtered = filterPortsOnly
    ? processes.filter((p) => p.port !== "")
    : processes;
  if (filterText) {
    const q = filterText.toLowerCase();
    filtered = filtered.filter(
      (p) => p.name.toLowerCase().includes(q) || p.port.includes(q)
    );
  }
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

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center pb-3 border-b border-surface0 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtext0">
          Processes
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter by name or port…"
            className="bg-surface0 border border-surface1 rounded-md px-2 py-1 text-xs text-text placeholder:text-overlay0 outline-none focus:border-blue w-40"
          />
          <Button
            size="sm"
            variant={filterPortsOnly ? "active" : "default"}
            onClick={() => togglePortFilter()}
          >
            {filterPortsOnly ? "With Ports" : "All"}
          </Button>
          <Button size="sm" onClick={() => toggleSort()}>
            {processSortBy === "cpu" ? "CPU \u2193" : "MEM \u2193"}
          </Button>
          <span className="text-right text-sm tabular-nums text-subtext1 whitespace-nowrap">
            {filterPortsOnly || filterText
              ? `${sorted.length} / ${processes.length}`
              : `${processes.length}`}
          </span>
        </div>
      </div>

      <MemoryStats />

      {/* Process table */}
      <div className="flex-1 overflow-y-auto flex flex-col scrollbar-thin">
        {/* Header row */}
        <div className="grid grid-cols-[60px_80px_1fr_56px_64px_64px] gap-2 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-overlay0 sticky top-0 bg-background">
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
              <span className="text-overlay0 tabular-nums text-xs">
                {proc.pid}
              </span>
              <span className="whitespace-nowrap overflow-hidden text-ellipsis text-overlay0 text-xs">
                {proc.user}
              </span>
              <span className="whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1">
                {proc.name}
                {isGenie && (
                  <span className="inline-block bg-mauve text-background text-2xs font-bold px-[5px] py-px rounded-lg uppercase tracking-tight shrink-0">
                    Genie
                  </span>
                )}
              </span>
              <span className="text-blue text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
                {proc.port}
              </span>
              <span className="text-right tabular-nums text-subtext1 text-xs">
                {proc.cpu}%
              </span>
              <span className="text-right tabular-nums text-subtext1 text-xs">
                {proc.mem}M
              </span>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <ProcessContextMenu
          pid={contextMenu.pid}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
