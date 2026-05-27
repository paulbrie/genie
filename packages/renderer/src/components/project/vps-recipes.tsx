"use client";

import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { Check, ChevronDown, ChevronRight, Copy, Globe, Loader2, Package, Play, Plus, Square, TerminalSquare, Trash2, X } from "lucide-react";
import type { ProjectDef, RecipeState } from "@/store/types";
import { $commandRunOutputs, $projects } from "@/store/subjects";
import { addSshTerminalTab, checkVpsRecipe, loadRecipes, runProjectCommand, runVpsRecipe, stopProjectCommand, uninstallVpsRecipe, vpsExec } from "@/store/actions";
import { useAllRecipes } from "@/hooks/use-all-recipes";
import { wsSend } from "@/lib/ws";
import { cn } from "@/lib/utils";
import { ErrorMessage } from "@/components/ui/error-message";

interface RecipeCommand {
  name: string;
  command: string;
}

export interface RecipeOption {
  /** Env var name set when running the install script (e.g. `PG_VERSION`). */
  name: string;
  label: string;
  choices: { value: string; label: string }[];
  defaultValue: string;
}

/** A secret value the install script needs (e.g. a PAT). Collected from the
 *  user at apply-time via a modal — NOT stored anywhere (settings, DB, or local
 *  storage). Each Install / Re-apply requires the user to paste it again. */
export interface RecipeSecret {
  /** Env var name set in the install script's environment (e.g. `GIT_TOKEN`). */
  name: string;
  label: string;
  /** Placeholder text shown in the input. */
  placeholder?: string;
  /** Short description rendered under the field. May include hints/links. */
  description?: string;
  /** When true, the recipe will refuse to install with this field empty. */
  required?: boolean;
}

export interface VpsRecipeDef {
  id: string;
  label: string;
  icon: typeof Globe;
  description: string;
  port?: number;
  checkScript: string;
  installScript: string;
  uninstallScript: string;
  setupShSnippet: string;
  commands: RecipeCommand[];
  /** Optional pre-install options shown as a small form in the admin panel. */
  options?: RecipeOption[];
  /** Optional secrets prompted via modal on every Install / Re-apply. Required
   *  for recipes that consume sensitive values not safe to persist (PATs).
   *  Distinct from `options` in two ways:
   *    1. Modal-driven UX (not inline form) so the user can't mistakenly leave
   *       a token sitting in the page state across other actions.
   *    2. Each apply re-prompts — no auto-fill, no saved values.
   */
  secrets?: RecipeSecret[];
}


function JsonSyntax({ text }: { text: string }) {
  // Colorize JSON tokens
  const colored = text
    .replace(/("(?:\\.|[^"\\])*")\s*:/g, '<span class="text-blue">$1</span>:')  // keys
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="text-green">$1</span>') // string values
    .replace(/:\s*(true|false)/g, ': <span class="text-peach">$1</span>')         // booleans
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="text-peach">$1</span>')          // numbers
    .replace(/:\s*(null)/g, ': <span class="text-overlay0">$1</span>');            // null
  return <pre className="text-md font-mono text-text whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: colored }} />;
}

