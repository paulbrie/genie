"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { wsSend } from "@/lib/ws";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $vmConnections } from "@/store/subjects";
import { closeVmConnection, openProjectVmConnection } from "@/store/actions";
import { VmConnectionPopup } from "@/components/tazcloud/vm-connection-popup";
import type { MockServer, MockSession } from "@/components/mobile/mock-data";

// Keys a phone keyboard hides or makes painful — sent straight to the real PTY
// as the same byte sequences xterm would emit.
const KEY_STRIP: { label: string; data: string }[] = [
  { label: "esc", data: "\x1b" },
  { label: "tab", data: "\t" },
  { label: "^C", data: "\x03" },
  { label: "^D", data: "\x04" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
];

export function TerminalScreen({
  server,
  session,
  onBack,
}: {
  server?: MockServer;
  session?: MockSession;
  onBack: () => void;
}) {
  const [connKey, setConnKey] = useState<string | null>(null);

  // Open a real VM connection — the exact mechanism the desktop uses. A tmux
  // session reattaches its named session; the Actions SSH button opens a shell.
  useEffect(() => {
    if (!server?.projectId) return;
    const key = openProjectVmConnection({
      projectId: server.projectId,
      instanceId: server.id,
      host: server.host,
      username: server.user || "genie",
      vmLabel: session ? session.title : server.label,
      ...(session && session.kind !== "claude"
        ? { tmuxIntent: "attach" as const, tmuxSessionName: session.id }
        : {}),
    });
    setConnKey(key);
    return () => closeVmConnection(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.projectId, server?.id, session?.id]);

  const conns = useDeepSubjectAll($vmConnections);
  const terminalId = connKey ? conns.connections[connKey]?.terminalId : null;

  function sendKey(data: string) {
    if (terminalId) wsSend("terminal:data", { terminalId, data });
  }

  return (
    <div className="flex flex-col h-full bg-crust">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface0 shrink-0 bg-mantle">
        <button onClick={onBack} className="p-1 -ml-1 rounded-lg text-overlay0 active:bg-surface0" aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <span className="text-md font-semibold text-subtext0 truncate">
          {session ? session.title : server?.label ?? "Terminal"}
        </span>
      </div>

      {/* Real terminal */}
      <div className="flex-1 min-h-0">
        {connKey ? (
          <VmConnectionPopup connectionKey={connKey} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-overlay0 px-6 text-center">
            {server?.projectId
              ? "Connecting…"
              : "No project instance — open a terminal from a project's server."}
          </div>
        )}
      </div>

      {/* Mobile key strip — writes to the live PTY */}
      {terminalId && (
        <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-thin border-t border-surface0 bg-mantle shrink-0">
          {KEY_STRIP.map((k) => (
            <button
              key={k.label}
              onClick={() => sendKey(k.data)}
              className="shrink-0 min-w-9 px-2.5 py-1.5 rounded-md bg-surface0 text-subtext0 text-sm font-mono active:bg-surface1"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
