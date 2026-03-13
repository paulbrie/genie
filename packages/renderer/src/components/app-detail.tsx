"use client";

import { useSubject } from "subjecto/react";
import {
  $apps,
  $selectedAppId,
  $appStats,
  $logBuffers,
  $viewingLogsFor,
  clearLogs,
  saveUiState,
  type AppDef,
  type AppStats,
} from "@/store";
import { Button } from "@/components/ui/button";
import { wsSend } from "@/lib/ws";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/view-header";

export function AppDetail() {
  const [apps] = useSubject($apps);
  const [selectedAppId] = useSubject($selectedAppId);
  const [appStats] = useSubject($appStats);
  const [logBuffers] = useSubject($logBuffers);
  const [viewingLogsFor] = useSubject($viewingLogsFor);

  const logsRef = useRef<HTMLPreElement>(null);
  const prevLogLen = useRef(0);

  const app = apps.find((a) => a.id === selectedAppId);
  if (!app) return null;

  const stats = appStats[app.id];
  const logContent = viewingLogsFor ? logBuffers[viewingLogsFor] || "" : "";

  // Auto-scroll logs
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (logsRef.current && logContent.length > prevLogLen.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
    prevLogLen.current = logContent.length;
  }, [logContent]);

  // Save UI state when selection changes
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    saveUiState();
  }, [selectedAppId]);

  function handleToggle() {
    if (app!.status === "running") {
      wsSend("app:stop", { id: app!.id });
    } else {
      wsSend("app:start", { id: app!.id });
    }
  }

  function handleRemove() {
    wsSend("app:remove", { id: app!.id });
    $selectedAppId.next(null);
    $viewingLogsFor.next(null);
  }

  function handleClearLogs() {
    if (viewingLogsFor) {
      clearLogs(viewingLogsFor);
    }
  }

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      <ViewHeader
        title={app.name}
        subtitle={<span className="font-mono">{app.command}</span>}
        statusIndicator={
          <span
            className={cn(
              "w-2.5 h-2.5 rounded-full",
              app.status === "running" &&
                "bg-green shadow-[0_0_4px_var(--color-green)]",
              app.status === "stopped" && "bg-overlay0",
              app.status === "crashed" &&
                "bg-red shadow-[0_0_4px_var(--color-red)]",
            )}
          />
        }
        actions={
          <>
            <Button size="sm" onClick={handleToggle}>
              {app.status === "running" ? "Stop" : "Start"}
            </Button>
            <Button size="sm" variant="danger" onClick={handleRemove}>
              Remove
            </Button>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-2.5 py-4">
        <StatCard label="CPU" value={stats ? `${stats.cpu}%` : "—"} />
        <StatCard label="Memory" value={stats ? `${stats.mem} MB` : "—"} />
        <StatCard label="PID" value={stats ? `${stats.pid}` : "—"} />
        <StatCard
          label="Status"
          value={app.status.charAt(0).toUpperCase() + app.status.slice(1)}
        />
      </div>

      {/* Logs */}
      <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
        <div className="flex justify-between items-center">
          <h2 className="text-md font-semibold uppercase tracking-wide text-subtext0">
            Logs
          </h2>
          <Button size="sm" onClick={handleClearLogs}>
            Clear
          </Button>
        </div>
        <pre
          ref={logsRef}
          className="flex-1 bg-crust rounded-md p-2 font-mono text-md leading-relaxed overflow-y-auto text-subtext0 whitespace-pre-wrap break-all select-text cursor-text scrollbar-thin"
        >
          {logContent}
        </pre>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-mantle rounded-lg px-3 py-2.5 flex flex-col gap-1">
      <span className="text-md font-bold uppercase tracking-wide text-subtext0">
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums text-text">
        {value}
      </span>
    </div>
  );
}
