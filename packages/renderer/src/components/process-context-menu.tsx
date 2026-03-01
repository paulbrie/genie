"use client";

import { ContextMenu, ContextMenuItem } from "@/components/ui/context-menu";
import { wsSend } from "@/lib/ws";

interface ProcessContextMenuProps {
  pid: number;
  x: number;
  y: number;
  onClose: () => void;
}

export function ProcessContextMenu({
  pid,
  x,
  y,
  onClose,
}: ProcessContextMenuProps) {
  function handleKill() {
    wsSend("process:kill", { pid });
    onClose();
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <ContextMenuItem onClick={handleKill} className="text-red">
        Kill Process
      </ContextMenuItem>
    </ContextMenu>
  );
}
