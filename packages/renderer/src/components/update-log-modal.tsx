"use client";

import { X, Sparkles } from "lucide-react";
import type { ChangelogEntry } from "@/lib/changelog";

interface UpdateLogModalProps {
  open: boolean;
  entries: ChangelogEntry[];
  onClose: () => void;
}

export function UpdateLogModal({ open, entries, onClose }: UpdateLogModalProps) {
  if (!open || entries.length === 0) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[92vw] max-h-[80vh] bg-mantle border border-surface0 rounded-lg shadow-xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
          <Sparkles size={14} className="text-mauve" />
          <span className="text-text font-medium text-md">What&apos;s new</span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {entries.map((entry) => (
            <section key={entry.version} className="flex flex-col gap-1.5">
              <header className="flex items-baseline gap-2">
                <h3 className="text-text font-medium text-md">{entry.title}</h3>
                <span className="text-overlay0 text-xs tabular-nums">{entry.date}</span>
              </header>
              <ul className="list-disc list-outside pl-4 flex flex-col gap-1 text-subtext0 text-md">
                {entry.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-mauve text-crust text-md border-none cursor-pointer hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
