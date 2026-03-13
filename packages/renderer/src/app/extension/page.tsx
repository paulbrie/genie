"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Send, Square, Globe, Wrench, ChevronDown, ChevronRight, MessageSquare, FolderOpen, Terminal, Container, File, Folder, ArrowLeft, Save, RefreshCw, Loader2, Play, TerminalSquare, Plus, X, Users, Bot, Share2, Minus, Maximize2, Minimize2, Database, Table2, SearchCode, GitBranch, GitCommit, ArrowUp, ArrowDown, Check, Circle, FilePlus, FileEdit, FileX, FileQuestion, Copy, ExternalLink, LogOut, Trash2 } from "lucide-react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { $auth, $chat, $projects, $commandRunOutputs, $conversationChat, $terminal, $vpsDeploy, CHAT_MODELS, setChatModel, runProjectCommand, stopProjectCommand, loadConversations, loadChatUsers, selectConversation, sendConversationMessage, createGenieDm, createRoom, shareTerminal, acceptTerminalShare, declineTerminalShare, leaveSharedTerminal, fetchVpsStats, loadChatSessions, loadChatSession, newChat, renameChatSession, deleteChatSession, type ChatModelId, type ChatMessage, type ToolUse, type StreamingStep, type AuthState, type ConversationSummary, type ConversationMessage as ConvMessage, type ChatUser, type TerminalShareInvite, type VpsDeployState, type ProjectDef, type ChatSessionSummary } from "@/store";
import dynamic from "next/dynamic";
import type { BeforeMount } from "@monaco-editor/react";
import { connectWs, setManagerRunning, wsSend, wsRequest, triggerGoogleLogin, logout } from "@/lib/ws";
import { markdownComponents } from "@/components/ui/markdown-link";
import { useDraggable, useResizable } from "@/components/use-draggable";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-overlay0" style={{ fontSize: 13 }}>
      <Loader2 size={14} className="animate-spin mr-2" />Loading editor...
    </div>
  ),
});

function ClaudeLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -.01 39.5 39.53" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z" fill="currentColor"/>
    </svg>
  );
}

const catppuccinMocha = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "", foreground: "cdd6f4" },
    { token: "comment", foreground: "6c7086", fontStyle: "italic" },
    { token: "keyword", foreground: "cba6f7" },
    { token: "string", foreground: "a6e3a1" },
    { token: "number", foreground: "fab387" },
    { token: "type", foreground: "f9e2af" },
    { token: "tag", foreground: "89b4fa" },
    { token: "attribute.name", foreground: "f9e2af" },
    { token: "attribute.value", foreground: "a6e3a1" },
    { token: "delimiter", foreground: "9399b2" },
    { token: "key", foreground: "89b4fa" },
    { token: "string.yaml", foreground: "a6e3a1" },
  ],
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "editor.lineHighlightBackground": "#313244",
    "editor.selectionBackground": "#45475a",
    "editorCursor.foreground": "#f5e0dc",
    "editorLineNumber.foreground": "#6c7086",
    "editorLineNumber.activeForeground": "#cdd6f4",
    "editor.inactiveSelectionBackground": "#313244",
    "editorWidget.background": "#181825",
    "editorWidget.border": "#313244",
    "input.background": "#181825",
    "input.border": "#313244",
    "scrollbarSlider.background": "#31324480",
    "scrollbarSlider.hoverBackground": "#45475a80",
    "scrollbarSlider.activeBackground": "#585b7080",
  },
};

function getFileLanguage(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (name === ".env" || name.startsWith(".env.")) return "ini";
  if (name.startsWith("Dockerfile")) return "dockerfile";
  const map: Record<string, string> = {
    ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".json": "json", ".html": "html", ".htm": "html", ".css": "css", ".scss": "scss",
    ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".yml": "yaml", ".yaml": "yaml", ".toml": "ini", ".conf": "ini", ".cfg": "ini", ".ini": "ini",
    ".md": "markdown", ".sql": "sql", ".xml": "xml", ".svg": "xml",
    ".php": "php", ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".lua": "lua", ".r": "r", ".swift": "swift", ".kt": "kotlin",
    ".nginx": "nginx", ".graphql": "graphql", ".gql": "graphql",
  };
  return map[ext] || "plaintext";
}

const handleEditorWillMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("catppuccin-mocha", catppuccinMocha);
};
import { UsageLine } from "@/components/ui/usage-line";
import { LoginScreen } from "@/components/login-screen";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
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

type ExtTab = "chat" | "team" | "commands" | "files" | "terminal" | "docker" | "database" | "git";

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

function ContextMenu({ x, y, onRename, onDelete, onClose }: {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-mantle border border-surface1 rounded-lg shadow-lg py-1 min-w-[120px]"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => { onRename(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-text hover:bg-surface0 transition-colors text-left"
        style={{ fontSize: 13 }}
      >
        <FileEdit size={13} className="text-overlay1" />
        Rename
      </button>
      <button
        onClick={() => { onDelete(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-red hover:bg-red/10 transition-colors text-left"
        style={{ fontSize: 13 }}
      >
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  );
}

// --- File entry with click/double-click handling ---

function FileEntry({ entry, isActive, onOpen, onRename, onDelete, children }: {
  entry: FsEntry;
  isActive: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onRename();
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onOpen();
      }, 250);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`flex items-center gap-2 w-full px-2 py-1.5 hover:bg-surface0/50 transition-colors text-left ${
          isActive ? "bg-surface0 text-mauve" : "text-text"
        }`}
        style={{ fontSize: 13 }}
      >
        {children}
      </button>
      {contextMenu && createPortal(
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={onRename}
          onDelete={onDelete}
          onClose={() => setContextMenu(null)}
        />,
        document.body,
      )}
    </>
  );
}

// --- File Explorer ---

