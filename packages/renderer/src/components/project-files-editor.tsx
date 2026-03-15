"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSubject } from "subjecto/react";
import dynamic from "next/dynamic";
import type { OnMount, BeforeMount } from "@monaco-editor/react";
import {
  $fileEditor,
  $projects,
  $fileTemplates,
  loadProjectFiles,
  selectFile,
  saveFile,
  updateFileContent,
  clearFileEditor,
  deleteProjectFile,
  addProjectFile,
  renameProjectFile,
  loadFileTemplates,
  createFileTemplate,
  saveTemplateFromProject,
  updateFileTemplate,
  deleteFileTemplate,
  injectFileTemplate,
  injectSingleFileFromTemplate,
  type FileTemplate,
} from "@/store";
import { wsRequest } from "@/lib/ws";
import { Loader2, Save, Check, FileCode, FileText, Plus, X, Upload, Trash2, Download, Pencil, Package, ChevronRight } from "lucide-react";
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
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
    ".json": "json", ".css": "css", ".scss": "scss", ".less": "less",
    ".html": "html", ".htm": "html", ".xml": "xml", ".svg": "xml",
    ".md": "markdown", ".mdx": "markdown",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".yml": "yaml", ".yaml": "yaml",
    ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
    ".java": "java", ".kt": "kotlin", ".swift": "swift",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".sql": "sql", ".graphql": "graphql", ".gql": "graphql",
    ".toml": "ini", ".conf": "ini", ".cfg": "ini", ".ini": "ini",
    ".php": "php", ".lua": "lua", ".r": "r",
  };
  return map[ext] || "plaintext";
}

function getFileIcon(fileName: string) {
  if (fileName === ".env") return <FileText size={13} className="text-yellow" />;
  if (fileName.startsWith("Dockerfile")) return <FileCode size={13} className="text-teal" />;
  return <FileCode size={13} className="text-blue" />;
}

// --- Templates panel ---

interface TemplateFileEdit {
  templateId: string;
  templateName: string;
  fileName: string;
  content: string;
  savedContent: string;
}

