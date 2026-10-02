"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSubject } from "subjecto/react";
import type { MemoryInfo } from "@/store/types";
import { $system } from "@/store/subjects";
import { switchNav } from "@/store/actions";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/** Real-time main-thread busyness estimate based on setTimeout drift.
 *
 *  Schedules a tick every `TICK_MS` and measures how late each one actually
 *  fires. When the event loop is idle a tick fires on time and drift ≈ 0; when
 *  the main thread is busy synchronously, the tick is delayed and the extra
 *  delay equals "time spent blocked". We sum drift over a rolling ~1 s window
 *  and report it as a percentage of that window.
 *
 *  Why not the Long Tasks API? It only fires for tasks > 50 ms (Chromium-only,
 *  no Firefox/Safari) so the indicator looks frozen at 0 under normal use.
 *  setTimeout drift catches sub-50 ms work and works in every browser.
 */
function useUiCpu(): number | null {
  const [pct, setPct] = useState<number | null>(null);
  const lastPctRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setPct(0);
    lastPctRef.current = 0;

    // Sample drift frequently (200 ms) so we don't miss short blocking work,
    // but only re-publish the displayed value every PUBLISH_MS — and even
    // then, only when the integer % actually changes. This keeps the sidebar
    // SystemStats component from re-rendering on every tick, which was
    // measurably stealing time from xterm keystroke handling.
    const TICK_MS = 200;
    const PUBLISH_MS = 500;
    const WINDOW_MS = 1000;
    const drifts: { t: number; busy: number }[] = [];
    let lastScheduled = performance.now();
    let lastPublished = 0;
    let timeoutId: number;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      const expected = lastScheduled + TICK_MS;
      const drift = Math.max(0, now - expected);
      drifts.push({ t: now, busy: drift });

      const windowStart = now - WINDOW_MS;
      while (drifts.length > 0 && drifts[0].t < windowStart) {
        drifts.shift();
      }

      if (now - lastPublished >= PUBLISH_MS) {
        let busyMs = 0;
        for (const d of drifts) busyMs += d.busy;
        const next = Math.min(100, Math.round((busyMs / WINDOW_MS) * 100));
        if (next !== lastPctRef.current) {
          lastPctRef.current = next;
          setPct(next);
        }
        lastPublished = now;
      }

      lastScheduled = now;
      timeoutId = window.setTimeout(tick, TICK_MS);
    };
    timeoutId = window.setTimeout(tick, TICK_MS);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  return pct;
}

export function SystemStats() {
  const [system] = useSubject($system);
  const { cpu, mem, memory } = system;
  const uiCpu = useUiCpu();
  const router = useRouter();

  const openSshPanel = (): void => {
    switchNav("ssh");
    router.push("/ssh");
  };

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
                Measured via setTimeout drift — % of time the event loop was
                blocked by synchronous work.
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
      {system.wsMessagesPerSec !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-default">
              <label className="w-[30px] text-md font-bold uppercase tracking-wide text-subtext0">
                WS
              </label>
              <div className="flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(100, system.wsMessagesPerSec)}%` }}
                />
              </div>
              <span className="w-8 text-right text-md tabular-nums text-subtext1">
                {system.wsMessagesPerSec}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-0.5 text-md max-w-[220px]">
              <span>WebSocket frames/sec the manager handles (inbound + outbound).</span>
              <span className="text-overlay0">
                {system.wsConnections ?? 0} client{system.wsConnections === 1 ? "" : "s"} connected · bar scaled to 100/s.
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      {system.sshConnections !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openSshPanel}
              className="flex items-center gap-2 w-full text-left hover:bg-surface0/40 rounded transition-colors"
              title="Open SSH connections panel"
            >
              <label className="w-[30px] text-md font-bold uppercase tracking-wide text-subtext0 cursor-pointer">
                SSH
              </label>
              <div className="flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden">
                <div
                  className={
                    "h-full rounded-full transition-[width] duration-500 ease-out "
                    + (system.sshConnections >= 15 ? "bg-red" : system.sshConnections >= 8 ? "bg-yellow" : "bg-green")
                  }
                  style={{ width: `${Math.min(100, (system.sshConnections / 20) * 100)}%` }}
                />
              </div>
              <span className="w-8 text-right text-md tabular-nums text-subtext1">
                {system.sshConnections}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-0.5 text-md max-w-[220px]">
              <span>Pooled SSH tunnels the manager holds open — one per VM host. Multiplexed terminal channels riding a tunnel aren&rsquo;t counted separately.</span>
              <span className="text-overlay0">
                Bar scaled to 20. Click to inspect tunnels, channels &amp; kill connections.
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </section>
  );
}
