"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { FileEdit, Loader2, MessageSquare, Plug, Terminal, Trash2, X } from "lucide-react";
import { $auth, $chat, $persistedTerminals, $projects } from "@/store/subjects";
import {
  deleteChatSession,
  forgetPersistedTerminal,
  loadChatSession,
  loadChatSessions,
  loadPersistedTerminals,
  openWindow,
  reattachPersistedTerminal,
  renameChatSession,
} from "@/store/actions";
import { ViewHeader } from "@/components/ui/view-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HistoryTab = "chats" | "terminals";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function HistoryPanel() {
  const [auth] = useSubject($auth);
  const [tab, setTab] = useState<HistoryTab>("chats");
  const isSuperAdmin = auth.user?.role === "superadmin";

  return (
    <div className="flex flex-col h-full">
      <ViewHeader
        title="History"
        subtitle={isSuperAdmin ? "All users" : "Your activity"}
      />
      <div className="flex items-center gap-1 px-4 border-b border-surface0 shrink-0">
        <TabButton active={tab === "chats"} onClick={() => setTab("chats")} icon={<MessageSquare size={13} />} label="Assistant" />
        <TabButton active={tab === "terminals"} onClick={() => setTab("terminals")} icon={<Terminal size={13} />} label="Terminals" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "chats" ? <ChatsTab isSuperAdmin={isSuperAdmin} /> : <TerminalsTab isSuperAdmin={isSuperAdmin} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors text-md",
        active
          ? "border-mauve text-text"
          : "border-transparent text-overlay0 hover:text-subtext0"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// --- Chats tab (the original HistoryPanel body) ---

function ChatsTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [chat] = useSubject($chat);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const sessions = chat.sessions;
  const loading = chat.sessionsLoading;

  useEffect(() => { loadChatSessions(); }, []);

  function openSession(sessionId: string): void {
    loadChatSession(sessionId);
    openWindow("genie-assistant");
  }

  function commitRename(sessionId: string): void {
    const trimmed = renameValue.trim();
    if (trimmed) renameChatSession(sessionId, trimmed);
    setRenamingId(null);
  }

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-overlay0">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading sessions…
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-overlay0 gap-2">
        <MessageSquare size={28} className="opacity-50" />
        <p>No assistant sessions yet</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-surface0">
      {sessions.map((s) => {
        const title = s.name || s.firstMessage || "Untitled session";
        return (
          <li
            key={s.sessionId}
            className="group relative px-4 py-3 hover:bg-surface0/60 transition-colors cursor-pointer"
            onClick={() => { if (!renamingId) openSession(s.sessionId); }}
          >
            {renamingId === s.sessionId ? (
              <form
                onSubmit={(e) => { e.preventDefault(); commitRename(s.sessionId); }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(s.sessionId)}
                  onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                  className="w-full bg-surface0 border border-mauve/40 rounded px-2 py-1 text-text outline-none"
                  style={{ fontSize: 13 }}
                />
              </form>
            ) : (
              <>
                <div className="flex items-baseline gap-2 min-w-0 pr-16">
                  <span className="truncate text-text font-medium" style={{ fontSize: 13 }}>{title}</span>
                  {s.modelId && (
                    <span className="text-overlay0 shrink-0" style={{ fontSize: 11 }}>· {s.modelId}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-overlay0 mt-1" style={{ fontSize: 11 }}>
                  {isSuperAdmin && s.userName && <span className="text-subtext0">{s.userName}</span>}
                  <span>{formatWhen(s.updatedAt)}</span>
                  <span>{s.messageCount} msg{s.messageCount !== 1 ? "s" : ""}</span>
                  {s.projectId && (
                    <span className="font-mono text-overlay0/80">{s.projectId.slice(0, 8)}</span>
                  )}
                </div>
                <div
                  className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => { setRenameValue(s.name || s.firstMessage || ""); setRenamingId(s.sessionId); }}
                    className="p-1.5 rounded hover:bg-surface1 text-overlay0 hover:text-text transition-colors"
                    title="Rename"
                  >
                    <FileEdit size={13} />
                  </button>
                  <button
                    onClick={() => deleteChatSession(s.sessionId)}
                    className="p-1.5 rounded hover:bg-red/20 text-overlay0 hover:text-red transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- Terminals tab ---

function TerminalsTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [pt] = useSubject($persistedTerminals);
  const [projects] = useSubject($projects);

  // Local filter draft. Pushed to the store on change. Server-side filtering
  // re-fires the WS list call, so we keep the round-trip cheap by only loading
  // once with whatever filters are active; sessions are typically small (<100).
  useEffect(() => { loadPersistedTerminals(); }, []);

  const allOwnerNames = useMemo(() => {
    // Distinct owner ids in the response, with friendly fallback labels.
    const seen = new Map<string, string>();
    for (const s of pt.sessions) {
      if (!seen.has(s.ownerId)) seen.set(s.ownerId, s.ownerId.slice(0, 8));
    }
    return seen;
  }, [pt.sessions]);

  const allVpsHosts = useMemo(() => Array.from(new Set(pt.sessions.map((s) => s.vpsHost))), [pt.sessions]);

  const sessions = pt.sessions;
  const loading = pt.loading;

  function setFilter(key: "projectId" | "instanceId" | "vpsHost" | "ownerId", value: string | null | undefined): void {
    loadPersistedTerminals({ [key]: value });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter strip */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-surface0 shrink-0 flex-wrap" style={{ fontSize: 12 }}>
        <span className="text-overlay0">Filter:</span>

        <FilterSelect
          label="Project"
          value={pt.filters.projectId || ""}
          options={[
            { value: "", label: "All" },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(v) => setFilter("projectId", v || null)}
        />

        <FilterSelect
          label="Server"
          value={pt.filters.vpsHost || ""}
          options={[
            { value: "", label: "All" },
            ...allVpsHosts.map((h) => ({ value: h, label: h })),
          ]}
          onChange={(v) => setFilter("vpsHost", v || null)}
        />

        {isSuperAdmin && (
          <FilterSelect
            label="User"
            value={pt.filters.ownerId === undefined || pt.filters.ownerId === null ? "" : pt.filters.ownerId}
            options={[
              { value: "", label: "All users" },
              ...Array.from(allOwnerNames.entries()).map(([id, label]) => ({ value: id, label })),
            ]}
            onChange={(v) => setFilter("ownerId", v || null)}
          />
        )}

        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={() => loadPersistedTerminals()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-overlay0">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading terminals…
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-overlay0 gap-2">
            <Terminal size={28} className="opacity-50" />
            <p>No persistent terminal sessions</p>
            <p style={{ fontSize: 11 }} className="text-overlay0/80 max-w-md text-center">
              Open a terminal on a project VPS and it will appear here. Sessions survive disconnects and Manager restarts via tmux on the remote side.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-surface0">
            {sessions.map((s) => {
              const project = s.projectId ? projects.find((p) => p.id === s.projectId) : null;
              const title = s.commandLabel || (s.kind === "claude" ? "Claude" : "Shell");
              return (
                <li key={s.id} className="group relative px-4 py-3 hover:bg-surface0/60 transition-colors">
                  <div className="flex items-center gap-2 min-w-0 pr-28">
                    {s.kind === "claude" ? (
                      <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-mauve/20 text-mauve shrink-0" title="Claude Code">
                        <Terminal size={11} />
                      </span>
                    ) : (
                      <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-surface1 text-overlay1 shrink-0" title="Shell">
                        <Terminal size={11} />
                      </span>
                    )}
                    <span className="truncate text-text font-medium" style={{ fontSize: 13 }}>{title}</span>
                    <span className="text-overlay0 shrink-0 font-mono" style={{ fontSize: 11 }}>{s.id}</span>
                  </div>
                  <div className="flex items-center gap-3 text-overlay0 mt-1 flex-wrap" style={{ fontSize: 11 }}>
                    {isSuperAdmin && <span className="text-subtext0">{allOwnerNames.get(s.ownerId) ?? s.ownerId.slice(0, 8)}</span>}
                    {project && <span className="text-blue/70">{project.name}</span>}
                    <span className="font-mono">{s.vpsHost}</span>
                    <span>last active {formatWhen(s.lastActivity)}</span>
                  </div>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={() => reattachPersistedTerminal(s)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-mauve/20 text-mauve hover:bg-mauve/30 transition-colors"
                      style={{ fontSize: 11 }}
                      title="Reattach to this terminal"
                    >
                      <Plug size={11} />
                      Reattach
                    </button>
                    <button
                      onClick={() => forgetPersistedTerminal(s.id)}
                      className="p-1.5 rounded hover:bg-red/20 text-overlay0 hover:text-red transition-colors opacity-0 group-hover:opacity-100"
                      title="Forget (removes from list; does NOT kill the tmux session on the VPS)"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

interface FilterOption { value: string; label: string }

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-overlay0">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface0 border border-surface1 rounded px-1.5 py-0.5 text-text outline-none focus:border-mauve/60"
        style={{ fontSize: 12 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
