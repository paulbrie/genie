"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createRoom } from "@/store";
import { cn } from "@/lib/utils";

export function CreateRoomDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [includeGenie, setIncludeGenie] = useState(true);

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // memberIds for Genie will be resolved server-side when type=room
    // We pass an empty array; the server always adds the creator.
    // If includeGenie, we signal it via a special flag — the server
    // will add Genie automatically for rooms.
    createRoom(trimmed, includeGenie ? ["claude"] : []);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-mantle border border-surface0 rounded-lg w-[340px] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-semibold text-text">New Room</h3>
          <button
            onClick={onClose}
            className="p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-md text-subtext0">Room Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="e.g. Project Alpha"
            autoFocus
            className="bg-surface0 border border-surface1 rounded-md px-3 py-1.5 text-md text-text placeholder:text-overlay0 outline-none focus:border-blue"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeGenie}
            onChange={(e) => setIncludeGenie(e.target.checked)}
            className="accent-blue"
          />
          <span className="text-md text-subtext0">Include Genie as a member</span>
        </label>

        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-surface0 border-none text-md text-subtext0 cursor-pointer hover:bg-surface1 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className={cn(
              "px-3 py-1.5 rounded-md border-none text-md font-medium cursor-pointer transition-colors",
              name.trim()
                ? "bg-blue text-background hover:bg-blue/80"
                : "bg-surface0 text-overlay0 cursor-not-allowed"
            )}
          >
            Create Room
          </button>
        </div>
      </div>
    </div>
  );
}
