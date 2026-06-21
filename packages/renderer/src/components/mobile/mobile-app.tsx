"use client";

import { useEffect, useState } from "react";
import { connectWs, setManagerRunning } from "@/lib/ws";
import { loadUiState } from "@/store/actions";
import { HomeScreen } from "@/components/mobile/screens/home-screen";
import { ClaudeScreen } from "@/components/mobile/screens/claude-screen";
import { TerminalScreen } from "@/components/mobile/screens/terminal-screen";
import { ActivityScreen } from "@/components/mobile/screens/activity-screen";
import { ServerDetailScreen } from "@/components/mobile/screens/server-detail-screen";
import type { MockServer } from "@/components/mobile/mock-data";

// Simple navigation stack. Home is the root; every other view pushes on top and
// shows a back button until you pop back to Home.
type View =
  | { kind: "home" }
  | { kind: "manager"; server: MockServer }
  | { kind: "claude"; server: MockServer }
  | { kind: "terminal" }
  | { kind: "activity" };

export function MobileApp() {
  const [stack, setStack] = useState<View[]>([{ kind: "home" }]);
  const top = stack[stack.length - 1];

  // This route's own live connection so the screens get real data when a
  // manager is reachable (mock fallback otherwise — see use-mobile-data).
  useEffect(() => {
    loadUiState();
    setManagerRunning(true);
    connectWs();
  }, []);

  const push = (v: View) => setStack((s) => [...s, v]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-text overflow-hidden">
      <main className="flex-1 min-h-0 overflow-hidden">
        {top.kind === "home" && (
          <div className="h-full overflow-y-auto scrollbar-thin">
            <HomeScreen onOpenServer={(server) => push({ kind: "manager", server })} />
          </div>
        )}
        {top.kind === "manager" && (
          <ServerDetailScreen
            server={top.server}
            onBack={back}
            onSSH={() => push({ kind: "terminal" })}
            onOpenClaude={(server) => push({ kind: "claude", server })}
          />
        )}
        {top.kind === "claude" && <ClaudeScreen server={top.server} onBack={back} />}
        {top.kind === "terminal" && <TerminalScreen onBack={back} />}
        {top.kind === "activity" && <ActivityScreen />}
      </main>
    </div>
  );
}
