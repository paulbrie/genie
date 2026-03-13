"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSubject } from "subjecto/react";
import dynamic from "next/dynamic";
import type { OnMount, BeforeMount } from "@monaco-editor/react";
import {
  $fileEditor,
  $projects,
  loadProjectFiles,
  selectFile,
  saveFile,
  updateFileContent,
  clearFileEditor,
  deleteProjectFile,
  addProjectFile,
  renameProjectFile,
} from "@/store";
import { wsRequest } from "@/lib/ws";
import { Loader2, Save, Check, FileCode, FileText, Plus, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuItem } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
      <Loader2 size={14} className="animate-spin mr-2" />
      Loading editor...
    </div>
  ),
});

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

function getLanguage(fileName: string): string {
  if (fileName === ".env") return "ini";
  if (fileName.startsWith("Dockerfile")) return "dockerfile";
  if (fileName.endsWith(".sh") || fileName.endsWith(".bash")) return "shell";
  if (fileName.endsWith(".json")) return "json";
  if (fileName.endsWith(".toml")) return "ini";
  if (fileName.endsWith(".conf") || fileName.endsWith(".cfg") || fileName.endsWith(".ini")) return "ini";
  if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) return "yaml";
  if (fileName.endsWith(".md")) return "markdown";
  return "yaml";
}

function getFileIcon(fileName: string) {
  if (fileName === ".env") return <FileText size={13} className="text-yellow" />;
  if (fileName.startsWith("Dockerfile")) return <FileCode size={13} className="text-teal" />;
  return <FileCode size={13} className="text-blue" />;
}

// --- Main component ---

