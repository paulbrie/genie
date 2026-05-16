"use client";

import { useCallback, useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { Terminal, X, UserCheck } from "lucide-react";
import type { TerminalShareInvite } from "@/store/types";
import { $auth, $terminal } from "@/store/subjects";
import { acceptTerminalShare, declineTerminalShare, loadUiState, stopImpersonating } from "@/store/actions";
import { connectWs, setManagerRunning } from "@/lib/ws";
import { Sidebar } from "@/components/sidebar";
import { WindowToolbar } from "@/components/window-toolbar";
import { FileExplorerPanel } from "@/components/file-explorer";
import { WsLogDrawer } from "@/components/ws-log-drawer";
import { GenieAssistant } from "@/components/genie-assistant";
import { DeployWindow } from "@/components/deploy-window";
import { BuildLogWindow } from "@/components/build-log-window";
import { TerminalWindows } from "@/components/terminal-window";
import { LoginScreen } from "@/components/login-screen";

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
      <div className="flex flex-row flex-1 min-h-0">
        <Sidebar wsLogOpen={wsLogOpen} onToggleWsLog={toggleWsLog} />
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {children}
          <WindowToolbar />
        </main>
        <FileExplorerPanel />
        <WsLogDrawer open={wsLogOpen} onClose={toggleWsLog} />
        <GenieAssistant />
        <DeployWindow />
        <BuildLogWindow />
        <TerminalWindows />
        <TerminalShareToasts />
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

function TerminalShareToasts() {
  const [terminal] = useSubject($terminal);
  const shareInvites = terminal.shareInvites;

  useEffect(() => {
    if (shareInvites.length === 0) return;
    const timers = shareInvites.map((invite: TerminalShareInvite) =>
      setTimeout(() => {
        declineTerminalShare(invite.sessionId);
      }, 15000)
    );
    return () => timers.forEach(clearTimeout);
  }, [shareInvites]);

  if (shareInvites.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
      {shareInvites.slice(-3).map((invite: TerminalShareInvite) => (
        <div
          key={invite.sessionId}
          className="pointer-events-auto flex items-start gap-2 bg-mantle border border-surface0 rounded-lg shadow-lg px-3 py-2 max-w-[300px] animate-in slide-in-from-right"
        >
          <Terminal size={14} className="text-green shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-md font-medium text-text">
              {invite.ownerName} shared a terminal
            </p>
            <div className="flex gap-1.5 mt-1.5">
              <button
                onClick={() => acceptTerminalShare(invite)}
                className="px-2 py-0.5 text-md bg-green/20 text-green rounded border-none cursor-pointer hover:bg-green/30 transition-colors"
              >
                Join
              </button>
              <button
                onClick={() => declineTerminalShare(invite.sessionId)}
                className="px-2 py-0.5 text-md bg-surface0 text-subtext0 rounded border-none cursor-pointer hover:bg-surface1 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            onClick={() => declineTerminalShare(invite.sessionId)}
            className="p-0.5 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
