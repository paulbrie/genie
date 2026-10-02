"use client";

// Extension-side file browser + Monaco-based file editor. Talks to the manager's
// `vps:fs:*` handlers (readDirectory, readFile, writeFile, rename, delete).
// The editor's catppuccin-mocha theme + `getFileLanguage` detection are local
// because nothing else in the extension uses them.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { BeforeMount } from "@monaco-editor/react";
import { ArrowLeft, File, FileEdit, Folder, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { wsRequest } from "@/lib/ws";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="h-[200px] bg-[#1e1e2e] rounded-md" />,
});

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

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedMs: number;
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
      className="fixed z-[100000] bg-mantle border border-surface1 rounded-lg shadow-lg py-1 min-w-[120px]"
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

export function FileExplorer({ project }: { project: ExtensionProject }) {
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
