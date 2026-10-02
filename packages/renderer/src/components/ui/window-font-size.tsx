"use client";

// Shared font-size control for every floating window's title bar. The choice is
// kept in the global `$windowFontSize` subject (so changing it in one window
// updates them all) and persisted to localStorage by `setWindowFontSize`.
//
// Two consumption shapes, because windows render two kinds of content:
//   • DOM windows (Manage, deploy/build logs, chat) apply WINDOW_FONT_SCALE as a
//     CSS `zoom` on their scroll container — scales every label uniformly.
//   • xterm windows (Terminal, SSH) can't use `zoom` (it desyncs the FitAddon),
//     so they feed WINDOW_FONT_PX into the terminal's own `fontSize` instead.

import { useCallback, useState } from "react";
import { Check, ChevronDown, Type } from "lucide-react";
import { useSubject } from "subjecto/react";
import { $windowFontSize } from "@/store/subjects";

export const WINDOW_FONT_SIZES = ["small", "medium", "large"] as const;
export type WindowFontSize = (typeof WINDOW_FONT_SIZES)[number];

/** Zoom factor applied to DOM-content windows. "small" is the original look. */
export const WINDOW_FONT_SCALE: Record<WindowFontSize, number> = {
  small: 1,
  medium: 1.15,
  large: 1.3,
};

/** xterm `fontSize` (px) per choice — "small" matches the bridge default (13). */
export const WINDOW_FONT_PX: Record<WindowFontSize, number> = {
  small: 13,
  medium: 15,
  large: 17,
};

const STORAGE_KEY = "genie-window-font-size";

/** Read the current size and a setter that persists + broadcasts the change. */
export function useWindowFontSize(): [WindowFontSize, (size: WindowFontSize) => void] {
  const [size] = useSubject($windowFontSize);
  const setSize = useCallback((next: WindowFontSize) => {
    $windowFontSize.next(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / disabled storage — keep the in-memory choice */
    }
  }, []);
  return [size, setSize];
}

/** Title-bar dropdown: pick Small / Medium / Large. Self-contained — drop it
 *  into any window header. Stops pointer-down so opening it doesn't drag the
 *  window. */
export function WindowFontSizeButton({ className }: { className?: string }) {
  const [size, setSize] = useWindowFontSize();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0" onPointerDown={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          className ??
          "flex items-center gap-0.5 px-1 py-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors bg-transparent border-none cursor-pointer"
        }
        title="Font size"
      >
        <Type size={13} />
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-mantle border border-overlay0/30 rounded-md shadow-lg py-1 min-w-[140px]">
            {WINDOW_FONT_SIZES.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  setSize(opt);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1 text-md hover:bg-surface0 flex items-center justify-between gap-2 capitalize"
              >
                <span>{opt}</span>
                {opt === size && <Check size={12} className="text-blue shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
