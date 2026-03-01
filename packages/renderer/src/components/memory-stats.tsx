"use client";

import { useDeepSubject } from "subjecto/react";
import { store, type MemoryInfo } from "@/store";
import { formatBytes } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function MemoryStats() {
  const memory = useDeepSubject(
    store,
    "system/memory"
  ) as MemoryInfo | null;

  if (!memory) return null;

  const total = memory.physical || 1;
  const pct = (v: number) =>
    `${Math.min((v / total) * 100, 100).toFixed(1)}%`;

  return (
    <div className="flex gap-4 py-2.5 px-3 bg-mantle rounded-lg mb-2.5 items-stretch">
      {/* Gauge section */}
      <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
        <div className="flex justify-between items-baseline">
          <span className="text-xs font-bold uppercase tracking-wide text-subtext0">
            Memory Pressure
          </span>
          <span className="text-sm font-semibold tabular-nums text-text">
            {formatBytes(memory.used)} / {formatBytes(memory.physical)}
          </span>
        </div>
        <div className="flex h-2.5 bg-surface1 rounded-[5px] overflow-hidden">
          <div
            className="h-full bg-blue transition-[width] duration-500 ease-out"
            style={{ width: pct(memory.wired) }}
          />
          <div
            className="h-full bg-mauve transition-[width] duration-500 ease-out"
            style={{ width: pct(memory.appMem) }}
          />
          <div
            className="h-full bg-yellow transition-[width] duration-500 ease-out"
            style={{ width: pct(memory.compressed) }}
          />
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <LegendItem color="bg-blue" label="Wired" tooltip="Memory required by the system that cannot be compressed or paged out" />
          <LegendItem color="bg-mauve" label="App" tooltip="Memory used by applications and their data" />
          <LegendItem color="bg-yellow" label="Compressed" tooltip="Memory that has been compressed to make more RAM available" />
          <LegendItem color="bg-surface1" label="Free" tooltip="Memory not currently in use and available for allocation" />
        </div>
      </div>

      {/* Details section */}
      <div className="flex gap-5 border-l border-surface0 pl-4">
        <div className="flex flex-col gap-1">
          <MemStatRow label="Physical Memory" value={formatBytes(memory.physical)} tooltip="Total installed RAM on this machine" />
          <MemStatRow label="Memory Used" value={formatBytes(memory.used)} tooltip="App + Wired + Compressed memory currently in use" />
          <MemStatRow label="Cached Files" value={formatBytes(memory.cached)} tooltip="Files cached in RAM for faster access, reclaimable when needed" />
          <MemStatRow label="Swap Used" value={formatBytes(memory.swap)} tooltip="Data written to disk when RAM is full — high values may indicate memory pressure" />
        </div>
        <div className="flex flex-col gap-1">
          <MemStatRow label="App Memory" value={formatBytes(memory.appMem)} tooltip="Memory used by applications and their data" />
          <MemStatRow label="Wired Memory" value={formatBytes(memory.wired)} tooltip="Memory required by the system that cannot be compressed or paged out" />
          <MemStatRow label="Compressed" value={formatBytes(memory.compressed)} tooltip="Inactive memory compressed to free up RAM — counts toward used memory" />
        </div>
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  tooltip,
}: {
  color: string;
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-xs text-overlay0 cursor-default">
          <span className={`w-2 h-2 rounded-sm shrink-0 ${color}`} />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function MemStatRow({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-baseline gap-2 cursor-default">
          <span className="text-sm text-subtext0 whitespace-nowrap">
            {label}
          </span>
          <span className="text-sm font-semibold tabular-nums text-text ml-auto whitespace-nowrap">
            {value}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
