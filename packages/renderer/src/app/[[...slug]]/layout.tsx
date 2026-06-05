"use client";

import { useCallback, useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { UserCheck } from "lucide-react";
import { $auth } from "@/store/subjects";
import { loadUiState, stopImpersonating } from "@/store/actions";
import { connectWs, setManagerRunning } from "@/lib/ws";
import { Sidebar } from "@/components/ui/sidebar";
import { SuperadminTopBar } from "@/components/ui/superadmin-top-bar";
import { WindowToolbar } from "@/components/ui/window-toolbar";
import { FileExplorerPanel } from "@/components/file-explorer";
import { WsLogDrawer } from "@/components/ui/ws-log-drawer";
import { GenieAssistant } from "@/components/chat/genie-assistant";
import { DmPopup } from "@/components/chat/dm-popup";
import { DeployWindow } from "@/components/project/deploy-window";
import { BuildLogWindow } from "@/components/project/build-log-window";
import { TerminalWindows } from "@/components/terminal/terminal-window";
import { LoginScreen } from "@/components/ui/login-screen";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [auth] = useSubject($auth);
  const [wsLogOpen, setWsLogOpen] = useState(false);
  const toggleWsLog = useCallback(() => setWsLogOpen((v) => !v), []);

  useEffect(() => {
    loadUiState();
    setManagerRunning(true);
    connectWs();
  }, []);

  if (auth.status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue border-t-transparent rounded-full animate-spin" />
          <p className="text-md text-overlay0">Connecting...</p>
        </div>
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return <LoginScreen />;
  }

  return (
    <div className="flex flex-col h-screen">
      <ImpersonationBanner />
      <SuperadminTopBar />
      <div className="flex flex-row flex-1 min-h-0">
        <Sidebar wsLogOpen={wsLogOpen} onToggleWsLog={toggleWsLog} />
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {children}
          <WindowToolbar />
        </main>
        <FileExplorerPanel />
        <WsLogDrawer open={wsLogOpen} onClose={toggleWsLog} />
        <GenieAssistant />
        <DmPopup />
        <DeployWindow />
        <BuildLogWindow />
        <TerminalWindows />
      </div>
    </div>
  );
}

function ImpersonationBanner() {
  const [auth] = useSubject($auth);
  if (!auth.impersonatedBy || !auth.user) return null;
  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-mauve/15 border-b border-mauve/30 text-mauve text-md">
      <div className="flex items-center gap-2">
        <UserCheck size={14} />
        <span>
          Impersonating <strong className="text-text">{auth.user.name}</strong> ({auth.user.email}) — signed in as {auth.impersonatedBy.name}
        </span>
      </div>
      <button
        onClick={stopImpersonating}
        className="px-2 py-0.5 rounded bg-mauve/25 hover:bg-mauve/40 text-text border-none cursor-pointer transition-colors"
      >
        Stop impersonating
      </button>
    </div>
  );
}

