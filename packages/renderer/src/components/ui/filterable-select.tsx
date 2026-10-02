"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterableSelectOption {
  value: string;
  label: string;
}

// A lightweight, dependency-free combobox: a trigger that opens a popover with a
// search box and a filtered, alphabetically-sorted option list. Full keyboard
// support (↑/↓ to move, Enter to select, Esc to close); Esc stays local so it
// doesn't bubble up and close a surrounding modal.
export function FilterableSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  emptyText = "No matches",
  disabled = false,
}: {
  value: string;
  options: FilterableSelectOption[];
  onChange: (val: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label)),
    [options],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((o) => o.label.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);
  // Clamp so a shrinking list never leaves the highlight out of bounds.
  const idx = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  const selectedLabel = options.find((o) => o.value === value)?.label;

  const commit = useCallback((opt?: FilterableSelectOption) => {
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  }, [onChange]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // Open with the highlight on the current selection (or the top of the list).
    const sel = filtered.findIndex((o) => o.value === value);
    setActiveIndex(sel >= 0 ? sel : 0);
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Typing in the search box resets the highlight to the first match.
  useEffect(() => { setActiveIndex(0); }, [query]);
  // Keep the highlighted row scrolled into view as it moves.
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [idx, open]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(filtered[idx]);
    } else if (e.key === "Escape") {
      // Keep Escape local to the popover so it doesn't close the modal.
      e.stopPropagation();
      setOpen(false);
    }
  }, [filtered, idx, commit]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-1 bg-mantle border border-surface0 rounded-md px-2 py-1.5 text-md cursor-pointer hover:border-overlay0 focus:border-blue outline-none transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        <span className={cn("truncate", selectedLabel ? "text-text" : "text-overlay0")}>
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown size={14} className="text-overlay0 shrink-0" />
      </button>
      {open && !disabled && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-crust border border-surface0 rounded-md shadow-lg overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface0">
            <Search size={13} className="text-overlay0 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search…"
              className="flex-1 bg-transparent text-md text-text outline-none placeholder:text-overlay0"
            />
          </div>
          <div className="max-h-[180px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-md text-overlay0">{emptyText}</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  type="button"
                  key={o.value}
                  ref={i === idx ? activeRef : undefined}
                  onClick={() => commit(o)}
                  onMouseMove={() => setActiveIndex(i)}
                  className={cn(
                    "w-full flex items-center px-2 py-1 text-md border-none cursor-pointer transition-colors text-left truncate",
                    i === idx ? "bg-surface0 text-text" : "bg-transparent text-subtext0",
                    o.value === value && i !== idx && "text-text",
                  )}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
