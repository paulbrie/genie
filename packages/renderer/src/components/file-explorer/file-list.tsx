"use client";

import { useState, useRef, useEffect } from "react";
import { useDeepSubject } from "subjecto/react";
import {
  Folder,
  File,
  FileText,
  FileCode,
  FileImage,
  FileJson,
  Film,
  Music,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  store,
  navigateTo,
  selectFileEntry,
  setRenamingEntry,
  refreshDirectory,
} from "@/store";
import { genie } from "@/lib/genie-api";
import type { DirEntry } from "@/lib/genie-api";
import { FileContextMenu } from "./file-context-menu";

function getFileIcon(entry: DirEntry) {
  if (entry.isDirectory) return Folder;
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "css", "scss", "html", "vue", "svelte"].includes(ext)) return FileCode;
  if (["json", "yaml", "yml", "toml"].includes(ext)) return FileJson;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) return FileImage;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return Film;
  if (["mp3", "wav", "flac", "aac", "ogg"].includes(ext)) return Music;
  if (["md", "txt", "log", "csv", "xml"].includes(ext)) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InlineRenameInput({ entry }: { entry: DirEntry }) {
  const [value, setValue] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  async function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === entry.name) {
      setRenamingEntry(null);
      return;
    }
    const dir = entry.path.replace(/\/[^/]+$/, "");
    const newPath = dir + "/" + trimmed;
    await genie.renameEntry(entry.path, newPath);
    setRenamingEntry(null);
    await refreshDirectory();
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleSubmit();
        if (e.key === "Escape") setRenamingEntry(null);
        e.stopPropagation();
      }}
      onBlur={handleSubmit}
      className="flex-1 min-w-0 bg-surface0 border border-mauve rounded px-1 py-0.5 text-xs text-text outline-none"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function FileList() {
  const entries = useDeepSubject(store, "fileExplorer/entries") as DirEntry[];
  const loading = useDeepSubject(store, "fileExplorer/loading") as boolean;
  const error = useDeepSubject(store, "fileExplorer/error") as string | null;
  const selectedEntry = useDeepSubject(store, "fileExplorer/selectedEntry") as string | null;
  const renamingEntry = useDeepSubject(store, "fileExplorer/renamingEntry") as string | null;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: DirEntry;
  } | null>(null);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0 text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red text-sm px-4 text-center">
        {error}
      </div>
    );
  }

  // Sort: directories first, then alphabetical
  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0 text-sm">
        Empty directory
      </div>
    );
  }

  function handleDoubleClick(entry: DirEntry) {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    } else {
      genie.openFile(entry.path);
    }
  }

  function handleContextMenu(e: React.MouseEvent, entry: DirEntry) {
    e.preventDefault();
    selectFileEntry(entry.path);
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }

  return (
    <div className="flex-1 overflow-y-auto px-1">
      {sorted.map((entry) => {
        const Icon = getFileIcon(entry);
        const isSelected = selectedEntry === entry.path;
        const isRenaming = renamingEntry === entry.path;

        return (
          <div
            key={entry.path}
            className={cn(
              "flex items-center gap-2 px-2 py-1 rounded cursor-default text-sm select-none",
              "hover:bg-surface0",
              isSelected && "bg-surface0"
            )}
            onClick={() => selectFileEntry(entry.path)}
            onDoubleClick={() => handleDoubleClick(entry)}
            onContextMenu={(e) => handleContextMenu(e, entry)}
          >
            <Icon
              size={16}
              className={cn(
                "shrink-0",
                entry.isDirectory ? "text-mauve" : "text-overlay1"
              )}
            />
            {isRenaming ? (
              <InlineRenameInput entry={entry} />
            ) : (
              <>
                <span className="flex-1 truncate text-text text-xs">
                  {entry.name}
                </span>
                {!entry.isDirectory && (
                  <span className="text-overlay0 text-[10px] shrink-0">
                    {formatSize(entry.size)}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
