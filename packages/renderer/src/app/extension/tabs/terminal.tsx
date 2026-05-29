"use client";

// Extension-side terminal subsystem:
//   TerminalTabDef          — shape of an open terminal window
//   SingleTerminal          — xterm.js mount wired to the manager's vps:terminal:* WS messages
//   OwnerAvatar / ViewerAvatars — share-related avatars shown in the title bar
//   FloatingTerminalWindow  — draggable/resizable window wrapping SingleTerminal
//   TerminalListPanel       — the Terminal tab body (list + "New" button + restore/close controls)
//
// The TerminalShareInvite *banner* and the ShareTerminalPopup live in
// ./team-chat.tsx — both depend on the chat store and we import the popup
// here for the title-bar share button.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Maximize2, Minimize2, Minus, Plus, RotateCcw, Share2, Terminal, X } from "lucide-react";
import { GENIE_PROJECT_DIR } from "@/lib/terminal-spawn";
import { wsSend } from "@/lib/ws";
import { $auth, $conversationChat } from "@/store/subjects";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { createTerminal, disposeTerminal, refitTerminal, writeToTerminal } from "@/lib/terminal-bridge";
import { ShareTerminalPopup } from "./team-chat";

// Minimal projection of the manager's project shape — duplicated rather than
// imported from `../page` to keep the tab modules independent of the page.
interface ExtensionProject {
  id: string;
  name: string;
  dbUrl?: string;
  gitFolders?: string[];
  vpsInstances: {
    id: string;
    label: string;
    connection: { host: string };
    digitalocean?: { ipAddress: string };
  }[];
}

export interface TerminalTabDef {
  id: string;
  sessionId: string;
  label: string;
  exited: boolean;
  /** Server-side Claude launch (tmux `-c` + `claude`; no client inject). */
  claudeLaunch?: { resume?: boolean };
  /** Non-Claude command to inject after shell prompt (recipe terminals). */
  injectCommand?: string;
  /** If set, this is a shared terminal from another user */
  shared?: boolean;
  ownerId?: string;
  ownerName?: string;
  viewerIds?: string[];
  /** Floating window state */
  windowStatus: "open" | "minimized";
  windowPos?: { x: number; y: number };
  /** Per-window z-index for stacking order */
  windowZIndex?: number;
  /** Whether this window is the focused (top) window */
  focused?: boolean;
}


