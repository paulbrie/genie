"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export function TmuxRenameDialog({
  sessionName,
  onConfirm,
  onClose,
}: {
  sessionName: string;
  onConfirm: (newName: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(sessionName);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const trimmed = value.trim();
  const canSubmit = !!trimmed && trimmed !== sessionName && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tmux-rename-title"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        className="bg-mantle border border-surface0 rounded-lg w-[360px] p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id="tmux-rename-title" className="text-md font-semibold text-text">
            Rename tmux session
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-xs text-overlay0 font-mono truncate" title={sessionName}>
          {sessionName}
        </p>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          disabled={submitting}
          className="bg-surface0 border border-surface1 rounded-md px-3 py-1.5 text-md font-mono text-text placeholder:text-overlay0 outline-none focus:border-blue disabled:opacity-60"
          placeholder="New session name"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-md bg-surface0 border-none text-md text-subtext0 cursor-pointer hover:bg-surface1 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "px-3 py-1.5 rounded-md border-none text-md font-medium cursor-pointer transition-colors",
              canSubmit
                ? "bg-blue text-background hover:bg-blue/80"
                : "bg-surface0 text-overlay0 cursor-not-allowed",
            )}
          >
            {submitting ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
