"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Server, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectRemoveConfirmProps {
  /** Display name of the project being removed. */
  name: string;
  /** Number of servers currently attached to the project. */
  attachedServers: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal for removing a project.
 *
 *  - When servers are still attached, removal is blocked: the modal explains
 *    the servers must be detached first and offers only a Cancel action.
 *  - Otherwise it asks for an explicit confirm before the (soft) delete.
 *
 * The socket re-checks both the permission and the attached-server guard; this
 * UI only prevents accidental removal.
 */
export function ProjectRemoveConfirm({ name, attachedServers, onConfirm, onCancel }: ProjectRemoveConfirmProps) {
  const blocked = attachedServers > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-remove-title"
        className="w-full max-w-md mx-4 bg-mantle border border-red/40 rounded-lg shadow-2xl shadow-red/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
          <AlertTriangle size={16} className="text-red shrink-0" />
          <h2 id="project-remove-title" className="text-text font-medium text-md flex-1 truncate">
            Remove project <span className="font-mono text-red">{name}</span>?
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
          {blocked ? (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded bg-red/10 border border-red/30">
              <Server size={13} className="text-red shrink-0 mt-0.5" />
              <div className="text-md text-red">
                This project still has <span className="font-medium">{attachedServers} server{attachedServers === 1 ? "" : "s"}</span> attached.
                Detach {attachedServers === 1 ? "it" : "them"} from the Servers tab before removing the project.
              </div>
            </div>
          ) : (
            <p className="text-md text-text">
              The project will be removed from your list. This can't be undone from here.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0 bg-background/30">
          <Button size="sm" onClick={onCancel}>Cancel</Button>
          {!blocked && (
            <Button size="sm" variant="danger" onClick={onConfirm} title="Remove project">
              Remove project
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
