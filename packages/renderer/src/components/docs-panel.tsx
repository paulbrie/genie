"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useDeepSubject } from "subjecto/react";
import { FileText, Plus, Save, Trash2, X } from "lucide-react";
import {
  store,
  loadDocsList,
  openDoc,
  saveDoc,
  deleteDoc,
  createNewDoc,
  type DocsState,
} from "@/store";
import { type DocFile } from "@/lib/genie-api";
import { cn } from "@/lib/utils";

export function DocsPanel() {
  const docs = useDeepSubject(store, "docs") as DocsState;
  const [editContent, setEditContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDocsList();
  }, []);

  useEffect(() => {
    setEditContent(docs.content);
    setDirty(false);
  }, [docs.content, docs.selectedFile]);

  const handleSelectFile = useCallback((file: DocFile) => {
    openDoc(file.name);
  }, []);

  const handleSave = useCallback(() => {
    if (docs.selectedFile) {
      saveDoc(docs.selectedFile, editContent);
      setDirty(false);
    }
  }, [docs.selectedFile, editContent]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = useCallback(() => {
    if (!docs.selectedFile) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteDoc(docs.selectedFile);
    setConfirmingDelete(false);
  }, [docs.selectedFile, confirmingDelete]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [docs.selectedFile]);

  const handleNew = useCallback(() => {
    setShowNewInput(true);
    setNewFileName("");
    setTimeout(() => newInputRef.current?.focus(), 0);
  }, []);

  const handleNewSubmit = useCallback(() => {
    const name = newFileName.trim();
    if (name) {
      createNewDoc(name);
    }
    setShowNewInput(false);
    setNewFileName("");
  }, [newFileName]);

  const handleNewKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNewSubmit();
      } else if (e.key === "Escape") {
        setShowNewInput(false);
        setNewFileName("");
      }
    },
    [handleNewSubmit]
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditContent(e.target.value);
      setDirty(true);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (docs.selectedFile && dirty) {
          saveDoc(docs.selectedFile, editContent);
          setDirty(false);
        }
      }
    },
    [docs.selectedFile, editContent, dirty]
  );

  return (
    <div className="flex-1 flex flex-col px-5 pb-5 overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center pb-3 border-b border-surface0 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtext0">
          Docs
        </h2>
        <button
          onClick={handleNew}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium",
            "bg-surface0 text-text border-none cursor-pointer",
            "hover:bg-surface1 transition-colors duration-150"
          )}
        >
          <Plus size={14} />
          New
        </button>
      </div>

      {/* Body: file list + editor */}
      <div className="flex-1 flex gap-3 overflow-hidden">
        {/* Left: file list */}
        <div className="w-48 shrink-0 flex flex-col overflow-y-auto scrollbar-thin">
          {showNewInput && (
            <div className="flex items-center gap-1 px-1.5 py-1">
              <input
                ref={newInputRef}
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={handleNewKeyDown}
                onBlur={handleNewSubmit}
                placeholder="filename.md"
                className={cn(
                  "flex-1 min-w-0 px-2 py-1 rounded text-sm",
                  "bg-mantle text-text border border-surface1",
                  "outline-none focus:border-blue"
                )}
              />
              <button
                onClick={() => { setShowNewInput(false); setNewFileName(""); }}
                className="text-overlay0 hover:text-text border-none bg-transparent cursor-pointer p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {docs.files.length === 0 && !docs.loading && !showNewInput && (
            <p className="text-xs text-overlay0 px-2 py-4">
              No docs yet. Click "New" to create one.
            </p>
          )}
          {docs.files.map((file) => (
            <button
              key={file.name}
              onClick={() => handleSelectFile(file)}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left w-full",
                "border-none cursor-pointer text-sm transition-colors duration-150",
                file.name === docs.selectedFile
                  ? "bg-surface0 text-text"
                  : "bg-transparent text-overlay0 hover:bg-mantle hover:text-subtext0"
              )}
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate">{file.name}</span>
            </button>
          ))}
        </div>

        {/* Right: editor */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {docs.selectedFile ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 pb-2 mb-2 border-b border-surface0">
                <span className="text-sm font-medium text-text truncate flex-1">
                  {docs.selectedFile}
                  {dirty && (
                    <span className="text-yellow ml-1 text-xs">(unsaved)</span>
                  )}
                </span>
                <button
                  onClick={handleSave}
                  disabled={!dirty || docs.loading}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium",
                    "border-none cursor-pointer transition-colors duration-150",
                    dirty
                      ? "bg-green text-base hover:opacity-90"
                      : "bg-surface0 text-overlay0 cursor-not-allowed"
                  )}
                >
                  <Save size={13} />
                  Save
                </button>
                <button
                  onClick={handleDelete}
                  onBlur={() => setConfirmingDelete(false)}
                  disabled={docs.loading}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium",
                    "border-none cursor-pointer transition-colors duration-150",
                    confirmingDelete
                      ? "bg-red text-base"
                      : "bg-surface0 text-red hover:bg-red hover:text-base"
                  )}
                >
                  <Trash2 size={13} />
                  {confirmingDelete ? "Confirm?" : "Delete"}
                </button>
              </div>

              {/* Textarea */}
              <textarea
                value={editContent}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className={cn(
                  "flex-1 w-full resize-none p-3 rounded-md",
                  "bg-mantle text-text border border-surface0",
                  "font-mono text-sm leading-relaxed",
                  "outline-none focus:border-blue",
                  "scrollbar-thin"
                )}
              />
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-overlay0">
              <FileText size={40} className="mb-3 opacity-40" />
              <p className="text-sm">Select a doc or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