function TemplatesPanel({ projectId, onEditFile }: { projectId: string; onEditFile: (edit: TemplateFileEdit) => void }) {
  const [tplState] = useSubject($fileTemplates);
  const { templates, loading } = tplState;
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadFileTemplates();
  }, []);

  function handleCreate() {
    if (!createName.trim()) return;
    saveTemplateFromProject(projectId, createName.trim(), createDesc.trim());
    setCreateName("");
    setCreateDesc("");
    setShowCreate(false);
  }

  function startEdit(tpl: FileTemplate) {
    setEditingId(tpl.id);
    setEditName(tpl.name);
    setEditDesc(tpl.description);
  }

  function commitEdit() {
    if (!editingId || !editName.trim()) return;
    updateFileTemplate(editingId, { name: editName.trim(), description: editDesc.trim() });
    setEditingId(null);
  }

  function handleInjectAll(tpl: FileTemplate) {
    const fileCount = Object.keys(tpl.files).length;
    if (confirm(`Inject all ${fileCount} file(s) from "${tpl.name}"?\n\nExisting files with the same name will be overwritten.`)) {
      injectFileTemplate(projectId, tpl.id, "merge");
    }
  }

  function handleInjectFile(fileName: string, content: string) {
    injectSingleFileFromTemplate(projectId, fileName, content);
    // Reload to reflect the new/updated file
    setTimeout(() => loadProjectFiles(projectId), 300);
  }

  function handleDelete(tpl: FileTemplate) {
    if (confirm(`Delete template "${tpl.name}"?`)) {
      deleteFileTemplate(tpl.id);
    }
  }

  function handleOverwrite(tpl: FileTemplate) {
    const projects = $projects.getValue();
    const project = projects.find((p) => p.id === projectId);
    const setupFiles = project?.setupFiles || {};
    if (confirm(`Update template "${tpl.name}" with the current project files?\n\nThis will replace the template's files.`)) {
      updateFileTemplate(tpl.id, { files: setupFiles as Record<string, string> });
    }
  }

  return (
    <div className="py-4 flex flex-col gap-2 border-t border-surface0">
      <div className="flex items-center justify-between">
        <h2 className="text-md font-semibold uppercase tracking-wide text-subtext0 flex items-center gap-1.5">
          <Package size={12} />
          File Templates
        </h2>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-overlay0 text-md py-2">
          <Loader2 size={12} className="animate-spin" /> Loading templates...
        </div>
      )}

      {!loading && templates.length === 0 && !showCreate && (
        <p className="text-md text-overlay0 py-2">
          No templates yet. Save your current project files as a template to reuse them across projects.
        </p>
      )}

      {!loading && templates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {templates.map((tpl) => {
            const fileEntries = Object.entries(tpl.files).sort(([a], [b]) => a.localeCompare(b));
            const isExpanded = expandedId === tpl.id;

            return (
              <div key={tpl.id} className="bg-mantle rounded-lg overflow-hidden">
                {editingId === tpl.id ? (
                  <div className="flex flex-col gap-1.5 px-3 py-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                      className="bg-base border border-surface1 rounded px-2 py-1 text-md text-text outline-none focus:border-mauve/50"
                      placeholder="Template name"
                    />
                    <input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                      className="bg-base border border-surface1 rounded px-2 py-1 text-md text-overlay1 outline-none focus:border-mauve/50"
                      placeholder="Description (optional)"
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={commitEdit}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Template header */}
                    <div className="flex items-center gap-2 px-3 py-2 group">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : tpl.id)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <ChevronRight
                          size={13}
                          className={cn("text-overlay0 transition-transform shrink-0", isExpanded && "rotate-90")}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-md font-medium text-text truncate">{tpl.name}</div>
                          {tpl.description && (
                            <div className="text-md text-overlay0 truncate">{tpl.description}</div>
                          )}
                          <div className="text-md text-overlay0">
                            {fileEntries.length} file(s)
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleInjectAll(tpl)}
                          className="p-1.5 text-green hover:bg-green/15 rounded transition-colors"
                          title="Inject all files into project"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          onClick={() => handleOverwrite(tpl)}
                          className="p-1.5 text-blue hover:bg-blue/15 rounded transition-colors"
                          title="Update template from current files"
                        >
                          <Upload size={13} />
                        </button>
                        <button
                          onClick={() => startEdit(tpl)}
                          className="p-1.5 text-overlay0 hover:text-text hover:bg-surface0 rounded transition-colors"
                          title="Edit name/description"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(tpl)}
                          className="p-1.5 text-overlay0 hover:text-red hover:bg-red/15 rounded transition-colors"
                          title="Delete template"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded file list */}
                    {isExpanded && (
                      <div className="border-t border-surface0">
                        {fileEntries.map(([fileName, fileContent]) => (
                          <div
                            key={fileName}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface0/50 group/file"
                          >
                            <button
                              onClick={() => onEditFile({ templateId: tpl.id, templateName: tpl.name, fileName, content: fileContent, savedContent: fileContent })}
                              className="pl-5 flex items-center gap-2 flex-1 min-w-0 text-left"
                              title={`Edit ${fileName}`}
                            >
                              {getFileIcon(fileName)}
                              <span className="text-md text-overlay1 truncate font-mono hover:text-text transition-colors">{fileName}</span>
                            </button>
                            <button
                              onClick={() => handleInjectFile(fileName, fileContent)}
                              className="p-1 text-green opacity-0 group-hover/file:opacity-100 hover:bg-green/15 rounded transition-all"
                              title={`Inject ${fileName} into project`}
                            >
                              <Download size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate ? (
        <div className="flex flex-col gap-1.5 px-3 py-2 bg-mantle rounded-lg">
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
            className="bg-base border border-surface1 rounded px-2 py-1 text-md text-text outline-none focus:border-mauve/50"
            placeholder="Template name"
          />
          <input
            value={createDesc}
            onChange={(e) => setCreateDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
            className="bg-base border border-surface1 rounded px-2 py-1 text-md text-overlay1 outline-none focus:border-mauve/50"
            placeholder="Description (optional)"
          />
          <div className="flex gap-1.5">
            <Button size="sm" onClick={handleCreate} disabled={!createName.trim()}>
              Save current files as template
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-md text-overlay1 hover:text-text transition-colors py-1"
        >
          <Plus size={12} /> Save current files as template
        </button>
      )}
    </div>
  );
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

  // Template file editing
  const [tplEdit, setTplEdit] = useState<TemplateFileEdit | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplJustSaved, setTplJustSaved] = useState(false);

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

    // Disable TypeScript/JavaScript diagnostics — files are on a remote VPS
    // so we can't resolve node_modules. Syntax highlighting still works.
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    // Enable JSX support
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowJs: true,
      esModuleInterop: true,
    });
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      allowJs: true,
    });
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const val = editor.getValue();
      // Check if we're in template editing mode by reading tplEdit from a ref
      if (tplEditRef.current) {
        saveTplFile(val);
      } else {
        saveFile(val);
      }
    });
  };

  // Keep a ref to tplEdit so the Monaco keybinding closure can access it
  const tplEditRef = useRef(tplEdit);
  tplEditRef.current = tplEdit;

  function saveTplFile(val: string) {
    if (!tplEdit) return;
    setTplSaving(true);
    // Get the current template from store to update just the one file
    const tplState = $fileTemplates.getValue();
    const tpl = tplState.templates.find((t) => t.id === tplEdit.templateId);
    if (!tpl) return;
    const updatedFiles = { ...tpl.files, [tplEdit.fileName]: val };
    updateFileTemplate(tplEdit.templateId, { files: updatedFiles });
    setTplEdit((prev) => prev ? { ...prev, savedContent: val } : null);
    setTplSaving(false);
    setTplJustSaved(true);
    setTimeout(() => setTplJustSaved(false), 2000);
  }

  function handleSave() {
    if (tplEdit) {
      saveTplFile(tplEdit.content);
      return;
    }
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
                        onClick={() => { setTplEdit(null); selectFile(f); }}
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
          {/* Template file toolbar */}
          {tplEdit && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface0 bg-mantle relative">
              <div className="flex items-center gap-2 text-md">
                <span className="text-md bg-mauve/15 text-mauve px-1.5 py-0.5 rounded font-medium">Template: {tplEdit.templateName}</span>
                <span className="text-overlay1 font-mono text-md">{tplEdit.fileName}</span>
                {tplEdit.content !== tplEdit.savedContent && (
                  <span className="text-md bg-yellow/15 text-yellow px-1.5 py-0.5 rounded">modified</span>
                )}
                {tplJustSaved && (
                  <span className="text-md text-green flex items-center gap-1">
                    <Check size={10} /> Saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => saveTplFile(tplEdit.content)}
                  disabled={tplSaving || tplEdit.content === tplEdit.savedContent}
                >
                  {tplSaving ? (
                    <Loader2 size={12} className="animate-spin mr-1" />
                  ) : (
                    <Save size={12} className="mr-1" />
                  )}
                  {tplSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTplEdit(null)}
                >
                  <X size={12} className="mr-1" /> Close
                </Button>
              </div>
            </div>
          )}

          {/* Project file toolbar */}
          {!tplEdit && isActive && selectedFile && (
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

          {/* Monaco editor — template file mode */}
          {tplEdit && (
            <MonacoEditor
              height="100%"
              language={getLanguage(tplEdit.fileName)}
              theme="catppuccin-mocha"
              value={tplEdit.content}
              onChange={(val) => setTplEdit((prev) => prev ? { ...prev, content: val ?? "" } : null)}
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

          {/* Monaco editor — project file mode */}
          {!tplEdit && isActive && feLoading && (
            <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
              <Loader2 size={14} className="animate-spin mr-2" />
              Loading...
            </div>
          )}

          {!tplEdit && isActive && feError && (
            <div className="flex-1 flex items-center justify-center text-red text-md px-4">
              {feError}
            </div>
          )}

          {!tplEdit && isActive && !feLoading && !feError && selectedFile && (
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

          {!tplEdit && isActive && !feLoading && !selectedFile && (
            <div className="flex-1 flex items-center justify-center text-overlay0 text-md">
              Select a file to edit
            </div>
          )}
        </div>
      </div>

      {/* Templates */}
      <TemplatesPanel projectId={projectId} onEditFile={(edit) => setTplEdit(edit)} />

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
