"use client";

import { useEffect, useRef, useState } from "react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { Loader2, Check, X, ChevronDown, ChevronRight, Play, Square, KeyRound, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VpsRecipeDef } from "@/components/project/project-detail";
import { useAllRecipes } from "@/hooks/use-all-recipes";
import { loadRecipes } from "@/store/actions";

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
 *  connections during pubkey auth ("Connection lost before handshake"). Keep
 *  this low so opening Manage doesn't create a burst of parallel SSH sessions. */
const SSH_CONCURRENCY = 2;

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

  // Secrets modal state. Held only here in component state — never persisted to
  // settings, storage, or the DB. Cleared on submit/cancel/recipe-change so a
  // pasted token doesn't outlive the action that consumed it.
  const [secretsPromptFor, setSecretsPromptFor] = useState<string | null>(null);
  const [secretValuesDraft, setSecretValuesDraft] = useState<Record<string, string>>({});
  const [secretError, setSecretError] = useState<string | null>(null);

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

  function buildInstallCommand(recipe: VpsRecipeDef, secrets?: Record<string, string>): string {
    const opts = getOptionValues(recipe);
    // Options + secrets both reach the install script via `export NAME=VALUE`.
    // Secrets are only present for this single command — they live in the bash
    // process env, not in the user's shell rc / persistent settings.
    const optExports = Object.entries(opts)
      .map(([k, v]) => `export ${k}=${JSON.stringify(v)}; `)
      .join("");
    const secretExports = secrets
      ? Object.entries(secrets)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => `export ${k}=${JSON.stringify(v)}; `)
          .join("")
      : "";
    // The install script comes straight from the DB — built-in recipes
    // already have BASH_HELPERS resolved into the body at seed time
    // (see manager/src/default-recipes.ts), and user recipes are
    // responsible for inlining whatever helpers they need. We just
    // prepend the per-apply env exports and run it.
    return `${optExports}${secretExports}${recipe.installScript}`;
  }

  /** Entry point for any "kick off install" action. If the recipe declares
   *  secrets, opens the modal instead of running immediately. The modal's
   *  submit handler calls install() with the collected values. */
  function requestInstall(recipe: VpsRecipeDef) {
    if (recipe.secrets && recipe.secrets.length > 0) {
      setSecretError(null);
      // Empty draft — we deliberately do NOT pre-fill from a previous apply.
      // Each install is a fresh prompt.
      setSecretValuesDraft({});
      setSecretsPromptFor(recipe.id);
      // Make sure the expansion is open so post-install output is visible.
      setExpandedSet((p) => new Set(p).add(recipe.id));
      return;
    }
    void install(recipe);
    setExpandedSet((p) => new Set(p).add(recipe.id));
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
    // checkScripts are short one-liners that don't use BASH_HELPERS — run as-is.
    const res = await limitedExec(recipe.checkScript);
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

  async function install(recipe: VpsRecipeDef, secrets?: Record<string, string>) {
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
    const res = await limitedExec(buildInstallCommand(recipe, secrets), onChunk, controller.signal);
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

  /** Modal submit: validate, fire install with the typed secrets, then wipe
   *  the draft so the values don't sit in memory longer than necessary. */
  function submitSecrets() {
    const recipe = ALL_RECIPES.find((r) => r.id === secretsPromptFor);
    if (!recipe || !recipe.secrets) return;
    // Per-field required check.
    let anyRequired = false;
    for (const s of recipe.secrets) {
      if (s.required) {
        anyRequired = true;
        if (!secretValuesDraft[s.name]?.trim()) {
          setSecretError(`${s.label} is required.`);
          return;
        }
      }
    }
    // Default rule when no field is marked required: at least one must be
    // non-empty. Mirrors the previous custom validateSecrets used by
    // git-credentials ("provide at least one token").
    if (!anyRequired) {
      const anyFilled = recipe.secrets.some((s) => secretValuesDraft[s.name]?.trim());
      if (!anyFilled) {
        setSecretError("Provide a value for at least one field.");
        return;
      }
    }
    const values = { ...secretValuesDraft };
    setSecretsPromptFor(null);
    setSecretValuesDraft({});
    setSecretError(null);
    void install(recipe, values);
  }

  function cancelSecrets() {
    setSecretsPromptFor(null);
    setSecretValuesDraft({});
    setSecretError(null);
  }

  return (
    <div className="mb-3">
      <div className="flex items-center mb-2">
        <span className="text-md font-medium text-subtext0 flex items-center gap-1.5">
          <Package size={12} />
          Add-ons
        </span>
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
                  requestInstall(recipe);
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
                  <>
                    <button
                      onClick={() => check(recipe)}
                      disabled={state.checking}
                      className="text-md text-overlay0 hover:text-blue transition-colors ml-2"
                    >
                      Re-check
                    </button>
                    <button
                      onClick={() => requestInstall(recipe)}
                      disabled={state.checking}
                      className="text-md text-overlay0 hover:text-blue transition-colors inline-flex items-center gap-1"
                      title={recipe.secrets && recipe.secrets.length > 0
                        ? "Re-run the install script — prompts again for the secrets it needs"
                        : "Re-run the install script — picks up updated options"}
                    >
                      <Play size={10} /> Re-apply
                    </button>
                  </>
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
                    <button onClick={() => requestInstall(recipe)} className="text-blue hover:underline inline-flex items-center gap-1">
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
      {/* Secrets modal — appears when requestInstall fires on a recipe with
       *  declared secrets. Values are kept ONLY in component state and wiped
       *  on submit/cancel; nothing is persisted to settings, storage, or DB. */}
      <RecipeSecretsModal
        recipe={ALL_RECIPES.find((r) => r.id === secretsPromptFor) ?? null}
        values={secretValuesDraft}
        onChange={(name, value) => setSecretValuesDraft((prev) => ({ ...prev, [name]: value }))}
        error={secretError}
        onSubmit={submitSecrets}
        onCancel={cancelSecrets}
      />
    </div>
  );
}

/** Modal dialog for one-shot secrets (typically PATs). Inputs are type=password
 *  so they're masked, and we suppress autocomplete + 1Password by setting
 *  data-1p-ignore + autoComplete="off" — important so a leaked autofill never
 *  silently writes a token into the wrong field across recipes. */
function RecipeSecretsModal({
  recipe,
  values,
  onChange,
  error,
  onSubmit,
  onCancel,
}: {
  recipe: VpsRecipeDef | null;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!recipe) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recipe, onCancel, onSubmit]);

  if (!recipe || !recipe.secrets) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onCancel} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[95vw] bg-mantle border border-surface0 rounded-lg shadow-xl z-[61] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 shrink-0">
          <KeyRound size={14} className="text-blue" />
          <span className="text-text font-medium text-md">{recipe.label}</span>
          <span className="text-overlay0 text-xs">— one-time secrets, not stored</span>
          <div className="flex-1" />
          <button onClick={onCancel} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>
        <div className="px-4 py-3 flex flex-col gap-3">
          {recipe.secrets.map((s) => (
            <div key={s.name} className="flex flex-col gap-1">
              <label className="text-md text-text font-medium">
                {s.label}
                {s.required && <span className="text-red ml-1">*</span>}
              </label>
              <input
                type="password"
                value={values[s.name] ?? ""}
                onChange={(e) => onChange(s.name, e.target.value)}
                placeholder={s.placeholder}
                autoComplete="off"
                data-1p-ignore="true"
                spellCheck={false}
                className="bg-background border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text font-mono outline-none focus:border-blue"
              />
              {s.description && (
                <p className="text-xs text-overlay0 leading-snug">{s.description}</p>
              )}
            </div>
          ))}
          {error && (
            <p className="text-xs text-red">{error}</p>
          )}
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={onCancel}
              className="text-md text-overlay1 hover:text-text px-3 py-1 rounded border border-overlay0/30 bg-transparent cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              className="text-md text-blue hover:bg-blue/10 px-3 py-1 rounded border border-blue/40 bg-transparent cursor-pointer transition-colors inline-flex items-center gap-1.5"
              title="Apply (⌘/Ctrl+Enter)"
            >
              <Play size={11} /> Apply
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
