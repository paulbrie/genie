"use client";

import { useSubject } from "subjecto/react";
import { $system, type MemoryInfo } from "@/store";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function SystemStats() {
  const [system] = useSubject($system);
  const { cpu, mem, memory } = system;

  const total = memory?.physical || 1;
  const wiredPct = memory ? Math.min((memory.wired / total) * 100, 100) : 0;
  const appPct = memory ? Math.min((memory.appMem / total) * 100, 100) : 0;
  const compPct = memory
    ? Math.min((memory.compressed / total) * 100, 100)
    : 0;
  const cachedPct = memory ? Math.min((memory.cached / total) * 100, 100) : 0;

  return (
    <section className="flex flex-col gap-1.5 py-2 px-2.5 bg-crust rounded-lg">
      <div className="flex items-center gap-2">
        <label className="w-[30px] text-md font-bold uppercase tracking-wide text-subtext0">
          CPU
        </label>
        <div className="flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${cpu}%` }}
          />
        </div>
        <span className="w-8 text-right text-md tabular-nums text-subtext1">
          {cpu}%
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-default">
            <label className="w-[30px] text-md font-bold uppercase tracking-wide text-subtext0">
              MEM
            </label>
            <div className="flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden flex">
              {memory ? (
                <>
                  <div
                    className="h-full bg-blue transition-[width] duration-500 ease-out"
                    style={{ width: `${wiredPct}%` }}
                  />
                  <div
                    className="h-full bg-mauve transition-[width] duration-500 ease-out"
                    style={{ width: `${appPct}%` }}
                  />
                  <div
                    className="h-full bg-yellow transition-[width] duration-500 ease-out"
                    style={{ width: `${compPct}%` }}
                  />
                  <div
                    className="h-full bg-teal opacity-50 transition-[width] duration-500 ease-out"
                    style={{ width: `${cachedPct}%` }}
                  />
                </>
              ) : (
                <div
                  className="h-full bg-green rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${mem}%` }}
                />
              )}
            </div>
            <span className="w-8 text-right text-md tabular-nums text-subtext1">
              {mem}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex flex-col gap-0.5 text-md">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-blue shrink-0" />
              Wired {memory ? `${wiredPct.toFixed(1)}%` : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-mauve shrink-0" />
              App {memory ? `${appPct.toFixed(1)}%` : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-yellow shrink-0" />
              Compressed {memory ? `${compPct.toFixed(1)}%` : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-teal opacity-50 shrink-0" />
              Cached {memory ? `${cachedPct.toFixed(1)}%` : ""}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </section>
  );
}
