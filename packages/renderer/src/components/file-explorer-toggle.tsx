"use client";

import { useDeepSubject } from "subjecto/react";
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { store, toggleFileExplorer } from "@/store";

export function FileExplorerToggle() {
  const open = useDeepSubject(store, "fileExplorer/open") as boolean;

  return (
    <button
      onClick={toggleFileExplorer}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-subtext0",
        "hover:bg-surface0 hover:text-text transition-colors",
        open && "bg-surface0 text-text"
      )}
      title="Toggle File Explorer"
    >
      <FolderOpen size={16} />
      <span>Files</span>
    </button>
  );
}
