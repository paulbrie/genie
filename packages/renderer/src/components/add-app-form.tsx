"use client";

import { useState } from "react";
import { hideAddForm } from "@/store";
import { wsSend } from "@/lib/ws";
import { Button } from "@/components/ui/button";

export function AddAppForm() {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");

  function handleSave() {
    const trimName = name.trim();
    const trimCommand = command.trim();
    if (!trimName || !trimCommand) return;

    wsSend("app:add", {
      name: trimName,
      command: trimCommand,
      cwd: cwd.trim() || undefined,
    });
    setName("");
    setCommand("");
    setCwd("");
    hideAddForm();
  }

  function handleCancel() {
    setName("");
    setCommand("");
    setCwd("");
    hideAddForm();
  }

  return (
    <div className="px-5 py-6 flex flex-col gap-3.5 max-w-[480px]">
      <h2 className="text-lg font-semibold text-text mb-1">Add New App</h2>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My App"
          className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">Command</label>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="node server.js"
          className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">
          Working Directory
        </label>
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/path/to/project (optional)"
          className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
        />
      </div>

      <div className="flex gap-1.5 justify-end pt-1">
        <Button size="sm" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
