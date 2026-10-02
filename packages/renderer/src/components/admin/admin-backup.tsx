"use client";

import { useEffect, useRef } from "react";
import { Database, Terminal, Trash2, X } from "lucide-react";
import { createBackup, deleteBackup } from "@/store/actions";
import { Button } from "@/components/ui/button";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupPanel({ backups }: { backups: { files: { name: string; size: number; createdAt: string }[]; loading: boolean; creating: boolean } }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-md text-overlay0">Local database backups stored in ~/.genie/backups/</p>
        <Button size="sm" onClick={createBackup} disabled={backups.creating}>
          <Database size={14} className="mr-1" />
          {backups.creating ? "Creating..." : "Create Backup"}
        </Button>
      </div>

      {backups.loading ? (
        <div className="flex items-center justify-center py-8 text-base text-overlay0">Loading...</div>
      ) : backups.files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">No backups yet</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-base border-collapse">
            <thead className="sticky top-0 bg-mantle z-10">
              <tr>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0">File</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0">Size</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0">Created</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0">Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.files.map((f) => (
                <tr key={f.name} className="border-b border-surface0/30 hover:bg-surface0/30">
                  <td className="px-3 py-2 text-text font-mono">{f.name}</td>
                  <td className="px-3 py-2 text-subtext0">{formatBytes(f.size)}</td>
                  <td className="px-3 py-2 text-subtext0">{new Date(f.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Delete ${f.name}?`)) deleteBackup(f.name);
                      }}
                      className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-red transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DrizzlePushWindow({ output, running, onClose }: { output: string; running: boolean; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  return (
    <div className="fixed bottom-6 right-6 w-[520px] max-h-[400px] flex flex-col bg-mantle border border-surface0 rounded-lg shadow-2xl z-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface0">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-mauve" />
          <span className="text-md font-medium text-text">Drizzle Push</span>
          {running && <div className="w-2 h-2 rounded-full bg-green animate-pulse" />}
        </div>
        <button onClick={onClose} className="p-0.5 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-md text-text whitespace-pre-wrap break-all bg-base">
        {output || (running ? "Starting drizzle-kit push...\n" : "")}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
