"use client";

import { ContextMenu, ContextMenuItem } from "@/components/ui/context-menu";

interface DockerContextMenuProps {
  containerId: string;
  containerState: string;
  x: number;
  y: number;
  onClose: () => void;
  onAction: (id: string, action: "docker:start" | "docker:stop") => void;
}

export function DockerContextMenu({
  containerId,
  containerState,
  x,
  y,
  onClose,
  onAction,
}: DockerContextMenuProps) {
  const isRunning = containerState === "running";

  function handleAction() {
    onAction(containerId, isRunning ? "docker:stop" : "docker:start");
    onClose();
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <ContextMenuItem
        onClick={handleAction}
        className={isRunning ? "text-red" : "text-green"}
      >
        {isRunning ? "Stop Container" : "Start Container"}
      </ContextMenuItem>
    </ContextMenu>
  );
}
