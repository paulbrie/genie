"use client";

import { ContextMenu, ContextMenuItem } from "@/components/ui/context-menu";

interface TmuxSessionContextMenuProps {
  sessionName: string;
  x: number;
  y: number;
  onClose: () => void;
  onRename: (sessionName: string) => void;
  onDelete: (sessionName: string) => void;
}

export function TmuxSessionContextMenu({
  sessionName,
  x,
  y,
  onClose,
  onRename,
  onDelete,
}: TmuxSessionContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <ContextMenuItem
        onClick={() => {
          onRename(sessionName);
          onClose();
        }}
      >
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          onDelete(sessionName);
          onClose();
        }}
        className="text-red"
      >
        Delete
      </ContextMenuItem>
    </ContextMenu>
  );
}

interface TmuxCompactContextMenuProps {
  sessions: { name: string }[];
  x: number;
  y: number;
  onClose: () => void;
  onRename: (sessionName: string) => void;
  onDelete: (sessionName: string) => void;
}

/** Multi-session menu for the compact title-bar badge. */
export function TmuxCompactContextMenu({
  sessions,
  x,
  y,
  onClose,
  onRename,
  onDelete,
}: TmuxCompactContextMenuProps) {
  if (sessions.length === 1) {
    return (
      <TmuxSessionContextMenu
        sessionName={sessions[0].name}
        x={x}
        y={y}
        onClose={onClose}
        onRename={onRename}
        onDelete={onDelete}
      />
    );
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {sessions.map((s, i) => (
        <div key={s.name}>
          {i > 0 && <div className="my-1 border-t border-surface1" />}
          <div className="px-3 py-1 text-xs font-mono text-overlay0 truncate max-w-[14rem]" title={s.name}>
            {s.name}
          </div>
          <ContextMenuItem
            onClick={() => {
              onRename(s.name);
              onClose();
            }}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              onDelete(s.name);
              onClose();
            }}
            className="text-red"
          >
            Delete
          </ContextMenuItem>
        </div>
      ))}
    </ContextMenu>
  );
}
