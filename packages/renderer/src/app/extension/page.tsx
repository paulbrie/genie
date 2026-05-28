"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Send, Square, Globe, Wrench, ChevronDown, ChevronRight, MessageSquare, FolderOpen, Terminal, Container, File, Folder, ArrowLeft, Save, RefreshCw, Loader2, Play, TerminalSquare, Plus, X, Users, Bot, Share2, Minus, Maximize2, Minimize2, Database, Table2, SearchCode, GitBranch, GitCommit, ArrowUp, ArrowDown, Check, Circle, FilePlus, FileEdit, FileX, FileQuestion, Copy, ExternalLink, LogOut, Trash2, Lightbulb, ClipboardList, History } from "lucide-react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AuthState, ChatMessage, ChatSessionSummary, ChatUser, ConversationMessage as ConvMessage, ConversationSummary, ProjectDef, StreamingStep, TerminalShareInvite, ToolUse, VpsDeployState } from "@/store/types";
import { $auth, $chat, $commandRunOutputs, $conversationChat, $projects, $terminal, $vpsDeploy } from "@/store/subjects";
import type { ChatModelId } from "@/store/actions";
import { CHAT_MODELS, acceptTerminalShare, createGenieDm, createRoom, createTrackerIssue, declineTerminalShare, deleteChatSession, fetchVpsStats, leaveSharedTerminal, loadChatSession, loadChatSessions, loadChatUsers, loadConversations, newChat, renameChatSession, runProjectCommand, selectConversation, sendConversationMessage, setChatModel, setTrackerProject, shareTerminal, stopProjectCommand, unwatchVpsStats, watchVpsStats } from "@/store/actions";
import dynamic from "next/dynamic";
import type { BeforeMount } from "@monaco-editor/react";
import { connectWs, setManagerRunning, wsSend, wsRequest, triggerGoogleLogin, logout, getWsUrl, isWsConnected } from "@/lib/ws";
import { markdownComponents } from "@/components/ui/markdown-link";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { DbExplorer } from "./tabs/db";
import { GitPanel } from "./tabs/git";
import { FileExplorer } from "./tabs/files";
import { DockerLogs } from "./tabs/docker";
import { ExtCommandsTab } from "./tabs/commands";
import { ExtTrackerTab } from "./tabs/tracker";
import { ExtTeamChat, ShareTerminalPopup, ShareInviteBanner } from "./tabs/team-chat";
import { FloatingTerminalWindow, TerminalListPanel, type TerminalTabDef, TERM_WIN_W, TERM_WIN_H, TERM_CASCADE } from "./tabs/terminal";


function relativeTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ClaudeLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -.01 39.5 39.53" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z" fill="currentColor"/>
    </svg>
  );
}