function FileExplorer({ project }: { project: ExtensionProject }) {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("genie-ext-file-path") || "/opt/project";
    }
    return "/opt/project";
  });
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState<{ path: string; content: string; original: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("genie-ext-sidebar-width");
      if (stored) return parseInt(stored);
    }
    return 220;
  });
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const inst = project.vpsInstances[0];
  if (!inst) return <div className="p-4 text-overlay0" style={{ fontSize: 13 }}>No VPS instance available.</div>;

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest("vps:fs:readDirectory", { projectId: project.id, instanceId: inst.id, path: dirPath });
      if (res.ok) {
        const sorted = (res.entries as FsEntry[]).sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
        setCurrentPath(dirPath);
        localStorage.setItem("genie-ext-file-path", dirPath);
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project.id, inst.id]);

  const openFile = useCallback(async (filePath: string) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await wsRequest("vps:fs:readFile", { projectId: project.id, instanceId: inst.id, path: filePath });
      if (res.ok) {
        if (res.tooLarge) {
          setError("File too large to open (> 1MB)");
        } else if (res.binary) {
          setError("Binary file — cannot display");
        } else {
          setEditingFile({ path: filePath, content: res.content, original: res.content });
        }
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project.id, inst.id]);

  const editingFileRef = useRef(editingFile);
  editingFileRef.current = editingFile;

  const saveFile = useCallback(async () => {
    const file = editingFileRef.current;
    if (!file) return;
    setSaving(true);
    try {
      const res = await wsRequest("vps:fs:writeFile", { projectId: project.id, instanceId: inst.id, path: file.path, content: file.content });
      if (res.ok) {
        const savedContent = file.content;
        setEditingFile((prev) => prev ? { ...prev, original: savedContent } : null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }, [project.id, inst.id]);

  const startRename = useCallback((entry: FsEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  }, []);

  const deleteEntry = useCallback(async (entry: FsEntry) => {
    const label = entry.isDirectory ? "folder" : "file";
    if (!confirm(`Delete ${label} "${entry.name}"?`)) return;
    try {
      const res = await wsRequest("vps:fs:delete", { projectId: project.id, instanceId: inst.id, path: entry.path });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.path !== entry.path));
        if (editingFile?.path === entry.path) {
          setEditingFile(null);
        }
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [project.id, inst.id, editingFile]);

  const commitRename = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const oldName = renamingPath.split("/").pop() || "";
    if (renameValue.trim() === oldName) {
      setRenamingPath(null);
      return;
    }
    const parentDir = renamingPath.replace(/\/[^/]+$/, "") || "/";
    const newPath = parentDir + "/" + renameValue.trim();
    try {
      const res = await wsRequest("vps:fs:rename", { projectId: project.id, instanceId: inst.id, oldPath: renamingPath, newPath });
      if (res.ok) {
        // Update entries locally
        setEntries((prev) => prev.map((e) => e.path === renamingPath ? { ...e, name: renameValue.trim(), path: newPath } : e));
        // If the renamed file is currently open, update the editing path
        if (editingFile?.path === renamingPath) {
          setEditingFile({ ...editingFile, path: newPath });
        }
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, project.id, inst.id, editingFile]);

  // Load initial path on mount
  useEffect(() => {
    loadDirectory(currentPath);
  }, [loadDirectory]);

  // Drag handler for resizer
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientX - startX;
      const containerW = containerRef.current?.offsetWidth || 600;
      const newW = Math.max(120, Math.min(containerW - 150, startW + delta));
      setSidebarWidth(newW);
    }
    function onUp() {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((w) => {
        localStorage.setItem("genie-ext-sidebar-width", String(w));
        return w;
      });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const pathParts = currentPath.split("/").filter(Boolean);
  const hasChanges = editingFile ? editingFile.content !== editingFile.original : false;
  const fileName = editingFile?.path.split("/").pop() || "";

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* Left sidebar — file tree */}
      <div className="flex flex-col shrink-0 border-r border-surface0 bg-mantle overflow-hidden" style={{ width: sidebarWidth }}>
        {/* Breadcrumb + refresh */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-surface0 shrink-0 overflow-x-auto">
          <button
            onClick={() => loadDirectory("/")}
            className="text-overlay1 hover:text-text transition-colors px-1 shrink-0"
            style={{ fontSize: 13 }}
          >/</button>
          {pathParts.map((part, i) => {
            const fullPath = "/" + pathParts.slice(0, i + 1).join("/");
            return (
              <span key={fullPath} className="flex items-center gap-0.5 shrink-0">
                <span className="text-overlay0" style={{ fontSize: 12 }}>/</span>
                <button
                  onClick={() => loadDirectory(fullPath)}
                  className="text-overlay1 hover:text-text transition-colors truncate"
                  style={{ fontSize: 13, maxWidth: 80 }}
                >{part}</button>
              </span>
            );
          })}
          <div className="flex-1" />
          <button onClick={() => loadDirectory(currentPath)} className="text-overlay1 hover:text-text transition-colors p-0.5 shrink-0">
            <RefreshCw size={12} />
          </button>
        </div>

        {error && (
          <div className="px-2 py-1.5 text-red bg-red/10 border-b border-red/20 shrink-0" style={{ fontSize: 12 }}>{error}</div>
        )}

        {/* File list */}
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 size={16} className="text-mauve animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {currentPath !== "/" && (
              <button
                onClick={() => {
                  const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
                  loadDirectory(parent);
                }}
                className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-surface0/50 text-overlay1 transition-colors"
                style={{ fontSize: 13 }}
              >
                <ArrowLeft size={12} />
                <span>..</span>
              </button>
            )}
            {entries.map((entry) => (
              renamingPath === entry.path ? (
                <div key={entry.path} className="flex items-center gap-2 w-full px-2 py-1 bg-surface0">
                  {entry.isDirectory ? (
                    <Folder size={13} className="text-mauve shrink-0" />
                  ) : (
                    <File size={13} className="text-blue shrink-0" />
                  )}
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingPath(null);
                    }}
                    className="flex-1 bg-base text-text px-1.5 py-0.5 rounded outline-none border border-mauve/40 min-w-0"
                    style={{ fontSize: 13 }}
                    spellCheck={false}
                  />
                </div>
              ) : (
                <FileEntry
                  key={entry.path}
                  entry={entry}
                  isActive={editingFile?.path === entry.path}
                  onOpen={() => entry.isDirectory ? loadDirectory(entry.path) : openFile(entry.path)}
                  onRename={() => startRename(entry)}
                  onDelete={() => deleteEntry(entry)}
                >
                  {entry.isDirectory ? (
                    <Folder size={13} className="text-mauve shrink-0" />
                  ) : (
                    <File size={13} className="text-blue shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </FileEntry>
              )
            ))}
            {entries.length === 0 && !loading && (
              <div className="text-overlay0 text-center py-6" style={{ fontSize: 13 }}>Empty</div>
            )}
          </div>
        )}
      </div>

      {/* Resizer handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 shrink-0 cursor-col-resize bg-surface0 hover:bg-mauve/40 transition-colors"
      />

      {/* Right panel — editor or placeholder */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {editingFile ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
              <File size={13} className="text-blue shrink-0" />
              <span className="text-text truncate" style={{ fontSize: 13 }}>{fileName}</span>
              <div className="flex-1" />
              {saved && (
                <span className="text-green" style={{ fontSize: 12 }}>Saved</span>
              )}
              {hasChanges && (
                <button onClick={saveFile} disabled={saving} className="flex items-center gap-1 px-2 py-1 bg-green/20 text-green hover:bg-green/30 rounded transition-colors disabled:opacity-50" style={{ fontSize: 12 }}>
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              )}
            </div>
            <MonacoEditor
              language={getFileLanguage(fileName)}
              theme="catppuccin-mocha"
              value={editingFile.content}
              onChange={(v) => { setSaved(false); setEditingFile((prev) => prev ? { ...prev, content: v ?? "" } : null); }}
              beforeMount={handleEditorWillMount}
              onMount={(editor) => {
                editor.addCommand(
                  // eslint-disable-next-line no-bitwise
                  editor.getModel()?.uri ? 2048 | 49 : 2048 | 49, // Ctrl/Cmd+S
                  () => saveFile(),
                );
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                tabSize: 2,
                folding: true,
                lineNumbers: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                padding: { top: 8 },
              }}
            />
          </>
        ) : (
          <div className="flex items-center justify-center flex-1 text-overlay0" style={{ fontSize: 13 }}>
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}

// --- SSH Terminal ---

interface TerminalTabDef {
  id: string;
  sessionId: string;
  label: string;
  exited: boolean;
  /** Command to inject into the terminal after SSH connects */
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
  injectCommand,
  shared,
}: {
  project: ExtensionProject;
  sessionId: string;
  visible: boolean;
  onExit: () => void;
  injectCommand?: string;
  shared?: boolean;
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

    const term = createTerminal(containerRef.current, sessionId);

    if (shared) {
      // Request scrollback replay for shared terminals
      wsSend("terminal:share:replay", { sessionId });
    } else if (inst) {
      wsSend("vps:terminal:spawn", {
        id: sessionId,
        projectId: project.id,
        instanceId: inst.id,
        cols: term.cols,
        rows: term.rows,
      });
    }

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
        setTimeout(() => wsSend("terminal:close", { id: sessionId }), 0);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instId, project.id, sessionId, shared]);

  return (
    <div className="h-full w-full bg-[#1e1e2e]" style={{ display: visible ? "block" : "none" }}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

const TERM_WIN_W = 600;
const TERM_WIN_H = 400;
const TERM_CASCADE = 30;

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

function FloatingTerminalWindow({
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
        <Terminal size={12} className={tab.exited ? "text-red" : tab.shared ? "text-blue" : tab.injectCommand ? "text-mauve" : "text-green"} />
        <span className="text-md text-subtext0 font-medium truncate flex-1">{tab.label}</span>
        {tab.shared && tab.ownerId && (
          <OwnerAvatar ownerId={tab.ownerId} />
        )}
        {tab.viewerIds && tab.viewerIds.length > 0 && !tab.shared && (
          <ViewerAvatars viewerIds={tab.viewerIds} sessionId={tab.sessionId} />
        )}
        {!tab.exited && !tab.shared && (
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
          injectCommand={tab.injectCommand}
          shared={tab.shared}
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
function TerminalListPanel({
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
            <Terminal size={13} className={tab.exited ? "text-red" : tab.shared ? "text-blue" : tab.injectCommand ? "text-mauve" : "text-green"} />
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

// --- Commands Tab ---

function ExtCommandsTab({ projectId, onKillTerminal }: { projectId: string; onKillTerminal?: (commandName: string) => void }) {
  const [projects] = useSubject($projects);
  const [commandRunOutputs] = useSubject($commandRunOutputs);
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;

  const vpsInstance = project.vpsInstances.find((i) => !i.deployFailed) ?? project.vpsInstances[0];
  const instanceId = vpsInstance?.id ?? null;

  const commands = project.commands;

  return (
    <div className="flex flex-col h-full overflow-y-auto px-3 py-3 gap-2">
      {commands.length === 0 && (
        <div className="text-overlay0 py-8 text-center" style={{ fontSize: 13 }}>
          No commands configured. Add commands in the main app.
        </div>
      )}

      {!instanceId && commands.length > 0 && (
        <div className="text-peach bg-peach/10 rounded-md px-3 py-2" style={{ fontSize: 13 }}>
          No VPS instance available to run commands on.
        </div>
      )}

      {commands.map((cmd) => {
        const key = `${project.id}:${cmd.id}`;
        const runState = commandRunOutputs[key];
        const isRunning = runState?.running ?? false;
        const isExpanded = expandedCommandId === cmd.id;
        const isTerminalMode = cmd.mode === "terminal";

        return (
          <div key={cmd.id} className="bg-mantle rounded-lg border border-surface0">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => {
                  if (!instanceId) return;
                  if (isTerminalMode) {
                    runProjectCommand(project.id, cmd.id, instanceId);
                  } else if (isRunning) {
                    setConfirmStopId(cmd.id);
                  } else {
                    setExpandedCommandId(cmd.id);
                    runProjectCommand(project.id, cmd.id, instanceId);
                  }
                }}
                disabled={!instanceId}
                className={`shrink-0 p-1 rounded transition-colors ${
                  !isTerminalMode && isRunning
                    ? "text-red hover:bg-red/10"
                    : "text-green hover:bg-green/10"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={isTerminalMode ? "Open in terminal" : isRunning ? "Stop" : "Run"}
              >
                {!isTerminalMode && isRunning ? <Square size={14} /> : <Play size={14} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-text font-medium truncate" style={{ fontSize: 13 }}>{cmd.name}</span>
                  {isTerminalMode && (
                    <span className="text-mauve bg-mauve/10 px-1 py-0.5 rounded leading-none" style={{ fontSize: 10 }}>terminal</span>
                  )}
                </div>
                <div className="text-overlay0 font-mono truncate" style={{ fontSize: 12 }}>{cmd.command}</div>
              </div>
              {!isTerminalMode && runState && (
                <button
                  onClick={() => setExpandedCommandId(isExpanded ? null : cmd.id)}
                  className="text-overlay0 hover:text-text p-1 transition-colors shrink-0"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              )}
            </div>

            {/* Stop confirmation (inline commands only) */}
            {confirmStopId === cmd.id && !isTerminalMode && (
              <div className="flex items-center gap-2 px-3 py-2 border-t border-surface0 bg-red/5">
                <span className="text-red flex-1" style={{ fontSize: 12 }}>Kill this command?</span>
                <button
                  onClick={() => { stopProjectCommand(project.id, cmd.id); setConfirmStopId(null); }}
                  className="px-2 py-0.5 rounded text-red bg-red/10 hover:bg-red/20 transition-colors font-medium"
                  style={{ fontSize: 12 }}
                >
                  Kill
                </button>
                <button
                  onClick={() => setConfirmStopId(null)}
                  className="px-2 py-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
                  style={{ fontSize: 12 }}
                >
                  Cancel
                </button>
              </div>
            )}

            {!isTerminalMode && isExpanded && runState && (
              <div className="border-t border-surface0 px-3 py-2 max-h-[200px] overflow-y-auto font-mono bg-base scrollbar-thin" style={{ fontSize: 12 }}>
                <pre className="text-overlay1 leading-relaxed whitespace-pre-wrap">{runState.output}</pre>
                {isRunning && <Loader2 size={12} className="text-blue animate-spin mt-1" />}
                <div ref={outputEndRef} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Git Panel ---

interface GitFileEntry {
  path: string;
  index: string;   // X column from porcelain
  working: string;  // Y column from porcelain
}

function parseGitPorcelain(porcelain: string | undefined | null): { files: GitFileEntry[]; branchLine: string | null } {
  if (!porcelain) return { files: [], branchLine: null };
  const lines = porcelain.split("\n").filter(Boolean);
  let branchLine: string | null = null;
  const files: GitFileEntry[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      branchLine = line;
      continue;
    }
    if (line.length < 4) continue;
    const index = line[0];
    const working = line[1];
    const path = line.slice(3);
    files.push({ path, index, working });
  }
  return { files, branchLine };
}

function gitFileIcon(index: string, working: string) {
  const status = working !== " " && working !== "?" ? working : index;
  switch (status) {
    case "A": return <FilePlus size={13} className="text-green" />;
    case "M": return <FileEdit size={13} className="text-yellow" />;
    case "D": return <FileX size={13} className="text-red" />;
    case "R": return <FileEdit size={13} className="text-blue" />;
    case "?": return <FileQuestion size={13} className="text-overlay0" />;
    default: return <File size={13} className="text-overlay0" />;
  }
}

function GitPanel({ project }: { project: ExtensionProject }) {
  const inst = project.vpsInstances[0];
  const folders = project.gitFolders && project.gitFolders.length > 0 ? project.gitFolders : ["/opt/project"];
  const [selectedFolder, setSelectedFolder] = useState(folders[0]);

  // Sync selectedFolder when gitFolders changes
  useEffect(() => {
    if (!folders.includes(selectedFolder)) {
      setSelectedFolder(folders[0]);
    }
  }, [folders.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [files, setFiles] = useState<GitFileEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const loadStatus = useCallback(async () => {
    if (!inst) return;
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest("git:status", { projectId: project.id, instanceId: inst.id, folder: selectedFolder }, 15000);
      if (res.message) {
        // Error response from git:error
        setError(res.message);
        setLoading(false);
        return;
      }
      const porcelain = res.porcelain || "";
      if (porcelain.startsWith("fatal:")) {
        setError(porcelain);
        setLoading(false);
        return;
      }
      setBranch(res.branch || "");
      setAhead(res.ahead || 0);
      setBehind(res.behind || 0);
      const parsed = parseGitPorcelain(porcelain);
      setFiles(parsed.files);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project.id, inst?.id, selectedFolder]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const loadLog = useCallback(async () => {
    if (!inst) return;
    try {
      const res = await wsRequest("git:log", { projectId: project.id, instanceId: inst.id, folder: selectedFolder, count: 30 }, 15000);
      setLogEntries(res.log ? res.log.split("\n") : []);
    } catch {}
  }, [project.id, inst?.id, selectedFolder]);

  const loadBranches = useCallback(async () => {
    if (!inst) return;
    try {
      const res = await wsRequest("git:branches", { projectId: project.id, instanceId: inst.id, folder: selectedFolder }, 15000);
      const parsed = (res.branches || "").split("\n").filter(Boolean).map((line: string) => {
        const isCurrent = line.includes("*");
        const name = line.replace("*", "").trim();
        return { name, current: isCurrent };
      });
      setBranches(parsed);
    } catch {}
  }, [project.id, inst?.id, selectedFolder]);

  const viewDiff = useCallback(async (file: string, staged: boolean) => {
    if (!inst) return;
    try {
      const res = await wsRequest("git:diff", { projectId: project.id, instanceId: inst.id, folder: selectedFolder, file, staged }, 15000);
      setDiffContent(res.diff || "(no changes)");
      setDiffFile(file);
    } catch {}
  }, [project.id, inst?.id, selectedFolder]);

  const doAction = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!inst) return;
    setActionLoading(action);
    setError(null);
    try {
      await wsRequest(action, { projectId: project.id, instanceId: inst.id, folder: selectedFolder, ...payload }, 60000);
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
    setActionLoading(null);
  }, [project.id, inst?.id, selectedFolder, loadStatus]);

  const stagedFiles = files.filter(f => f.index !== " " && f.index !== "?");
  const unstagedFiles = files.filter(f => f.working !== " " || f.index === "?");

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!inst) return <div className="p-4 text-overlay0" style={{ fontSize: 13 }}>No VPS instance available.</div>;

  if (diffContent !== null) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <button onClick={() => { setDiffContent(null); setDiffFile(null); }} className="text-overlay1 hover:text-text transition-colors p-1">
            <ArrowLeft size={13} />
          </button>
          <span className="text-text truncate" style={{ fontSize: 13 }}>Diff: {diffFile}</span>
        </div>
        <pre className="flex-1 overflow-auto p-3 text-subtext0 whitespace-pre-wrap break-words" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {diffContent.split("\n").map((line, i) => {
            let cls = "text-subtext0";
            if (line.startsWith("+")) cls = "text-green";
            else if (line.startsWith("-")) cls = "text-red";
            else if (line.startsWith("@@")) cls = "text-blue";
            return <div key={i} className={cls}>{line}</div>;
          })}
        </pre>
      </div>
    );
  }

  if (showLog) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <button onClick={() => setShowLog(false)} className="text-overlay1 hover:text-text transition-colors p-1">
            <ArrowLeft size={13} />
          </button>
          <GitCommit size={13} className="text-mauve" />
          <span className="text-text" style={{ fontSize: 13 }}>Commit Log</span>
          <div className="flex-1" />
          <button onClick={loadLog} className="text-overlay1 hover:text-text transition-colors p-1">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {logEntries.length === 0 ? (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>No commits</div>
          ) : logEntries.map((entry, i) => {
            const hash = entry.slice(0, 7);
            const msg = entry.slice(8);
            return (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5 border-b border-surface0/50 hover:bg-surface0/30 transition-colors" style={{ fontSize: 13 }}>
                <code className="text-mauve shrink-0" style={{ fontSize: 12 }}>{hash}</code>
                <span className="text-text break-words">{msg}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (showBranches) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <button onClick={() => setShowBranches(false)} className="text-overlay1 hover:text-text transition-colors p-1">
            <ArrowLeft size={13} />
          </button>
          <GitBranch size={13} className="text-mauve" />
          <span className="text-text" style={{ fontSize: 13 }}>Branches</span>
          <div className="flex-1" />
          <button onClick={loadBranches} className="text-overlay1 hover:text-text transition-colors p-1">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {branches.length === 0 ? (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>No branches</div>
          ) : branches.map((b) => (
            <button
              key={b.name}
              onClick={async () => {
                if (!b.current) {
                  await doAction("git:checkout", { branch: b.name });
                  setShowBranches(false);
                }
              }}
              disabled={b.current || actionLoading !== null}
              className={`flex items-center gap-2 w-full px-3 py-2 border-b border-surface0/50 text-left transition-colors ${
                b.current ? "bg-surface0/30 text-mauve" : "hover:bg-surface0/30 text-text"
              }`}
              style={{ fontSize: 13 }}
            >
              {b.current && <Check size={13} className="text-green shrink-0" />}
              {!b.current && <Circle size={11} className="text-overlay0 shrink-0" />}
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <GitBranch size={13} className="text-mauve" />
        {folders.length > 1 ? (
          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
            className="bg-surface0 text-text border border-surface1 rounded px-1.5 py-0.5 outline-none"
            style={{ fontSize: 13 }}
          >
            {folders.map(f => <option key={f} value={f}>{f.split("/").pop() || f}</option>)}
          </select>
        ) : (
          <span className="text-text truncate" style={{ fontSize: 13 }}>{selectedFolder}</span>
        )}
        <div className="flex-1" />
        <button onClick={() => { loadBranches(); setShowBranches(true); }} className="text-overlay1 hover:text-text transition-colors px-1.5 py-0.5 rounded hover:bg-surface0" style={{ fontSize: 12 }}>
          {branch || "..."}
        </button>
        {ahead > 0 && <span className="text-green flex items-center gap-0.5" style={{ fontSize: 12 }}><ArrowUp size={11} />{ahead}</span>}
        {behind > 0 && <span className="text-yellow flex items-center gap-0.5" style={{ fontSize: 12 }}><ArrowDown size={11} />{behind}</span>}
        <button onClick={loadStatus} disabled={loading} className="text-overlay1 hover:text-text transition-colors p-1">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-red bg-red/10 border-b border-red/20" style={{ fontSize: 13 }}>
          <span className="flex-1 truncate">{error}</span>
          <button
            onClick={() => {
              const fallback = () => {
                const ta = document.createElement("textarea");
                ta.value = error;
                ta.style.cssText = "position:fixed;opacity:0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
              };
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(error).catch(fallback);
              } else {
                fallback();
              }
            }}
            className="shrink-0 text-red/60 hover:text-red transition-colors p-0.5"
            title="Copy error"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-red/60 hover:text-red transition-colors p-0.5"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {loading && files.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={18} className="text-mauve animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {files.length === 0 && !loading && (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>Working tree clean</div>
          )}

          {/* Staged files */}
          {stagedFiles.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface0/30 border-b border-surface0">
                <span className="text-green" style={{ fontSize: 12 }}>Staged ({stagedFiles.length})</span>
                <div className="flex-1" />
                <button
                  onClick={() => doAction("git:unstage", { files: stagedFiles.map(f => f.path) })}
                  disabled={actionLoading !== null}
                  className="text-overlay1 hover:text-text transition-colors"
                  style={{ fontSize: 12 }}
                >
                  Unstage All
                </button>
              </div>
              {stagedFiles.map(f => (
                <div key={"s-" + f.path} className="flex items-center gap-2 px-3 py-1 border-b border-surface0/50 hover:bg-surface0/30 transition-colors group" style={{ fontSize: 13 }}>
                  {gitFileIcon(f.index, " ")}
                  <button onClick={() => viewDiff(f.path, true)} className="text-text truncate text-left flex-1 hover:text-mauve transition-colors">{f.path}</button>
                  <button
                    onClick={() => doAction("git:unstage", { files: [f.path] })}
                    className="text-overlay0 hover:text-text opacity-0 group-hover:opacity-100 transition-all"
                    title="Unstage"
                  >
                    <Minus size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Unstaged / untracked files */}
          {unstagedFiles.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface0/30 border-b border-surface0">
                <span className="text-yellow" style={{ fontSize: 12 }}>Changes ({unstagedFiles.length})</span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    const toStage = selectedFiles.size > 0
                      ? unstagedFiles.filter(f => selectedFiles.has(f.path)).map(f => f.path)
                      : unstagedFiles.map(f => f.path);
                    doAction("git:stage", { files: toStage });
                    setSelectedFiles(new Set());
                  }}
                  disabled={actionLoading !== null}
                  className="text-overlay1 hover:text-text transition-colors"
                  style={{ fontSize: 12 }}
                >
                  {selectedFiles.size > 0 ? `Stage Selected (${selectedFiles.size})` : "Stage All"}
                </button>
              </div>
              {unstagedFiles.map(f => (
                <div key={"u-" + f.path} className="flex items-center gap-2 px-3 py-1 border-b border-surface0/50 hover:bg-surface0/30 transition-colors group" style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(f.path)}
                    onChange={() => toggleFile(f.path)}
                    className="accent-mauve"
                  />
                  {gitFileIcon(f.index, f.working)}
                  <button onClick={() => viewDiff(f.path, false)} className="text-text truncate text-left flex-1 hover:text-mauve transition-colors">{f.path}</button>
                  <button
                    onClick={() => doAction("git:stage", { files: [f.path] })}
                    className="text-overlay0 hover:text-text opacity-0 group-hover:opacity-100 transition-all"
                    title="Stage"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Commit bar */}
      {stagedFiles.length > 0 && (
        <div className="shrink-0 border-t border-surface0 px-3 py-2 bg-mantle flex items-center gap-2">
          <input
            type="text"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && commitMsg.trim()) {
                doAction("git:commit", { message: commitMsg.trim() });
                setCommitMsg("");
              }
            }}
            placeholder="Commit message..."
            className="flex-1 bg-surface0 text-text placeholder-overlay0 border border-surface1 rounded px-2 py-1 outline-none focus:border-mauve transition-colors"
            style={{ fontSize: 13 }}
          />
          <button
            onClick={() => {
              if (commitMsg.trim()) {
                doAction("git:commit", { message: commitMsg.trim() });
                setCommitMsg("");
              }
            }}
            disabled={!commitMsg.trim() || actionLoading !== null}
            className="px-3 py-1 rounded bg-mauve text-crust hover:bg-mauve/80 disabled:opacity-40 transition-colors"
            style={{ fontSize: 13 }}
          >
            {actionLoading === "git:commit" ? <Loader2 size={13} className="animate-spin" /> : "Commit"}
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="shrink-0 border-t border-surface0 px-3 py-2 bg-mantle flex items-center gap-2">
        <button
          onClick={() => doAction("git:pull")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          {actionLoading === "git:pull" ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
          Pull
        </button>
        <button
          onClick={() => doAction("git:push")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          {actionLoading === "git:push" ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
          Push
        </button>
        <button
          onClick={() => doAction("git:stash")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          Stash
        </button>
        <button
          onClick={() => doAction("git:stash-pop")}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors disabled:opacity-40"
          style={{ fontSize: 12 }}
        >
          Pop
        </button>
        <div className="flex-1" />
        <button
          onClick={() => { loadLog(); setShowLog(true); }}
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface0 hover:bg-surface1 text-text transition-colors"
          style={{ fontSize: 12 }}
        >
          <GitCommit size={12} />
          Log
        </button>
      </div>
    </div>
  );
}

// --- Docker Logs ---

function DockerLogs({ project }: { project: ExtensionProject }) {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

  const inst = project.vpsInstances[0];

  const loadLogs = useCallback(async () => {
    if (!inst) return;
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest("vps:docker:logs", { projectId: project.id, instanceId: inst.id }, 30000);
      if (res.ok) {
        setContainers(res.containers);
        if (res.containers.length > 0 && !expandedContainer) {
          setExpandedContainer(res.containers[0].name);
        }
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project.id, inst?.id, expandedContainer]);

  useEffect(() => {
    loadLogs();
  }, []);

  if (!inst) return <div className="p-4 text-overlay0" style={{ fontSize: 13 }}>No VPS instance available.</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <Container size={13} className="text-mauve" />
        <span className="text-text" style={{ fontSize: 13 }}>Docker Containers</span>
        <div className="flex-1" />
        <button onClick={loadLogs} disabled={loading} className="text-overlay1 hover:text-text transition-colors p-1">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-red bg-red/10 border-b border-red/20" style={{ fontSize: 13 }}>{error}</div>
      )}

      {loading && containers.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={18} className="text-mauve animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {containers.length === 0 && !loading && (
            <div className="text-overlay0 text-center py-8" style={{ fontSize: 13 }}>No containers found</div>
          )}
          {containers.map((c) => {
            const isUp = c.status.toLowerCase().includes("up");
            const isExpanded = expandedContainer === c.name;
            return (
              <div key={c.name} className="border-b border-surface0">
                <button
                  onClick={() => setExpandedContainer(isExpanded ? null : c.name)}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-surface0/50 transition-colors text-left"
                  style={{ fontSize: 13 }}
                >
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isUp ? "bg-green" : "bg-overlay0"}`} />
                  <span className="text-text truncate">{c.name}</span>
                  <span className="text-overlay0 ml-auto shrink-0" style={{ fontSize: 12 }}>{c.status}</span>
                </button>
                {isExpanded && (
                  <pre className="px-3 py-2 bg-mantle text-subtext0 overflow-x-auto whitespace-pre-wrap break-words" style={{ fontSize: 12, lineHeight: 1.5, maxHeight: 400 }}>
                    {c.logs || "(no logs)"}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Database Explorer Tab ---

interface DbTableInfo {
  name: string;
  rowCount: number | null;
}

interface DbQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  error?: string;
}

interface SavedQuery {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  description: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
  userAvatar: string | null;
}

function DbExplorer({ project }: { project: ExtensionProject }) {
  const inst = project.vpsInstances[0];
  const [tables, setTables] = useState<DbTableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<DbQueryResult | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [sqlQuery, setSqlQuery] = useState("");
  const [sqlResult, setSqlResult] = useState<DbQueryResult | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [mode, setMode] = useState<"tables" | "sql" | "saved">("tables");
  const [sidebarWidth, setSidebarWidth] = useState(192);
  const [dbUrl, setDbUrl] = useState(project.dbUrl || "");
  const [dbConnected, setDbConnected] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<{ original: Record<string, any>; edited: Record<string, any>; columns: string[] } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [primaryKeys, setPrimaryKeys] = useState<Record<string, string[]>>({});
  const [savedQueriesList, setSavedQueriesList] = useState<SavedQuery[]>([]);
  const [savedQueriesLoading, setSavedQueriesLoading] = useState(false);
  const [saveQueryForm, setSaveQueryForm] = useState<{ name: string; description: string; queryId?: string } | null>(null);
  const [saveQueryLoading, setSaveQueryLoading] = useState(false);

  // Auto-connect if project has a stored dbUrl, otherwise try to detect
  useEffect(() => {
    if (!inst) return;
    (async () => {
      let url = project.dbUrl || "";
      if (!url) {
        // Try to detect DATABASE_URL from the remote .env
        try {
          const res = await wsRequest("vps:db:detect", { projectId: project.id, instanceId: inst.id }, 15000);
          if (res.ok && res.url) url = res.url;
        } catch { /* ignore */ }
      }
      if (url) {
        setDbUrl(url);
        setConnectLoading(true);
        try {
          const connRes = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl: url }, 15000);
          if (connRes.ok) {
            setTables(connRes.tables);
            setDbConnected(true);
          } else {
            setConnectError(connRes.error);
          }
        } catch (err: any) {
          setConnectError(err.message);
        }
        setConnectLoading(false);
      }
      setLoading(false);
    })();
  }, [project.id, inst?.id]);

  const connectDb = useCallback(async () => {
    if (!inst || !dbUrl.trim()) return;
    setConnectLoading(true);
    setConnectError(null);
    try {
      const res = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl: dbUrl.trim() }, 15000);
      if (res.ok) {
        setTables(res.tables);
        setDbConnected(true);
        setConnectError(null);
      } else {
        setConnectError(res.error);
      }
    } catch (err: any) {
      setConnectError(err.message);
    }
    setConnectLoading(false);
  }, [project.id, inst?.id, dbUrl]);

  const refreshTables = useCallback(async () => {
    if (!inst || !dbUrl) return;
    setLoading(true);
    try {
      const res = await wsRequest("vps:db:tables", { projectId: project.id, instanceId: inst.id, dbUrl }, 15000);
      if (res.ok) setTables(res.tables);
    } catch { /* ignore */ }
    setLoading(false);
  }, [project.id, inst?.id, dbUrl]);

  const loadTableData = useCallback(async (tableName: string) => {
    if (!inst) return;
    setSelectedTable(tableName);
    setTableLoading(true);
    setTableData(null);
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl,
        query: `SELECT * FROM "${tableName}" LIMIT 100`,
      }, 30000);
      if (res.ok) {
        setTableData(res.result);
      } else {
        setTableData({ columns: [], rows: [], rowCount: 0, error: res.error });
      }
    } catch (err: any) {
      setTableData({ columns: [], rows: [], rowCount: 0, error: err.message });
    }
    setTableLoading(false);
  }, [project.id, inst?.id, dbUrl]);

  const runSql = useCallback(async () => {
    if (!inst || !sqlQuery.trim()) return;
    setSqlLoading(true);
    setSqlResult(null);
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl,
        query: sqlQuery.trim(),
      }, 30000);
      if (res.ok) {
        setSqlResult(res.result);
      } else {
        setSqlResult({ columns: [], rows: [], rowCount: 0, error: res.error });
      }
    } catch (err: any) {
      setSqlResult({ columns: [], rows: [], rowCount: 0, error: err.message });
    }
    setSqlLoading(false);
  }, [project.id, inst?.id, dbUrl, sqlQuery]);

  // Fetch primary key columns for a table (cached)
  const fetchPrimaryKeys = useCallback(async (tableName: string): Promise<string[]> => {
    if (primaryKeys[tableName]) return primaryKeys[tableName];
    if (!inst) return [];
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl,
        query: `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '"${tableName}"'::regclass AND i.indisprimary ORDER BY a.attnum`,
      }, 10000);
      const pks = res.ok && res.result?.rows ? res.result.rows.map((r: any) => r.attname) : [];
      setPrimaryKeys((prev) => ({ ...prev, [tableName]: pks }));
      return pks;
    } catch { return []; }
  }, [project.id, inst?.id, dbUrl, primaryKeys]);

  const openRowEditor = useCallback(async (row: Record<string, any>, columns: string[]) => {
    setEditingRow({ original: { ...row }, edited: { ...row }, columns });
    setEditError(null);
    if (selectedTable) fetchPrimaryKeys(selectedTable);
  }, [selectedTable, fetchPrimaryKeys]);

  const saveRow = useCallback(async () => {
    if (!inst || !editingRow || !selectedTable) return;
    const pks = primaryKeys[selectedTable] || await fetchPrimaryKeys(selectedTable);
    if (pks.length === 0) {
      setEditError("Cannot update: no primary key found for this table.");
      return;
    }

    // Build SET clause for changed fields only
    const changed: string[] = [];
    for (const col of editingRow.columns) {
      if (editingRow.edited[col] !== editingRow.original[col]) {
        const val = editingRow.edited[col];
        changed.push(`"${col}" = ${val === null || val === "NULL" ? "NULL" : `'${String(val).replace(/'/g, "''")}'`}`);
      }
    }
    if (changed.length === 0) { setEditingRow(null); return; }

    // Build WHERE clause from primary key
    const where = pks.map((pk) => {
      const val = editingRow.original[pk];
      return val === null ? `"${pk}" IS NULL` : `"${pk}" = '${String(val).replace(/'/g, "''")}'`;
    }).join(" AND ");

    const query = `UPDATE "${selectedTable}" SET ${changed.join(", ")} WHERE ${where}`;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await wsRequest("vps:db:query", {
        projectId: project.id, instanceId: inst.id, dbUrl, query,
      }, 15000);
      if (res.ok) {
        setEditingRow(null);
        // Refresh table data
        loadTableData(selectedTable);
      } else {
        setEditError(res.error || "Update failed");
      }
    } catch (err: any) {
      setEditError(err.message);
    }
    setEditSaving(false);
  }, [inst, editingRow, selectedTable, primaryKeys, fetchPrimaryKeys, project.id, dbUrl, loadTableData]);

  const loadSavedQueries = useCallback(async () => {
    setSavedQueriesLoading(true);
    try {
      const res = await wsRequest("db:saved-queries:list", { projectId: project.id }, 10000);
      if (res.ok) setSavedQueriesList(res.queries);
    } catch { /* ignore */ }
    setSavedQueriesLoading(false);
  }, [project.id]);

  // Load saved queries when switching to saved tab
  useEffect(() => {
    if (mode === "saved") loadSavedQueries();
  }, [mode, loadSavedQueries]);

  const handleSaveQuery = useCallback(async () => {
    if (!saveQueryForm || !saveQueryForm.name.trim() || !sqlQuery.trim()) return;
    setSaveQueryLoading(true);
    try {
      const res = await wsRequest("db:saved-queries:save", {
        projectId: project.id,
        name: saveQueryForm.name.trim(),
        description: saveQueryForm.description.trim(),
        query: sqlQuery.trim(),
        queryId: saveQueryForm.queryId,
      }, 10000);
      if (res.ok) setSavedQueriesList(res.queries);
      setSaveQueryForm(null);
    } catch { /* ignore */ }
    setSaveQueryLoading(false);
  }, [project.id, saveQueryForm, sqlQuery]);

  const deleteSavedQuery = useCallback(async (queryId: string) => {
    try {
      const res = await wsRequest("db:saved-queries:delete", { projectId: project.id, queryId }, 10000);
      if (res.ok) setSavedQueriesList(res.queries);
    } catch { /* ignore */ }
  }, [project.id]);

  const loadSavedQuery = useCallback((sq: SavedQuery) => {
    setSqlQuery(sq.query);
    setMode("sql");
  }, []);

  if (!inst) return <div className="p-4 text-overlay0" style={{ fontSize: 13 }}>No VPS instance available.</div>;

  // Connection form
  if (!dbConnected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
          <Database size={13} className="text-mauve" />
          <span className="text-text" style={{ fontSize: 13 }}>Database Explorer</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
          {loading ? (
            <Loader2 size={18} className="text-mauve animate-spin" />
          ) : (
            <>
              <p className="text-overlay0" style={{ fontSize: 13 }}>Enter a PostgreSQL connection URL</p>
              <input
                type="text"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && connectDb()}
                placeholder="postgres://user:pass@localhost:5432/dbname"
                className="w-full bg-surface0 text-text rounded px-3 py-2 outline-none focus:ring-1 focus:ring-mauve"
                style={{ fontSize: 13 }}
              />
              {connectError && <p className="text-red" style={{ fontSize: 13 }}>{connectError}</p>}
              <button
                onClick={connectDb}
                disabled={connectLoading || !dbUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 13 }}
              >
                {connectLoading ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                Connect
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <Database size={13} className="text-mauve" />
        <span className="text-text" style={{ fontSize: 13 }}>Database</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 bg-surface0 rounded p-0.5">
          {(["tables", "sql", "saved"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded transition-colors ${mode === m ? "bg-surface1 text-text" : "text-overlay1 hover:text-text"}`}
              style={{ fontSize: 12 }}
            >
              {m === "tables" ? "Tables" : m === "sql" ? "SQL" : "Saved"}
            </button>
          ))}
        </div>
        <button onClick={refreshTables} disabled={loading} className="text-overlay1 hover:text-text transition-colors p-1">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <div className="px-3 py-2 text-red bg-red/10 border-b border-red/20" style={{ fontSize: 13 }}>{error}</div>}

      {mode === "tables" ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Table list sidebar */}
          <div className="overflow-y-auto shrink-0 relative" style={{ width: sidebarWidth }}>
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => loadTableData(t.name)}
                className={`flex items-center gap-2 w-full min-w-0 px-3 py-1.5 text-left transition-colors ${
                  selectedTable === t.name ? "bg-surface0 text-mauve" : "text-text hover:bg-surface0/50"
                }`}
                style={{ fontSize: 13 }}
              >
                <Table2 size={12} className="shrink-0 text-overlay1" />
                <span className="truncate min-w-0">{t.name}</span>
                {t.rowCount !== null && <span className="ml-auto text-overlay0 shrink-0" style={{ fontSize: 11 }}>{t.rowCount}</span>}
              </button>
            ))}
            {tables.length === 0 && !loading && (
              <div className="text-overlay0 text-center py-4" style={{ fontSize: 13 }}>No tables</div>
            )}
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-mauve/40 active:bg-mauve/60 transition-colors"
              onPointerDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = sidebarWidth;
                const onMove = (ev: PointerEvent) => {
                  setSidebarWidth(Math.max(100, Math.min(400, startW + ev.clientX - startX)));
                };
                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
              }}
            />
          </div>

          {/* Table data view */}
          <div className="flex-1 overflow-auto">
            {tableLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={18} className="text-mauve animate-spin" />
              </div>
            ) : tableData ? (
              tableData.error ? (
                <div className="p-3 text-red" style={{ fontSize: 13 }}>{tableData.error}</div>
              ) : (
                <div className="overflow-auto h-full">
                  <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                    <thead>
                      <tr className="bg-mantle sticky top-0">
                        {tableData.columns.map((col) => (
                          <th key={col} className="text-left px-2 py-1.5 border-b border-surface0 text-overlay1 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-surface0/50 hover:bg-surface0/30 cursor-pointer"
                          onClick={() => openRowEditor(row, tableData.columns)}
                        >
                          {tableData.columns.map((col) => (
                            <td key={col} className="px-2 py-1 text-text whitespace-nowrap max-w-[200px] truncate">{formatCellValue(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {tableData.rows.length === 0 && <div className="text-overlay0 text-center py-4" style={{ fontSize: 13 }}>No rows</div>}
                  {tableData.rows.length > 0 && (
                    <div className="px-2 py-1 text-overlay0 bg-mantle border-t border-surface0" style={{ fontSize: 11 }}>
                      Showing {tableData.rows.length} rows (limit 100)
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-overlay0" style={{ fontSize: 13 }}>Select a table</div>
            )}
          </div>
        </div>
      ) : (
        /* SQL mode */
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 shrink-0">
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSql(); } }}
              placeholder="SELECT * FROM ..."
              rows={3}
              className="flex-1 bg-surface0 text-text rounded px-3 py-2 outline-none focus:ring-1 focus:ring-mauve resize-none font-mono"
              style={{ fontSize: 12 }}
            />
            <div className="flex flex-col gap-1.5 shrink-0 self-end">
              <button
                onClick={runSql}
                disabled={sqlLoading || !sqlQuery.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 13 }}
              >
                {sqlLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Run
              </button>
              <button
                onClick={() => setSaveQueryForm({ name: "", description: "" })}
                disabled={!sqlQuery.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-overlay1 hover:text-text border border-surface1 rounded hover:bg-surface0 transition-colors disabled:opacity-50"
                style={{ fontSize: 12 }}
              >
                <Save size={12} />
                Save
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {sqlLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={18} className="text-mauve animate-spin" />
              </div>
            ) : sqlResult ? (
              sqlResult.error ? (
                <div className="p-3 text-red font-mono whitespace-pre-wrap" style={{ fontSize: 12 }}>{sqlResult.error}</div>
              ) : (
                <div className="overflow-auto h-full">
                  <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                    <thead>
                      <tr className="bg-mantle sticky top-0">
                        {sqlResult.columns.map((col) => (
                          <th key={col} className="text-left px-2 py-1.5 border-b border-surface0 text-overlay1 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sqlResult.rows.map((row, i) => (
                        <tr key={i} className="border-b border-surface0/50 hover:bg-surface0/30">
                          {sqlResult.columns.map((col) => (
                            <td key={col} className="px-2 py-1 text-text whitespace-nowrap max-w-[200px] truncate">{formatCellValue(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-2 py-1 text-overlay0 bg-mantle border-t border-surface0" style={{ fontSize: 11 }}>
                    {sqlResult.rows.length} row{sqlResult.rows.length !== 1 ? "s" : ""} returned
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-overlay0" style={{ fontSize: 13 }}>
                Press Cmd+Enter to run query
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved queries tab */}
      {mode === "saved" && (
        <div className="flex-1 overflow-y-auto">
          {savedQueriesLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={18} className="text-mauve animate-spin" />
            </div>
          ) : savedQueriesList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-overlay0 gap-2" style={{ fontSize: 13 }}>
              <SearchCode size={24} className="text-overlay0" />
              <p>No saved queries yet.</p>
              <p style={{ fontSize: 12 }}>Write a query in the SQL tab and save it.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {savedQueriesList.map((sq) => (
                <div
                  key={sq.id}
                  className="flex items-start gap-3 px-3 py-2.5 border-b border-surface0 hover:bg-surface0/30 transition-colors cursor-pointer group"
                  onClick={() => loadSavedQuery(sq)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text font-medium truncate" style={{ fontSize: 13 }}>{sq.name}</span>
                    </div>
                    {sq.description && (
                      <p className="text-overlay0 mt-0.5 line-clamp-2" style={{ fontSize: 12 }}>{sq.description}</p>
                    )}
                    <pre className="text-overlay1 mt-1 truncate font-mono" style={{ fontSize: 11 }}>{sq.query}</pre>
                    <div className="flex items-center gap-2 mt-1">
                      {sq.userName && (
                        <span className="text-overlay0 flex items-center gap-1" style={{ fontSize: 11 }}>
                          {sq.userAvatar && <img src={sq.userAvatar} className="w-3 h-3 rounded-full" />}
                          {sq.userName}
                        </span>
                      )}
                      <span className="text-overlay0" style={{ fontSize: 11 }}>
                        {new Date(sq.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSqlQuery(sq.query); setSaveQueryForm({ name: sq.name, description: sq.description, queryId: sq.id }); setMode("sql"); }}
                      className="text-overlay1 hover:text-text p-1 rounded hover:bg-surface0"
                      title="Edit"
                    >
                      <File size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSavedQuery(sq.id); }}
                      className="text-overlay1 hover:text-red p-1 rounded hover:bg-surface0"
                      title="Delete"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Save query dialog */}
      {saveQueryForm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSaveQueryForm(null)} />
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] bg-mantle border border-surface0 rounded-lg shadow-xl z-50 flex flex-col"
            style={{ animation: "dbDrawerSlideIn 0.15s ease-out" }}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
              <span className="text-text font-medium" style={{ fontSize: 13 }}>{saveQueryForm.queryId ? "Update" : "Save"} Query</span>
              <div className="flex-1" />
              <button onClick={() => setSaveQueryForm(null)} className="text-overlay1 hover:text-text"><X size={14} /></button>
            </div>
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <label className="text-overlay1" style={{ fontSize: 12 }}>Name</label>
                <input
                  type="text"
                  value={saveQueryForm.name}
                  onChange={(e) => setSaveQueryForm((p) => p ? { ...p, name: e.target.value } : null)}
                  placeholder="e.g. Active users"
                  className="bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve"
                  style={{ fontSize: 13 }}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-overlay1" style={{ fontSize: 12 }}>Description</label>
                <textarea
                  value={saveQueryForm.description}
                  onChange={(e) => setSaveQueryForm((p) => p ? { ...p, description: e.target.value } : null)}
                  placeholder="What does this query do?"
                  rows={2}
                  className="bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve resize-none"
                  style={{ fontSize: 13 }}
                />
              </div>
              <pre className="text-overlay1 bg-surface0 rounded px-2.5 py-1.5 font-mono overflow-x-auto whitespace-pre-wrap" style={{ fontSize: 11, maxHeight: 80 }}>
                {sqlQuery}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
              <button onClick={() => setSaveQueryForm(null)} className="px-3 py-1.5 text-overlay1 hover:text-text" style={{ fontSize: 13 }}>Cancel</button>
              <button
                onClick={handleSaveQuery}
                disabled={saveQueryLoading || !saveQueryForm.name.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 13 }}
              >
                {saveQueryLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saveQueryForm.queryId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Row edit drawer */}
      {editingRow && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setEditingRow(null)} />
          <div
            className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-mantle border-l border-surface0 z-50 flex flex-col shadow-xl"
            style={{ animation: "dbDrawerSlideIn 0.2s ease-out" }}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 bg-mantle shrink-0">
              <span className="text-text font-medium" style={{ fontSize: 13 }}>Edit Row</span>
              <div className="flex-1" />
              <button onClick={() => setEditingRow(null)} className="text-overlay1 hover:text-text transition-colors">
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {editingRow.columns.map((col) => {
                const val = editingRow.edited[col];
                const isNull = val === null || val === undefined;
                return (
                  <div key={col} className="flex flex-col gap-1">
                    <label className="text-overlay1 font-medium" style={{ fontSize: 12 }}>{col}</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={isNull ? "" : String(val)}
                        onChange={(e) => setEditingRow((prev) => prev ? {
                          ...prev,
                          edited: { ...prev.edited, [col]: e.target.value || null },
                        } : null)}
                        placeholder="NULL"
                        className={`flex-1 bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve font-mono ${isNull ? "text-overlay0 italic" : ""}`}
                        style={{ fontSize: 12 }}
                      />
                      <button
                        onClick={() => setEditingRow((prev) => prev ? {
                          ...prev,
                          edited: { ...prev.edited, [col]: null },
                        } : null)}
                        className={`px-1.5 py-1 rounded text-overlay1 hover:text-text hover:bg-surface0 transition-colors shrink-0 ${isNull ? "text-mauve" : ""}`}
                        style={{ fontSize: 10 }}
                        title="Set NULL"
                      >
                        NULL
                      </button>
                    </div>
                    {editingRow.edited[col] !== editingRow.original[col] && (
                      <span className="text-yellow" style={{ fontSize: 11 }}>
                        was: {formatCellValue(editingRow.original[col])}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {editError && (
              <div className="px-4 py-2 text-red bg-red/10 border-t border-red/20" style={{ fontSize: 12 }}>{editError}</div>
            )}

            <div className="flex items-center gap-2 px-4 py-3 border-t border-surface0 bg-mantle shrink-0">
              <button
                onClick={() => setEditingRow(null)}
                className="px-3 py-1.5 text-overlay1 hover:text-text transition-colors rounded"
                style={{ fontSize: 13 }}
              >
                Cancel
              </button>
              <div className="flex-1" />
              <button
                onClick={saveRow}
                disabled={editSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-mauve text-crust rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 13 }}
              >
                {editSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatCellValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// --- Team Chat Tab (compact for extension) ---

function ExtTeamChat() {
  const [cc] = useSubject($conversationChat);
  const [auth] = useSubject($auth);
  const { conversations, activeConversationId, messages, members, loading, streamingContent, users, unreadCounts, mentionNotifications } = cc;
  const authUser = auth.user;
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const creatingGenieDmRef = useRef(false);

  useEffect(() => {
    loadConversations();
    loadChatUsers();
  }, []);

  // Auto-create Genie DM if none exists
  useEffect(() => {
    if (conversations.length === 0 || creatingGenieDmRef.current) return;
    const hasGenie = conversations.some((c) => c.type === "dm" && c.members.some((m) => m.isAgent));
    if (!hasGenie) {
      creatingGenieDmRef.current = true;
      createGenieDm();
    }
  }, [conversations]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendConversationMessage(text);
  }

  // Conversation list view
  if (!activeConversationId) {
    const dms = conversations.filter((c) => c.type === "dm");
    const rooms = conversations.filter((c) => c.type === "room");

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          {dms.length > 0 && (
            <div className="px-3 pt-3">
              <p className="text-overlay0 font-semibold uppercase tracking-wide px-1 pb-1" style={{ fontSize: 11 }}>Direct Messages</p>
              {dms.map((conv) => (
                <ExtConvItem key={conv.id} conv={conv} unread={unreadCounts[conv.id] || 0} hasMention={mentionNotifications.some((n) => n.conversationId === conv.id)} />
              ))}
            </div>
          )}
          {rooms.length > 0 && (
            <div className="px-3 pt-3">
              <p className="text-overlay0 font-semibold uppercase tracking-wide px-1 pb-1" style={{ fontSize: 11 }}>Rooms</p>
              {rooms.map((conv) => (
                <ExtConvItem key={conv.id} conv={conv} unread={unreadCounts[conv.id] || 0} hasMention={mentionNotifications.some((n) => n.conversationId === conv.id)} />
              ))}
            </div>
          )}
          {conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-overlay0 py-12" style={{ fontSize: 13 }}>
              <Users size={24} className="mb-2 opacity-40" />
              <p>No conversations yet</p>
            </div>
          )}
        </div>

        {/* Online users */}
        <div className="border-t border-surface0 px-3 py-2 shrink-0">
          <p className="text-overlay0 font-semibold uppercase tracking-wide px-1 pb-1" style={{ fontSize: 11 }}>Online</p>
          <div className="flex flex-wrap gap-1">
            {users.filter((u) => u.online && u.id !== authUser?.id).map((u) => (
              <span key={u.id} className="flex items-center gap-1 px-1.5 py-0.5 bg-surface0 rounded-md" style={{ fontSize: 12 }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" />
                {u.isAgent ? <Bot size={10} className="text-blue" /> : null}
                <span className="text-text truncate" style={{ maxWidth: 80 }}>{u.name}</span>
              </span>
            ))}
            {users.filter((u) => u.online && u.id !== authUser?.id).length === 0 && (
              <span className="text-overlay0" style={{ fontSize: 12 }}>No one online</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active conversation messages view
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const convName = activeConv?.type === "dm"
    ? activeConv.members.find((m) => m.isAgent)?.name || "DM"
    : activeConv?.name || "Room";

  return (
    <div className="flex flex-col h-full">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface0 bg-mantle shrink-0">
        <button onClick={() => $conversationChat.nextAssign({ activeConversationId: null })} className="text-overlay1 hover:text-text transition-colors p-0.5">
          <ArrowLeft size={14} />
        </button>
        {activeConv?.type === "dm" ? <Bot size={13} className="text-blue" /> : <Users size={13} className="text-mauve" />}
        <span className="text-text font-medium truncate" style={{ fontSize: 13 }}>{convName}</span>
        <div className="flex-1" />
        {activeConv?.type === "room" && (
          <span className="text-overlay0" style={{ fontSize: 11 }}>{members.length} members</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center flex-1">
            <Loader2 size={16} className="text-mauve animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-overlay0" style={{ fontSize: 13 }}>
            <p>Send a message to start</p>
          </div>
        )}

        {messages.map((msg) => (
          <ExtMessageRow key={msg.id} msg={msg} isOwn={msg.senderId === authUser?.id} />
        ))}

        {streamingContent && (
          <div className="flex items-start gap-1.5">
            <div className="w-4 h-4 rounded-full bg-blue/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={10} className="text-blue" />
            </div>
            <div className="text-text whitespace-pre-wrap" style={{ fontSize: 13 }}>{streamingContent}<span className="inline-block w-1 h-3 bg-text/50 ml-0.5 animate-pulse align-text-bottom" /></div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-surface0 bg-mantle px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Message..."
            className="flex-1 bg-surface0 text-text rounded-md px-2.5 py-1.5 outline-none placeholder:text-overlay0 border border-surface1 focus:border-mauve/40 transition-colors"
            style={{ fontSize: 13 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-1.5 rounded-md bg-mauve text-crust hover:bg-lavender transition-colors shrink-0 disabled:opacity-30"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtConvItem({ conv, unread, hasMention }: { conv: ConversationSummary; unread: number; hasMention: boolean }) {
  const isDm = conv.type === "dm";
  const name = isDm ? conv.members.find((m) => m.isAgent)?.name || "Genie" : conv.name || "Untitled Room";
  const Icon = isDm ? Bot : Users;

  return (
    <button
      onClick={() => selectConversation(conv.id)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface0/50 transition-colors text-left"
    >
      <Icon size={13} className="text-overlay0 shrink-0" />
      <span className={`flex-1 truncate ${unread > 0 ? "text-text font-medium" : "text-subtext0"}`} style={{ fontSize: 13 }}>{name}</span>
      {hasMention && <span className="w-2 h-2 rounded-full bg-blue shrink-0" />}
      {!hasMention && unread > 0 && (
        <span className="min-w-[16px] h-4 rounded-full bg-surface1 text-subtext0 flex items-center justify-center px-1 shrink-0" style={{ fontSize: 10 }}>{unread > 99 ? "99+" : unread}</span>
      )}
    </button>
  );
}

function ExtMessageRow({ msg, isOwn }: { msg: ConvMessage; isOwn: boolean }) {
  const time = new Date(msg.createdAt);
  const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`;

  return (
    <div className={`flex items-start gap-1.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      {!isOwn && (
        <div className="w-4 h-4 rounded-full bg-surface1 flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
          {msg.isAgent ? (
            <Bot size={10} className="text-blue" />
          ) : msg.senderAvatar ? (
            <img src={msg.senderAvatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="font-medium text-subtext0" style={{ fontSize: 8 }}>{msg.senderName[0]?.toUpperCase()}</span>
          )}
        </div>
      )}
      <div className={`max-w-[80%] ${isOwn ? "items-end" : ""}`}>
        {!isOwn && (
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-overlay0 font-medium" style={{ fontSize: 11 }}>{msg.senderName}</span>
            <span className="text-overlay0" style={{ fontSize: 10 }}>{timeStr}</span>
          </div>
        )}
        <div className={`rounded-lg px-2.5 py-1.5 ${isOwn ? "bg-mauve/15 text-text" : msg.isAgent ? "bg-surface0 text-text" : "bg-surface0 text-text"}`}>
          <div className="whitespace-pre-wrap break-words" style={{ fontSize: 13, lineHeight: 1.5 }}>{msg.content}</div>
        </div>
        {isOwn && (
          <div className="text-right">
            <span className="text-overlay0" style={{ fontSize: 10 }}>{timeStr}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Share Terminal Popup ---

function ShareTerminalPopup({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [cc] = useSubject($conversationChat);
  const [auth] = useSubject($auth);
  const { users } = cc;
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const onlineUsers = users.filter((u) => u.online && !u.isAgent && u.id !== auth.user?.id);

  useEffect(() => {
    function handleSent() { setStatus("sent"); setTimeout(onClose, 1200); }
    function handleError(e: Event) {
      const detail = (e as CustomEvent).detail;
      setStatus("error");
      setErrorMsg(detail?.message || "Failed to share");
    }
    window.addEventListener("genie:terminal:share:sent", handleSent);
    window.addEventListener("genie:terminal:share:error", handleError);
    return () => {
      window.removeEventListener("genie:terminal:share:sent", handleSent);
      window.removeEventListener("genie:terminal:share:error", handleError);
    };
  }, [onClose]);

  return (
    <div className="absolute top-full right-0 mt-1 w-48 bg-mantle border border-surface0 rounded-lg shadow-lg z-50 overflow-hidden">
      <div className="px-3 py-2 border-b border-surface0">
        <span className="text-text font-medium" style={{ fontSize: 12 }}>Share terminal with</span>
      </div>
      {status === "sent" && (
        <div className="px-3 py-3 text-green text-center" style={{ fontSize: 12 }}>Invite sent!</div>
      )}
      {status === "error" && (
        <div className="px-3 py-2 text-red text-center" style={{ fontSize: 12 }}>{errorMsg}</div>
      )}
      {status === "idle" && (
        <div className="max-h-[200px] overflow-y-auto">
          {onlineUsers.length === 0 && (
            <div className="px-3 py-3 text-overlay0 text-center" style={{ fontSize: 12 }}>No users online</div>
          )}
          {onlineUsers.map((user) => (
            <button
              key={user.id}
              onClick={() => { shareTerminal(sessionId, user.id); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface0/50 transition-colors text-left"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" />
              <span className="text-text truncate" style={{ fontSize: 12 }}>{user.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Terminal Share Invite Banner ---

function ShareInviteBanner({ invite, onAccept, onDecline }: { invite: TerminalShareInvite; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue/10 border-b border-blue/20 shrink-0">
      <Share2 size={13} className="text-blue shrink-0" />
      <span className="flex-1 text-text truncate" style={{ fontSize: 12 }}>
        <span className="font-medium">{invite.ownerName}</span> shared a terminal
      </span>
      <button
        onClick={onAccept}
        className="px-2 py-0.5 rounded bg-blue/20 text-blue hover:bg-blue/30 transition-colors font-medium"
        style={{ fontSize: 11 }}
      >Join</button>
      <button
        onClick={onDecline}
        className="px-2 py-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
        style={{ fontSize: 11 }}
      >Dismiss</button>
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

  // Fetch stats for all VPS instances on mount and every 15s
  useEffect(() => {
    const fetchAll = () => {
      for (const p of dropletsWithVps) {
        for (const inst of p.vpsInstances) {
          fetchVpsStats(p.id, inst.id);
        }
      }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 15_000);
    return () => clearInterval(interval);
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
              <div key={p.id} className="bg-mantle rounded-lg px-3 py-2">
                <DropletInstanceBar
                  name={p.name}
                  status={statsError ? "unreachable" : stats ? "active" : "checking"}
                  ip={ip}
                  region={inst?.digitalocean?.region}
                  sizeSlug={inst?.digitalocean?.size}
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

  /** Open a regular SSH terminal tab that will inject a command after connection */
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
        openCommandTerminal(detail.commandName, detail.command);
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
  }, [openCommandTerminal]);

  // Extension context from parent iframe
  const extensionCtx = useRef<{
    project: ExtensionProject | null;
    tabUrl: string;
    snapshot: string;
  }>({ project: null, tabUrl: "", snapshot: "" });
  const [projectState, setProjectState] = useState<ExtensionProject | null>(null);
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
          break;

        case "genie:context-update":
          extensionCtx.current.project = data.project;
          extensionCtx.current.tabUrl = data.tabUrl;
          setProjectState(data.project);
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
  const tabUrl = extensionCtx.current.tabUrl;
  let hostname = "";
  try { hostname = new URL(tabUrl).hostname; } catch { /* ignore */ }

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
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.action && tab.id === "claude") {
                  openCommandTerminal("Claude", "claude");
                } else {
                  setActiveTab(tab.id as ExtTab);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                !tab.action && activeTab === tab.id
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
    </div>
  );
}
