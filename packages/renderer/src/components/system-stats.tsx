"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import type { MemoryInfo } from "@/store/types";
import { $system } from "@/store/subjects";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/** Real-time main-thread busyness estimate, derived from the Long Tasks API.
 *
 *  Sums the duration of all `longtask` entries (>50 ms) that landed in the last
 *  ~1 s window and reports it as a percentage of that window. A reading of 30
 *  means the JS thread was blocked by long tasks for 300 ms in the last 1 s —
 *  i.e. visible jank.
 *
 *  Returns `null` on browsers without `PerformanceObserver` longtask support
 *  (Firefox, Safari today). Callers should hide the indicator when null —
 *  there's no useful fallback signal that's comparable across browsers.
 */
function useUiCpu(): number | null {
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof PerformanceObserver === "undefined") return;
    const supported = PerformanceObserver.supportedEntryTypes?.includes("longtask");
    if (!supported) return;

    setPct(0);
    const tasks: { start: number; duration: number }[] = [];
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          tasks.push({ start: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Supported list lied (rare); bail out and keep the indicator hidden.
      return;
    }

    const WINDOW_MS = 1000;
    const tick = window.setInterval(() => {
      const now = performance.now();
      const windowStart = now - WINDOW_MS;
      while (tasks.length > 0 && tasks[0].start + tasks[0].duration < windowStart) {
        tasks.shift();
      }
      let busyMs = 0;
      for (const t of tasks) {
        const a = Math.max(t.start, windowStart);
        const b = Math.min(t.start + t.duration, now);
        if (b > a) busyMs += b - a;
      }
      setPct(Math.min(100, Math.round((busyMs / WINDOW_MS) * 100)));
    }, 500);

    return () => {
      observer?.disconnect();
      window.clearInterval(tick);
    };
  }, []);

  return pct;
}

export function SystemStats() {
  const [system] = useSubject($system);
  const { cpu, mem, memory } = system;
  const uiCpu = useUiCpu();

  const total = memory?.physical || 1;
  const wiredPct = memory ? Math.min((memory.wired / total) * 100, 100) : 0;
  const appPct = memory ? Math.min((memory.appMem / total) * 100, 100) : 0;
  const compPct = memory
    ? Math.min((memory.compressed / total) * 100, 100)
    : 0;
  const cachedPct = memory ? Math.min((memory.cached / total) * 100, 100) : 0;

  return (
    <section className="flex flex-col gap-1.5 py-2 px-2.5 bg-crust rounded-lg">
      {uiCpu !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-default">
              <label className="w-[30px] text-md font-bold uppercase tracking-wide text-subtext0">
                UI
              </label>
              <div className="flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden">
                <div
                  className={
                    "h-full rounded-full transition-[width,background-color] duration-300 ease-out "
                    + (uiCpu >= 50 ? "bg-red" : uiCpu >= 20 ? "bg-yellow" : "bg-green")
                  }
                  style={{ width: `${uiCpu}%` }}
                />
              </div>
              <span className="w-8 text-right text-md tabular-nums text-subtext1">
                {uiCpu}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-0.5 text-md max-w-[220px]">
              <span>Browser main-thread busyness (last 1 s).</span>
              <span className="text-overlay0">
                Sum of long-task durations &gt; 50 ms, expressed as % of the window.
                Green &lt; 20 · Yellow &lt; 50 · Red ≥ 50.
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
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