function ClaudeTabButton({ icon, openClaudeTerminal }: { icon: React.ReactNode; openClaudeTerminal: (title: string, resume?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        onClick={() => openClaudeTerminal("Claude")}
        className="flex items-center gap-1.5 px-3 py-2 transition-colors text-overlay1 hover:text-text"
        style={{ fontSize: 13 }}
      >
        {icon}
        Claude
      </button>
      <button
        onClick={() => setOpen(!open)}
        className="text-overlay1 hover:text-text bg-transparent border-none cursor-pointer p-0 pr-1 -ml-2"
      >
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 bg-mantle border border-surface0 rounded-lg shadow-lg py-1 min-w-[130px] z-50">
          <button
            onClick={() => { openClaudeTerminal("Claude"); setOpen(false); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-text hover:bg-surface0 transition-colors text-left"
            style={{ fontSize: 12 }}
          >
            <Play size={11} className="text-green" />
            New
          </button>
          <button
            onClick={() => { openClaudeTerminal("Claude (resume)", true); setOpen(false); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-text hover:bg-surface0 transition-colors text-left"
            style={{ fontSize: 12 }}
          >
            <History size={11} className="text-blue" />
            Resume
          </button>
        </div>
      )}
    </div>
  );
}

import { UsageLine } from "@/components/ui/usage-line";
import { LoginScreen } from "@/components/ui/login-screen";
import { DropletInstanceBar } from "@/components/project/droplet-instance-bar";
import { TrackerPanel } from "@/components/project/tracker-panel";
import { createTerminal, disposeTerminal, writeToTerminal, refitTerminal, focusTerminal } from "@/lib/terminal-bridge";

// --- postMessage protocol types ---

interface GenieInitMessage {
  type: "genie:init";
  project: ExtensionProject | null;
  tabUrl: string;
  snapshot: string;
}

interface GenieContextUpdate {
  type: "genie:context-update";
  project: ExtensionProject | null;
  tabUrl: string;
}

interface GenieSnapshotResult {
  type: "genie:snapshot-result";
  snapshot: string;
}

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

type ParentMessage = GenieInitMessage | GenieContextUpdate | GenieSnapshotResult;

type ExtTab = "chat" | "team" | "commands" | "files" | "terminal" | "docker" | "database" | "git" | "tracker";

// --- File tree types ---

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedMs: number;
}

interface DockerContainer {
  name: string;
  status: string;
  logs: string;
}

// --- Tool pill ---

function ToolPill({ tool, active }: { tool: ToolUse; active?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 bg-surface1/50 hover:bg-surface1 rounded-md text-overlay1 transition-colors ${active ? "animate-pulse" : ""}`}
        style={{ fontSize: 11 }}
      >
        <Wrench size={10} className="text-mauve" />
        <span>{tool.name}</span>
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>
      {expanded && (
        <div className="mt-1 p-2 bg-mantle rounded-md text-subtext0 overflow-x-auto w-full" style={{ fontSize: 11 }}>
          <div className="text-overlay0 mb-1">Input: {JSON.stringify(tool.input)}</div>
          <pre className="whitespace-pre-wrap break-words">{tool.result.slice(0, 1000)}</pre>
        </div>
      )}
    </span>
  );
}

// --- Context menu ---


// --- File Explorer ---






// --- Database Explorer Tab ---


// --- Feedback button ---

function FeedbackButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    createTrackerIssue({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      status: "backlog",
      priority: "medium",
    });
    setTitle("");
    setDescription("");
    setSubmitted(true);
    setTimeout(() => { setSubmitted(false); setOpen(false); }, 1500);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); setSubmitted(false); }}
        className="p-1.5 text-overlay0 hover:text-peach transition-colors rounded-lg hover:bg-surface0"
        title="Send feedback"
      >
        <Lightbulb size={14} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-64 bg-mantle border border-surface1 rounded-lg shadow-lg p-3 z-50">
          {submitted ? (
            <div className="flex items-center gap-2 text-green py-2" style={{ fontSize: 13 }}>
              <Check size={14} />
              Feedback sent!
            </div>
          ) : (
            <>
              <p className="text-subtext0 font-medium mb-2" style={{ fontSize: 13 }}>Improvement request</p>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Title"
                className="w-full bg-base text-text px-2 py-1.5 rounded border border-surface1 outline-none focus:border-mauve/50 mb-2"
                style={{ fontSize: 13 }}
                spellCheck={false}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full bg-base text-text px-2 py-1.5 rounded border border-surface1 outline-none focus:border-mauve/50 mb-2 resize-none"
                style={{ fontSize: 13 }}
                rows={3}
                spellCheck={false}
              />
              <div className="flex justify-end">
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-mauve/20 text-mauve hover:bg-mauve/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ fontSize: 13 }}
                >
                  <Send size={12} />
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Droplet picker (when no project is matched by URL) ---

function DropletPicker({
  projects,
  hostname,
  isInIframe,
  onSelectProject,
  user,
}: {
  projects: ProjectDef[];
  hostname: string;
  isInIframe: boolean;
  onSelectProject: (projectId: string) => void;
  user: { name: string; avatarUrl: string | null } | null;
}) {
  const vpsState = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const dropletsWithVps = projects.filter((p) => p.vpsInstances.length > 0);
  const projectsWithoutVps = projects.filter((p) => p.vpsInstances.length === 0);
  const dropletKey = dropletsWithVps.map((p) => p.id).join(",");

  // Persistent stats streams for all VPS instances while this view is open
  useEffect(() => {
    for (const p of dropletsWithVps) {
      for (const inst of p.vpsInstances) {
        watchVpsStats(p.id, inst.id);
      }
    }
    return () => {
      for (const p of dropletsWithVps) {
        for (const inst of p.vpsInstances) {
          unwatchVpsStats(p.id, inst.id);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropletKey]);

  const navigateToUrl = (url: string, projectId: string) => {
    if (isInIframe) {
      window.parent.postMessage({ type: "genie:navigate", url }, "*");
      onSelectProject(projectId);
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-base">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 bg-mantle shrink-0" style={{ fontSize: 13 }}>
        <Globe size={13} className="text-mauve shrink-0" />
        <span className="text-mauve font-medium">Genie</span>
        {hostname && <span className="text-overlay0 truncate" style={{ fontSize: 12 }}>· {hostname}</span>}
        {user && (
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <div className="w-5 h-5 rounded-full overflow-hidden bg-surface1 shrink-0">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xs font-medium text-subtext0">
                  {user.name[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <button
              onClick={logout}
              className="text-overlay0 hover:text-red transition-colors"
              title="Sign out"
            >
              <LogOut size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="text-subtext0 mb-1" style={{ fontSize: 13 }}>
          This page is not a Genie droplet.
        </p>
        <p className="text-overlay0 mb-3" style={{ fontSize: 13 }}>
          Select a droplet to navigate to:
        </p>
        <div className="flex flex-col gap-2">
          {dropletsWithVps.map((p) => {
            const inst = p.vpsInstances[0];
            const ip = inst?.digitalocean?.ipAddress || inst?.connection.host || null;
            const instanceState = vpsState.instances[inst.id] || null;
            const stats = instanceState?.stats ?? null;
            const statsError = instanceState?.statsError ?? null;
            return (
              <div key={p.id} className="bg-mantle rounded-lg px-3 py-2 cursor-pointer hover:bg-surface0/50 transition-colors" onClick={() => onSelectProject(p.id)}>
                <DropletInstanceBar
                  name={p.name}
                  status={statsError ? "unreachable" : stats ? "active" : "checking"}
                  ip={ip}
                  region={inst?.digitalocean?.region}
                  sizeSlug={inst?.digitalocean?.size ?? inst?.tazcloud?.size}
                  provider={inst?.tazcloud ? "tazcloud" : "digitalocean"}
                  stats={stats}
                  statsLoading={!stats && !statsError}
                  statsError={statsError}
                  onRefresh={() => fetchVpsStats(p.id, inst.id)}
                  onNavigate={(url) => navigateToUrl(url, p.id)}
                  compact
                />
              </div>
            );
          })}
          {projectsWithoutVps.length > 0 && (
            <>
              <p className="text-overlay0 mt-2 mb-1" style={{ fontSize: 12 }}>Projects without droplets:</p>
              {projectsWithoutVps.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectProject(p.id)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-surface0/50 bg-mantle/50 hover:border-surface1 hover:bg-surface0/50 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface0 flex items-center justify-center shrink-0">
                    <FolderOpen size={14} className="text-overlay0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-subtext0 font-medium truncate" style={{ fontSize: 13 }}>{p.name}</div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main extension page ---

export default function ExtensionPage() {
  const [auth] = useSubject($auth);
  const authStatus = auth.status;
  const [chat] = useSubject($chat);
  const [convChat] = useSubject($conversationChat);
  const [termState] = useSubject($terminal);
  const [storeProjects] = useSubject($projects);
  const chatMessages = chat.messages;
  const streamingContent = chat.streamingContent;
  const chatLoading = chat.loading;
  const toolUses = chat.toolUses;
  const streamingSteps = chat.streamingSteps;
  const statusText = chat.statusText;
  const chatModelId = chat.modelId;
  const maxToolRounds = chat.maxToolRounds;
  const toolRoundsUsed = chat.toolRoundsUsed;
  const claudeInfo = chat.claudeInfo;
  const chatSessions = chat.sessions;
  const sessionsLoading = chat.sessionsLoading;
  const activeSessionId = chat.activeSessionId;
  const resumedFrom = chat.resumedFrom;

  const [showHistory, setShowHistory] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [activeTab, setActiveTab] = useState<ExtTab>("chat");
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Terminal tabs state (lifted so commands can open terminal tabs)
  const [termTabs, setTermTabs] = useState<TerminalTabDef[]>([]);
  const termNumRef = useRef(1);
  const termZIndexRef = useRef(1000);

  const addTermTab = useCallback(() => {
    const id = crypto.randomUUID();
    const num = termNumRef.current++;
    // Cascade position based on existing open windows
    const openCount = termTabs.filter((t) => t.windowStatus === "open").length;
    const x = Math.max(20, Math.floor(window.innerWidth / 2 - TERM_WIN_W / 2) + openCount * TERM_CASCADE);
    const y = Math.max(20, Math.floor(window.innerHeight / 2 - TERM_WIN_H / 2) + openCount * TERM_CASCADE);
    const z = ++termZIndexRef.current;
    const tab: TerminalTabDef = { id, sessionId: id, label: `Terminal ${num}`, exited: false, windowStatus: "open", windowPos: { x, y }, windowZIndex: z, focused: true };
    setTermTabs((prev) => [...prev.map((t) => ({ ...t, focused: false })), tab]);
  }, [termTabs]);

  const closeTermTab = useCallback((tabId: string) => {
    setTermTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab?.shared) {
        setTimeout(() => wsSend("terminal:share:leave", { sessionId: tab.sessionId }), 0);
      }
      return prev.filter((t) => t.id !== tabId);
    });
  }, []);

  const minimizeTermTab = useCallback((tabId: string) => {
    setTermTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, windowStatus: "minimized" as const, focused: false } : t)));
  }, []);

  const restoreTermTab = useCallback((tabId: string) => {
    const z = ++termZIndexRef.current;
    setTermTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, windowStatus: "open" as const, windowZIndex: z, focused: true } : { ...t, focused: false })));
  }, []);

  const focusTermTab = useCallback((tabId: string) => {
    setTermTabs((prev) => {
      const target = prev.find((t) => t.id === tabId);
      if (target?.focused) return prev; // already focused
      const z = ++termZIndexRef.current;
      return prev.map((t) => (t.id === tabId ? { ...t, windowZIndex: z, focused: true } : { ...t, focused: false }));
    });
  }, []);

  // Store positions in a ref to avoid re-renders on drag
  const termPosRef = useRef<Record<string, { x: number; y: number }>>({});
  const updateTermPos = useCallback((tabId: string, pos: { x: number; y: number }) => {
    termPosRef.current[tabId] = pos;
  }, []);

  const markTermExited = useCallback((tabId: string) => {
    setTermTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, exited: true } : t)));
  }, []);

  /** Open Claude Code on the project VPS (server-side tmux launch). */
  const openClaudeTerminal = useCallback((label: string, resume?: boolean) => {
    const id = crypto.randomUUID();
    const num = termNumRef.current++;
    const openCount = termTabs.filter((t) => t.windowStatus === "open").length;
    const x = Math.max(20, Math.floor(window.innerWidth / 2 - TERM_WIN_W / 2) + openCount * TERM_CASCADE);
    const y = Math.max(20, Math.floor(window.innerHeight / 2 - TERM_WIN_H / 2) + openCount * TERM_CASCADE);
    const z = ++termZIndexRef.current;
    const tab: TerminalTabDef = {
      id, sessionId: id, label: label || `Claude ${num}`, exited: false,
      claudeLaunch: { resume }, windowStatus: "open", windowPos: { x, y }, windowZIndex: z, focused: true,
    };
    setTermTabs((prev) => [...prev.map((t) => ({ ...t, focused: false })), tab]);
  }, [termTabs]);

  /** Open a shell terminal that injects a recipe command after connect. */
  const openCommandTerminal = useCallback((commandName: string, command: string) => {
    const id = crypto.randomUUID();
    const num = termNumRef.current++;
    const openCount = termTabs.filter((t) => t.windowStatus === "open").length;
    const x = Math.max(20, Math.floor(window.innerWidth / 2 - TERM_WIN_W / 2) + openCount * TERM_CASCADE);
    const y = Math.max(20, Math.floor(window.innerHeight / 2 - TERM_WIN_H / 2) + openCount * TERM_CASCADE);
    const z = ++termZIndexRef.current;
    const tab: TerminalTabDef = { id, sessionId: id, label: commandName || `Terminal ${num}`, exited: false, injectCommand: command, windowStatus: "open", windowPos: { x, y }, windowZIndex: z, focused: true };
    setTermTabs((prev) => [...prev.map((t) => ({ ...t, focused: false })), tab]);
  }, [termTabs]);

  // Listen for project:command:terminal events to open terminal tabs
  useEffect(() => {
    function handleCmdTerminal(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.commandName && detail?.command) {
        const cmd = String(detail.command);
        if (cmd.trim().startsWith("claude")) {
          openClaudeTerminal(detail.commandName, cmd.includes("--resume"));
        } else {
          openCommandTerminal(detail.commandName, cmd);
        }
      }
    }
    function handleShareViewers(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId) {
        setTermTabs((prev) => prev.map((t) =>
          t.sessionId === detail.sessionId ? { ...t, viewerIds: detail.viewerIds } : t
        ));
      }
    }
    function handleKicked(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId) {
        setTermTabs((prev) => prev.filter((t) => t.sessionId !== detail.sessionId));
      }
    }
    function handleScrollback(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId && detail?.scrollback) {
        writeToTerminal(detail.sessionId, detail.scrollback);
      }
    }
    window.addEventListener("genie:command:terminal", handleCmdTerminal);
    window.addEventListener("genie:terminal:share:viewers", handleShareViewers);
    window.addEventListener("genie:terminal:share:kicked", handleKicked);
    window.addEventListener("genie:terminal:scrollback", handleScrollback);
    return () => {
      window.removeEventListener("genie:command:terminal", handleCmdTerminal);
      window.removeEventListener("genie:terminal:share:viewers", handleShareViewers);
      window.removeEventListener("genie:terminal:share:kicked", handleKicked);
      window.removeEventListener("genie:terminal:scrollback", handleScrollback);
    };
  }, [openClaudeTerminal, openCommandTerminal]);

  // Extension context from parent iframe
  const extensionCtx = useRef<{
    project: ExtensionProject | null;
    tabUrl: string;
    snapshot: string;
  }>({ project: null, tabUrl: "", snapshot: "" });
  const [projectState, setProjectState] = useState<ExtensionProject | null>(null);
  const [tabUrlState, setTabUrlState] = useState("");
  const [manualProjectId, setManualProjectId] = useState<string | null>(null);

  // Pending snapshot request resolver
  const snapshotResolver = useRef<((snapshot: string) => void) | null>(null);
  const isInIframe = useRef(typeof window !== "undefined" && window.parent !== window);

  // Connect WS on mount
  useEffect(() => {
    setManagerRunning(true);
    connectWs();
  }, []);

  // Listen for postMessage from parent (chrome extension bridge)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as ParentMessage;
      if (!data?.type?.startsWith("genie:")) return;

      switch (data.type) {
        case "genie:init":
          extensionCtx.current = {
            project: data.project,
            tabUrl: data.tabUrl,
            snapshot: data.snapshot,
          };
          setProjectState(data.project);
          setTabUrlState(data.tabUrl || "");
          break;

        case "genie:context-update":
          extensionCtx.current.project = data.project;
          extensionCtx.current.tabUrl = data.tabUrl;
          setProjectState(data.project);
          setTabUrlState(data.tabUrl || "");
          break;

        case "genie:snapshot-result":
          if (snapshotResolver.current) {
            snapshotResolver.current(data.snapshot);
            snapshotResolver.current = null;
          }
          break;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab !== "chat") return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, streamingContent, toolUses, streamingSteps, activeTab]);

  // Focus input
  useEffect(() => {
    if (authStatus === "authenticated" && activeTab === "chat") {
      inputRef.current?.focus();
    }
  }, [authStatus, activeTab]);

  const requestSnapshot = useCallback((): Promise<string> => {
    if (!isInIframe.current) return Promise.resolve("");
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        snapshotResolver.current = null;
        resolve(extensionCtx.current.snapshot);
      }, 2000);
      snapshotResolver.current = (snapshot: string) => {
        clearTimeout(timeout);
        resolve(snapshot);
      };
      window.parent.postMessage({ type: "genie:request-snapshot" }, "*");
    });
  }, []);

  const buildContext = useCallback((): string => {
    const { project, tabUrl } = extensionCtx.current;
    if (!project) return "";

    let context = `\n\n=== Chrome Extension Context ===`;
    context += `\nThe user is currently viewing a deployed app in their browser.`;
    context += `\nProject Name: ${project.name}`;
    context += `\nProject ID: ${project.id}`;
    context += `\nTab URL: ${tabUrl}`;
    if (project.vpsInstances.length > 0) {
      for (const inst of project.vpsInstances) {
        context += `\nVPS Instance: label="${inst.label}", id="${inst.id}", host=${inst.connection.host}`;
        if (inst.digitalocean) {
          context += `, dropletIP=${inst.digitalocean.ipAddress}`;
        }
      }
    }
    context += `\nUse projectId="${project.id}" when calling ssh_exec, read_project_file, write_project_file, list_project_files, list_codebase_files, read_codebase_file, or search_codebase tools.`;
    return context;
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const currentChat = $chat.getValue();
    $chat.next({
      ...currentChat,
      messages: [...currentChat.messages, { role: "user", content: text }],
      loading: true,
      streamingContent: "",
      streamingSteps: [],
      toolUses: [],
      toolRoundsUsed: 0,
    });

    const snapshot = await requestSnapshot();
    const context = buildContext();
    const current = $chat.getValue();
    wsSend("chat:send", {
      messages: current.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
      context: context || undefined,
      domSnapshot: snapshot || undefined,
      modelId: current.modelId,
      source: "chrome-extension",
    });
  }, [input, chatLoading, requestSnapshot, buildContext]);

  const handleStop = useCallback(() => {
    wsSend("chat:stop", {});
    const currentChat = $chat.getValue();
    const steps = [...currentChat.streamingSteps];
    if (currentChat.streamingContent) {
      steps.push({ content: currentChat.streamingContent });
    }
    const newMessages = [...currentChat.messages];
    if (steps.length > 0) {
      const tu = currentChat.toolUses.length > 0 ? [...currentChat.toolUses] : undefined;
      newMessages.push({
        role: "assistant" as const,
        content: steps.map(st => st.content).join(""),
        toolUses: tu,
        steps,
      });
    }
    $chat.next({
      ...currentChat,
      messages: newMessages,
      streamingContent: "",
      streamingSteps: [],
      toolUses: [],
      loading: false,
      toolRoundsUsed: 0,
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Resolve project: bridge > URL-match > fallback
  // (must run before early returns so hooks are always called in the same order)
  const bridgeProject = projectState ?? extensionCtx.current.project;
  const tabUrl = tabUrlState || extensionCtx.current.tabUrl;
  const hostname = useMemo(() => {
    try { return new URL(tabUrl).hostname; } catch { return ""; }
  }, [tabUrl]);

  // Match current page hostname against project VPS instance IPs
  const urlMatchedProject = useMemo(() => {
    if (bridgeProject || !hostname || storeProjects.length === 0) return null;
    for (const p of storeProjects) {
      for (const v of p.vpsInstances) {
        if (
          v.connection.host === hostname ||
          v.digitalocean?.ipAddress === hostname
        ) {
          return p;
        }
      }
    }
    return null;
  }, [bridgeProject, hostname, storeProjects]);


  // If URL doesn't match any project, user must pick one manually (no auto-fallback)
  const manualProject = manualProjectId ? storeProjects.find((p) => p.id === manualProjectId) ?? null : null;
  const resolvedStore = urlMatchedProject ?? manualProject;
  // Clear manual pick when bridge/URL match kicks in
  const isUrlMatched = !!(bridgeProject || urlMatchedProject);
  useEffect(() => {
    if (isUrlMatched) setManualProjectId(null);
  }, [isUrlMatched]);

  // Enrich bridge project with store-only fields (gitFolders, dbUrl)
  const storeMatch = bridgeProject ? storeProjects.find((p) => p.id === bridgeProject.id) : null;
  const project: ExtensionProject | null = bridgeProject
    ? { ...bridgeProject, gitFolders: storeMatch?.gitFolders, dbUrl: bridgeProject.dbUrl || storeMatch?.dbUrl }
    : (resolvedStore ? {
      id: resolvedStore.id,
      name: resolvedStore.name,
      dbUrl: resolvedStore.dbUrl,
      vpsInstances: resolvedStore.vpsInstances.map((v) => ({
        id: v.id, label: v.label,
        connection: { host: v.connection.host },
        digitalocean: v.digitalocean ? { ipAddress: v.digitalocean.ipAddress } : undefined,
      })),
      gitFolders: resolvedStore.gitFolders,
    } : null);

  // --- Render ---

  if (authStatus === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-base">
        <div className="rounded-full bg-mauve animate-pulse" style={{ width: 8, height: 8 }} />
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return <LoginScreen />;
  }

  // No project matched by URL and no manual pick — show droplet picker
  if (!project && storeProjects.length > 0) {
    return (
      <DropletPicker
        projects={storeProjects}
        hostname={hostname}
        isInIframe={isInIframe.current}
        onSelectProject={setManualProjectId}
        user={auth.user}
      />
    );
  }

  const hasVps = project && project.vpsInstances.length > 0;
  const totalUnread = Object.values(convChat.unreadCounts).reduce((a, b) => a + b, 0);
  const shareInvites = termState.shareInvites;

  const TABS: { id: ExtTab | "claude"; icon: React.ReactNode; label: string; requiresVps?: boolean; badge?: number; action?: boolean }[] = [
    { id: "chat", icon: <MessageSquare size={14} />, label: "Chat" },
    { id: "team", icon: <Users size={14} />, label: "Team", badge: totalUnread },
    { id: "commands", icon: <TerminalSquare size={14} />, label: "Commands", requiresVps: true },
    { id: "files", icon: <FolderOpen size={14} />, label: "Files", requiresVps: true },
    { id: "terminal", icon: <Terminal size={14} />, label: "Terminal", requiresVps: true },
    { id: "claude", icon: <ClaudeLogo size={14} />, label: "Claude", requiresVps: true, action: true },
    { id: "tracker", icon: <ClipboardList size={14} />, label: "Tracker" },
    { id: "git", icon: <GitBranch size={14} />, label: "Git", requiresVps: true },
    { id: "docker", icon: <Container size={14} />, label: "Docker", requiresVps: true },
    { id: "database", icon: <Database size={14} />, label: "DB", requiresVps: true },
  ];

  return (
    <div className="flex flex-col h-screen bg-base">
      {/* Project context bar */}
      {project && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-surface0 bg-mantle shrink-0" style={{ fontSize: 13 }}>
          <Globe size={13} className="text-mauve shrink-0" />
          <span className="text-mauve font-medium truncate">{project.name}</span>
          {hostname && <span className="text-overlay0 truncate" style={{ fontSize: 12 }}>· {hostname}</span>}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {!isUrlMatched && (
              <button
                onClick={() => setManualProjectId(null)}
                className="flex items-center gap-1 text-overlay0 hover:text-text transition-colors"
                style={{ fontSize: 12 }}
                title="Back to droplet list"
              >
                <ArrowLeft size={12} />
                Droplets
              </button>
            )}
            {project && <FeedbackButton projectId={project.id} />}
            {auth.user && (
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full overflow-hidden bg-surface1 shrink-0">
                  {auth.user.avatarUrl ? (
                    <img src={auth.user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xs font-medium text-subtext0">
                      {auth.user.name[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <button
                  onClick={logout}
                  className="text-overlay0 hover:text-red transition-colors"
                  title="Sign out"
                >
                  <LogOut size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-surface0 bg-mantle shrink-0">
        {TABS.map((tab) => {
          if (tab.requiresVps && !hasVps) return null;
          if (tab.action && tab.id === "claude") {
            return <ClaudeTabButton key={tab.id} icon={tab.icon} openClaudeTerminal={openClaudeTerminal} />;
          }
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ExtTab)}
              className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                activeTab === tab.id
                  ? "text-mauve border-b-2 border-mauve"
                  : "text-overlay1 hover:text-text"
              }`}
              style={{ fontSize: 13 }}
            >
              {tab.icon}
              {tab.label}
              {tab.badge && tab.badge > 0 ? (
                <span className="min-w-[14px] h-3.5 rounded-full bg-blue text-crust flex items-center justify-center px-1" style={{ fontSize: 9 }}>{tab.badge > 99 ? "99+" : tab.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Terminal share invites */}
      {shareInvites.map((invite) => (
        <ShareInviteBanner
          key={invite.sessionId}
          invite={invite}
          onAccept={() => {
            // Accept and open shared terminal tab as floating window
            const z = ++termZIndexRef.current;
            const tab: TerminalTabDef = {
              id: invite.sessionId, sessionId: invite.sessionId,
              label: `${invite.ownerName}'s Term`, exited: false,
              shared: true, ownerId: invite.ownerId, ownerName: invite.ownerName,
              windowStatus: "open", windowZIndex: z, focused: true,
            };
            setTermTabs((prev) => [...prev.map((t) => ({ ...t, focused: false })), tab]);
            acceptTerminalShare(invite);
          }}
          onDecline={() => declineTerminalShare(invite.sessionId)}
        />
      ))}

      {/* Tab content */}
      {activeTab === "chat" && (
        <>
          {/* Chat toolbar */}
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-surface0 shrink-0">
            <button
              onClick={() => {
                if (!showHistory) loadChatSessions();
                setShowHistory(!showHistory);
              }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors cursor-pointer ${showHistory ? "bg-surface0 text-text" : ""}`}
              style={{ fontSize: 12 }}
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              History
            </button>
            {chatMessages.length > 0 && (
              <button
                onClick={() => { newChat(); setShowHistory(false); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors cursor-pointer"
                style={{ fontSize: 12 }}
              >
                <Plus size={12} />
                New
              </button>
            )}
          </div>

          {/* Session history panel */}
          {showHistory && (
            <div className="border-b border-surface0 bg-mantle overflow-y-auto shrink-0" style={{ maxHeight: 240 }}>
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-6 text-overlay0" style={{ fontSize: 12 }}>
                  <Loader2 size={14} className="animate-spin mr-2" /> Loading...
                </div>
              ) : chatSessions.length === 0 ? (
                <div className="text-overlay0 text-center py-6" style={{ fontSize: 12 }}>No past sessions</div>
              ) : (
                <div className="py-1">
                  {chatSessions.map((s) => (
                    <div
                      key={s.sessionId}
                      className={`group relative px-4 py-2 hover:bg-surface0 transition-colors cursor-pointer ${
                        activeSessionId === s.sessionId ? "bg-surface0" : ""
                      }`}
                      onClick={() => { if (!renamingSessionId) { loadChatSession(s.sessionId); setShowHistory(false); } }}
                    >
                      {renamingSessionId === s.sessionId ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (renameValue.trim()) renameChatSession(s.sessionId, renameValue.trim());
                            setRenamingSessionId(null);
                          }}
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => {
                              if (renameValue.trim()) renameChatSession(s.sessionId, renameValue.trim());
                              setRenamingSessionId(null);
                            }}
                            onKeyDown={(e) => { if (e.key === "Escape") setRenamingSessionId(null); }}
                            className="flex-1 bg-surface0 border border-mauve/40 rounded px-2 py-0.5 text-text outline-none"
                            style={{ fontSize: 12 }}
                          />
                        </form>
                      ) : (
                        <>
                          <div className="truncate text-text pr-12" style={{ fontSize: 12 }}>
                            {s.name || s.firstMessage || "Untitled session"}
                          </div>
                          <div className="flex items-center gap-2 text-overlay0 mt-0.5" style={{ fontSize: 11 }}>
                            {s.userName && <span className="text-subtext0">{s.userName}</span>}
                            <span>{new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            <span>{s.messageCount} msg{s.messageCount !== 1 ? "s" : ""}</span>
                          </div>
                          {/* Rename / Delete buttons */}
                          <div
                            className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => { setRenameValue(s.name || s.firstMessage || ""); setRenamingSessionId(s.sessionId); }}
                              className="p-1 rounded hover:bg-surface1 text-overlay0 hover:text-text transition-colors"
                              title="Rename"
                            >
                              <FileEdit size={12} />
                            </button>
                            <button
                              onClick={() => deleteChatSession(s.sessionId)}
                              className="p-1 rounded hover:bg-red/20 text-overlay0 hover:text-red transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Resumed-session banner */}
          {resumedFrom && !showHistory && (
            <div
              className="flex items-center gap-2 px-4 py-1.5 bg-surface0/60 border-b border-surface0 text-overlay1"
              style={{ fontSize: 11 }}
              title={`Claude Code session ${resumedFrom.sessionId}`}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 10 9 10"/></svg>
              <span>Continuing session · last active {relativeTimeAgo(resumedFrom.lastActivity)}</span>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {chatMessages.length === 0 && !chatLoading && !showHistory && (
              <div className="flex flex-col items-center justify-center h-full text-overlay0 gap-2 py-12">
                <p style={{ fontSize: 13 }}>Ask Genie anything about this page.</p>
              </div>
            )}

            <div className="space-y-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className={msg.role === "user" ? "flex justify-end" : ""}>
                  {msg.role === "user" ? (
                    <div
                      className="rounded-xl px-4 py-3 bg-mauve/15 text-text select-text cursor-text"
                      style={{ maxWidth: "85%" }}
                    >
                      <div className="whitespace-pre-wrap" style={{ fontSize: 13, lineHeight: 1.6 }}>
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1 ml-1 text-overlay0">
                        <ClaudeLogo size={13} />
                        <span style={{ fontSize: 11, fontWeight: 500 }}>Claude Code{claudeInfo?.email ? ` · ${claudeInfo.email}` : ""}{claudeInfo?.plan ? ` ${claudeInfo.plan.toUpperCase()}` : ""}</span>
                      </div>
                      <div
                        className={`rounded-xl px-4 py-3 select-text cursor-text ${
                          msg.content.startsWith("Error:")
                            ? "bg-red/10 text-red border border-red/20"
                            : "bg-surface0 text-text"
                        }`}
                      >
                        {msg.steps ? msg.steps.map((step, j) => (
                          <div key={j}>
                            {step.content && (
                              <div className="chat-markdown select-text cursor-text" style={{ fontSize: 13, lineHeight: 1.6 }}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                  {step.content}
                                </ReactMarkdown>
                              </div>
                            )}
                            {step.toolUse && (
                              <span className="inline-block my-0.5 mr-1 align-middle">
                                <ToolPill tool={step.toolUse} />
                              </span>
                            )}
                          </div>
                        )) : (
                          <>
                            {msg.toolUses && msg.toolUses.length > 0 && (
                              <div className="mb-1.5">
                                {msg.toolUses.map((tool, j) => (
                                  <span key={j} className="inline-block my-0.5 mr-1 align-middle">
                                    <ToolPill tool={tool} />
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="chat-markdown select-text cursor-text" style={{ fontSize: 13, lineHeight: 1.6 }}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {msg.role === "assistant" && msg.usage && (
                    <UsageLine usage={msg.usage} />
                  )}
                </div>
              ))}

              {/* Streaming assistant message — step-by-step */}
              {chatLoading && (streamingSteps.length > 0 || streamingContent) && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1 ml-1 text-overlay0">
                    <ClaudeLogo size={13} />
                    <span style={{ fontSize: 11, fontWeight: 500 }}>Claude Code{claudeInfo?.email ? ` · ${claudeInfo.email}` : ""}{claudeInfo?.plan ? ` ${claudeInfo.plan.toUpperCase()}` : ""}</span>
                  </div>
                <div className="genie-streaming-border bg-surface0 rounded-xl px-4 py-3 text-text select-text cursor-text">
                  {streamingSteps.map((step, i) => (
                    <div key={i}>
                      {step.content && (
                        <div className="chat-markdown select-text cursor-text" style={{ fontSize: 13, lineHeight: 1.6 }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {step.content}
                          </ReactMarkdown>
                        </div>
                      )}
                      {step.toolUse && (
                        <span className="inline-block my-0.5 mr-1 align-middle">
                          <ToolPill tool={step.toolUse} />
                        </span>
                      )}
                    </div>
                  ))}
                  {streamingContent && (
                    <div className="chat-markdown select-text cursor-text" style={{ fontSize: 13, lineHeight: 1.6 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                </div>
              )}

              {chatLoading && !streamingContent && streamingSteps.length === 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1 ml-1 text-overlay0">
                    <ClaudeLogo size={13} />
                    <span style={{ fontSize: 11, fontWeight: 500 }}>Claude Code{claudeInfo?.email ? ` · ${claudeInfo.email}` : ""}{claudeInfo?.plan ? ` ${claudeInfo.plan.toUpperCase()}` : ""}</span>
                  </div>
                  <div className="genie-streaming-border bg-surface0 rounded-xl px-4 py-3 flex items-center gap-2 text-overlay0">
                    <span style={{ fontSize: 13 }}>{statusText || "Thinking..."}</span>
                  {maxToolRounds > 0 && toolRoundsUsed > 0 && (
                    <span className="text-[11px] text-overlay0 ml-1">
                      {toolRoundsUsed}/{maxToolRounds} tools
                    </span>
                  )}
                </div>
                </div>
              )}
            </div>
          </div>

          {/* Input area */}
          <div className="border-t border-surface0 bg-mantle px-4 py-3 shrink-0">
            <div className="flex items-center gap-0.5 mb-2 bg-surface0 rounded-lg p-0.5">
              {Object.entries(CHAT_MODELS).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setChatModel(id as ChatModelId)}
                  className={`flex-1 px-2 py-1 rounded-md text-center transition-colors cursor-pointer ${
                    chatModelId === id
                      ? "bg-surface1 text-text font-medium"
                      : "text-overlay0 hover:text-subtext0"
                  }`}
                  style={{ fontSize: 11 }}
                >
                  {id === "claude-code" ? <span className="inline-flex items-center gap-1"><ClaudeLogo size={11} />{label}</span> : label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Genie..."
                rows={1}
                className="flex-1 bg-surface0 text-text rounded-lg px-3 py-2 resize-none outline-none placeholder:text-overlay0 border border-surface1 focus:border-mauve/40 transition-colors"
                style={{ fontSize: 13, lineHeight: 1.6, minHeight: 40, maxHeight: 120 }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
              />
              {chatLoading ? (
                <button
                  onClick={handleStop}
                  className="p-2 rounded-lg bg-red/20 text-red hover:bg-red/30 transition-colors shrink-0"
                  title="Stop"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="p-2 rounded-lg bg-mauve text-crust hover:bg-lavender transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Send"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "team" && (
        <div className="flex-1 overflow-hidden">
          <ExtTeamChat />
        </div>
      )}

      {activeTab === "commands" && project && (
        <div className="flex-1 overflow-hidden">
          <ExtCommandsTab projectId={project.id} onKillTerminal={(cmdName) => {
            setTermTabs((prev) => {
              const removed = prev.filter((t) => t.injectCommand && t.label === cmdName);
              if (removed.length > 0) {
                setTimeout(() => {
                  for (const t of removed) wsSend("terminal:close", { id: t.sessionId });
                }, 0);
              }
              return prev.filter((t) => !(t.injectCommand && t.label === cmdName));
            });
          }} />
        </div>
      )}

      {activeTab === "files" && project && (
        <div className="flex-1 overflow-hidden">
          <FileExplorer project={project} />
        </div>
      )}

      {activeTab === "terminal" && project && (
        <div className="flex-1 overflow-hidden">
          <TerminalListPanel
            tabs={termTabs}
            onAddTab={addTermTab}
            onRestore={restoreTermTab}
            onClose={closeTermTab}
          />
        </div>
      )}

      {activeTab === "git" && project && (
        <div className="flex-1 overflow-hidden">
          <GitPanel project={project} />
        </div>
      )}

      {activeTab === "docker" && project && (
        <div className="flex-1 overflow-hidden">
          <DockerLogs project={project} />
        </div>
      )}

      {activeTab === "database" && project && (
        <div className="flex-1 overflow-hidden">
          <DbExplorer project={project} />
        </div>
      )}

      {activeTab === "tracker" && project && (
        <div className="flex-1 overflow-hidden">
          <ExtTrackerTab projectId={project.id} />
        </div>
      )}

      {/* Minimized windows bar */}
      {termTabs.some((t) => t.windowStatus === "minimized") && (
        <div className="shrink-0 bg-mantle border-t border-surface0 px-3 py-1.5 flex items-center gap-2">
          {termTabs.filter((t) => t.windowStatus === "minimized").map((tab) => (
            <button
              key={tab.id}
              onClick={() => restoreTermTab(tab.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface0 hover:bg-surface1 text-md text-subtext0 transition-colors"
            >
              <Terminal size={13} className={tab.exited ? "text-red" : tab.shared ? "text-blue" : "text-green"} />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Floating terminal windows — rendered via portal */}
      {project && termTabs.map((tab) => (
        <FloatingTerminalWindow
          key={tab.id}
          tab={tab}
          project={project}
          onClose={closeTermTab}
          onMinimize={minimizeTermTab}
          onFocus={focusTermTab}
          onMarkExited={markTermExited}
          onUpdatePos={updateTermPos}
          savedPos={termPosRef.current[tab.id]}
          zIndex={tab.windowZIndex ?? 1000}
        />
      ))}

      {/* Dev toolbar */}
      <DevToolbar />
    </div>
  );
}


const SW_WS_OPTIONS = ["ws://127.0.0.1:9876", "wss://api.genie.teleporthq.ai"];

function DevToolbar() {
  const [wsUrl, setWsUrl] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [swWsUrl, setSwWsUrl] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setWsUrl(getWsUrl());
      setWsConnected(isWsConnected());
    };
    update();
    const interval = setInterval(update, 2000);

    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "genie:sw-ws-url") {
        setSwWsUrl(e.data.url);
      }
    }
    window.addEventListener("message", handleMessage);
    window.parent.postMessage({ type: "genie:request-sw-ws-url" }, "*");

    return () => {
      clearInterval(interval);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const isLocal = (url: string) => url.includes("localhost") || url.includes("127.0.0.1");

  const switchSwWsUrl = (url: string) => {
    window.parent.postMessage({ type: "genie:set-sw-ws-url", url }, "*");
    setSwWsUrl(url);
  };

  return (
    <div className="flex items-center gap-3 px-3 py-1 border-t border-surface0 bg-crust shrink-0" style={{ fontSize: 11 }}>
      <span className="text-overlay0">WS:</span>
      <span className={isLocal(wsUrl) ? "text-green" : "text-peach"}>{wsUrl || "—"}</span>
      <span className={wsConnected ? "text-green" : "text-red"}>{wsConnected ? "ok" : "off"}</span>
      <span className="text-surface1">|</span>
      <span className="text-overlay0">SW:</span>
      {SW_WS_OPTIONS.map((url) => (
        <button
          key={url}
          onClick={() => switchSwWsUrl(url)}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            swWsUrl === url
              ? isLocal(url) ? "bg-green/20 text-green" : "bg-peach/20 text-peach"
              : "text-overlay0 hover:text-text"
          }`}
          style={{ fontSize: 10 }}
        >
          {isLocal(url) ? "local" : "prod"}
        </button>
      ))}
    </div>
  );
}
