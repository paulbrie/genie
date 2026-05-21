"use client";

import { useEffect, useRef, useState } from "react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { Package, Loader2, Check, X, ChevronDown, ChevronRight, Play, Zap, Square, Database, Container, Globe, Cloud, FileText, Activity, Network, Shield, Server, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { VPS_RECIPES, BASH_HELPERS, type VpsRecipeDef } from "@/components/project-detail";
import type { UserRecipe } from "@/store/types";
import { $recipes } from "@/store/subjects";
import { loadRecipes } from "@/store/actions";
// Lucide icon names → components. Used to resolve `UserRecipe.icon` (string) into
// a renderable component. Keep this list short — anything not here falls back to Package.
const ICON_MAP: Record<string, typeof Package> = {
  Package, Database, Container, Globe, Cloud, FileText, Activity, Network, Shield, Server, Layers,
};

/** Convert a DB-stored UserRecipe into the in-code VpsRecipeDef shape so the
 *  rest of the panel doesn't need to care which source it came from. */
function userRecipeToDef(r: UserRecipe): VpsRecipeDef {
  return {
    id: r.slug,
    label: r.label,
    icon: ICON_MAP[r.icon] ?? Package,
    description: r.description,
    port: r.port ?? undefined,
    checkScript: r.checkScript,
    installScript: r.installScript,
    uninstallScript: r.uninstallScript,
    setupShSnippet: r.setupShSnippet,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commands: (r.commands as any[]) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: (r.options as any[]) ?? [],
  };
}

/** Hook that returns built-in + user recipes merged. User recipes with the same
 *  slug as a built-in override the built-in (so users can tweak Chrome's apt step). */
function useAllRecipes(): VpsRecipeDef[] {
  const recipes = useDeepSubjectAll($recipes);
  const userDefs = recipes.list.map(userRecipeToDef);
  const userSlugs = new Set(userDefs.map((d: VpsRecipeDef) => d.id));
  const builtins = VPS_RECIPES.filter((b) => !userSlugs.has(b.id));
  return [...builtins, ...userDefs];
}

/** Function-shaped SSH exec contract. `onChunk` streams stdout/stderr so long-
 *  running installs show live progress. `signal` lets the caller abort an
 *  in-flight command — the manager closes the SSH session and the promise
 *  resolves with `error: true`. (VpsFirewall passes a simpler wrapper that
 *  doesn't supply signal — it's optional here so both call shapes type-check.) */
type ExecFn = (
  command: string,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal,
) => Promise<{ output: string; error?: boolean }>;

interface RecipeRuntimeState {
  installed: boolean | null;        // null = unknown / not yet checked
  checking: boolean;
  running: boolean;
  error: string | null;
  output: string;
}

const INIT: RecipeRuntimeState = { installed: null, checking: false, running: false, error: null, output: "" };

/** Cap how many SSH exec calls run concurrently against a single VM. The panel
 *  fires 8+ checks on mount; without a cap, small VMs (1 vCPU / 1 GB) drop
 *  connections during pubkey auth ("Connection lost before handshake"). 3 is the
 *  empirical sweet spot — fast enough that the badges populate in a couple of
 *  seconds, slow enough that sshd never trips MaxStartups. */
const SSH_CONCURRENCY = 3;

/** Tiny async semaphore. Returns a wrapped function that enforces an upper
 *  bound on concurrent in-flight calls. Excess calls queue FIFO. */
function makeLimiter<Args extends unknown[], R>(
  limit: number,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (job) { active++; job(); }
  };
  return (...args: Args) =>
    new Promise<R>((resolve, reject) => {
      queue.push(() => {
        fn(...args).then(
          (v) => { active--; resolve(v); next(); },
          (e) => { active--; reject(e); next(); },
        );
      });
      next();
    });
}

/** Output pane that auto-scrolls to the bottom while the command is running so
 *  the latest streamed line stays visible. Once the command finishes, scroll
 *  control returns to the user. */
