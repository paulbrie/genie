"use client";

import { useCallback, useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { UserCheck } from "lucide-react";
import { $auth, $manager } from "@/store/subjects";
import { loadUiState, stopImpersonating } from "@/store/actions";
import { connectWs, setManagerRunning } from "@/lib/ws";
import { track } from "@/lib/analytics";
import { Sidebar } from "@/components/ui/sidebar";
import { SuperadminTopBar } from "@/components/ui/superadmin-top-bar";
import { WindowToolbar } from "@/components/ui/window-toolbar";
import { FileExplorerPanel } from "@/components/file-explorer";
import { WsLogDrawer } from "@/components/ui/ws-log-drawer";
import { GenieAssistant } from "@/components/chat/genie-assistant";
import { ClaudeStreamWindows } from "@/components/chat/claude-stream-window";
import { ReviewChangesPanel } from "@/components/chat/review-changes-panel";
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

  // Tab focus analytics: visibilitychange fires when the user switches to/from
  // the Genie tab. Only while authenticated (the server drops events without a
  // userId anyway).
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    const onVis = () => track(document.hidden ? "app.blur" : "app.focus");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [auth.status]);

  // Full-screen splash only on the *initial* connect — when we've never resolved
  // a user yet. On a later WS drop/re-auth we keep `auth.user`, so the app stays
  // mounted and a subtle ReconnectingToast covers the gap instead of flickering
  // the whole UI back to this splash. (The `auth:required` handler only merges
  // `status`, so `auth.user` survives a reconnect.)
  if (auth.status === "loading" && !auth.user) {
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
        <ClaudeStreamWindows />
        <ReviewChangesPanel />
        <DmPopup />
        <DeployWindow />
        <BuildLogWindow />
        <TerminalWindows />
      </div>
      <ReconnectingToast />
    </div>
  );
}

/** Subtle, debounced "Reconnecting…" pill shown while the manager WebSocket is
 *  down or the session is re-authenticating after a drop. Debounced so a quick
 *  sub-second blip doesn't flash it; hides immediately once back. Replaces the
 *  old full-screen splash on reconnect so the UI no longer flickers. */
function ReconnectingToast() {
  const [manager] = useSubject($manager);
  const [auth] = useSubject($auth);
  const offline = !manager.running || auth.status === "loading";
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!offline) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 700);
    return () => clearTimeout(t);
  }, [offline]);

  if (!show) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[200] flex items-center gap-2 px-3 py-1.5 rounded-full bg-mantle/95 border border-overlay0/30 shadow-lg text-md text-subtext0 backdrop-blur">
      <span className="w-3 h-3 border-2 border-peach border-t-transparent rounded-full animate-spin" />
      Reconnecting…
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

