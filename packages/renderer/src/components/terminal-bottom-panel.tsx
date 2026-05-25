"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSubject } from "subjecto/react";
import { ChevronDown, ChevronUp, Plus, X, Share2, Users } from "lucide-react";
import type { ChatUser, NavKey, TerminalTab } from "@/store/types";
import { $activeNav, $auth, $conversationChat, $terminal } from "@/store/subjects";
import { addTerminalTab, leaveSharedTerminal, removeTerminalTab, setTerminalBottomPanelHeight, shareTerminal, switchTerminalTab, toggleTerminalBottomPanel } from "@/store/actions";
import {
  createTerminal,
  disposeTerminal,
  hasTerminal,
  reattachTerminal,
  writeToTerminal,
  focusTerminal,
  refitTerminal,
} from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function TerminalBottomPanel() {
  const [terminal] = useSubject($terminal);
  const { bottomPanelOpen, bottomPanelHeight, tabs, activeTabId } = terminal;
  const [activeNav] = useSubject($activeNav);
  const [conversationChat] = useSubject($conversationChat);
  const chatUsers = conversationChat.users as ChatUser[];
  const [auth] = useSubject($auth);
  const authUserId = (auth.user as { id: string } | null)?.id;

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const mountedIds = useRef<Set<string>>(new Set());
  const dragging = useRef(false);
  const prevViewerIdsRef = useRef<Map<string, string[]>>(new Map());

  const [shareDropdownTab, setShareDropdownTab] = useState<string | null>(null);

  // Build a lookup from userId -> ChatUser
  const userMap = useMemo(() => {
    const map = new Map<string, ChatUser>();
    for (const u of chatUsers) map.set(u.id, u);
    return map;
  }, [chatUsers]);

  // Auto-hide when full terminal tab is active
  const hidden = activeNav === "terminal";

  // --- Drag-to-resize ---
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const startY = e.clientY;
      const startHeight = bottomPanelHeight;

      function onMouseMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const newHeight = startHeight + (startY - ev.clientY);
        setTerminalBottomPanelHeight(newHeight);
      }

      function onMouseUp() {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [bottomPanelHeight]
  );

  // --- Route incoming data to the right terminal instance ---
  const handleData = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    writeToTerminal(detail.id, detail.data);
  }, []);

  const handleExit = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    writeToTerminal(detail.id, `\r\n[Process exited with code ${detail.code}]\r\n`);
  }, []);

  // Register window event listeners (persistent — never dispose terminals on re-render)
  useEffect(() => {
    window.addEventListener("genie:terminal:data", handleData);
    window.addEventListener("genie:terminal:exit", handleExit);
    return () => {
      window.removeEventListener("genie:terminal:data", handleData);
      window.removeEventListener("genie:terminal:exit", handleExit);
    };
  }, [handleData, handleExit]);

  // Auto-create first tab only when user explicitly opens the panel (not after closing last tab)
  const panelWasOpened = useRef(false);
  useEffect(() => {
    if (bottomPanelOpen && !hidden && tabs.length === 0 && !panelWasOpened.current) {
      panelWasOpened.current = true;
      addTerminalTab();
    }
    if (!bottomPanelOpen) {
      panelWasOpened.current = false;
    }
  }, [bottomPanelOpen, hidden, tabs.length]);

  // Initialize terminal for new tabs
  useEffect(() => {
    if (!bottomPanelOpen || hidden) return;

    for (const tab of tabs) {
      if (mountedIds.current.has(tab.id)) continue;
      const container = containerRefs.current.get(tab.id);
      if (!container) continue;

      mountedIds.current.add(tab.id);

      // If terminal already exists (component remounted), reattach to new container
      if (hasTerminal(tab.id)) {
        reattachTerminal(tab.id, container);
        continue;
      }

      const term = createTerminal(container, tab.id);
      // Only spawn for fresh (non-shared, non-restored) tabs
      const isRestored = !!(tab.viewerIds && tab.viewerIds.length > 0);
      if (!tab.shared && !isRestored) {
        if (tab.reattach) {
          // Persisted server-side session: ask the manager to reattach by id.
          // The manager looks up the row and spawns SSH+tmux against the right host.
          wsSend("terminal:reattach", { id: tab.id, cols: term.cols, rows: term.rows });
        } else if (tab.ssh) {
          wsSend("terminal:ssh:spawn", {
            id: tab.id,
            cols: term.cols,
            rows: term.rows,
            host: tab.ssh.host,
            port: tab.ssh.port,
            username: tab.ssh.username,
            privateKeyPath: tab.ssh.privateKeyPath,
            title: tab.title,
            command: tab.command,
            ...(tab.ssh.bastion ? { bastion: tab.ssh.bastion } : {}),
          });
          if (tab.command) {
            const cmdToSend = tab.command;
            const tabId = tab.id;
            const onData = (e: Event) => {
              const detail = (e as CustomEvent).detail;
              if (detail?.id === tabId) {
                window.removeEventListener("genie:terminal:data", onData);
                setTimeout(() => wsSend("terminal:data", { id: tabId, data: cmdToSend + "\n" }), 300);
              }
            };
            window.addEventListener("genie:terminal:data", onData);
          }
        } else {
          wsSend("terminal:spawn", {
            id: tab.id,
            cols: term.cols,
            rows: term.rows,
            command: tab.command,
            cwd: tab.cwd,
          });
        }
      }
    }
  }, [tabs, bottomPanelOpen, hidden]);

  // Refit + focus when switching active tab
  useEffect(() => {
    if (!activeTabId || !bottomPanelOpen || hidden) return;
    requestAnimationFrame(() => {
      refitTerminal(activeTabId);
      focusTerminal(activeTabId);
    });
  }, [activeTabId, bottomPanelOpen, hidden]);

  const handleAddTab = () => {
    addTerminalTab();
  };

  const handleCloseTab = (tab: TerminalTab, e: React.MouseEvent) => {
    e.stopPropagation();
    mountedIds.current.delete(tab.id);
    containerRefs.current.delete(tab.id);
    disposeTerminal(tab.id);
    if (tab.shared) {
      leaveSharedTerminal(tab.id);
    } else {
      wsSend("terminal:close", { id: tab.id });
      removeTerminalTab(tab.id);
    }
  };

  const setContainerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      containerRefs.current.set(id, el);
    }
  }, []);

  // Detect viewer join/leave and write notification into the terminal
  useEffect(() => {
    for (const tab of tabs) {
      const currentViewers = tab.viewerIds || [];
      const prevViewers = prevViewerIdsRef.current.get(tab.id) || [];

      if (currentViewers.length === 0 && prevViewers.length === 0) continue;
      if (JSON.stringify(currentViewers) === JSON.stringify(prevViewers)) continue;

      // Find who joined / left
      const joined = currentViewers.filter((id) => !prevViewers.includes(id) && id !== authUserId);
      const left = prevViewers.filter((id) => !currentViewers.includes(id) && id !== authUserId);

      for (const uid of joined) {
        const name = userMap.get(uid)?.name || "Someone";
        writeToTerminal(tab.id, `\r\n\x1b[36m● ${name} joined the terminal session\x1b[0m\r\n`);
      }
      for (const uid of left) {
        const name = userMap.get(uid)?.name || "Someone";
        writeToTerminal(tab.id, `\r\n\x1b[33m○ ${name} left the terminal session\x1b[0m\r\n`);
      }

      prevViewerIdsRef.current.set(tab.id, [...currentViewers]);
    }
  }, [tabs, authUserId, userMap]);

  // Close share dropdown on click outside
  useEffect(() => {
    if (!shareDropdownTab) return;
    const close = () => setShareDropdownTab(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [shareDropdownTab]);

  if (hidden) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const onlineUsers = chatUsers.filter((u) => u.online && u.id !== authUserId && !u.isAgent);

  return (
    <div className="shrink-0 border-t border-surface0 flex flex-col">
      {/* Drag-to-resize handle */}
      {bottomPanelOpen && (
        <div
          className="h-1 cursor-row-resize hover:bg-mauve/40 active:bg-mauve/60"
          onMouseDown={handleResizeMouseDown}
        />
      )}

      {/* Toggle header + tab bar */}
      <div className="flex items-center bg-mantle border-b border-surface0">
        <button
          onClick={toggleTerminalBottomPanel}
          className="flex items-center gap-2 px-4 py-1.5 bg-transparent border-none cursor-pointer hover:bg-surface0/50 transition-colors duration-150"
        >
          <span className="text-md font-semibold uppercase tracking-wide text-subtext0">
            Terminal
          </span>
          {bottomPanelOpen ? (
            <ChevronDown size={14} className="text-overlay0" />
          ) : (
            <ChevronUp size={14} className="text-overlay0" />
          )}
        </button>

        {bottomPanelOpen && (
          <>
            <div className="flex items-center gap-0 ml-2 border-b border-surface0 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => switchTerminalTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-md font-medium border-b-2 transition-colors cursor-pointer",
                    "bg-transparent shrink-0",
                    tab.id === activeTabId
                      ? "border-blue text-text"
                      : "border-transparent text-overlay0 hover:text-subtext0"
                  )}
                >
                  <span>{tab.title}</span>
                  {(tab.shared || (tab.viewerIds && tab.viewerIds.length > 1)) && (
                    <span className="px-1 py-0 text-md bg-blue/20 text-blue rounded">Shared</span>
                  )}
                  {tab.viewerIds && tab.viewerIds.length > 1 && (
                    <div className="flex items-center -space-x-1 ml-0.5">
                      {tab.viewerIds.filter((id) => id !== authUserId).slice(0, 3).map((uid) => {
                        const user = userMap.get(uid);
                        return (
                          <div key={uid} className="w-4 h-4 rounded-full border border-surface0 bg-surface1 flex items-center justify-center shrink-0 overflow-hidden">
                            {user?.avatarUrl ? (
                              <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="text-[7px] font-medium text-subtext0">{user?.name?.[0]?.toUpperCase() || "?"}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <span
                    onClick={(e) => handleCloseTab(tab, e)}
                    className="hover:bg-surface1 rounded p-0.5 transition-colors"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
              <button
                onClick={handleAddTab}
                className="flex items-center justify-center w-6 h-6 ml-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text shrink-0"
                title="New terminal"
              >
                <Plus size={14} />
              </button>
            </div>
            {/* Share button for owned (non-shared) active tab */}
            {activeTab && !activeTab.shared && (
              <div className="relative ml-1 mr-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareDropdownTab(shareDropdownTab === activeTab.id ? null : activeTab.id);
                  }}
                  className="flex items-center justify-center w-6 h-6 bg-transparent border-none cursor-pointer text-subtext0 hover:text-text hover:bg-surface0/50 rounded transition-colors duration-150"
                  title="Share terminal"
                >
                  <Share2 size={13} />
                </button>
                {shareDropdownTab === activeTab.id && onlineUsers.length > 0 && (
                  <div className="absolute top-full right-0 mt-1 bg-mantle border border-surface0 rounded-md shadow-lg z-30 min-w-[160px] py-1">
                    <p className="px-3 py-1 text-md text-overlay0 font-medium">Share with:</p>
                    {onlineUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          shareTerminal(activeTab.id, u.id);
                          setShareDropdownTab(null);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-md bg-transparent border-none cursor-pointer text-subtext0 hover:bg-surface0 hover:text-text transition-colors"
                      >
                        <div className="w-4 h-4 rounded-full bg-surface1 flex items-center justify-center shrink-0 overflow-hidden">
                          {u.avatarUrl ? (
                            <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="text-[8px] font-medium text-subtext0">{u.name[0]?.toUpperCase()}</span>
                          )}
                        </div>
                        <span>{u.name}</span>
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green" />
                      </button>
                    ))}
                    {onlineUsers.length === 0 && (
                      <p className="px-3 py-1.5 text-md text-overlay0">No users online</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Terminal containers — one per tab, only active is visible */}
      {bottomPanelOpen && (
        <div className="relative overflow-hidden bg-crust" style={{ height: bottomPanelHeight }}>
          {/* Shared session banner */}
          {activeTab && activeTab.viewerIds && activeTab.viewerIds.length > 1 && (
            <SharedSessionBar
              viewerIds={activeTab.viewerIds}
              ownerId={activeTab.ownerId}
              authUserId={authUserId}
              userMap={userMap}
              isShared={!!activeTab.shared}
            />
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              ref={(el) => setContainerRef(tab.id, el)}
              className="absolute inset-0"
              style={{
                display: tab.id === activeTabId ? "block" : "none",
                top: activeTab?.viewerIds && activeTab.viewerIds.length > 1 && tab.id === activeTabId ? 28 : 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SharedSessionBar({
  viewerIds,
  ownerId,
  authUserId,
  userMap,
  isShared,
}: {
  viewerIds: string[];
  ownerId?: string;
  authUserId?: string;
  userMap: Map<string, ChatUser>;
  isShared: boolean;
}) {
  // Show all participants — put yourself first
  const sorted = [...viewerIds].sort((a, b) => {
    if (a === authUserId) return -1;
    if (b === authUserId) return 1;
    if (a === ownerId) return -1;
    if (b === ownerId) return 1;
    return 0;
  });

  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-1 bg-surface0/90 border-b border-surface1 backdrop-blur-sm">
      <Share2 size={11} className="text-blue shrink-0" />
      <span className="text-md text-subtext0">
        {isShared ? "Shared session" : "Sharing"}
      </span>
      <div className="flex items-center gap-0.5">
        {sorted.map((uid) => {
          const user = userMap.get(uid);
          const isYou = uid === authUserId;
          const isOwner = uid === ownerId;
          return (
            <Tooltip key={uid}>
              <TooltipTrigger asChild>
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 overflow-hidden cursor-default",
                  isYou ? "border-blue" : "border-surface0",
                  isOwner ? "bg-blue/20" : "bg-surface1"
                )}>
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="text-[8px] font-medium text-subtext0">
                      {user?.name?.[0]?.toUpperCase() || "?"}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="text-md">
                  {user?.name || "Unknown"}
                  {isYou ? " (you)" : ""}
                  {isOwner && !isYou ? " (owner)" : ""}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <span className="text-md text-overlay0 ml-auto">
        {viewerIds.length} connected
      </span>
    </div>
  );
}