function SingleTerminal({
  project,
  sessionId,
  visible,
  onExit,
  claudeLaunch,
  injectCommand,
  shared,
  respawnNonce,
}: {
  project: ExtensionProject;
  sessionId: string;
  visible: boolean;
  onExit: () => void;
  claudeLaunch?: { resume?: boolean };
  injectCommand?: string;
  shared?: boolean;
  /** Bumped by the parent when the user confirms "Restart" — forces a full
   *  remount so a fresh spawn message goes to the manager (which by then has
   *  destroyed the dtach socket via terminal:restart). */
  respawnNonce?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const commandInjectedRef = useRef(false);

  const inst = project.vpsInstances[0];

  const instId = inst?.id;

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    if (!shared && !inst) return;
    mountedRef.current = true;

    createTerminal(containerRef.current, sessionId, ({ cols, rows }) => {
      if (shared) {
        wsSend("terminal:share:replay", { sessionId });
      } else if (inst) {
        wsSend("vps:terminal:spawn", {
          id: sessionId,
          projectId: project.id,
          instanceId: inst.id,
          cols,
          rows,
          kind: claudeLaunch ? "claude" : "shell",
          cwd: claudeLaunch ? GENIE_PROJECT_DIR : undefined,
          claudeResume: claudeLaunch?.resume,
        });
      }
    });

    function handleData(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.id === sessionId) {
        writeToTerminal(sessionId, detail.data);
        // Inject the command once we see a shell prompt ($ or #)
        if (injectCommand && !commandInjectedRef.current) {
          const text: string = detail.data;
          if (text.includes("$") || text.includes("#")) {
            commandInjectedRef.current = true;
            // Small delay to let the shell fully initialize
            setTimeout(() => {
              wsSend("terminal:data", { id: sessionId, data: `cd /opt/project 2>/dev/null; ${injectCommand}\n` });
            }, 100);
          }
        }
      }
    }
    function handleExit(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.id === sessionId) {
        writeToTerminal(sessionId, `\r\n[Session ended with code ${detail.code}]\r\n`);
        onExit();
      }
    }

    window.addEventListener("genie:terminal:data", handleData);
    window.addEventListener("genie:terminal:exit", handleExit);

    return () => {
      window.removeEventListener("genie:terminal:data", handleData);
      window.removeEventListener("genie:terminal:exit", handleExit);
      mountedRef.current = false;
      disposeTerminal(sessionId);
      if (!shared) {
        // For dtach-wrapped sessions this is a DETACH, not a destroy — the
        // manager keeps the inner process alive on the VM. To truly end the
        // session use the "Restart" button (sends terminal:restart instead).
        setTimeout(() => wsSend("terminal:close", { id: sessionId }), 0);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instId, project.id, sessionId, shared, claudeLaunch?.resume, respawnNonce]);

  return (
    <div className="h-full w-full bg-[#1e1e2e]" style={{ display: visible ? "block" : "none" }}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export const TERM_WIN_W = 600;
export const TERM_WIN_H = 400;
export const TERM_CASCADE = 20;

function OwnerAvatar({ ownerId }: { ownerId: string }) {
  const [cc] = useSubject($conversationChat);
  const owner = cc.users.find((u) => u.id === ownerId);
  if (!owner) return null;
  return (
    <div className="flex items-center gap-1" title={`Shared by ${owner.name}`}>
      {owner.avatarUrl ? (
        <img src={owner.avatarUrl} alt={owner.name} className="w-5 h-5 rounded-full border border-blue/40" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-blue/20 border border-blue/40 flex items-center justify-center text-blue" style={{ fontSize: 9 }}>
          {owner.name[0]?.toUpperCase()}
        </div>
      )}
      <span className="text-blue" style={{ fontSize: 11 }}>{owner.name}</span>
    </div>
  );
}

function ViewerAvatars({ viewerIds, sessionId }: { viewerIds: string[]; sessionId: string }) {
  const [cc] = useSubject($conversationChat);
  const [auth] = useSubject($auth);
  const { users } = cc;
  // Exclude the current user (owner) from viewer list
  const viewers = viewerIds
    .filter((id) => id !== auth.user?.id)
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean) as { id: string; name: string; avatarUrl?: string | null }[];

  if (viewers.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {viewers.map((v) => (
        <div key={v.id} className="group relative">
          {v.avatarUrl ? (
            <img src={v.avatarUrl} alt={v.name} className="w-5 h-5 rounded-full border border-blue/40" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-blue/20 border border-blue/40 flex items-center justify-center text-blue" style={{ fontSize: 9 }}>
              {v.name[0]?.toUpperCase()}
            </div>
          )}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex items-center gap-1 bg-crust border border-surface0 rounded px-1.5 py-1 whitespace-nowrap z-50 shadow-lg">
            <span className="text-text" style={{ fontSize: 11 }}>{v.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); wsSend("terminal:share:kick", { sessionId, userId: v.id }); }}
              className="text-overlay0 hover:text-red transition-colors ml-1"
              title="Remove from session"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FloatingTerminalWindow({
  tab,
  project,
  onClose,
  onMinimize,
  onFocus,
  onMarkExited,
  onUpdatePos,
  savedPos,
  zIndex,
}: {
  tab: TerminalTabDef;
  project: ExtensionProject;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onFocus: (id: string) => void;
  onMarkExited: (id: string) => void;
  onUpdatePos: (id: string, pos: { x: number; y: number }) => void;
  savedPos?: { x: number; y: number };
  zIndex: number;
}) {
  const [maximized, setMaximized] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  // "Resumed" pill — flashes for 3s when the manager confirms this open
  // attached to a live dtach socket. Driven by terminal:opened.
  const [resumedFlash, setResumedFlash] = useState(false);
  // Inline confirm row for the "Restart" action. Showing this swaps the title
  // bar for a small "End this session? [Cancel] [Restart]" affordance.
  const [restartConfirm, setRestartConfirm] = useState(false);
  // Bumps when the user confirms Restart — the inner SingleTerminal sees this
  // and re-issues its spawn with the same sessionId after the manager dtach
  // socket has been destroyed.
  const [respawnNonce, setRespawnNonce] = useState(0);

  useEffect(() => {
    function handleOpened(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.id !== tab.sessionId) return;
      if (detail.resumed) {
        setResumedFlash(true);
        const t = setTimeout(() => setResumedFlash(false), 3000);
        return () => clearTimeout(t);
      }
    }
    function handleRestarted(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.id !== tab.sessionId) return;
      // Trigger SingleTerminal to remount + respawn against the now-empty
      // socket.
      setRespawnNonce((n) => n + 1);
    }
    window.addEventListener("genie:terminal:opened", handleOpened);
    window.addEventListener("genie:terminal:restarted", handleRestarted);
    return () => {
      window.removeEventListener("genie:terminal:opened", handleOpened);
      window.removeEventListener("genie:terminal:restarted", handleRestarted);
    };
  }, [tab.sessionId]);

  const onConfirmRestart = useCallback(() => {
    setRestartConfirm(false);
    wsSend("terminal:restart", { id: tab.sessionId });
  }, [tab.sessionId]);

  const initial = useMemo(() => {
    if (savedPos) return savedPos;
    if (tab.windowPos) return tab.windowPos;
    const x = Math.max(20, Math.floor(window.innerWidth / 2 - TERM_WIN_W / 2));
    const y = Math.max(20, Math.floor(window.innerHeight / 2 - TERM_WIN_H / 2));
    return { x, y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnd = useCallback((pos: { x: number; y: number }) => {
    onUpdatePos(tab.id, pos);
  }, [tab.id, onUpdatePos]);

  const { elRef, onPointerDown } = useDraggable(initial, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, { w: TERM_WIN_W, h: TERM_WIN_H });

  // Refit terminal when restored from minimized or maximized toggled
  useEffect(() => {
    if (tab.windowStatus === "open") {
      setTimeout(() => refitTerminal(tab.sessionId), 50);
    }
  }, [tab.windowStatus, maximized, tab.sessionId]);

  const isVisible = tab.windowStatus === "open";

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex }
    : { left: initial.x, top: initial.y, width: TERM_WIN_W, height: TERM_WIN_H, zIndex };

  // Keep mounted when minimized (preserves xterm + PTY) but hide via CSS
  if (!isVisible) {
    containerStyle.visibility = "hidden";
    containerStyle.pointerEvents = "none";
    containerStyle.zIndex = -1;
  }

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle shadow-2xl shadow-black/50 flex flex-col ${maximized ? "rounded-none" : "rounded-xl"} overflow-hidden border ${tab.focused ? "border-mauve/60" : "border-surface0"}`}
      style={containerStyle}
      onPointerDown={() => onFocus(tab.id)}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0 bg-mantle"
        onPointerDown={(e) => { onFocus(tab.id); if (!maximized) onPointerDown(e); }}
      >
        <Terminal size={12} className={tab.exited ? "text-red" : tab.shared ? "text-blue" : (tab.claudeLaunch || tab.injectCommand) ? "text-mauve" : "text-green"} />
        <span className="text-md text-subtext0 font-medium truncate flex-1">{tab.label}</span>
        {resumedFlash && (
          <span
            className="px-1.5 py-0.5 rounded text-green bg-green/10 border border-green/30 transition-opacity duration-1000"
            style={{ fontSize: 10 }}
            title="Reattached to the live process on the VM"
          >
            ↻ Resumed
          </span>
        )}
        {tab.shared && tab.ownerId && (
          <OwnerAvatar ownerId={tab.ownerId} />
        )}
        {tab.viewerIds && tab.viewerIds.length > 0 && !tab.shared && (
          <ViewerAvatars viewerIds={tab.viewerIds} sessionId={tab.sessionId} />
        )}
        {!tab.exited && !tab.shared && !restartConfirm && (
          <button
            onClick={(e) => { e.stopPropagation(); setRestartConfirm(true); }}
            className="p-1 rounded text-overlay0 hover:text-yellow hover:bg-yellow/10 transition-colors"
            title={tab.claudeLaunch ? "Restart Claude (ends this conversation)" : "Restart shell"}
          >
            <RotateCcw size={12} />
          </button>
        )}
        {restartConfirm && (
          <div className="flex items-center gap-1.5">
            <span className="text-yellow" style={{ fontSize: 11 }}>
              {tab.claudeLaunch ? "End conversation?" : "Restart shell?"}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setRestartConfirm(false); }}
              className="px-1.5 py-0.5 rounded text-overlay1 hover:text-text hover:bg-surface0 transition-colors"
              style={{ fontSize: 11 }}
            >
              Cancel
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onConfirmRestart(); }}
              className="px-1.5 py-0.5 rounded text-yellow bg-yellow/10 hover:bg-yellow/20 transition-colors"
              style={{ fontSize: 11 }}
            >
              Restart
            </button>
          </div>
        )}
        {!tab.exited && !tab.shared && !restartConfirm && (
          <div className="relative">
            <button
              onClick={() => setSharingOpen((v) => !v)}
              className={`p-1 rounded transition-colors ${sharingOpen ? "text-blue bg-surface0" : "text-overlay0 hover:text-text hover:bg-surface0"}`}
              title="Share terminal"
            >
              <Share2 size={12} />
            </button>
            {sharingOpen && (
              <ShareTerminalPopup sessionId={tab.sessionId} onClose={() => setSharingOpen(false)} />
            )}
          </div>
        )}
        <button onClick={() => onMinimize(tab.id)} className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors" title="Minimize">
          <Minus size={12} />
        </button>
        <button onClick={() => setMaximized((v) => !v)} className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors" title={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
        <button onClick={() => onClose(tab.id)} className="p-1 rounded text-overlay0 hover:text-red hover:bg-red/10 transition-colors" title="Close">
          <X size={12} />
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0">
        <SingleTerminal
          project={project}
          sessionId={tab.sessionId}
          visible={true}
          onExit={() => onMarkExited(tab.id)}
          claudeLaunch={tab.claudeLaunch}
          injectCommand={tab.injectCommand}
          shared={tab.shared}
          respawnNonce={respawnNonce}
        />
      </div>

      {/* Resize handle */}
      {!maximized && (
        <div
          onPointerDown={onResizePointerDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ touchAction: "none" }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="text-overlay0/50">
            <path d="M14 14L8 14L14 8Z" fill="currentColor" />
            <path d="M14 14L11 14L14 11Z" fill="currentColor" opacity="0.5" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Terminal list panel shown in the Terminal tab — lists all floating terminal windows */
export function TerminalListPanel({
  tabs,
  onAddTab,
  onRestore,
  onClose,
}: {
  tabs: TerminalTabDef[];
  onAddTab: () => void;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <Terminal size={13} className="text-mauve" />
        <span className="text-text font-medium" style={{ fontSize: 13 }}>Terminal Windows</span>
        <div className="flex-1" />
        <button
          onClick={onAddTab}
          className="flex items-center gap-1 px-2 py-1 rounded text-md text-mauve hover:bg-mauve/10 transition-colors"
        >
          <Plus size={13} />
          New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 gap-1.5 flex flex-col">
        {tabs.length === 0 && (
          <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>
            No terminals open. Click "New" to create one.
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex items-center gap-2 px-3 py-2 bg-mantle rounded-lg border border-surface0 hover:border-surface1 transition-colors"
          >
            <Terminal size={13} className={tab.exited ? "text-red" : tab.shared ? "text-blue" : (tab.claudeLaunch || tab.injectCommand) ? "text-mauve" : "text-green"} />
            <span className="flex-1 text-text truncate" style={{ fontSize: 13 }}>{tab.label}</span>
            {tab.exited && <span className="text-red" style={{ fontSize: 11 }}>exited</span>}
            {tab.windowStatus === "minimized" && (
              <button
                onClick={() => onRestore(tab.id)}
                className="px-2 py-0.5 rounded text-md text-blue hover:bg-blue/10 transition-colors"
              >
                Restore
              </button>
            )}
            {tab.windowStatus === "open" && (
              <button
                onClick={() => onRestore(tab.id)}
                className="px-2 py-0.5 rounded text-md text-green hover:bg-green/10 transition-colors"
              >
                Focus
              </button>
            )}
            <button
              onClick={() => onClose(tab.id)}
              className="p-1 rounded text-overlay0 hover:text-red hover:bg-red/10 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
