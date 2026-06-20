"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Check, X, ChevronDown, Play, Square, KeyRound, Puzzle, Chrome, TestTube, Palette, Sparkles, Package, GitCompare, Wrench, ExternalLink, Search, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $claudePlugins } from "@/store/subjects/claude-plugins";
import type { ClaudePlugin } from "@/store/types/claude-plugins";
import { loadClaudePlugins } from "@/store/actions/claude-plugins";
import { wsRequest } from "@/lib/ws";

// Lucide icon names → components. Plugins use Puzzle / Chrome / TestTube /
// Package — anything else falls back to Puzzle. Mirrors useAllRecipes' ICON_MAP.
const ICON_MAP: Record<string, typeof Puzzle> = {
  Puzzle, Chrome, TestTube, Palette, Sparkles, Package, GitCompare, Wrench,
};

interface PluginCommand {
  name: string;
  command: string;
}

interface PluginOption {
  name: string;
  label: string;
  choices: { value: string; label: string }[];
  defaultValue: string;
}

interface PluginSecret {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
}

interface PluginDef {
  id: string;
  label: string;
  icon: typeof Puzzle;
  description: string;
  homepageUrl: string;
  checkScript: string;
  installScript: string;
  uninstallScript: string;
  commands: PluginCommand[];
  options?: PluginOption[];
  secrets?: PluginSecret[];
}

function pluginToDef(p: ClaudePlugin): PluginDef {
  return {
    id: p.slug,
    label: p.label,
    icon: ICON_MAP[p.icon] ?? Puzzle,
    description: p.description,
    homepageUrl: p.homepageUrl,
    checkScript: p.checkScript,
    installScript: p.installScript,
    uninstallScript: p.uninstallScript,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commands: (p.commands as any[]) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: (p.options as any[]) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    secrets: Array.isArray(p.secrets) && p.secrets.length > 0 ? (p.secrets as any[]) : undefined,
  };
}

type ExecFn = (
  command: string,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal,
) => Promise<{ output: string; error?: boolean }>;

interface PluginRuntimeState {
  installed: boolean | null;
  checking: boolean;
  running: boolean;
  error: string | null;
  output: string;
}

const INIT: PluginRuntimeState = { installed: null, checking: false, running: false, error: null, output: "" };

const SSH_CONCURRENCY = 1;

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

/** Per-VM Claude Plugins panel. Behaves like `AdminRecipesPanel` but reads the
 *  `claude_plugins` catalog instead of `recipes`. Install/uninstall scripts run
 *  via the provided `exec` callback, which the parent (manage-vm-popup) wires
 *  to the same provider-aware SSH pipeline recipes use. */
