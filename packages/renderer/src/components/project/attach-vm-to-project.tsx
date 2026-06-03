"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Link2, ChevronDown } from "lucide-react";
import { $projects } from "@/store/subjects";
import { attachExistingVmToProject } from "@/store/actions";
import { cn } from "@/lib/utils";

/**
 * Inline button for the "Project" column of an unlinked DO/Taz row.
 * Renders the dropdown via a portal so the surrounding table's `overflow-x-auto`
 * doesn't clip it.
 */
export function AttachVmToProject({
  provider,
  vmId,
}: {
  provider: "digitalocean" | "tazcloud" | "hetzner";
  vmId: string | number;
}) {
  const [projects] = useSubject($projects);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Below the button; right-align to the button's right edge.
      setMenuPos({ top: r.bottom + 4, left: r.right - 200 });
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-overlay0/30 bg-surface0/50",
          "text-md text-overlay1 hover:bg-surface0 hover:text-text transition-colors",
        )}
        title="Link this VM to a Genie project"
      >
        <Link2 size={11} />
        <span>Link →</span>
        <ChevronDown size={10} />
      </button>
      {open && menuPos && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[101] bg-mantle border border-surface0 rounded-md shadow-lg py-1 w-[200px] max-h-[240px] overflow-auto"
            style={{ top: menuPos.top, left: Math.max(8, menuPos.left) }}
          >
            {projects.length === 0 ? (
              <div className="px-3 py-2 text-md text-overlay0 italic">No projects available.</div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    attachExistingVmToProject(p.id, provider, vmId);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-md text-text hover:bg-surface0 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="truncate">{p.name}</span>
                  {p.teamName && (
                    <span className="text-overlay0 text-xs shrink-0">{p.teamName}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