function StreamingOutput({ text, running }: { text: string; running: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (running && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [text, running]);
  return (
    <pre
      ref={ref}
      className="text-xs bg-background rounded p-2 max-h-60 overflow-auto text-overlay1 select-text whitespace-pre-wrap"
    >
      {text}
    </pre>
  );
}

/** Admin-scoped Add Services panel: works without a project linkage by taking an
 *  exec callback. State is kept locally per-mount (no global store), so navigating
 *  away resets it — appropriate for ad-hoc admin use. */
export function AdminRecipesPanel({ exec }: { exec: ExecFn }) {
  // Combined built-in + user recipes — user-created entries override built-ins
  // with the same slug (so "chrome-custom" never shadows the built-in "chrome",
  // but editing a recipe with slug="chrome" would).
  const ALL_RECIPES = useAllRecipes();
  // Throttle every SSH exec from this panel to avoid overwhelming small VMs
  // during the auto-check burst on mount. One limiter per mount via useRef so
  // the queue state survives re-renders without reset.
  const limitedExecRef = useRef<ExecFn | null>(null);
  if (!limitedExecRef.current) {
    limitedExecRef.current = makeLimiter(SSH_CONCURRENCY, exec);
  }
  const limitedExec = limitedExecRef.current;
  const [states, setStates] = useState<Record<string, RecipeRuntimeState>>({});
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  // Per-recipe AbortController for in-flight install/runCmd. Kept in a ref so
  // calling abort() from anywhere doesn't require a re-render — we only need
  // the controller's identity, not React reactivity.
  const abortersRef = useRef<Map<string, AbortController>>(new Map());

  // Per-recipe option selections (e.g. { postgres: { PG_VERSION: "16" } }).
  const [optionValues, setOptionValues] = useState<Record<string, Record<string, string>>>({});

  function getOptionValues(recipe: VpsRecipeDef): Record<string, string> {
    const stored = optionValues[recipe.id] ?? {};
    const result: Record<string, string> = {};
    for (const o of recipe.options ?? []) {
      result[o.name] = stored[o.name] ?? o.defaultValue;
    }
    return result;
  }

  function setOptionValue(recipeId: string, name: string, value: string) {
    setOptionValues((prev) => ({ ...prev, [recipeId]: { ...(prev[recipeId] ?? {}), [name]: value } }));
  }

  function buildInstallCommand(recipe: VpsRecipeDef): string {
    const opts = getOptionValues(recipe);
    const exports = Object.entries(opts)
      .map(([k, v]) => `export ${k}=${JSON.stringify(v)}; `)
      .join("");
    // Auto-inject log() / wait_apt for user recipes. Built-ins already inline
    // them, so the duplicate function defs are harmless (bash just overwrites).
    return `${BASH_HELPERS}\n${exports}${recipe.installScript}`;
  }

  function update(id: string, patch: Partial<RecipeRuntimeState>) {
    setStates((s) => ({ ...s, [id]: { ...(s[id] ?? INIT), ...patch } }));
  }

  function toggleExpand(id: string) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function check(recipe: VpsRecipeDef) {
    update(recipe.id, { checking: true, error: null });
    const res = await limitedExec(`${BASH_HELPERS}\n${recipe.checkScript}`);
    update(recipe.id, {
      checking: false,
      installed: res.output.includes("INSTALLED") && !res.output.includes("NOT_INSTALLED"),
      output: res.output,
      error: res.error ? res.output : null,
    });
  }

  // Make sure user recipes are loaded once per session — the Manage panel may be
  // the first place anyone touches recipes (e.g. before they visit /recipes).
  useEffect(() => { loadRecipes(); }, []);
  // Auto-check every recipe whose status we don't have yet. Tracking per-id (not
  // a single ref) so recipes loaded asynchronously from the server still get
  // checked when they first appear in ALL_RECIPES.
  const autoCheckedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const r of ALL_RECIPES) {
      if (autoCheckedRef.current.has(r.id)) continue;
      autoCheckedRef.current.add(r.id);
      void check(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ALL_RECIPES.length]);

  async function install(recipe: VpsRecipeDef) {
    update(recipe.id, { running: true, error: null, output: "" });
    const controller = new AbortController();
    abortersRef.current.set(recipe.id, controller);
    const onChunk = (chunk: string) => {
      // Functional update so each chunk is appended to the latest state — using
      // the closure's `state` would lose chunks under bursty streams.
      setStates((s) => {
        const prev = s[recipe.id] ?? INIT;
        return { ...s, [recipe.id]: { ...prev, output: prev.output + chunk } };
      });
    };
    const res = await limitedExec(buildInstallCommand(recipe), onChunk, controller.signal);
    abortersRef.current.delete(recipe.id);
    const aborted = controller.signal.aborted;
    update(recipe.id, {
      running: false,
      // Don't claim "installed" on cancel — leave it unknown so the next Re-check
      // can determine the real state (the install may have partly succeeded).
      installed: aborted ? null : !res.error,
      output: res.output,
      error: aborted ? "Cancelled" : (res.error ? res.output : null),
    });
  }

  async function runCmd(recipe: VpsRecipeDef, cmd: string) {
    update(recipe.id, { running: true, output: "" });
    const controller = new AbortController();
    abortersRef.current.set(recipe.id, controller);
    const onChunk = (chunk: string) => {
      setStates((s) => {
        const prev = s[recipe.id] ?? INIT;
        return { ...s, [recipe.id]: { ...prev, output: prev.output + chunk } };
      });
    };
    const res = await limitedExec(cmd, onChunk, controller.signal);
    abortersRef.current.delete(recipe.id);
    const aborted = controller.signal.aborted;
    update(recipe.id, {
      running: false,
      output: res.output,
      error: aborted ? "Cancelled" : (res.error ? res.output : null),
    });
  }

  /** Stop an in-flight install / runCmd for one recipe. The promise still
   *  resolves (with error: true) after the manager closes the SSH session,
   *  which clears the running flag and shows the partial output. */
  function stop(recipeId: string) {
    abortersRef.current.get(recipeId)?.abort();
  }

  /** Trigger check on any recipe with unknown status, then fire installs for everything not installed. */
  async function installAll() {
    const unknown = ALL_RECIPES.filter((r) => (states[r.id] ?? INIT).installed === null);
    await Promise.all(unknown.map((r) => check(r)));
    // After checks resolve, read the latest state from the setter callback to avoid stale closure.
    setStates((current) => {
      const toInstall = ALL_RECIPES.filter((r) => {
        const s = current[r.id] ?? INIT;
        return s.installed === false && !s.running && !s.checking;
      });
      if (toInstall.length === 0) return current;
      setExpandedSet((prev) => {
        const next = new Set(prev);
        toInstall.forEach((r) => next.add(r.id));
        return next;
      });
      toInstall.forEach((r) => { void install(r); });
      return current;
    });
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-md font-medium text-subtext0 flex items-center gap-1.5">
          <Package size={12} />
          Add-ons
        </span>
        <button
          onClick={installAll}
          disabled={Object.values(states).some((s) => s.running || s.checking)}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-blue/30 text-md text-blue hover:bg-blue/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Check status of all add-ons, then install everything that's missing (parallel)"
        >
          <Zap size={11} />
          Install all missing
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mt-1">
        {ALL_RECIPES.map((recipe) => {
          const state = states[recipe.id] ?? INIT;
          const Icon = recipe.icon;
          // Disable only the same recipe while it's busy. Other recipes stay clickable
          // — installs fire in parallel SSH sessions.
          const busy = state.checking || state.running;
          return (
            <button
              key={recipe.id}
              disabled={busy}
              onClick={() => {
                if (state.installed === null) {
                  check(recipe);
                  toggleExpand(recipe.id);
                } else if (state.installed) {
                  toggleExpand(recipe.id);
                } else if (recipe.options && recipe.options.length > 0) {
                  // Options to pick — open the panel so the user can choose first.
                  setExpandedSet((p) => new Set(p).add(recipe.id));
                } else {
                  install(recipe);
                  setExpandedSet((p) => new Set(p).add(recipe.id));
                }
              }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded border text-md transition-colors",
                state.installed
                  ? "border-green/30 text-green hover:bg-green/10"
                  : state.error
                    ? "border-red/30 text-red hover:bg-red/10"
                    : "border-overlay0/30 text-overlay1 hover:bg-surface0",
                busy && "opacity-60 cursor-wait",
              )}
              title={recipe.description}
            >
              <Icon size={12} />
              {recipe.label}
              {state.checking || state.running ? <Loader2 size={11} className="animate-spin" />
                : state.installed ? <Check size={11} />
                : state.error ? <X size={11} />
                : null}
            </button>
          );
        })}
      </div>

      {/* Expanded panels — multiple can be open simultaneously to monitor parallel installs */}
      <div className="flex flex-col gap-2 mt-2">
        {ALL_RECIPES.filter((r) => expandedSet.has(r.id)).map((recipe) => {
          const state = states[recipe.id] ?? INIT;
          return (
            <div key={recipe.id} className="bg-mantle rounded-lg p-3 border border-overlay0/20">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => toggleExpand(recipe.id)} className="text-overlay0 hover:text-text transition-colors">
                  <ChevronDown size={12} />
                </button>
                <span className="text-md font-medium text-text">{recipe.label}</span>
                {state.running && <Loader2 size={11} className="animate-spin text-blue" />}
                {state.running && (
                  <button
                    onClick={() => stop(recipe.id)}
                    className="text-md text-overlay0 hover:text-red transition-colors ml-2 flex items-center gap-1"
                    title="Cancel this add-on operation"
                  >
                    <Square size={10} /> Stop
                  </button>
                )}
                {state.installed && !state.running && (
                  <button
                    onClick={() => check(recipe)}
                    disabled={state.checking}
                    className="text-md text-overlay0 hover:text-blue transition-colors ml-2"
                  >
                    Re-check
                  </button>
                )}
              </div>
              {state.installed && !state.running && recipe.commands.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                  {recipe.commands.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => runCmd(recipe, c.command)}
                      disabled={state.running}
                      className="flex items-center gap-1.5 text-left text-md text-overlay1 hover:text-blue transition-colors disabled:opacity-50"
                    >
                      <ChevronRight size={10} />
                      <span className="font-medium">{c.name}</span>
                      <span className="font-mono text-overlay0 text-xs truncate">{c.command}</span>
                    </button>
                  ))}
                </div>
              )}
              {!state.installed && state.installed !== null && !state.running && (
                <div className="mb-2 flex items-center gap-3 flex-wrap">
                  {recipe.options?.map((opt) => {
                    const current = getOptionValues(recipe)[opt.name];
                    return (
                      <div key={opt.name} className="flex items-center gap-1.5 text-md">
                        <label className="text-overlay0">{opt.label}:</label>
                        <select
                          value={current}
                          onChange={(e) => setOptionValue(recipe.id, opt.name, e.target.value)}
                          className="bg-background border border-surface0 rounded px-1.5 py-0.5 text-md text-text outline-none focus:border-blue font-mono"
                        >
                          {opt.choices.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  <span className="text-md text-overlay1">
                    Not installed.{" "}
                    <button onClick={() => install(recipe)} className="text-blue hover:underline inline-flex items-center gap-1">
                      <Play size={10} /> Install
                    </button>
                  </span>
                </div>
              )}
              {(() => {
                // Hide the output pane when it's just the check-script's status marker.
                const trimmed = state.output.trim();
                const isJustMarker = trimmed === "INSTALLED" || trimmed === "NOT_INSTALLED" || trimmed === "";
                if (!state.running && isJustMarker) return null;
                return (
                  <StreamingOutput text={state.running && !state.output ? "Running…" : state.output} running={state.running} />
                );
              })()}
              {state.error && !state.running && (
                <p className="text-xs text-red mt-1">{state.error.slice(0, 200)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
