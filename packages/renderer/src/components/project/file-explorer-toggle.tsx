"use client";

import { useSubject } from "subjecto/react";
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { $fileExplorer } from "@/store/subjects";
import { toggleFileExplorer } from "@/store/actions";
export function FileExplorerToggle() {
  const [fileExplorer] = useSubject($fileExplorer);
  const open = fileExplorer.open;

  return (
    <button
      onClick={toggleFileExplorer}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-base text-subtext0",
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