export function ClaudePluginsPanel({
  exec,
  deferAutoCheckMs = 600,
  kind = "plugin",
}: {
  exec: ExecFn;
  deferAutoCheckMs?: number;
  /** Which catalog slice to show: marketplace "plugin"s or generic "skill"s.
   *  Same panel + install pipeline, split only by this discriminator so the
   *  Manage popup can present two clearly-separated tabs. */
  kind?: "plugin" | "skill";
}) {
  const pluginsState = useDeepSubjectAll($claudePlugins);
  const ALL_PLUGINS: PluginDef[] = (pluginsState.list ?? [])
    .filter((p) => (p.kind ?? "plugin") === kind)
    .map(pluginToDef);
  const isSkills = kind === "skill";
  const HeaderIcon = isSkills ? Sparkles : Puzzle;

  const limitedExecRef = useRef<ExecFn | null>(null);
  if (!limitedExecRef.current) {
    limitedExecRef.current = makeLimiter(SSH_CONCURRENCY, exec);
  }
  const limitedExec = limitedExecRef.current;

  const [states, setStates] = useState<Record<string, PluginRuntimeState>>({});
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const abortersRef = useRef<Map<string, AbortController>>(new Map());
  const [optionValues, setOptionValues] = useState<Record<string, Record<string, string>>>({});
  const [secretsPromptFor, setSecretsPromptFor] = useState<string | null>(null);
  const [secretValuesDraft, setSecretValuesDraft] = useState<Record<string, string>>({});
  const [secretError, setSecretError] = useState<string | null>(null);

  function getOptionValues(plugin: PluginDef): Record<string, string> {
    const stored = optionValues[plugin.id] ?? {};
    const result: Record<string, string> = {};
    for (const o of plugin.options ?? []) {
      result[o.name] = stored[o.name] ?? o.defaultValue;
    }
    return result;
  }

  function setOptionValue(pluginId: string, name: string, value: string) {
    setOptionValues((prev) => ({ ...prev, [pluginId]: { ...(prev[pluginId] ?? {}), [name]: value } }));
  }

  function buildInstallCommand(plugin: PluginDef, secrets?: Record<string, string>): string {
    const opts = getOptionValues(plugin);
    const optExports = Object.entries(opts)
      .map(([k, v]) => `export ${k}=${JSON.stringify(v)}; `)
      .join("");
    const secretExports = secrets
      ? Object.entries(secrets)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => `export ${k}=${JSON.stringify(v)}; `)
          .join("")
      : "";
    return `${optExports}${secretExports}${plugin.installScript}`;
  }

  function requestInstall(plugin: PluginDef) {
    if (plugin.secrets && plugin.secrets.length > 0) {
      setSecretError(null);
      setSecretValuesDraft({});
      setSecretsPromptFor(plugin.id);
      setExpandedSet((p) => new Set(p).add(plugin.id));
      return;
    }
    void install(plugin);
    setExpandedSet((p) => new Set(p).add(plugin.id));
  }

  function update(id: string, patch: Partial<PluginRuntimeState>) {
    setStates((s) => ({ ...s, [id]: { ...(s[id] ?? INIT), ...patch } }));
  }

  function toggleExpand(id: string) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function check(plugin: PluginDef) {
    update(plugin.id, { checking: true, error: null });
    const res = await limitedExec(plugin.checkScript);
    update(plugin.id, {
      checking: false,
      installed: res.output.includes("INSTALLED") && !res.output.includes("NOT_INSTALLED"),
      output: res.output,
      error: res.error ? res.output : null,
    });
  }

  useEffect(() => { loadClaudePlugins(); }, []);

  const autoCheckedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (ALL_PLUGINS.length === 0) return;
    const t = window.setTimeout(() => {
      for (const p of ALL_PLUGINS) {
        if (autoCheckedRef.current.has(p.id)) continue;
        autoCheckedRef.current.add(p.id);
        void check(p);
      }
    }, deferAutoCheckMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ALL_PLUGINS.length, deferAutoCheckMs]);

  async function install(plugin: PluginDef, secrets?: Record<string, string>) {
    update(plugin.id, { running: true, error: null, output: "" });
    const controller = new AbortController();
    abortersRef.current.set(plugin.id, controller);
    const onChunk = (chunk: string) => {
      setStates((s) => {
        const prev = s[plugin.id] ?? INIT;
        return { ...s, [plugin.id]: { ...prev, output: prev.output + chunk } };
      });
    };
    const res = await limitedExec(buildInstallCommand(plugin, secrets), onChunk, controller.signal);
    abortersRef.current.delete(plugin.id);
    const aborted = controller.signal.aborted;
    update(plugin.id, {
      running: false,
      installed: aborted ? null : !res.error,
      output: res.output,
      error: aborted ? "Cancelled" : (res.error ? res.output : null),
    });
  }

  async function uninstall(plugin: PluginDef) {
    if (!plugin.uninstallScript.trim()) return;
    update(plugin.id, { running: true, error: null, output: "" });
    const controller = new AbortController();
    abortersRef.current.set(plugin.id, controller);
    const onChunk = (chunk: string) => {
      setStates((s) => {
        const prev = s[plugin.id] ?? INIT;
        return { ...s, [plugin.id]: { ...prev, output: prev.output + chunk } };
      });
    };
    const res = await limitedExec(plugin.uninstallScript, onChunk, controller.signal);
    abortersRef.current.delete(plugin.id);
    const aborted = controller.signal.aborted;
    update(plugin.id, {
      running: false,
      installed: aborted ? null : (res.error ? null : false),
      output: res.output,
      error: aborted ? "Cancelled" : (res.error ? res.output : null),
    });
  }

  function stop(pluginId: string) {
    abortersRef.current.get(pluginId)?.abort();
  }

  function submitSecrets() {
    const plugin = ALL_PLUGINS.find((p) => p.id === secretsPromptFor);
    if (!plugin || !plugin.secrets) return;
    let anyRequired = false;
    for (const s of plugin.secrets) {
      if (s.required) {
        anyRequired = true;
        if (!secretValuesDraft[s.name]?.trim()) {
          setSecretError(`${s.label} is required.`);
          return;
        }
      }
    }
    if (!anyRequired) {
      const anyFilled = plugin.secrets.some((s) => secretValuesDraft[s.name]?.trim());
      if (!anyFilled) {
        setSecretError("Provide a value for at least one field.");
        return;
      }
    }
    const values = { ...secretValuesDraft };
    setSecretsPromptFor(null);
    setSecretValuesDraft({});
    setSecretError(null);
    void install(plugin, values);
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
          <HeaderIcon size={12} />
          {isSkills ? "Skills" : "Claude Plugins"}
        </span>
        {pluginsState.loading && <Loader2 size={11} className="animate-spin text-overlay0 ml-2" />}
      </div>
      <p className="text-xs text-overlay0 mb-2">
        {isSkills
          ? "Generic agent skills (e.g. installed via npx skills add …) — separate from Claude Code marketplace plugins."
          : "Claude Code marketplace plugins & MCP servers. Generic skills live in the Skills tab."}
      </p>
      {isSkills && <SkillsBrowser exec={exec} />}
      {pluginsState.error && (
        <p className="text-xs text-red mb-2">{pluginsState.error}</p>
      )}
      {ALL_PLUGINS.length === 0 && !pluginsState.loading && !pluginsState.error && (
        <p className="text-xs text-overlay0">{isSkills ? "Built-in skills appear here; browse skills.sh above to add more." : "No plugins in the catalog yet."}</p>
      )}
      <div className="flex flex-wrap gap-2 mt-1">
        {ALL_PLUGINS.map((plugin) => {
          const state = states[plugin.id] ?? INIT;
          const Icon = plugin.icon;
          const busy = state.checking || state.running;
          return (
            <button
              key={plugin.id}
              disabled={busy}
              onClick={() => {
                if (state.installed === null) {
                  check(plugin);
                  toggleExpand(plugin.id);
                } else if (state.installed) {
                  toggleExpand(plugin.id);
                } else if (plugin.options && plugin.options.length > 0) {
                  setExpandedSet((p) => new Set(p).add(plugin.id));
                } else {
                  requestInstall(plugin);
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
              title={plugin.description}
            >
              <Icon size={12} />
              {plugin.label}
              {state.checking || state.running ? <Loader2 size={11} className="animate-spin" />
                : state.installed ? <Check size={11} />
                : state.error ? <X size={11} />
                : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 mt-2">
        {ALL_PLUGINS.filter((p) => expandedSet.has(p.id)).map((plugin) => {
          const state = states[plugin.id] ?? INIT;
          return (
            <div key={plugin.id} className="bg-mantle rounded-lg p-3 border border-overlay0/20">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => toggleExpand(plugin.id)} className="text-overlay0 hover:text-text transition-colors">
                  <ChevronDown size={12} />
                </button>
                <span className="text-md font-medium text-text">{plugin.label}</span>
                {plugin.homepageUrl && (
                  <a
                    href={plugin.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-overlay0 hover:text-blue inline-flex items-center gap-1 text-xs"
                    title="View plugin docs"
                  >
                    <ExternalLink size={10} /> Docs
                  </a>
                )}
                {state.running && <Loader2 size={11} className="animate-spin text-blue" />}
                {state.running && (
                  <button
                    onClick={() => stop(plugin.id)}
                    className="text-md text-overlay0 hover:text-red transition-colors ml-2 flex items-center gap-1"
                    title="Cancel this plugin operation"
                  >
                    <Square size={10} /> Stop
                  </button>
                )}
                {state.installed && !state.running && (
                  <>
                    <button
                      onClick={() => check(plugin)}
                      disabled={state.checking}
                      className="text-md text-overlay0 hover:text-blue transition-colors ml-2"
                    >
                      Re-check
                    </button>
                    <button
                      onClick={() => requestInstall(plugin)}
                      disabled={state.checking}
                      className="text-md text-overlay0 hover:text-blue transition-colors inline-flex items-center gap-1"
                      title={plugin.secrets && plugin.secrets.length > 0
                        ? "Re-run the install script — prompts again for the secrets it needs"
                        : "Re-run the install script"}
                    >
                      <Play size={10} /> Re-apply
                    </button>
                    {plugin.uninstallScript.trim() && (
                      <button
                        onClick={() => uninstall(plugin)}
                        disabled={state.checking}
                        className="text-md text-overlay0 hover:text-red transition-colors inline-flex items-center gap-1"
                        title="Uninstall this plugin from the VM"
                      >
                        <X size={10} /> Uninstall
                      </button>
                    )}
                  </>
                )}
              </div>
              {plugin.description && (
                <p className="text-xs text-overlay1 mb-2">{plugin.description}</p>
              )}
              {!state.installed && state.installed !== null && !state.running && (
                <div className="mb-2 flex items-center gap-3 flex-wrap">
                  {plugin.options?.map((opt) => {
                    const current = getOptionValues(plugin)[opt.name];
                    return (
                      <div key={opt.name} className="flex items-center gap-1.5 text-md">
                        <label className="text-overlay0">{opt.label}:</label>
                        <select
                          value={current}
                          onChange={(e) => setOptionValue(plugin.id, opt.name, e.target.value)}
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
                    <button onClick={() => requestInstall(plugin)} className="text-blue hover:underline inline-flex items-center gap-1">
                      <Play size={10} /> Install
                    </button>
                  </span>
                </div>
              )}
              {(() => {
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

      <PluginSecretsModal
        plugin={ALL_PLUGINS.find((p) => p.id === secretsPromptFor) ?? null}
        values={secretValuesDraft}
        onChange={(name, value) => setSecretValuesDraft((prev) => ({ ...prev, [name]: value }))}
        error={secretError}
        onSubmit={submitSecrets}
        onCancel={cancelSecrets}
      />
    </div>
  );
}

interface RegistrySkill { id: string; name: string; source: string; installs: number; url: string }
type SkillInstallState = { running: boolean; output: string; done: boolean; error: string | null };

/** Browse / search the public skills.sh registry and install any entry onto this
 *  VM via `npx skills add <id>` (the manager proxies the catalog to dodge CORS). */
function SkillsBrowser({ exec }: { exec: ExecFn }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installs, setInstalls] = useState<Record<string, SkillInstallState>>({});
  const reqSeq = useRef(0);

  // Debounced fetch — trending on empty, search once ≥2 chars typed.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 1) return; // wait for a real query
    const seq = ++reqSeq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      void wsRequest<{ skills?: RegistrySkill[]; error?: string }>("skills:registry:search", { q }, 12_000)
        .then((res) => {
          if (seq !== reqSeq.current) return; // a newer query superseded this one
          setResults(res.skills ?? []);
          setError(res.error ?? null);
        })
        .catch(() => { if (seq === reqSeq.current) setError("Couldn't reach skills.sh"); })
        .finally(() => { if (seq === reqSeq.current) setLoading(false); });
    }, q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [query]);

  async function installSkill(skill: RegistrySkill) {
    // id is "owner/slug" from skills.sh — validate before interpolating into the shell.
    if (!/^[\w.-]+\/[\w.-]+$/.test(skill.id)) {
      setInstalls((s) => ({ ...s, [skill.id]: { running: false, output: "", done: false, error: "Unexpected skill id" } }));
      return;
    }
    setInstalls((s) => ({ ...s, [skill.id]: { running: true, output: "", done: false, error: null } }));
    const cmd = `cd /opt/project 2>/dev/null || cd "$HOME"; npx -y skills add ${skill.id} < /dev/null 2>&1`;
    const onChunk = (chunk: string) =>
      setInstalls((s) => ({ ...s, [skill.id]: { ...(s[skill.id]), running: true, done: false, error: null, output: (s[skill.id]?.output ?? "") + chunk } }));
    const res = await exec(cmd, onChunk);
    setInstalls((s) => ({ ...s, [skill.id]: { running: false, output: res.output, done: !res.error, error: res.error ? res.output.slice(-300) : null } }));
  }

  return (
    <div className="mb-3 rounded-lg border border-overlay0/20 bg-mantle p-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Search size={12} className="text-overlay0 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Browse skills.sh — search by name…"
          className="flex-1 bg-background border border-surface0 rounded px-2 py-1 text-md text-text placeholder:text-overlay0 outline-none focus:border-blue"
        />
        {loading && <Loader2 size={12} className="animate-spin text-overlay0 shrink-0" />}
      </div>
      {error && <p className="text-xs text-red mb-1">{error}</p>}
      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto scrollbar-thin">
        {results.length === 0 && !loading && !error && (
          <p className="text-xs text-overlay0 px-1 py-1">No skills found.</p>
        )}
        {results.map((skill) => {
          const st = installs[skill.id];
          return (
            <div key={skill.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface0/60">
              <div className="min-w-0 flex-1">
                <div className="text-md text-text truncate flex items-center gap-1.5">
                  {skill.name || skill.id}
                  {skill.url && (
                    <a href={skill.url} target="_blank" rel="noopener noreferrer" className="text-overlay0 hover:text-blue shrink-0" title="View on skills.sh">
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                <div className="text-[10px] text-overlay0 truncate font-mono">
                  {skill.id}{skill.installs > 0 ? ` · ${skill.installs.toLocaleString()} installs` : ""}
                </div>
                {st?.error && <div className="text-[10px] text-red truncate" title={st.error}>{st.error}</div>}
              </div>
              <button
                type="button"
                onClick={() => installSkill(skill)}
                disabled={st?.running}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs transition-colors",
                  st?.done ? "border-green/40 text-green"
                    : st?.error ? "border-red/40 text-red hover:bg-red/10"
                    : "border-overlay0/30 text-overlay1 hover:bg-surface0",
                  st?.running && "opacity-60 cursor-wait",
                )}
                title={`npx skills add ${skill.id}`}
              >
                {st?.running ? <Loader2 size={11} className="animate-spin" />
                  : st?.done ? <Check size={11} />
                  : <Download size={11} />}
                {st?.done ? "Added" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PluginSecretsModal({
  plugin,
  values,
  onChange,
  error,
  onSubmit,
  onCancel,
}: {
  plugin: PluginDef | null;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!plugin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plugin, onCancel, onSubmit]);

  if (!plugin || !plugin.secrets) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onCancel} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[95vw] bg-mantle border border-surface0 rounded-lg shadow-xl z-[61] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 shrink-0">
          <KeyRound size={14} className="text-blue" />
          <span className="text-text font-medium text-md">{plugin.label}</span>
          <span className="text-overlay0 text-xs">— one-time secrets, not stored</span>
          <div className="flex-1" />
          <button onClick={onCancel} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>
        <div className="px-4 py-3 flex flex-col gap-3">
          {plugin.secrets.map((s) => (
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
