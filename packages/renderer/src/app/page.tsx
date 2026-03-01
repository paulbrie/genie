"use client";

import { useEffect } from "react";
import { useDeepSubject } from "subjecto/react";
import { store, loadUiState, type AppDef, type NavKey } from "@/store";
import { genie } from "@/lib/genie-api";
import { connectWs, setManagerRunning } from "@/lib/ws";
import { Sidebar } from "@/components/sidebar";
import { WelcomePanel } from "@/components/welcome-panel";
import { AppDetail } from "@/components/app-detail";
import { AddAppForm } from "@/components/add-app-form";
import { ProcessesPanel } from "@/components/processes-panel";
import { DockerPanel } from "@/components/docker-panel";
import { DocsPanel } from "@/components/docs-panel";
import { LogsPanel } from "@/components/logs-panel";
import { TerminalPanel } from "@/components/terminal-panel";
import { TerminalBottomPanel } from "@/components/terminal-bottom-panel";
import { ChatPanel } from "@/components/chat-panel";
import { FileExplorerPanel } from "@/components/file-explorer";

function MainPanel() {
  const activeNav = useDeepSubject(store, "activeNav") as NavKey;
  const selectedAppId = useDeepSubject(
    store,
    "selectedAppId"
  ) as string | null;
  const showAddForm = useDeepSubject(
    store,
    "showAddForm"
  ) as boolean;
  const apps = useDeepSubject(store, "apps") as AppDef[];

  if (activeNav === "processes") {
    return <ProcessesPanel />;
  }

  if (activeNav === "docker") {
    return <DockerPanel />;
  }

  if (activeNav === "docs") {
    return <DocsPanel />;
  }

  if (activeNav === "logs") {
    return <LogsPanel />;
  }

  if (activeNav === "terminal") {
    return <TerminalPanel />;
  }

  if (showAddForm) {
    return <AddAppForm />;
  }

  const selectedApp = selectedAppId
    ? apps.find((a) => a.id === selectedAppId)
    : null;

  if (selectedApp) {
    return <AppDetail />;
  }

  return <WelcomePanel />;
}

export default function Home() {
  useEffect(() => {
    // Restore UI state from localStorage
    loadUiState();

    // Listen for manager status from Electron main process
    genie.onManagerStatus((running: boolean) => {
      const s = store.getValue();
      s.manager.running = running;
      setManagerRunning(running);
      if (running) {
        setTimeout(connectWs, 500);
      }
    });

    // Check initial manager status
    genie.getManagerStatus().then((running) => {
      const s = store.getValue();
      s.manager.running = running;
      setManagerRunning(running);
      if (running) {
        connectWs();
      }
    });
  }, []);

  return (
    <div className="flex flex-row h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Titlebar drag area */}
        <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />
        <MainPanel />
        <ChatPanel />
        <TerminalBottomPanel />
      </main>
      <FileExplorerPanel />
    </div>
  );
}
