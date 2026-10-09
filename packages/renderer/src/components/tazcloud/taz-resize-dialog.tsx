"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/**
 * Pick a new size for a TazCloud VM and confirm the reboot it causes. The
 * sizes come from the deployment's capabilities (falling back to `fallback`
 * until they load); the current size is preselected and can't be submitted.
 */
export function TazResizeDialog({
  vm,
  sizes,
  onConfirm,
  onClose,
}: {
  vm: { id: string; name: string; size?: string };
  sizes: string[];
  onConfirm: (size: string) => void;
  onClose: () => void;
}) {
  const options = vm.size && !sizes.includes(vm.size) ? [vm.size, ...sizes] : sizes;
  const [size, setSize] = useState(vm.size ?? options[0] ?? "");
  const unchanged = !size || size === vm.size;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[3000000] flex items-start justify-center pt-[16vh] bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="taz-resize-title"
        className="w-[440px] max-w-[92vw] bg-mantle border border-surface0 rounded-xl shadow-2xl p-4 flex flex-col gap-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div id="taz-resize-title" className="flex items-center gap-2 text-text font-semibold">
          <Maximize2 size={15} className="text-blue" /> Resize “{vm.name}”
        </div>
        <label className="flex items-center gap-2 text-md text-subtext0">
          <span className="w-24 shrink-0">Current size</span>
          <span className="font-mono text-text">{vm.size || "unknown"}</span>
        </label>
        <label className="flex items-center gap-2 text-md text-subtext0">
          <span className="w-24 shrink-0">New size</span>
          <Select value={size} onChange={(e) => setSize(e.target.value)} className="py-1 text-md font-mono" aria-label="New size">
            {options.map((s) => (
              <option key={s} value={s}>
                {s}{s === vm.size ? " (current)" : ""}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2 rounded-lg border border-peach/30 bg-peach/10 px-3 py-2 text-md text-peach">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div>
            The VM <b>reboots</b> at the new size: a short outage, usually under a minute. Open SSH sessions and running
            dev servers will drop. Disk and data are unchanged; the cost may change.
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={unchanged}
            title={unchanged ? "Pick a different size" : `Resize to ${size} and reboot`}
            onClick={() => onConfirm(size)}
          >
            Resize &amp; reboot
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
