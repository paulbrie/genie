"use client";

import { useCallback, useState } from "react";
import { Bot, Pencil, Trash2 } from "lucide-react";
import {
  ActionMenuItem,
  ContextActionMenu,
} from "@/components/ui/action-menu";

export type TmuxSessionMenuHandlers = {
  onRename: (sessionName: string) => void;
  /** Kill the tmux session on the VM. Resolves when the manager round-trip finishes. */
  onDelete: (sessionName: string) => Promise<void>;
  /** Open the project's chat-mode Claude window. Omitted → no "Chat" item. */
  onChat?: (sessionName: string) => void;
};

interface TmuxSessionContextMenuProps extends TmuxSessionMenuHandlers {
  sessionName: string;
  x: number;
  y: number;
  onClose: () => void;
  /** Override confirm prompt (e.g. persisted-terminal sessions tab). */
  deleteConfirmMessage?: string;
}

export function TmuxSessionContextMenu({
  sessionName,
  x,
  y,
  onClose,
  onRename,
  onDelete,
  onChat,
  deleteConfirmMessage,
}: TmuxSessionContextMenuProps) {
  const [deleting, setDeleting] = useState(false);

  const runDelete = useCallback(async () => {
    const msg =
      deleteConfirmMessage ?? `Kill tmux session "${sessionName}"?`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      await onDelete(sessionName);
      onClose();
    } catch {
      // Parent surfaces errors via alert; keep menu open for retry.
    } finally {
      setDeleting(false);
    }
  }, [sessionName, deleteConfirmMessage, onDelete, onClose]);

  return (
    <ContextActionMenu x={x} y={y} onClose={onClose} blockClose={deleting}>
      {onChat && sessionName.startsWith("claude-chat-") && (
        <ActionMenuItem
          icon={Bot}
          disabled={deleting}
          onClick={() => { onChat(sessionName); onClose(); }}
        >
          Open chat (beta)
        </ActionMenuItem>
      )}
      <ActionMenuItem
        icon={Pencil}
        disabled={deleting}
        onClick={() => {
          onRename(sessionName);
          onClose();
        }}
      >
        Rename
      </ActionMenuItem>
      <ActionMenuItem
        icon={Trash2}
        variant="danger"
        loading={deleting}
        onClick={() => void runDelete()}
      >
        {deleting ? "Deleting session…" : "Delete session…"}
      </ActionMenuItem>
    </ContextActionMenu>
  );
}

interface TmuxCompactContextMenuProps extends TmuxSessionMenuHandlers {
  sessions: { name: string }[];
  x: number;
  y: number;
  onClose: () => void;
}

/** Multi-session menu for the compact title-bar badge. */
export function TmuxCompactContextMenu({
  sessions,
  x,
  y,
  onClose,
  onRename,
  onDelete,
  onChat,
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
        onChat={onChat}
      />
    );
  }

  return (
    <ContextActionMenu x={x} y={y} onClose={onClose}>
      {sessions.map((s, i) => (
        <TmuxSessionMenuSection
          key={s.name}
          sessionName={s.name}
          showDivider={i > 0}
          onRename={onRename}
          onDelete={onDelete}
          onChat={onChat}
          onClose={onClose}
        />
      ))}
    </ContextActionMenu>
  );
}

function TmuxSessionMenuSection({
  sessionName,
  showDivider,
  onRename,
  onDelete,
  onChat,
  onClose,
}: {
  sessionName: string;
  showDivider: boolean;
} & TmuxSessionMenuHandlers & { onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const runDelete = useCallback(async () => {
    if (!window.confirm(`Kill tmux session "${sessionName}"?`)) return;
    setDeleting(true);
    try {
      await onDelete(sessionName);
      onClose();
    } finally {
      setDeleting(false);
    }
  }, [sessionName, onDelete, onClose]);

  return (
    <div>
      {showDivider && <div className="my-1 border-t border-overlay0/15" />}
      <div
        className="px-3 py-1 text-xs font-mono text-overlay0 truncate max-w-[14rem]"
        title={sessionName}
      >
        {sessionName}
      </div>
      {onChat && sessionName.startsWith("claude-chat-") && (
        <ActionMenuItem icon={Bot} onClick={() => { onChat(sessionName); onClose(); }}>
          Open chat (beta)
        </ActionMenuItem>
      )}
      <ActionMenuItem
        icon={Pencil}
        disabled={deleting}
        onClick={() => {
          onRename(sessionName);
          onClose();
        }}
      >
        Rename
      </ActionMenuItem>
      <ActionMenuItem
        icon={Trash2}
        variant="danger"
        loading={deleting}
        onClick={() => void runDelete()}
      >
        {deleting ? "Deleting session…" : "Delete session…"}
      </ActionMenuItem>
    </div>
  );
}
