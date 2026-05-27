"use client";

// Extension-side Commands tab. Renders every command configured on the
// project, lets the user start/stop background runs (`runProjectCommand` /
// `stopProjectCommand`) or fire a one-shot terminal session for
// `mode: "terminal"` commands.

import { useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { ChevronDown, ChevronRight, Loader2, Play, Square } from "lucide-react";
import { $commandRunOutputs, $projects } from "@/store/subjects";
import { runProjectCommand, stopProjectCommand } from "@/store/actions";

export function ExtCommandsTab({ projectId, onKillTerminal: _onKillTerminal }: { projectId: string; onKillTerminal?: (commandName: string) => void }) {
  const [projects] = useSubject($projects);
  const [commandRunOutputs] = useSubject($commandRunOutputs);
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;

  const vpsInstance = project.vpsInstances.find((i) => !i.deployFailed) ?? project.vpsInstances[0];
  const instanceId = vpsInstance?.id ?? null;

  const commands = project.commands;

  return (
    <div className="flex flex-col h-full overflow-y-auto px-3 py-3 gap-2">
      {commands.length === 0 && (
        <div className="text-overlay0 py-8 text-center" style={{ fontSize: 13 }}>
          No commands configured. Add commands in the main app.
        </div>
      )}

      {!instanceId && commands.length > 0 && (
        <div className="text-peach bg-peach/10 rounded-md px-3 py-2" style={{ fontSize: 13 }}>
          No VPS instance available to run commands on.
        </div>
      )}

      {commands.map((cmd) => {
        const key = `${project.id}:${cmd.id}`;
        const runState = commandRunOutputs[key];
        const isRunning = runState?.running ?? false;
        const isExpanded = expandedCommandId === cmd.id;
        const isTerminalMode = cmd.mode === "terminal";

        return (
          <div key={cmd.id} className="bg-mantle rounded-lg border border-surface0">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => {
                  if (!instanceId) return;
                  if (isTerminalMode) {
                    runProjectCommand(project.id, cmd.id, instanceId);
                  } else if (isRunning) {
                    setConfirmStopId(cmd.id);
                  } else {
                    setExpandedCommandId(cmd.id);
                    runProjectCommand(project.id, cmd.id, instanceId);
                  }
                }}
                disabled={!instanceId}
                className={`shrink-0 p-1 rounded transition-colors ${
                  !isTerminalMode && isRunning
                    ? "text-red hover:bg-red/10"
                    : "text-green hover:bg-green/10"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={isTerminalMode ? "Open in terminal" : isRunning ? "Stop" : "Run"}
              >
                {!isTerminalMode && isRunning ? <Square size={14} /> : <Play size={14} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-text font-medium truncate" style={{ fontSize: 13 }}>{cmd.name}</span>
                  {isTerminalMode && (
                    <span className="text-mauve bg-mauve/10 px-1 py-0.5 rounded leading-none" style={{ fontSize: 10 }}>terminal</span>
                  )}
                </div>
                <div className="text-overlay0 font-mono truncate" style={{ fontSize: 12 }}>{cmd.command}</div>
              </div>
              {!isTerminalMode && runState && (
                <button
                  onClick={() => setExpandedCommandId(isExpanded ? null : cmd.id)}
                  className="text-overlay0 hover:text-text p-1 transition-colors shrink-0"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              )}
            </div>

            {/* Stop confirmation (inline commands only) */}
            {confirmStopId === cmd.id && !isTerminalMode && (
              <div className="flex items-center gap-2 px-3 py-2 border-t border-surface0 bg-red/5">
                <span className="text-red flex-1" style={{ fontSize: 12 }}>Kill this command?</span>
                <button
                  onClick={() => { stopProjectCommand(project.id, cmd.id); setConfirmStopId(null); }}
                  className="px-2 py-0.5 rounded text-red bg-red/10 hover:bg-red/20 transition-colors font-medium"
                  style={{ fontSize: 12 }}
                >
                  Kill
                </button>
                <button
                  onClick={() => setConfirmStopId(null)}
                  className="px-2 py-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
                  style={{ fontSize: 12 }}
                >
                  Cancel
                </button>
              </div>
            )}

            {!isTerminalMode && isExpanded && runState && (
              <div className="border-t border-surface0 px-3 py-2 max-h-[200px] overflow-y-auto font-mono bg-base scrollbar-thin" style={{ fontSize: 12 }}>
                <pre className="text-overlay1 leading-relaxed whitespace-pre-wrap">{runState.output}</pre>
                {isRunning && <Loader2 size={12} className="text-blue animate-spin mt-1" />}
                <div ref={outputEndRef} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
