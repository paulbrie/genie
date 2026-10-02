"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ServerDeleteConfirmProps {
  /** Display name of the VM/droplet — what the user must type to confirm. */
  name: string;
  /** A "locked" server requires superadmin to delete. */
  locked: boolean;
  /** True when the active user is allowed to delete a locked server. */
  canDeleteLocked: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Destructive-delete confirmation modal for cloud server rows.
 *
 * Same prop signature as the prior inline confirm — drop-in replacement.
 * Differences:
 *  - Always requires typing the server name (not only for locked rows).
 *  - Requires an explicit "I understand" checkbox — two independent signals
 *    before the destructive button is enabled.
 *  - Spells out exactly what gets destroyed.
 *  - Renders as a centered modal in a portal, not an inline strip, so it's
 *    impossible to miss and easy to escape (Esc / backdrop click / X).
 *
 * Backend still re-checks the lock + role; this UI only prevents thumbslip.
 */
export function ServerDeleteConfirm({ name, locked, canDeleteLocked, onConfirm, onCancel }: ServerDeleteConfirmProps) {
  const [typed, setTyped] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const lockBlocked = locked && !canDeleteLocked;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    // Prevent body scroll while the modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  const nameMatches = typed.trim() === name;
  const canConfirm = !lockBlocked && nameMatches && acknowledged;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-delete-title"
        className="w-full max-w-md mx-4 bg-mantle border border-red/40 rounded-lg shadow-2xl shadow-red/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
          <AlertTriangle size={16} className="text-red shrink-0" />
          <h2 id="server-delete-title" className="text-text font-medium text-md flex-1 truncate">
            Delete server <span className="font-mono text-red">{name}</span>?
          </h2>
          <button
            onClick={onCancel}
            className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-0.5"
            title="Cancel"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          <p className="text-md text-text">
            This action is <span className="text-red font-medium">permanent and cannot be undone</span>.
          </p>
          <ul className="text-md text-subtext0 list-disc pl-5 space-y-0.5">
            <li>The VM and its disk will be destroyed.</li>
            <li>All data on the VM will be lost forever.</li>
            <li>Any attached ingress / domain will be removed.</li>
            <li>If linked to a Genie project, the linkage will break.</li>
          </ul>

          {locked && (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded bg-red/10 border border-red/30">
              <Lock size={13} className="text-red shrink-0 mt-0.5" />
              <div className="text-xs text-red">
                {lockBlocked
                  ? "This server is locked. Only a superadmin can delete or unlock it. Ask a superadmin to unlock first."
                  : "This server is locked. You are deleting a locked resource — proceed only if you are certain."}
              </div>
            </div>
          )}

          {!lockBlocked && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="server-delete-name" className="text-xs text-overlay1">
                  Type the server name to confirm:{" "}
                  <span className="font-mono text-subtext0">{name}</span>
                </label>
                <input
                  id="server-delete-name"
                  autoFocus
                  type="text"
                  value={typed}
                  spellCheck={false}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canConfirm) onConfirm();
                  }}
                  placeholder={name}
                  className="bg-background border border-surface1 rounded px-2 py-1 text-md font-mono outline-none focus:border-red"
                />
              </div>

              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 accent-red cursor-pointer"
                />
                <span className="text-xs text-subtext0">
                  I understand this will permanently destroy the VM and all data on it.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0 bg-background/30">
          <Button size="sm" onClick={onCancel}>Cancel</Button>
          {!lockBlocked && (
            <Button
              size="sm"
              variant="danger"
              disabled={!canConfirm}
              onClick={onConfirm}
              title={
                !nameMatches ? "Type the server name to enable"
                : !acknowledged ? "Check the acknowledgement to enable"
                : "Delete server permanently"
              }
            >
              Delete server
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
