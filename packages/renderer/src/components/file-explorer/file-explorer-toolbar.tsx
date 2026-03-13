"use client";

import { useState } from "react";
import { useSubject } from "subjecto/react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { $fileExplorer, navigateBack, navigateForward, navigateUp, navigateTo, refreshDirectory } from "@/store";
import { genie } from "@/lib/genie-api";

export function FileExplorerToolbar() {
  const [fileExplorer] = useSubject($fileExplorer);
  const { currentPath, historyIndex, history } = fileExplorer;
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const canGoUp = currentPath !== "/";

  const segments = currentPath.split("/").filter(Boolean);

  async function handleCreateFolder() {
    if (!newFolderName.trim()) {
      setCreatingFolder(false);
      return;
    }
    const folderPath = currentPath.replace(/\/$/, "") + "/" + newFolderName.trim();
    await genie.createFolder(folderPath);
    setNewFolderName("");
    setCreatingFolder(false);
    await refreshDirectory();
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 pb-1.5">
      {/* Navigation buttons row */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={navigateBack}
          disabled={!canGoBack}
          className="p-1 rounded hover:bg-surface1 disabled:opacity-30 disabled:cursor-default text-subtext0"
          title="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={navigateForward}
          disabled={!canGoForward}
          className="p-1 rounded hover:bg-surface1 disabled:opacity-30 disabled:cursor-default text-subtext0"
          title="Forward"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={navigateUp}
          disabled={!canGoUp}
          className="p-1 rounded hover:bg-surface1 disabled:opacity-30 disabled:cursor-default text-subtext0"
          title="Up"
        >
          <ArrowUp size={16} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setCreatingFolder(true)}
          className="p-1 rounded hover:bg-surface1 text-subtext0"
          title="New Folder"
        >
          <FolderPlus size={16} />
        </button>
        <button
          onClick={refreshDirectory}
          className="p-1 rounded hover:bg-surface1 text-subtext0"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 text-md text-overlay0 overflow-x-auto min-h-[20px] scrollbar-none">
        <button
          onClick={() => navigateTo("/")}
          className="shrink-0 hover:text-text px-0.5 rounded hover:bg-surface1"
        >
          /
        </button>
        {segments.map((seg, i) => {
          const segPath = "/" + segments.slice(0, i + 1).join("/");
          const isLast = i === segments.length - 1;
          return (
            <span key={segPath} className="flex items-center gap-0.5 shrink-0">
              <span className="text-surface2">/</span>
              {isLast ? (
                <span className="text-subtext1 px-0.5">{seg}</span>
              ) : (
                <button
                  onClick={() => navigateTo(segPath)}
                  className="hover:text-text px-0.5 rounded hover:bg-surface1"
                >
                  {seg}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {/* New folder input */}
      {creatingFolder && (
        <input
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateFolder();
            if (e.key === "Escape") {
              setCreatingFolder(false);
              setNewFolderName("");
            }
          }}
          onBlur={handleCreateFolder}
          placeholder="New folder name…"
          className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text outline-none focus:border-mauve"
        />
      )}
    </div>
  );
}
