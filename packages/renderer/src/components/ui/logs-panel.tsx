"use client";

import { useEffect, useRef } from "react";
import { useSubject } from "subjecto/react";
import type { LogsState } from "@/store/types";
import { $logs } from "@/store/subjects";
import { clearManagerLogs, switchLogSource } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { Select } from "@/components/ui/select";
import { wsSend } from "@/lib/ws";

export function LogsPanel() {
  const [logs] = useSubject($logs);
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
      <ViewHeader
        title="Logs"
        actions={
          <>
            <Select
              value={logs.activeSource}
              onChange={(e) => switchLogSource(e.target.value)}
              className="px-2 py-1 cursor-pointer"
            >
              {logs.sources.map((src) => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={clearManagerLogs}>
              Clear
            </Button>
          </>
        }
      />

      {/* Log content */}
      <pre
        ref={logsRef}
        className="flex-1 mt-4 bg-crust rounded-md p-2 font-mono text-md leading-relaxed overflow-y-auto text-subtext0 whitespace-pre-wrap break-all select-text cursor-text scrollbar-thin"
      >
        {logContent || "No logs yet..."}
      </pre>
    </div>
  );
}
