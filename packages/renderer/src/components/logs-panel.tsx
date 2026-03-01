"use client";

import { useEffect, useRef } from "react";
import { useDeepSubject } from "subjecto/react";
import { store, switchLogSource, clearManagerLogs, type LogsState } from "@/store";
import { Button } from "@/components/ui/button";
import { wsSend } from "@/lib/ws";

export function LogsPanel() {
  const logs = useDeepSubject(store, "logs") as LogsState;
  const logsRef = useRef<HTMLPreElement>(null);
  const prevLogLen = useRef(0);

  const logContent = logs.buffers[logs.activeSource] || "";

  // Subscribe on mount, unsubscribe on unmount/change
  useEffect(() => {
    wsSend("logs:subscribe", { source: logs.activeSource });
    return () => {
      wsSend("logs:unsubscribe", { source: logs.activeSource });
    };
  }, [logs.activeSource]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current && logContent.length > prevLogLen.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
    prevLogLen.current = logContent.length;
  }, [logContent]);

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-surface0">
        <h2 className="text-2xl font-semibold text-text">Logs</h2>
        <div className="flex items-center gap-2">
          <select
            value={logs.activeSource}
            onChange={(e) => switchLogSource(e.target.value)}
            className="bg-surface0 border border-surface1 rounded-md px-2 py-1 text-sm text-text outline-none focus:border-blue cursor-pointer"
          >
            {logs.sources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={clearManagerLogs}>
            Clear
          </Button>
        </div>
      </div>

      {/* Log content */}
      <pre
        ref={logsRef}
        className="flex-1 mt-4 bg-crust rounded-md p-2 font-mono text-xs leading-relaxed overflow-y-auto text-subtext0 whitespace-pre-wrap break-all select-text cursor-text scrollbar-thin"
      >
        {logContent || "No logs yet..."}
      </pre>
    </div>
  );
}
