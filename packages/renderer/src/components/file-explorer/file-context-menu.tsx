"use client";

import {
  ContextMenu,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { genie } from "@/lib/genie-api";
import { refreshDirectory, setRenamingEntry } from "@/store/actions";
import type { DirEntry } from "@/lib/genie-api";

interface FileContextMenuProps {
  x: number;
  y: number;
  entry: DirEntry;
  onClose: () => void;
}

export function FileContextMenu({
  x,
  y,
  entry,
  onClose,
}: FileContextMenuProps) {
  async function handleOpen() {
    if (entry.isDirectory) {
      // handled via double-click in parent
    } else {
      await genie.openFile(entry.path);
    }
    onClose();
  }

  async function handleReveal() {
    await genie.openInFinder(entry.path);
    onClose();
  }

  function handleRename() {
    setRenamingEntry(entry.path);
    onClose();
  }

  async function handleDelete() {
    if (!confirm("Delete permanently?")) return;
    await genie.deleteEntry(entry.path);
    await refreshDirectory();
    onClose();
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {!entry.isDirectory && (
        <ContextMenuItem onClick={handleOpen}>Open</ContextMenuItem>
      )}
      <ContextMenuItem onClick={handleReveal}>
        Reveal in Finder
      </ContextMenuItem>
      <ContextMenuItem onClick={handleRename}>Rename</ContextMenuItem>
      <ContextMenuItem onClick={handleDelete} className="text-red">
        Delete
      </ContextMenuItem>
    </ContextMenu>
  );
}
