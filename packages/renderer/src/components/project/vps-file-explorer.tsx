"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { BeforeMount } from "@monaco-editor/react";
import { File, Folder, ArrowLeft, Save, RefreshCw, Loader2, FileEdit, Trash2, Download, Upload, X } from "lucide-react";
import { wsRequest, wsSend } from "@/lib/ws";
import { formatBytes } from "@/lib/utils";
import { ErrorMessage } from "@/components/ui/error-message";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
      <Loader2 size={14} className="animate-spin mr-2" />Loading editor...
    </div>
  ),
});

// --- Types ---

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedMs: number;
}

export interface FileExplorerProject {
  id: string;
  vpsInstances: { id: string; connection: { host: string } }[];
}

export interface FileExplorerInstance {
  id: string;
  connection: { host: string };
}

// --- Monaco theme ---

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

// --- Context menu ---

function FsContextMenu({ x, y, onRename, onDelete, onDownload, onClose }: {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
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
      // Above the window-manager baseline (nextZIndex starts at 10000) so this menu beats every popup.
      className="fixed z-[100000] bg-crust border border-surface0 rounded-lg shadow-xl py-1 min-w-[120px]"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => { onRename(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-text hover:bg-surface0 transition-colors text-left text-md bg-transparent border-none cursor-pointer"
      >
        <FileEdit size={13} className="text-overlay1" />
        Rename
      </button>
      <button
        onClick={() => { onDownload(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-text hover:bg-surface0 transition-colors text-left text-md bg-transparent border-none cursor-pointer"
      >
        <Download size={13} className="text-overlay1" />
        Download
      </button>
      <button
        onClick={() => { onDelete(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-red hover:bg-red/10 transition-colors text-left text-md bg-transparent border-none cursor-pointer"
      >
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  );
}

// --- File entry ---

function FsFileEntry({ entry, isActive, onOpen, onRename, onDelete, onDownload, children }: {
  entry: FsEntry;
  isActive: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
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

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
        className={`flex items-center gap-2 w-full px-2 py-1.5 hover:bg-surface0/50 transition-colors text-left text-md bg-transparent border-none cursor-pointer ${
          isActive ? "bg-surface0 text-mauve" : "text-text"
        }`}
      >
        {children}
      </button>
      {contextMenu && createPortal(
        <FsContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={onRename}
          onDelete={onDelete}
          onDownload={onDownload}
          onClose={() => setContextMenu(null)}
        />,
        document.body,
      )}
    </>
  );
}

// --- Main component ---

/** When `instance` is provided, the explorer is locked to that specific VM —
 *  use this from the Manage popup so a project with multiple droplets routes
 *  fs ops to the droplet the user opened, not blindly to `vpsInstances[0]`.
 *  Omit `instance` for the project-detail surface, which picks the only one. */
export function FileExplorer({ project, instance }: {
  project: FileExplorerProject;
  instance?: FileExplorerInstance;
}) {
  const [currentPath, setCurrentPath] = useState("/opt/project");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState<{ path: string; content: string; original: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    fileName: string;
    fileIndex: number;
    fileCount: number;
    percent: number;
    bytesDone: number;
    bytesTotal: number;
    speedBps: number;
  } | null>(null);
  const uploadCancelRef = useRef(false);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inst = instance ?? project.vpsInstances[0];
  if (!inst) return <div className="p-4 text-overlay0 text-md">No VPS instance available.</div>;

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

  const downloadEntry = useCallback(async (entry: FsEntry) => {
    try {
      const res = await wsRequest("vps:fs:download", { projectId: project.id, instanceId: inst.id, path: entry.path }, 60000);
      if (res.ok && typeof window !== "undefined") {
        const byteChars = atob(res.data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: "application/gzip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else if (!res.ok) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [project.id, inst.id]);

  const handleUpload = useCallback(async (files: File[]) => {
    if (!inst || files.length === 0) return;
    uploadCancelRef.current = false;
    setUploading(true);
    setError(null);
    setUploadStatus(null);
    let failed = false;
    let cancelled = false;
    const CHUNK_SIZE = 256 * 1024; // base64 chars per chunk (~192KB of file data)
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus({
          fileName: file.name,
          fileIndex: i,
          fileCount: files.length,
          percent: 0,
          bytesDone: 0,
          bytesTotal: file.size,
          speedBps: 0,
        });
        // FileReader does base64 natively — fast for multi-MB files (manual
        // String.fromCharCode loop would be O(n²) and freeze the UI).
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
          };
          reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
          reader.readAsDataURL(file);
        });

        const totalChunks = Math.max(1, Math.ceil(dataBase64.length / CHUNK_SIZE));
        const uploadId = crypto.randomUUID();
        const startedAt = performance.now();
        let lastTickAt = startedAt;
        let lastTickBytes = 0;
        let emaSpeed = 0; // bytes/sec, exponential moving average
        let completed = 0;

        const sendChunk = (c: number) =>
          wsRequest("vps:fs:upload", {
            uploadId,
            projectId: project.id,
            instanceId: inst.id,
            path: currentPath,
            fileName: file.name,
            dataBase64: dataBase64.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE),
            chunkIndex: c,
            totalChunks,
            // Absolute byte offset of this chunk's decoded data. c*CHUNK_SIZE is a
            // multiple of 4, so base64→bytes is exact (4 chars → 3 bytes); lets the
            // server write positionally and accept chunks out of order (pipelined).
            byteOffset: (c * CHUNK_SIZE) / 4 * 3,
          }, 120000);

        const onChunkDone = () => {
          completed += 1;
          const bytesDone = Math.round((completed / totalChunks) * file.size);
          const now = performance.now();
          const dt = (now - lastTickAt) / 1000;
          if (dt > 0) {
            const instant = (bytesDone - lastTickBytes) / dt;
            emaSpeed = emaSpeed === 0 ? instant : emaSpeed * 0.6 + instant * 0.4;
            lastTickAt = now;
            lastTickBytes = bytesDone;
          }
          setUploadStatus({
            fileName: file.name,
            fileIndex: i,
            fileCount: files.length,
            percent: Math.round((completed / totalChunks) * 100),
            bytesDone,
            bytesTotal: file.size,
            speedBps: emaSpeed,
          });
        };

        // Chunk 0 first: it opens the server-side SFTP handle, so it must land
        // before the rest can write. Then pipeline the remainder with a bounded
        // window of concurrent workers — throughput was latency-bound at one
        // in-flight chunk per round-trip (~300 KB/s over the bastion hop).
        if (uploadCancelRef.current) { cancelled = true; break; }
        const first = await sendChunk(0);
        if (uploadCancelRef.current) {
          wsSend("vps:fs:upload-cancel", { uploadId, projectId: project.id, instanceId: inst.id });
          cancelled = true;
          break;
        }
        if (!first.ok) {
          setError(`Failed to upload ${file.name}: ${first.error}`);
          failed = true;
          break;
        }
        onChunkDone();

        const UPLOAD_WINDOW = 6;
        let nextChunk = 1;
        const worker = async () => {
          while (!failed && !cancelled) {
            if (uploadCancelRef.current) {
              wsSend("vps:fs:upload-cancel", { uploadId, projectId: project.id, instanceId: inst.id });
              cancelled = true;
              return;
            }
            const c = nextChunk++;
            if (c >= totalChunks) return;
            const res = await sendChunk(c);
            if (!res.ok) {
              setError(`Failed to upload ${file.name}: ${res.error}`);
              failed = true;
              return;
            }
            onChunkDone();
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(UPLOAD_WINDOW, Math.max(0, totalChunks - 1)) }, worker),
        );
        if (failed || cancelled) break;
      }
      if (!failed && !cancelled) loadDirectory(currentPath);
    } catch (err: any) {
      setError(err.message);
    }
    uploadCancelRef.current = false;
    setUploading(false);
    setUploadStatus(null);
  }, [project.id, inst?.id, currentPath, loadDirectory]);

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
        setEntries((prev) => prev.map((e) => e.path === renamingPath ? { ...e, name: renameValue.trim(), path: newPath } : e));
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

  useEffect(() => {
    loadDirectory(currentPath);
  }, [loadDirectory]);

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
            className="text-overlay1 hover:text-text transition-colors px-1 shrink-0 text-md bg-transparent border-none cursor-pointer"
          >/</button>
          {pathParts.map((part, i) => {
            const fullPath = "/" + pathParts.slice(0, i + 1).join("/");
            return (
              <span key={fullPath} className="flex items-center gap-0.5 shrink-0">
                <span className="text-overlay0 text-md">/</span>
                <button
                  onClick={() => loadDirectory(fullPath)}
                  className="text-overlay1 hover:text-text transition-colors truncate text-md bg-transparent border-none cursor-pointer"
                  style={{ maxWidth: 80 }}
                >{part}</button>
              </span>
            );
          })}
          <div className="flex-1" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-overlay1 hover:text-text transition-colors p-0.5 shrink-0 bg-transparent border-none cursor-pointer disabled:opacity-50"
            title="Upload files"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          </button>
          <button onClick={() => loadDirectory(currentPath)} className="text-overlay1 hover:text-text transition-colors p-0.5 shrink-0 bg-transparent border-none cursor-pointer">
            <RefreshCw size={12} />
          </button>
          {/* Visually hidden — NOT `display: none`. Chromium silently refuses to
           *  open the native file picker when `.click()` is invoked on a
           *  display:none <input type="file">, especially inside a portal
           *  (this component is rendered through the manage-vm popup). Keep it
           *  in the layout tree but invisible/unclickable instead. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              // Snapshot to a real array BEFORE the value reset below — resetting
              // the input empties the live FileList that the async handleUpload
              // iterates across its per-file awaits, which would otherwise drop
              // every file after the first.
              if (e.target.files?.length) handleUpload(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <ErrorMessage variant="banner" className="shrink-0">{error}</ErrorMessage>
        )}

        {uploadStatus && (
          <div className="shrink-0 px-2 py-1 bg-background/50 border border-overlay0/30 rounded text-xs text-overlay1 select-none">
            <div className="flex items-center justify-between gap-2 mb-1 font-mono">
              <span className="truncate">
                {uploadStatus.fileCount > 1
                  ? `(${uploadStatus.fileIndex + 1}/${uploadStatus.fileCount}) `
                  : ""}
                {uploadStatus.fileName}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span>{uploadStatus.percent}%</span>
                <button
                  onClick={() => { uploadCancelRef.current = true; }}
                  disabled={uploadCancelRef.current}
                  className="text-overlay0 hover:text-red transition-colors p-0.5 bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  title="Cancel upload"
                  aria-label="Cancel upload"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <div className="h-1 bg-overlay0/30 rounded overflow-hidden">
              <div
                className="h-full bg-blue transition-[width] duration-150"
                style={{ width: `${uploadStatus.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 mt-1 font-mono text-overlay0">
              <span>
                {formatBytes(uploadStatus.bytesDone)} / {formatBytes(uploadStatus.bytesTotal)}
              </span>
              <span>{uploadStatus.speedBps > 0 ? `${formatBytes(uploadStatus.speedBps)}/s` : ""}</span>
            </div>
          </div>
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
                className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-surface0/50 text-overlay1 transition-colors text-md bg-transparent border-none cursor-pointer"
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
                    className="flex-1 bg-base text-text px-1.5 py-0.5 rounded outline-none border border-mauve/40 min-w-0 text-md"
                    spellCheck={false}
                  />
                </div>
              ) : (
                <FsFileEntry
                  key={entry.path}
                  entry={entry}
                  isActive={editingFile?.path === entry.path}
                  onOpen={() => entry.isDirectory ? loadDirectory(entry.path) : openFile(entry.path)}
                  onRename={() => startRename(entry)}
                  onDelete={() => deleteEntry(entry)}
                  onDownload={() => downloadEntry(entry)}
                >
                  {entry.isDirectory ? (
                    <Folder size={13} className="text-mauve shrink-0" />
                  ) : (
                    <File size={13} className="text-blue shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </FsFileEntry>
              )
            ))}
            {entries.length === 0 && !loading && (
              <div className="text-overlay0 text-center py-6 text-md">Empty</div>
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
              <span className="text-text truncate text-md">{fileName}</span>
              <div className="flex-1" />
              {saved && (
                <span className="text-green text-md">Saved</span>
              )}
              {hasChanges && (
                <button onClick={saveFile} disabled={saving} className="flex items-center gap-1 px-2 py-1 bg-green/20 text-green hover:bg-green/30 rounded transition-colors disabled:opacity-50 text-md border-none cursor-pointer">
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
                  editor.getModel()?.uri ? 2048 | 49 : 2048 | 49,
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
          <div className="flex items-center justify-center flex-1 text-overlay0 text-md">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}
