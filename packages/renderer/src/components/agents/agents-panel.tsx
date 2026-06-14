"use client";

// Agents panel — list user-visible agents (theirs + built-ins), create/edit
// via a right-side drawer, and run an agent with live token/tool streaming.
//
// Mirrors the recipes-panel shape (list on the left, drawer on the right) so
// it feels native alongside the rest of the admin surface. Unlike recipes,
// this page is available to every authenticated user (see lib/routes.ts).

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Pencil, Plus, RefreshCw, Trash2, Save, X, Play, Square } from "lucide-react";
import { $agents, $projects } from "@/store/subjects";
import {
  cancelAgentRun,
  clearAgentRun,
  deleteAgent,
  loadAgents,
  runAgent,
  upsertAgent,
  type AgentUpsertInput,
} from "@/store/actions/agents";
import type { AgentDef, AgentSandboxConfig, RunState } from "@/store/types/agents";
import { AGENT_TEMPLATES, type AgentTemplate } from "./agent-templates";
import type { ProjectDef } from "@/store/types";
import { useDeepSubjectAll } from "@/lib/hooks";
import { useSubject } from "subjecto/react";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { cn } from "@/lib/utils";

// Models exposed in the picker. Mirrors CHAT_MODELS in
// packages/manager/src/chat.ts; "claude-code" is excluded because it only
// works via the VPS claude CLI, not the sandboxed runtime.
const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "claude-opus", label: "Claude Opus" },
];

// Tool allowlist options — must match the tools createTools() exposes in
// packages/vps-agent/src/tools/index.ts. Empty allowlist (no checkboxes) lets
// the runner expose every tool, including view_page/dom_action.
const TOOL_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: "read_file", label: "read_file", hint: "Read files from /workspace" },
  { id: "write_file", label: "write_file", hint: "Create/overwrite files" },
  { id: "list_files", label: "list_files", hint: "Walk the workspace tree" },
  { id: "search_files", label: "search_files", hint: "grep across the workspace" },
  { id: "shell_exec", label: "shell_exec", hint: "Run bash in the container" },
];

interface Draft {
  id?: string;          // present = edit; missing = create
  slug: string;
  label: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  maxToolRounds: number;
  tools: string[];
  sandbox: AgentSandboxConfig;
}

function emptyDraft(firstProject?: ProjectDef): Draft {
  const firstInstance = firstProject?.vpsInstances[0];
  return {
    slug: "",
    label: "",
    description: "",
    systemPrompt:
      "You are a helpful agent. Answer concisely and use your tools when needed.",
    modelId: "claude-sonnet",
    maxToolRounds: 20,
    tools: [],
    sandbox: {
      kind: "project-docker",
      projectId: firstProject?.id ?? "",
      instanceId: firstInstance?.id ?? "",
      timeoutSec: 300,
    },
  };
}

function fromAgent(a: AgentDef): Draft {
  return {
    id: a.id,
    slug: a.slug,
    label: a.label,
    description: a.description,
    systemPrompt: a.systemPrompt,
    modelId: a.modelId,
    maxToolRounds: a.maxToolRounds,
    tools: a.tools,
    sandbox: a.sandbox,
  };
}

export function AgentsPanel() {
  return <AgentsPanelImpl />;
}

