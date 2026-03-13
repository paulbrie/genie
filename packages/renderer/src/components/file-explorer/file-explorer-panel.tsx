"use client";

import { useCallback, useRef } from "react";
import { useSubject } from "subjecto/react";
import { X } from "lucide-react";
import { $fileExplorer, toggleFileExplorer, setFileExplorerPanelWidth } from "@/store";
import { FileExplorerToolbar } from "./file-explorer-toolbar";
import { FileList } from "./file-list";

export function FileExplorerPanel() {
  const [fileExplorer] = useSubject($fileExplorer);
  const { open, panelWidth } = fileExplorer;
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const startX = e.clientX;
      const startWidth = panelWidth;

      function onMouseMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const delta = startX - ev.clientX;
        setFileExplorerPanelWidth(startWidth + delta);
      }

      function onMouseUp() {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth]
  );

  if (!open) return null;

  return (
    <div
      className="fixed top-0 right-0 h-screen bg-mantle border-l border-surface0 flex flex-col z-50 shadow-xl shadow-black/30"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-mauve/40 active:bg-mauve/60 z-10"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-[38px] pb-1.5">
        <h2 className="text-md font-semibold text-text">Files</h2>
        <button
          onClick={toggleFileExplorer}
          className="p-1 rounded hover:bg-surface1 text-overlay0 hover:text-text"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <FileExplorerToolbar />
      <FileList />
    </div>
  );
}
