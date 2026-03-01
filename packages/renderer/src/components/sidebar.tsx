"use client";

import { useDeepSubject } from "subjecto/react";
import { store } from "@/store";
import { genie } from "@/lib/genie-api";
import { connectWs, disconnectWs, setManagerRunning } from "@/lib/ws";
import { SystemStats } from "@/components/system-stats";
import { SidebarNav } from "@/components/sidebar-nav";
import { AppsList } from "@/components/apps-list";
import { Button } from "@/components/ui/button";
import { FileExplorerToggle } from "@/components/file-explorer-toggle";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const managerRunning = useDeepSubject(
    store,
    "manager/running"
  ) as boolean;

  async function handleManagerToggle() {
    if (managerRunning) {
      await genie.stopManager();
      disconnectWs();
      const s = store.getValue();
      s.manager.running = false;
      setManagerRunning(false);
    } else {
      await genie.startManager();
      const s = store.getValue();
      s.manager.running = true;
      setManagerRunning(true);
      setTimeout(connectWs, 1200);
    }
  }

  function handleManagerRestart() {
    genie.restartApp();
  }

  return (
    <aside className="w-60 min-w-60 bg-mantle border-r border-surface0 flex flex-col gap-2.5 px-3 pb-3 overflow-hidden">
      {/* Titlebar drag area */}
      <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-mauve">Genie</h1>
        <div className="flex items-center gap-1.5 text-sm">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              managerRunning
                ? "bg-green shadow-[0_0_4px_var(--color-green)]"
                : "bg-overlay0"
            )}
          />
          <Button size="sm" onClick={handleManagerToggle}>
            {managerRunning ? "Stop" : "Start"}
          </Button>
          {managerRunning && (
            <Button size="sm" onClick={handleManagerRestart}>
              Restart
            </Button>
          )}
        </div>
      </div>

      <SystemStats />
      <SidebarNav />
      <AppsList />
      <div className="mt-auto pt-2 border-t border-surface0">
        <FileExplorerToggle />
      </div>
    </aside>
  );
}