function AgentsPanelImpl() {
  const agents = useDeepSubjectAll($agents);
  const [projects] = useSubject($projects);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [runningAgent, setRunningAgent] = useState<AgentDef | null>(null);

  useEffect(() => { loadAgents(); }, []);

  // Most-recent run for the panel, if any. We don't show a full history list
  // yet — keeps the page focused on "edit + try". History view comes later
  // when the agent_runs table is worth surfacing.
  const runEntries = useMemo(() =>
    Object.entries(agents.runs).sort((a, b) => (a[0] < b[0] ? 1 : -1)),
    [agents.runs]);

  function startCreate() {
    setDraft(emptyDraft(projects[0]));
  }
  function startEdit(a: AgentDef) {
    setDraft(fromAgent(a));
  }
  function cancelDraft() {
    setDraft(null);
  }
  function save() {
    if (!draft) return;
    const input: AgentUpsertInput = {
      slug: draft.slug,
      label: draft.label,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      modelId: draft.modelId,
      maxToolRounds: draft.maxToolRounds,
      tools: draft.tools,
      sandbox: draft.sandbox,
    };
    upsertAgent(input);
    setDraft(null);
  }

  // Run is two-step: clicking the row's "Run" button opens the run drawer;
  // the drawer collects a user message and only then fires `runAgent`. Keeps
  // the run input out of the row and lets us re-run the same agent without
  // editing it.
  function start(agent: AgentDef) {
    setRunningAgent(agent);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5">
        <ViewHeader
          title="Agents"
          subtitle="Define and run your own AI agents on a project's VPS — private to you."
          actions={
            <>
              <Button size="sm" onClick={loadAgents} disabled={agents.loading}>
                <RefreshCw size={14} className={cn("mr-1", agents.loading && "animate-spin")} /> Refresh
              </Button>
              <Button size="sm" variant="primary" onClick={startCreate}>
                <Plus size={14} className="mr-1" /> New agent
              </Button>
            </>
          }
        />
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 flex gap-4">
        <div className="flex-1 min-w-0">
          {agents.saveError && (
            <div className="mb-3 text-md text-red bg-red/10 border border-red/30 rounded px-3 py-2 font-mono">
              Save failed: {agents.saveError}
            </div>
          )}
          {agents.error && (
            <div className="mb-3 text-md text-red bg-red/10 border border-red/30 rounded px-3 py-2 font-mono">
              {agents.error}
            </div>
          )}

          <AgentList
            agents={agents.list}
            loading={agents.loading}
            projects={projects}
            onEdit={startEdit}
            onRun={start}
            onDelete={(id) => {
              if (confirm("Delete this agent? Run history will be retained.")) deleteAgent(id);
            }}
          />

          {runEntries.length > 0 && (
            <div className="mt-6">
              <h2 className="text-md font-medium text-subtext1 mb-2">Recent runs</h2>
              <div className="space-y-2">
                {runEntries.map(([reqId, run]) => (
                  <RunCard
                    key={reqId}
                    reqId={reqId}
                    run={run}
                    agent={agents.list.find((a) => a.id === run.agentId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {draft && (
          <EditDrawer
            draft={draft}
            projects={projects}
            onChange={setDraft}
            onSave={save}
            onCancel={cancelDraft}
          />
        )}

        {runningAgent && (
          <RunDrawer
            agent={runningAgent}
            onClose={() => setRunningAgent(null)}
          />
        )}
      </div>
    </div>
  );
}

// --- List ---

function AgentList({
  agents, loading, projects, onEdit, onRun, onDelete,
}: {
  agents: AgentDef[];
  loading: boolean;
  projects: ProjectDef[];
  onEdit: (a: AgentDef) => void;
  onRun: (a: AgentDef) => void;
  onDelete: (id: string) => void;
}) {
  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center text-overlay0 text-md py-6">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading agents…
      </div>
    );
  }
  if (agents.length === 0) {
    return (
      <div className="text-center text-overlay0 text-md py-12 border border-dashed border-surface0 rounded">
        <Bot size={28} className="mx-auto mb-3 text-overlay0" />
        <p>No agents yet.</p>
        <p className="mt-1 text-sm">Click "New agent" to define your first one.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {agents.map((a) => {
        const sandbox = a.sandbox;
        const projName = sandbox.kind === "project-docker"
          ? (projects.find((p) => p.id === sandbox.projectId)?.name ?? "(unknown project)")
          : `firecracker @ ${sandbox.host}`;
        return (
          <div
            key={a.id}
            className="border border-surface0 rounded bg-mantle px-3 py-2.5 flex items-center gap-3"
          >
            <Bot size={18} className="text-overlay1 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-text">{a.label}</span>
                <code className="text-sm text-overlay0 font-mono">{a.slug}</code>
                {a.isBuiltin && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface0 text-subtext0 uppercase tracking-wide">built-in</span>
                )}
              </div>
              <div className="text-sm text-subtext0 truncate">
                {a.description || <span className="italic text-overlay0">no description</span>}
              </div>
              <div className="text-xs text-overlay0 mt-0.5">
                {a.modelId} · {a.tools.length > 0 ? a.tools.join(", ") : "all tools"} · {projName}
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => onRun(a)}>
              <Play size={13} className="mr-1" /> Run
            </Button>
            <Button size="sm" onClick={() => onEdit(a)} disabled={a.isBuiltin}>
              <Pencil size={13} className="mr-1" /> Edit
            </Button>
            <Button size="sm" onClick={() => onDelete(a.id)} disabled={a.isBuiltin}>
              <Trash2 size={13} className="mr-1 text-red" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// --- Edit drawer ---

function EditDrawer({
  draft, projects, onChange, onSave, onCancel,
}: {
  draft: Draft;
  projects: ProjectDef[];
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!draft.id;
  const sandbox = draft.sandbox;
  const project = sandbox.kind === "project-docker"
    ? projects.find((p) => p.id === sandbox.projectId)
    : undefined;

  function patchSandbox(p: Partial<AgentSandboxConfig>) {
    onChange({ ...draft, sandbox: { ...draft.sandbox, ...p } as AgentSandboxConfig });
  }

  function toggleTool(name: string) {
    const has = draft.tools.includes(name);
    onChange({
      ...draft,
      tools: has ? draft.tools.filter((t) => t !== name) : [...draft.tools, name],
    });
  }

  // Prefill the persona fields from a starter template, keeping the user's
  // chosen project/instance (only the timeout comes from the template).
  function applyTemplate(t: AgentTemplate) {
    onChange({
      ...draft,
      slug: t.slug,
      label: t.label,
      description: t.description,
      systemPrompt: t.systemPrompt,
      modelId: t.modelId,
      maxToolRounds: t.maxToolRounds,
      tools: t.tools,
      sandbox: { ...draft.sandbox, timeoutSec: t.timeoutSec } as AgentSandboxConfig,
    });
  }

  return (
    <div className="w-[480px] shrink-0 border-l border-surface0 bg-base flex flex-col">
      <div className="px-3 py-2 border-b border-surface0 flex items-center justify-between">
        <h2 className="text-md font-medium text-text">{isEdit ? "Edit agent" : "New agent"}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={onSave}>
            <Save size={13} className="mr-1" /> Save
          </Button>
          <Button size="sm" onClick={onCancel}>
            <X size={13} />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3 space-y-4 text-md">
        {!isEdit && (
          <Field label="Start from a template" hint="Prefills the fields below; you still pick the project + instance.">
            <select
              className="w-full bg-mantle border border-surface0 rounded px-2 py-1"
              value=""
              onChange={(e) => {
                const t = AGENT_TEMPLATES.find((x) => x.key === e.target.value);
                if (t) applyTemplate(t);
              }}
            >
              <option value="">Blank agent…</option>
              <optgroup label="Read-only (safe to try)">
                {AGENT_TEMPLATES.filter((t) => t.category === "read-only").map((t) => (
                  <option key={t.key} value={t.key}>{t.label} — {t.description}</option>
                ))}
              </optgroup>
              <optgroup label="Writes / runs commands">
                {AGENT_TEMPLATES.filter((t) => t.category === "mutating").map((t) => (
                  <option key={t.key} value={t.key}>{t.label} — {t.description}</option>
                ))}
              </optgroup>
            </select>
          </Field>
        )}
        <Field label="Slug" hint="lowercase letters, digits, dashes — stable id">
          <input
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1 font-mono text-md"
            value={draft.slug}
            onChange={(e) => onChange({ ...draft, slug: e.target.value })}
            placeholder="my-helper"
            disabled={isEdit}
          />
        </Field>
        <Field label="Label">
          <input
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1"
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            placeholder="My helper agent"
          />
        </Field>
        <Field label="Description">
          <input
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1"
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="What does this agent do?"
          />
        </Field>
        <Field label="System prompt">
          <textarea
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1 font-mono text-md"
            rows={6}
            value={draft.systemPrompt}
            onChange={(e) => onChange({ ...draft, systemPrompt: e.target.value })}
          />
        </Field>
        <Field label="Model">
          <select
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1"
            value={draft.modelId}
            onChange={(e) => onChange({ ...draft, modelId: e.target.value })}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Max tool rounds" hint="Hard cap on tool-call iterations per chat turn.">
          <input
            type="number"
            min={1}
            max={100}
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1 font-mono"
            value={draft.maxToolRounds}
            onChange={(e) => onChange({ ...draft, maxToolRounds: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
        <Field label="Tools" hint="Pick the tools this agent may use. Leave all unchecked to expose every tool.">
          <div className="space-y-1">
            {TOOL_OPTIONS.map((t) => (
              <label key={t.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.tools.includes(t.id)}
                  onChange={() => toggleTool(t.id)}
                  className="mt-0.5"
                />
                <span>
                  <code className="font-mono text-md text-text">{t.label}</code>
                  <span className="text-overlay0 ml-2 text-sm">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="border-t border-surface0 pt-3">
          <h3 className="text-md font-medium text-subtext1 mb-2">Sandbox</h3>
          <Field label="Project">
            <select
              className="w-full bg-mantle border border-surface0 rounded px-2 py-1"
              value={draft.sandbox.kind === "project-docker" ? draft.sandbox.projectId : ""}
              onChange={(e) => {
                const projectId = e.target.value;
                const next = projects.find((p) => p.id === projectId);
                patchSandbox({
                  kind: "project-docker",
                  projectId,
                  instanceId: next?.vpsInstances[0]?.id ?? "",
                });
              }}
            >
              <option value="">— pick a project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="VPS instance" hint="The container runs on this VPS via SSH + Docker.">
            <select
              className="w-full bg-mantle border border-surface0 rounded px-2 py-1"
              value={draft.sandbox.kind === "project-docker" ? draft.sandbox.instanceId : ""}
              onChange={(e) => patchSandbox({ instanceId: e.target.value })}
              disabled={!project || project.vpsInstances.length === 0}
            >
              {project?.vpsInstances.length
                ? project.vpsInstances.map((i) => (
                    <option key={i.id} value={i.id}>{i.label || i.id}</option>
                  ))
                : <option value="">— project has no VPS —</option>}
            </select>
          </Field>
          <Field label="Run timeout (seconds)">
            <input
              type="number"
              min={10}
              max={3600}
              className="w-full bg-mantle border border-surface0 rounded px-2 py-1 font-mono"
              value={draft.sandbox.kind === "project-docker" ? (draft.sandbox.timeoutSec ?? 300) : 300}
              onChange={(e) => patchSandbox({ timeoutSec: Math.max(10, Number(e.target.value) || 300) })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-md text-subtext1">{label}</span>
        {hint && <span className="text-xs text-overlay0">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// --- Run drawer ---

function RunDrawer({ agent, onClose }: { agent: AgentDef; onClose: () => void }) {
  const agents = useDeepSubjectAll($agents);
  const [message, setMessage] = useState("");
  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const run = activeReqId ? agents.runs[activeReqId] : null;

  function send() {
    if (!message.trim() || activeReqId) return;
    const reqId = runAgent(agent, message);
    setActiveReqId(reqId);
  }

  return (
    <div className="w-[520px] shrink-0 border-l border-surface0 bg-base flex flex-col">
      <div className="px-3 py-2 border-b border-surface0 flex items-center justify-between">
        <div>
          <div className="text-md font-medium text-text">Run · {agent.label}</div>
          <div className="text-xs text-overlay0 font-mono">{agent.slug}</div>
        </div>
        <Button size="sm" onClick={onClose}>
          <X size={13} />
        </Button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3 space-y-3 text-md">
        <Field label="Message">
          <textarea
            className="w-full bg-mantle border border-surface0 rounded px-2 py-1 font-mono"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask the agent something…"
            disabled={!!activeReqId && run?.status === "running"}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={send}
            disabled={!message.trim() || (run?.status === "running")}
          >
            <Play size={13} className="mr-1" /> {run?.status === "running" ? "Running…" : "Run"}
          </Button>
          {run?.status === "running" && activeReqId && (
            <Button size="sm" variant="danger" onClick={() => cancelAgentRun(activeReqId)}>
              <Square size={13} className="mr-1" /> Stop
            </Button>
          )}
          {run && run.status !== "running" && (
            <Button size="sm" onClick={() => { if (activeReqId) clearAgentRun(activeReqId); setActiveReqId(null); }}>
              <Square size={13} className="mr-1" /> Clear
            </Button>
          )}
        </div>

        {run && <RunStream run={run} />}
      </div>
    </div>
  );
}

function RunCard({ reqId, run, agent }: { reqId: string; run: RunState; agent?: AgentDef }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-surface0 rounded bg-mantle text-md">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 flex items-center gap-3 border-none bg-transparent cursor-pointer"
      >
        <StatusPill status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="text-text">
            {agent?.label ?? <span className="italic">deleted agent</span>}
            <span className="text-overlay0 ml-2 text-sm font-mono">{reqId.split(":").slice(-1)[0]}</span>
          </div>
          {run.error && <div className="text-xs text-red truncate">{run.error}</div>}
        </div>
        <span className="text-xs text-overlay0">{run.toolEvents.length} tool calls</span>
      </button>
      {expanded && <RunStream run={run} />}
    </div>
  );
}

function StatusPill({ status }: { status: RunState["status"] }) {
  const color =
    status === "running" ? "text-yellow bg-yellow/10 border-yellow/30"
    : status === "succeeded" ? "text-green bg-green/10 border-green/30"
    : status === "timeout" ? "text-yellow bg-yellow/10 border-yellow/30"
    : "text-red bg-red/10 border-red/30";
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded border font-mono", color)}>
      {status}
    </span>
  );
}

function RunStream({ run }: { run: RunState }) {
  return (
    <div className="px-3 py-2 border-t border-surface0 space-y-2">
      {run.toolEvents.map((ev, i) => (
        ev.type === "tool" ? (
          <details key={i} className="text-sm font-mono bg-base border border-surface0 rounded px-2 py-1">
            <summary className="cursor-pointer text-subtext1">
              <span className="text-blue">{ev.name}</span>
              <span className="text-overlay0">({JSON.stringify(ev.input).slice(0, 80)})</span>
            </summary>
            <pre className="mt-1 whitespace-pre-wrap text-overlay1 text-xs">{ev.result.slice(0, 4000)}</pre>
          </details>
        ) : null
      ))}
      {run.output && (
        <pre className="whitespace-pre-wrap text-text bg-base border border-surface0 rounded px-2 py-1">
          {run.output}
        </pre>
      )}
      {run.status === "running" && (
        <div className="text-overlay0 text-sm flex items-center">
          <Loader2 size={12} className="animate-spin mr-2" /> Streaming…
        </div>
      )}
      {run.error && (
        <div className="text-red text-sm font-mono">{run.error}</div>
      )}
    </div>
  );
}