export function ProjectFilesEditor({ projectId }: { projectId: string }) {
  const [fileEditor] = useSubject($fileEditor);
  const { projectId: feProjectId, files, selectedFile, content, savedContent, loading: feLoading, saving: feSaving, error: feError } = fileEditor;

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: string } | null>(null);
  const [pushPicker, setPushPicker] = useState<{ x: number; y: number; file: string } | null>(null);
  const [pushStatus, setPushStatus] = useState<{ file: string; status: "pushing" | "done" | "error"; instance?: string; error?: string } | null>(null);
  const [allProjects] = useSubject($projects);
  const project = allProjects.find((p) => p.id === projectId);
  const vpsInstances = project?.vpsInstances ?? [];

  const pushFileToInstance = useCallback(async (fileName: string, instanceId: string, instanceLabel: string) => {
    setPushStatus({ file: fileName, status: "pushing", instance: instanceLabel });
    try {
      // Read the file content from the editor store
      const fe = $fileEditor.getValue();
      let fileContent: string;
      if (fe.selectedFile === fileName && fe.content !== null) {
        fileContent = fe.content;
      } else {
        // File not currently selected — get saved content from setupFiles
        fileContent = project?.setupFiles?.[fileName] ?? "";
      }
      const res = await wsRequest("vps:fs:writeFile", {
        projectId,
        instanceId,
        path: `/opt/project/${fileName}`,
        content: fileContent,
      }, 15000);
      if (res.ok) {
        setPushStatus({ file: fileName, status: "done", instance: instanceLabel });
      } else {
        setPushStatus({ file: fileName, status: "error", instance: instanceLabel, error: res.error });
      }
    } catch (err: any) {
      setPushStatus({ file: fileName, status: "error", instance: instanceLabel, error: err.message });
    }
    setTimeout(() => setPushStatus(null), 3000);
  }, [projectId, project]);

  const handlePushFile = useCallback((fileName: string, x: number, y: number) => {
    if (vpsInstances.length === 0) return;
    if (vpsInstances.length === 1) {
      pushFileToInstance(fileName, vpsInstances[0].id, vpsInstances[0].label);
    } else {
      setPushPicker({ x, y, file: fileName });
    }
  }, [vpsInstances, pushFileToInstance]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("project-files-sidebar-width");
      return saved ? parseInt(saved) : 180;
    }
    return 180;
  });
  const draggingRef = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(120, Math.min(400, startW + ev.clientX - startX));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((w) => { localStorage.setItem("project-files-sidebar-width", String(w)); return w; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const isActive = feProjectId === projectId;
  const sortedFiles = useMemo(() => [...files].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [files]);
  const isDirty = isActive && content !== null && content !== savedContent;

  function startRename(file: string) {
    setRenamingFile(file);
    setRenameValue(file);
  }

  function commitRename() {
    if (!renamingFile) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== renamingFile) {
      renameProjectFile(renamingFile, trimmed);
    }
    setRenamingFile(null);
  }

  useEffect(() => {
    loadProjectFiles(projectId);
    return () => clearFileEditor();
  }, [projectId]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("catppuccin-mocha", catppuccinMocha);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const val = editor.getValue();
      saveFile(val);
    });
  };

  function handleSave() {
    if (content !== null) {
      saveFile(content);
    }
  }

  const justSaved = isActive && !feSaving && !isDirty && savedContent !== null;

  return (
    <div className="py-4 flex flex-col gap-2 border-t border-surface0">
      <h2 className="text-md font-semibold uppercase tracking-wide text-subtext0 mb-1 flex items-center gap-1.5">
        <FileCode size={12} />
        Files
      </h2>

      <div className="flex bg-mantle rounded-lg overflow-hidden" style={{ height: 380 }}>
        {/* File list sidebar */}
        <div className="flex flex-col border-r border-surface0 relative" style={{ width: sidebarWidth }}>
          <div className="flex-1 overflow-y-auto">
            {isActive &&
              sortedFiles.map((f) => (
                <div
                  key={f}
                  className={cn(
                    "flex items-center group",
                    selectedFile === f
                      ? "bg-surface0 text-text"
                      : "text-overlay1 hover:bg-surface0/50 hover:text-text"
                  )}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, file: f });
                  }}
                >
                  {renamingFile === f ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 flex-1 min-w-0">
                      {getFileIcon(f)}
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingFile(null);
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 bg-base border border-mauve/40 rounded px-1.5 py-0.5 text-md text-text outline-none"
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => selectFile(f)}
                        className="flex items-center gap-2 px-3 py-2 text-md text-left transition-colors truncate flex-1 min-w-0"
                      >
                        {getFileIcon(f)}
                        <span className="truncate">{f}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${f}"?`)) deleteProjectFile(f);
                        }}
                        className="px-1.5 opacity-0 group-hover:opacity-100 text-overlay0 hover:text-red transition-opacity shrink-0"
                        title="Delete file"
                      >
                        <X size={12} />
                      </button>
                    </>
                  )}
                </div>
              ))}

            {ctxMenu && (
              <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
                <ContextMenuItem onClick={() => { startRename(ctxMenu.file); setCtxMenu(null); }}>
                  Rename
                </ContextMenuItem>
                {vpsInstances.length > 0 && (
                  <ContextMenuItem
                    onClick={() => {
                      const file = ctxMenu.file;
                      const { x, y } = ctxMenu;
                      setCtxMenu(null);
                      handlePushFile(file, x, y);
                    }}
                  >
                    <Upload size={12} className="inline mr-1.5" />
                    Push to instance
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  onClick={() => {
                    if (confirm(`Delete "${ctxMenu.file}"?`)) deleteProjectFile(ctxMenu.file);
                    setCtxMenu(null);
                  }}
                  className="text-red"
                >
                  Delete
                </ContextMenuItem>
              </ContextMenu>
            )}

            {/* Instance picker for multi-instance push */}
            {pushPicker && (
              <ContextMenu x={pushPicker.x} y={pushPicker.y} onClose={() => setPushPicker(null)}>
                {vpsInstances.map((inst) => (
                  <ContextMenuItem
                    key={inst.id}
                    onClick={() => {
                      pushFileToInstance(pushPicker.file, inst.id, inst.label);
                      setPushPicker(null);
                    }}
                  >
                    {inst.label}
                  </ContextMenuItem>
                ))}
              </ContextMenu>
            )}
          </div>
          {isActive && (
            <div className="flex border-t border-surface0">
              <button
                onClick={() => {
                  const name = prompt("File name:");
                  if (name?.trim()) addProjectFile(name.trim());
                }}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-md text-overlay1 hover:text-text hover:bg-surface0/50 transition-colors"
                title="Add file"
              >
                <Plus size={11} /> Add
              </button>
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onDragStart}
          className="w-1 cursor-col-resize hover:bg-mauve/30 active:bg-mauve/50 transition-colors shrink-0"
        />

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Toolbar */}
          {isActive && selectedFile && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface0 bg-mantle relative">
              <div className="flex items-center gap-2 text-md">
                <span className="text-overlay1 font-mono text-md">{selectedFile}</span>
                {isDirty && (
                  <span className="text-md bg-yellow/15 text-yellow px-1.5 py-0.5 rounded">modified</span>
                )}
                {justSaved && (
                  <span className="text-md text-green flex items-center gap-1">
                    <Check size={10} /> Saved
                  </span>
                )}
                {pushStatus && pushStatus.file === selectedFile && (
                  <span className={`text-md flex items-center gap-1 ${pushStatus.status === "error" ? "text-red" : pushStatus.status === "done" ? "text-green" : "text-mauve"}`}>
                    {pushStatus.status === "pushing" && <><Loader2 size={10} className="animate-spin" /> Pushing...</>}
                    {pushStatus.status === "done" && <><Check size={10} /> Pushed to {pushStatus.instance}</>}
                    {pushStatus.status === "error" && <>Push failed</>}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={feSaving || !isDirty}
                >
                  {feSaving ? (
                    <Loader2 size={12} className="animate-spin mr-1" />
                  ) : (
                    <Save size={12} className="mr-1" />
                  )}
                  {feSaving ? "Saving..." : "Save"}
                </Button>
              </div>

            </div>
          )}

          {/* Monaco editor */}
          {isActive && feLoading && (
            <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
              <Loader2 size={14} className="animate-spin mr-2" />
              Loading...
            </div>
          )}

          {isActive && feError && (
            <div className="flex-1 flex items-center justify-center text-red text-md px-4">
              {feError}
            </div>
          )}

          {isActive && !feLoading && !feError && selectedFile && (
            <MonacoEditor
              height="100%"
              language={getLanguage(selectedFile)}
              theme="catppuccin-mocha"
              value={content ?? ""}
              onChange={(val) => updateFileContent(val ?? "")}
              beforeMount={handleBeforeMount}
              onMount={handleMount}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                wordWrap: "on",
                tabSize: 2,
                scrollBeyondLastLine: false,
                renderLineHighlight: "line",
                padding: { top: 8 },
                lineNumbers: "on",
                folding: true,
                automaticLayout: true,
              }}
            />
          )}

          {isActive && !feLoading && !selectedFile && (
            <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
              Select a file to edit
            </div>
          )}
        </div>
      </div>

      {/* Deploy mechanism docs */}
      <div className="mt-4 px-1 text-overlay0 space-y-2" style={{ fontSize: 13, lineHeight: 1.7 }}>
        <h3 className="text-subtext0 font-semibold text-md">How deploy works</h3>
        <p>
          When you trigger a deploy, all files listed above are copied via SSH to the remote VPS
          at <code className="bg-surface0 px-1.5 py-0.5 rounded text-mauve">/opt/project</code>.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-overlay1">
          <li>A remote directory is created at <code className="bg-surface0 px-1 py-0.5 rounded text-mauve">/opt/project</code></li>
          <li>Each file (e.g. <code className="bg-surface0 px-1 py-0.5 rounded text-text">.env</code>, <code className="bg-surface0 px-1 py-0.5 rounded text-text">docker-compose.yml</code>, Dockerfiles) is written to that directory</li>
          <li>If a <code className="bg-surface0 px-1 py-0.5 rounded text-green">setup.sh</code> file exists, it is executed automatically (<code className="bg-surface0 px-1 py-0.5 rounded text-text">bash setup.sh</code>)</li>
        </ol>
        <p className="text-overlay0">
          Put all your deployment logic (docker compose build, migrations, etc.) inside <code className="bg-surface0 px-1 py-0.5 rounded text-green">setup.sh</code>. Environment variables from the Secrets tab are available during execution.
        </p>
      </div>
    </div>
  );
}