function CommandPill({
  cmd,
  projectId,
  instanceId,
}: {
  cmd: RecipeCommand;
  projectId: string;
  instanceId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const [projects] = useSubject($projects);
  const project = projects.find((p) => p.id === projectId);
  const instance = project?.vpsInstances.find((v) => v.id === instanceId);

  async function handleClick() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    setLoading(true);
    setOutput(null);
    const result = await vpsExec(projectId, instanceId, cmd.command);
    setOutput(result.output);
    setIsError(!!result.error);
    setLoading(false);
  }

  function handleRunInTerminal() {
    if (!instance) return;
    const { host, port, username, privateKeyPath } = instance.connection;
    addSshTerminalTab({ host, port, username, privateKeyPath }, cmd.name, cmd.command);
  }

  // Try to detect and format JSON
  const isJson = output && (() => {
    const trimmed = output.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try { JSON.parse(trimmed); return true; } catch { return false; }
    }
    return false;
  })();

  const formattedJson = isJson ? JSON.stringify(JSON.parse(output!.trim()), null, 2) : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <button
          onClick={handleClick}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-md transition-colors",
            expanded ? "bg-surface1 text-text" : "bg-surface0 text-subtext0 hover:bg-surface1 hover:text-text",
          )}
          title={cmd.command}
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <ChevronRight size={11} className={cn("transition-transform", expanded && "rotate-90")} />}
          {cmd.name}
        </button>
        <button
          onClick={handleRunInTerminal}
          className="p-1 text-overlay0 hover:text-green transition-colors rounded"
          title="Run in SSH terminal"
        >
          <TerminalSquare size={13} />
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(cmd.command)}
          className="p-1 text-overlay0 hover:text-text transition-colors rounded"
          title="Copy command"
        >
          <Copy size={13} />
        </button>
      </div>
      {expanded && (
        <div className="mt-1 ml-2 bg-crust rounded-md p-2 max-h-[200px] overflow-auto scrollbar-thin">
          {loading && <span className="text-md text-overlay0">Running...</span>}
          {output !== null && !loading && (
            <>
              {formattedJson ? (
                <JsonSyntax text={formattedJson} />
              ) : (
                <pre className={cn("text-md font-mono whitespace-pre-wrap", isError ? "text-red" : "text-text")}>{output}</pre>
              )}
              {output && (
                <button
                  onClick={() => navigator.clipboard.writeText(formattedJson || output)}
                  className="mt-1 text-[11px] text-overlay0 hover:text-text transition-colors"
                >
                  Copy output
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RecipeCommands({
  commands,
  projectId,
  instanceId,
}: {
  commands: RecipeCommand[];
  projectId: string;
  instanceId: string;
}) {
  return (
    <div className="mb-2">
      <span className="text-md font-medium text-subtext0 mb-1 block">Commands</span>
      <div className="flex flex-wrap gap-1">
        {commands.map((cmd) => (
          <CommandPill
            key={cmd.name}
            cmd={cmd}
            projectId={projectId}
            instanceId={instanceId}
          />
        ))}
      </div>
    </div>
  );
}

export function VpsRecipes({
  projectId,
  instanceId,
  recipes,
}: {
  projectId: string;
  instanceId: string;
  recipes: Record<string, RecipeState>;
}) {
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ recipeId: string; x: number; y: number } | null>(null);
  const allRecipes = useAllRecipes();

  // User recipes (Node.js LTS, Playwright, etc.) live in the $recipes store and
  // load async. The Manage panel may be the first place anyone touches them.
  useEffect(() => { loadRecipes(); }, []);

  // Per-id auto-check so user recipes that arrive after mount also get checked.
  // Mirrors the admin Manage panel's pattern.
  const autoCheckedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const recipe of allRecipes) {
      const key = `${instanceId}:${recipe.id}`;
      if (autoCheckedRef.current.has(key)) continue;
      autoCheckedRef.current.add(key);
      checkVpsRecipe(projectId, instanceId, recipe.id, recipe.checkScript);
    }
  }, [projectId, instanceId, allRecipes.length]);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  function handleAddToSetup(recipe: VpsRecipeDef) {
    wsSend("project:setup-snippet:add", { projectId, recipeId: recipe.id, snippet: recipe.setupShSnippet });
  }

  function handleUninstall(recipe: VpsRecipeDef) {
    uninstallVpsRecipe(projectId, instanceId, recipe.id, recipe.uninstallScript);
    setExpandedRecipe(recipe.id);
    setContextMenu(null);
  }

  return (
    <div className="mb-3">
      <span className="text-md font-medium text-subtext0 mb-2 flex items-center gap-1.5">
        <Package size={12} />
        Add Services
      </span>
      <div className="flex flex-wrap gap-2 mt-1">
        {allRecipes.map((recipe) => {
          const state = recipes[recipe.id];
          const checking = state?.checking ?? false;
          const installed = state?.installed ?? null;
          const running = state?.running ?? false;
          const failed = !!state?.error;
          const expanded = expandedRecipe === recipe.id;
          const Icon = recipe.icon;

          return (
            <div key={recipe.id} className="flex flex-col relative">
              <button
                disabled={running || checking}
                onClick={() => {
                  if (checking) return;
                  if (installed === null) {
                    // Re-check if state is unknown
                    checkVpsRecipe(projectId, instanceId, recipe.id, recipe.checkScript);
                  } else if (installed) {
                    setExpandedRecipe(expanded ? null : recipe.id);
                  } else if (failed) {
                    setExpandedRecipe(expanded ? null : recipe.id);
                  } else {
                    runVpsRecipe(projectId, instanceId, recipe.id, recipe.installScript);
                    setExpandedRecipe(recipe.id);
                  }
                }}
                onContextMenu={(e) => {
                  if (installed && !running) {
                    e.preventDefault();
                    setContextMenu({ recipeId: recipe.id, x: e.clientX, y: e.clientY });
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-md transition-colors",
                  checking && "bg-surface0 text-overlay0 cursor-wait",
                  running && "bg-blue/10 text-blue cursor-wait",
                  installed && !running && "bg-green/10 text-green hover:bg-green/20",
                  failed && "bg-red/10 text-red hover:bg-red/20",
                  installed === false && !running && !failed && "bg-surface0 text-text hover:bg-surface1",
                  installed === null && !checking && "bg-surface0 text-overlay0",
                )}
                title={recipe.description}
              >
                {(running || checking) ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                {recipe.label}
                {installed && !running && recipe.port && <span className="text-[11px] font-mono opacity-70">:{recipe.port}</span>}
                {installed && !running && <Check size={12} />}
                {failed && <X size={12} />}
              </button>

              {/* Right-click context menu */}
              {contextMenu?.recipeId === recipe.id && (
                <div
                  className="fixed z-50 bg-mantle border border-surface0 rounded-lg shadow-lg py-1 min-w-[140px]"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                  <button
                    onClick={() => handleAddToSetup(recipe)}
                    className="w-full text-left px-3 py-1.5 text-md text-text hover:bg-surface0 flex items-center gap-2"
                  >
                    <Plus size={12} />
                    Add to setup.sh
                  </button>
                  <button
                    onClick={() => handleUninstall(recipe)}
                    className="w-full text-left px-3 py-1.5 text-md text-red hover:bg-red/10 flex items-center gap-2"
                  >
                    <Trash2 size={12} />
                    Uninstall
                  </button>
                </div>
              )}

              {expanded && (
                <div className="mt-1 bg-background rounded-lg p-2 max-w-[480px]">
                  {/* Progress log (install/uninstall output) */}
                  {state && state.progress.length > 0 && (
                    <div className="max-h-[150px] overflow-y-auto scrollbar-thin mb-2">
                      {state.progress.map((line, i) => (
                        <div key={i} className="text-md text-overlay1 font-mono whitespace-pre-wrap">{line}</div>
                      ))}
                    </div>
                  )}
                  {state?.error && <ErrorMessage className="font-mono mb-2">{state.error}</ErrorMessage>}

                  {/* Commands manual */}
                  {installed && !running && recipe.commands.length > 0 && (
                    <RecipeCommands
                      commands={recipe.commands}
                      projectId={projectId}
                      instanceId={instanceId}
                    />
                  )}

                  <div className="flex items-center gap-2 pt-1 border-t border-surface0">
                    {failed && (
                      <button
                        onClick={() => { runVpsRecipe(projectId, instanceId, recipe.id, recipe.installScript); }}
                        className="text-md text-blue hover:underline"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedRecipe(null)}
                      className="text-md text-overlay0 hover:underline ml-auto"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Run Commands Section ---

export function VpsRunCommands({ project, instanceId }: { project: ProjectDef; instanceId: string }) {
  const [commandRunOutputs] = useSubject($commandRunOutputs);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commandRunOutputs, expandedId]);

  if (project.commands.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Play size={12} className="text-green" />
        <span className="text-md font-medium text-subtext0">Run Commands</span>
      </div>
      <div className="flex flex-col gap-1">
        {project.commands.map((cmd) => {
          const key = `${project.id}:${cmd.id}`;
          const runState = commandRunOutputs[key];
          const isRunning = runState?.running ?? false;
          const isExpanded = expandedId === cmd.id && runState;

          return (
            <div key={cmd.id} className="bg-background rounded overflow-hidden">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  onClick={() => {
                    if (cmd.mode === "terminal") {
                      const inst = project.vpsInstances.find((v) => v.id === instanceId);
                      if (inst) {
                        const { username, host, port, privateKeyPath } = inst.connection;
                        // Use setsid for nohup commands so they survive PTY close
                        let termCmd = cmd.command;
                        if (termCmd.includes("nohup ")) {
                          const clean = termCmd.replace(/\s*&\s*$/, "");
                          termCmd = `setsid ${clean} &`;
                        }
                        addSshTerminalTab({ host, port, username, privateKeyPath }, cmd.name, termCmd);
                      }
                    } else {
                      runProjectCommand(project.id, cmd.id, instanceId);
                      setExpandedId(cmd.id);
                    }
                  }}
                  disabled={isRunning}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    isRunning ? "text-overlay0" : "text-green hover:bg-green/10"
                  )}
                  title={isRunning ? "Running..." : "Run"}
                >
                  {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                </button>
                {isRunning && (
                  <button
                    onClick={() => stopProjectCommand(project.id, cmd.id)}
                    className="p-0.5 rounded text-red hover:bg-red/10 transition-colors"
                    title="Stop"
                  >
                    <Square size={12} />
                  </button>
                )}
                <span className="text-md text-text font-medium shrink-0">{cmd.name}</span>
                <span className="text-[11px] text-overlay0">—</span>
                <span className="text-md text-overlay0 font-mono truncate">{cmd.command}</span>
                {cmd.mode === "terminal" && (
                  <span className="text-[11px] px-1 py-0.5 rounded bg-surface0 text-overlay0">terminal</span>
                )}
                {runState && (
                  <button
                    onClick={() => setExpandedId(expandedId === cmd.id ? null : cmd.id)}
                    className="text-overlay0 hover:text-text transition-colors p-0.5"
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                )}
              </div>
              {isExpanded && (
                <div className="px-2 pb-2 max-h-[200px] overflow-y-auto scrollbar-thin">
                  <pre className="text-md font-mono text-overlay1 whitespace-pre-wrap break-words">
                    {runState.output || (isRunning ? "Running..." : "")}
                  </pre>
                  <div ref={outputEndRef} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
