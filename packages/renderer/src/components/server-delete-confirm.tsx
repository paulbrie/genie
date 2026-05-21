"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ServerDeleteConfirmProps {
  /** Display name of the VM/droplet — what the user must type when locked. */
  name: string;
  /** A running server is "locked": confirmation requires typing the name. */
  locked: boolean;
  /** True when the active user is allowed to delete a locked server. */
  canDeleteLocked: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Inline delete confirmation for cloud server rows.
 *
 * - Unlocked: plain Confirm/Cancel.
 * - Locked + caller is superadmin: requires typing the server name to enable Confirm.
 * - Locked + caller is not superadmin: shows the lock notice with no path to confirm.
 *
 * Backend re-checks both the lock and the role; this UI just prevents the obvious mistake.
 */
export function ServerDeleteConfirm({ name, locked, canDeleteLocked, onConfirm, onCancel }: ServerDeleteConfirmProps) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === name;

  if (!locked) {
    return (
      <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded bg-red/10">
        <span className="text-md text-red">Delete this server?</span>
        <Button size="sm" variant="danger" onClick={onConfirm}>Confirm</Button>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    );
  }

  if (!canDeleteLocked) {
    return (
      <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded bg-red/10">
        <Lock size={12} className="text-red" />
        <span className="text-md text-red">
          This server is locked — only a superadmin can delete or unlock it.
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={onCancel}>Dismiss</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-2 px-2 py-2 rounded bg-red/10 border border-red/30">
      <div className="flex items-center gap-1.5">
        <Lock size={12} className="text-red" />
        <span className="text-md text-red font-medium">
          This server is locked. Type its name to confirm deletion.
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-md text-overlay1 font-mono">{name}</span>
        <input
          autoFocus
          type="text"
          value={typed}
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches) onConfirm();
            else if (e.key === "Escape") onCancel();
          }}
          placeholder="type the name"
          className="bg-background border border-red/40 rounded px-1.5 py-0.5 text-md font-mono outline-none focus:border-red flex-1"
        />
        <Button size="sm" variant="danger" disabled={!matches} onClick={onConfirm}>
          Delete
        </Button>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
