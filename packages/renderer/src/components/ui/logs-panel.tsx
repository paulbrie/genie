"use client";

import { useEffect, useRef } from "react";
import { useSubject } from "subjecto/react";
import { cn } from "@/lib/utils";
import { $auth, $logs } from "@/store/subjects";
import { clearManagerLogs, switchLogSource } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { Select } from "@/components/ui/select";
import { wsSend } from "@/lib/ws";

export function LogsPanel() {
  const [logs] = useSubject($logs);
  const [auth] = useSubject($auth);
  const logsRef = useRef<HTMLPreElement>(null);
  const prevLogLen = useRef(0);
  const didAutoSelect = useRef(false);

  const isSuperAdmin = auth.user?.role === "superadmin";
  const logContent = logs.buffers[logs.activeSource] || "";

  // Default superadmins to the live error stream once the server advertises it.
  // One-shot: never override a manual source switch afterwards.
  useEffect(() => {
    if (didAutoSelect.current) return;
    if (isSuperAdmin && logs.sources.includes("errors")) {
      didAutoSelect.current = true;
      if (logs.activeSource !== "errors") switchLogSource("errors");
    }
  }, [isSuperAdmin, logs.sources, logs.activeSource]);

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
        className={cn(
          "flex-1 mt-4 bg-crust rounded-md p-2 font-mono text-md leading-relaxed overflow-y-auto whitespace-pre-wrap break-all select-text cursor-text scrollbar-thin",
          logs.activeSource === "errors" ? "text-red/90" : "text-subtext0",
        )}
      >
        {logContent || (logs.activeSource === "errors" ? "No errors yet — server is quiet." : "No logs yet...")}
      </pre>
    </div>
  );
}
