"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDeepSubjectAll } from "@/lib/hooks";
import dynamic from "next/dynamic";
import type { BeforeMount } from "@monaco-editor/react";
import {
  ChevronUp, ChevronDown, Pencil, Trash2, Plus, Play, Database,
  ChevronLeft, ChevronRight, ChevronsUpDown, Terminal,
  RefreshCw, ExternalLink, Settings, X, Copy, Check, Key, AlertTriangle,
  RotateCcw, History, Clock, Download, Users, UserPlus, Shield, Crown,
} from "lucide-react";
import {
  $admin,
  addTerminalTab,
  loadAdminTables,
  selectAdminTable,
  loadAdminRows,
  setAdminSort,
  openAdminRowDrawer,
  closeAdminRowDrawer,
  saveAdminRow,
  deleteAdminRow,
  executeAdminSql,
  toggleAdminSqlPanel,
  setAdminTab,
  setDropletsSubTab,
  setAiSubTab,
  loadAdminDroplets,
  loadAdminDropletStats,
  adminDeleteDroplet,
  createAdminBaseImage,
  testBaseImageTemplate,
  loadBaseImageConfigs,
  saveBaseImageConfig,
  deleteBaseImageConfig,
  saveBaseImageTemplate,
  deleteBaseImageTemplate,
  restoreBaseImageTemplate,
  hardDeleteBaseImageTemplate,
  loadTemplateHistory,
  loadAiCosts,
  loadAiSettings,
  saveAiSettings,
  CHAT_MODELS,
  type ChatModelId,
  type AiSettings,
  type AdminState,
  type AdminBaseImageState,
  type BaseImageConfig,
  type BaseImageTemplate,
  type TemplateHistoryEntry,
  type DropletsSubTab,
  type AiSubTab,
  type AiUsageRow,
  type AdminColumnInfo,
  loadAdminUsers,
  validateUser,
  deleteUser,
  saveUser,
  loadAdminTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  setTeamMemberRole,
  type AdminUser,
  type AdminTeam,
  type AdminTeamMember,
  loadSshKey,
  regenerateSshKey,
  runDrizzlePush,
  closeDrizzlePush,
  loadBackups,
  createBackup,
  deleteBackup,
  loadAuditLogs,
  type AuditLogEntry,
  type AdminDroplet,
  type VpsStats,
} from "@/store";
import { cn } from "@/lib/utils";
import { buildAdminPath } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { CopyableIp } from "@/components/ui/copyable-ip";
import { DropletInstanceBar } from "@/components/droplet-instance-bar";
import { ViewHeader } from "@/components/view-header";
import { ViewTabs } from "@/components/view-tabs";
import { AdminRowDrawer } from "@/components/admin-row-drawer";
import { Select } from "@/components/ui/select";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="h-[200px] bg-[#1e1e2e] rounded-md" />,
});

const catppuccinMocha = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "", foreground: "cdd6f4" },
    { token: "comment", foreground: "6c7086", fontStyle: "italic" },
    { token: "keyword", foreground: "cba6f7" },
    { token: "string", foreground: "a6e3a1" },
    { token: "number", foreground: "fab387" },
    { token: "type", foreground: "f9e2af" },
  ],
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "editor.lineHighlightBackground": "#313244",
    "editor.selectionBackground": "#45475a",
    "editorCursor.foreground": "#f5e0dc",
    "editorLineNumber.foreground": "#6c7086",
    "editorLineNumber.activeForeground": "#cdd6f4",
    "editorWidget.background": "#181825",
    "editorWidget.border": "#313244",
    "scrollbarSlider.background": "#31324480",
    "scrollbarSlider.hoverBackground": "#45475a80",
  },
};

const handleEditorWillMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("catppuccin-mocha", catppuccinMocha);
};

function formatActiveSince(createdAt: string | null): string {
  if (!createdAt) return "-";
  const created = new Date(createdAt).getTime();
  if (isNaN(created)) return "-";
  const diffMs = Date.now() - created;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 p-1 bg-transparent border-none cursor-pointer text-red/60 hover:text-red transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function AiSettingsPanel({ aiState }: { aiState: AdminState["ai"] }) {
  const { settings, settingsLoading } = aiState;
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [maxToolRounds, setMaxToolRounds] = useState(settings.maxToolRounds);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadAiSettings();
  }, []);

  useEffect(() => {
    setDefaultModel(settings.defaultModel);
    setMaxToolRounds(settings.maxToolRounds);
  }, [settings.defaultModel, settings.maxToolRounds]);

  const handleSave = () => {
    saveAiSettings({ defaultModel, maxToolRounds });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="px-4 py-4 max-w-md space-y-5">
      <div className="space-y-1.5">
        <label className="text-md text-overlay0">Default Model</label>
        <select
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          className="w-full bg-surface0 border border-surface1 rounded-lg px-3 py-2 text-text text-md outline-none focus:border-mauve cursor-pointer"
        >
          {Object.entries(CHAT_MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <p className="text-md text-overlay0/60">Used when no model is explicitly selected in chat.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-md text-overlay0">Max Tool Rounds</label>
        <input
          type="number"
          min={1}
          max={50}
          value={maxToolRounds}
          onChange={(e) => setMaxToolRounds(Number(e.target.value) || 10)}
          className="w-full bg-surface0 border border-surface1 rounded-lg px-3 py-2 text-text text-md outline-none focus:border-mauve font-mono"
        />
        <p className="text-md text-overlay0/60">Maximum number of consecutive tool call rounds per chat message.</p>
      </div>

      <Button onClick={handleSave} disabled={settingsLoading}>
        {saved ? "Saved!" : "Save Settings"}
      </Button>
    </div>
  );
}

function AiCostsPanel({ aiState }: { aiState: AdminState["ai"] }) {
  const { costs, loading, error } = aiState;

  // Aggregate totals
  const totalCost = costs.reduce((sum, r) => sum + r.cost, 0);
  const totalInput = costs.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutput = costs.reduce((sum, r) => sum + r.outputTokens, 0);

  // Per-model breakdown
  const byModel: Record<string, { label: string; cost: number; input: number; output: number; count: number }> = {};
  for (const r of costs) {
    const m = byModel[r.modelId] || (byModel[r.modelId] = { label: r.modelLabel, cost: 0, input: 0, output: 0, count: 0 });
    m.cost += r.cost;
    m.input += r.inputTokens;
    m.output += r.outputTokens;
    m.count++;
  }
  const modelBreakdown = Object.values(byModel).sort((a, b) => b.cost - a.cost);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-surface0">
        <ViewTabs
          tabs={[
            { key: "costs" as const, label: "Costs" },
            { key: "settings" as const, label: "Settings" },
          ]}
          activeTab={aiState.subTab}
          onTabChange={(tab) => setAiSubTab(tab)}
        />
      </div>

      {aiState.subTab === "settings" ? (
        <AiSettingsPanel aiState={aiState} />
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">{error}</div>
      ) : loading && costs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">Loading...</div>
      ) : costs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-overlay0 text-base">No AI usage recorded yet.</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Summary cards */}
          <div className="flex gap-4 px-4 py-3">
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Total Cost</span>
              <span className="text-text text-lg font-semibold">${totalCost.toFixed(4)}</span>
            </div>
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Total Calls</span>
              <span className="text-text text-lg font-semibold">{costs.length}</span>
            </div>
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Input Tokens</span>
              <span className="text-text text-lg font-semibold">{totalInput.toLocaleString()}</span>
            </div>
            <div className="rounded-lg bg-surface0/50 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-overlay0 text-md">Output Tokens</span>
              <span className="text-text text-lg font-semibold">{totalOutput.toLocaleString()}</span>
            </div>
          </div>

          {/* Per-model breakdown */}
          <div className="px-4 pb-3">
            <h3 className="text-md text-overlay0 mb-2">Cost by Model</h3>
            <div className="flex gap-3 flex-wrap">
              {modelBreakdown.map((m) => (
                <div key={m.label} className="rounded-lg bg-surface0/50 px-4 py-2 flex flex-col gap-0.5 min-w-[160px]">
                  <span className="text-text text-md font-medium">{m.label}</span>
                  <span className="text-peach text-md font-semibold">${m.cost.toFixed(4)}</span>
                  <span className="text-overlay0 text-md">{m.count} calls &middot; {m.input.toLocaleString()} in / {m.output.toLocaleString()} out</span>
                </div>
              ))}
            </div>
          </div>

          {/* Usage log table */}
          <table className="w-full text-base border-collapse">
            <thead className="sticky top-0 bg-mantle z-10">
              <tr>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Time</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Source</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">User</th>
                <th className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Model</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Input</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Output</th>
                <th className="text-right px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 whitespace-nowrap">Cost</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((r) => (
                <tr key={r.id} className="border-b border-surface0/50 hover:bg-surface0/30 transition-colors">
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">{r.source || "-"}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">{r.userName || "-"}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md">{r.modelLabel}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md text-right font-mono">{r.inputTokens.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-text whitespace-nowrap text-md text-right font-mono">{r.outputTokens.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-peach whitespace-nowrap text-md text-right font-mono">{formatCost(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupPanel({ backups }: { backups: { files: { name: string; size: number; createdAt: string }[]; loading: boolean; creating: boolean } }) {
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

function DrizzlePushWindow({ output, running, onClose }: { output: string; running: boolean; onClose: () => void }) {
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

const TEAM_ROLES: ("member" | "owner" | "superadmin")[] = ["member", "owner", "superadmin"];
const USER_ROLES: ("user" | "admin" | "superadmin")[] = ["user", "admin", "superadmin"];

function UserDrawer({ user, teams, teamMembers, onClose }: { user: AdminUser; teams: AdminTeam[]; teamMembers: AdminTeamMember[]; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [validated, setValidated] = useState(user.validated);
  const [role, setRole] = useState<"user" | "admin" | "superadmin">(user.role || "user");
  const [addingTeam, setAddingTeam] = useState(false);
  const [addTeamRole, setAddTeamRole] = useState<"member" | "owner" | "superadmin">("member");

  useEffect(() => { setName(user.name); setValidated(user.validated); setRole(user.role || "user"); }, [user]);

  const userTeams = teamMembers.filter((m: AdminTeamMember) => m.userId === user.id);
  const availableTeams = teams.filter((t: AdminTeam) => !userTeams.some((m: AdminTeamMember) => m.teamId === t.id));

  const handleSave = () => {
    saveUser(user.id, { name, validated, role } as Partial<AdminUser>);
    onClose();
  };

  return (
    <div className="fixed right-0 top-0 h-screen w-[420px] z-50 bg-mantle border-l border-surface0 flex flex-col shadow-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface0">
        <h2 className="text-base font-semibold text-text">Edit User</h2>
        <Button size="sm" variant="ghost" onClick={onClose}><X size={16} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {user.avatarUrl && (
          <div className="flex justify-center">
            <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full" />
          </div>
        )}
        <div>
          <label className="text-subtext1 text-md block mb-1">Name</label>
          <input className="w-full bg-surface0 border border-surface1 rounded px-3 py-2 text-md text-text font-mono" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Email</label>
          <p className="text-subtext0 text-md font-mono">{user.email}</p>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Validated</label>
          <button
            className={cn("px-3 py-1.5 rounded text-md font-mono", validated ? "bg-green/20 text-green" : "bg-yellow/20 text-yellow")}
            onClick={() => setValidated(!validated)}
          >
            {validated ? "Validated" : "Pending"}
          </button>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Role</label>
          <select
            className="bg-surface0 border border-surface1 rounded px-3 py-2 text-md text-text font-mono"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {USER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Google ID</label>
          <p className="text-subtext0 text-md font-mono">{user.googleId}</p>
        </div>
        <div>
          <label className="text-subtext1 text-md block mb-1">Joined</label>
          <p className="text-subtext0 text-md font-mono">{new Date(user.createdAt).toLocaleString()}</p>
        </div>

        {/* Teams management */}
        <div>
          <label className="text-subtext1 text-md block mb-2">Teams</label>
          <div className="space-y-2">
            {userTeams.map((m: AdminTeamMember) => {
              const team = teams.find((t: AdminTeam) => t.id === m.teamId);
              return (
                <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-surface0/30 rounded">
                  <span className="text-md">{team?.name || m.teamId}</span>
                  <div className="flex items-center gap-2">
                    <select
                      className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                      value={m.role}
                      onChange={(e) => setTeamMemberRole(m.id, e.target.value)}
                    >
                      {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={() => removeTeamMember(m.id)}>
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Add to team */}
            {addingTeam ? (
              <div className="flex items-center gap-2">
                <select
                  className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text flex-1"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addTeamMember(e.target.value, user.id, addTeamRole);
                      setAddingTeam(false);
                      setAddTeamRole("member");
                    }
                  }}
                >
                  <option value="" disabled>Select team...</option>
                  {availableTeams.map((t: AdminTeam) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select
                  className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text"
                  value={addTeamRole}
                  onChange={(e) => setAddTeamRole(e.target.value as typeof addTeamRole)}
                >
                  {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setAddingTeam(false)}>
                  <X size={14} />
                </Button>
              </div>
            ) : availableTeams.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setAddingTeam(true)}>
                <Plus size={14} className="mr-1" /> Add to Team
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-surface0 flex items-center gap-2">
        <Button onClick={handleSave} className="flex-1">Save</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function TeamsPanel({ teams, users }: { teams: AdminState["teams"]; users: AdminUser[] }) {
  const [newTeamName, setNewTeamName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);

  const nonAgentUsers = users.filter((u: AdminUser) => !u.isAgent);

  const handleCreateTeam = () => {
    if (!newTeamName.trim()) return;
    createTeam(newTeamName.trim());
    setNewTeamName("");
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Create team form */}
      <div className="flex items-center gap-2">
        <input
          className="bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text flex-1 max-w-xs"
          placeholder="New team name..."
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
        />
        <Button size="sm" onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
          <Plus size={14} className="mr-1" /> Create Team
        </Button>
      </div>

      {teams.loading ? (
        <p className="text-subtext0">Loading teams...</p>
      ) : teams.list.length === 0 ? (
        <p className="text-subtext0">No teams yet.</p>
      ) : (
        <div className="space-y-3">
          {teams.list.map((team: AdminTeam) => {
            const teamMembers = teams.members.filter((m: AdminTeamMember) => m.teamId === team.id);
            const isExpanded = expandedTeamId === team.id;
            const isEditing = editingId === team.id;

            return (
              <div key={team.id} className="border border-surface0 rounded-lg overflow-hidden">
                {/* Team header */}
                <div className="flex items-center justify-between px-4 py-3 bg-surface0/30 cursor-pointer" onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <input
                        className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { updateTeam(team.id, editingName); setEditingId(null); }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium">{team.name}</span>
                    )}
                    <span className="text-subtext0 text-md">({teamMembers.length} members)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingId(team.id); setEditingName(team.name); }}>
                      <Pencil size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete team "${team.name}"?`)) deleteTeam(team.id); }}>
                      <Trash2 size={14} />
                    </Button>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Expanded: members list */}
                {isExpanded && (
                  <div className="px-4 py-3 space-y-2">
                    {teamMembers.length === 0 ? (
                      <p className="text-subtext0 text-md">No members yet.</p>
                    ) : (
                      teamMembers.map((m: AdminTeamMember) => {
                        const user = nonAgentUsers.find((u: AdminUser) => u.id === m.userId);
                        return (
                          <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-surface0/50 last:border-0">
                            <div className="flex items-center gap-2">
                              {user?.avatarUrl && <img src={user.avatarUrl} alt="" className="w-5 h-5 rounded-full" />}
                              <span>{user?.name || m.userId}</span>
                              <span className="text-subtext0 text-md">{user?.email}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={m.role === "owner" ? "default" : "ghost"}
                                onClick={() => setTeamMemberRole(m.id, m.role === "owner" ? "member" : "owner")}
                                title={m.role === "owner" ? "Demote to member" : "Promote to owner"}
                              >
                                <Crown size={14} className={m.role === "owner" ? "text-yellow" : ""} />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={() => removeTeamMember(m.id)}>
                                <X size={14} />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Add member */}
                    {addMemberTeamId === team.id ? (
                      <div className="flex items-center gap-2 pt-2">
                        <select
                          className="bg-surface0 border border-surface1 rounded px-2 py-1.5 text-md text-text flex-1"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              addTeamMember(team.id, e.target.value);
                              setAddMemberTeamId(null);
                            }
                          }}
                        >
                          <option value="" disabled>Select user...</option>
                          {nonAgentUsers
                            .filter((u: AdminUser) => !teamMembers.some((m: AdminTeamMember) => m.userId === u.id))
                            .map((u: AdminUser) => (
                              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                            ))}
                        </select>
                        <Button size="sm" variant="ghost" onClick={() => setAddMemberTeamId(null)}>
                          <X size={14} />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setAddMemberTeamId(team.id)} className="mt-1">
                        <Plus size={14} className="mr-1" /> Add Member
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AdminPanel() {
  const router = useRouter();
  const admin = useDeepSubjectAll($admin);
  const { activeTab, tables, selectedTable, columns, primaryKey, rows, totalCount, page, pageSize, orderBy, orderDir, loading, drawerOpen, drawerMode, drawerRow, sqlResult, sqlError, sqlLoading, sqlOpen, droplets, dropletsLoading, dropletsError, dropletStats, baseImage, dropletsSubTab, sshKey, ai: aiState, drizzlePush, users: usersState, teams: teamsState } = admin;


  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; user: AdminUser } | null>(null);
  const [sqlInput, setSqlInput] = useState("");
  // Configs sub-tab state
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);
  const [addingNewConfig, setAddingNewConfig] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [editConfigDrafts, setEditConfigDrafts] = useState<Record<string, BaseImageConfig & { editName: string }>>({});
  const [newConfigDraft, setNewConfigDraft] = useState<BaseImageConfig>({
    region: "nyc1",
    size: "s-1vcpu-1gb",
    provisionScript: "#!/bin/bash\nset -e\n",
  });
  // Templates sub-tab state
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [addingNewTemplate, setAddingNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [editTemplateDrafts, setEditTemplateDrafts] = useState<Record<string, BaseImageTemplate & { editName: string }>>({});
  const [newTemplateDraft, setNewTemplateDraft] = useState<Omit<BaseImageTemplate, "snapshotId" | "snapshotName">>({
    configName: "",
    snapshotPrefix: "genie-base",
  });

  useEffect(() => {
    loadAdminTables();
    if (activeTab === "droplets") {
      loadAdminDroplets();
      loadBaseImageConfigs();
    }
    if (activeTab === "ai") {
      loadAiCosts();
    }
    if (activeTab === "users") {
      loadAdminUsers();
    }
    if (activeTab === "teams") {
      loadAdminTeams();
      loadAdminUsers();
    }
  }, []);

  // Load AI costs when switching to AI tab
  useEffect(() => {
    if (activeTab === "ai" && aiState.costs.length === 0 && !aiState.loading) {
      loadAiCosts();
    }
  }, [activeTab]);

  // Poll real-time stats while the droplets sub-tab is visible
  useEffect(() => {
    if (activeTab !== "droplets" || dropletsSubTab !== "instances" || droplets.length === 0) return;
    loadAdminDropletStats();
    const id = setInterval(loadAdminDropletStats, 10000);
    return () => clearInterval(id);
  }, [activeTab, dropletsSubTab, droplets.length]);



  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const handleRunSql = useCallback(() => {
    if (sqlInput.trim()) executeAdminSql(sqlInput.trim());
  }, [sqlInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRunSql();
    }
  }, [handleRunSql]);

  const truncate = (val: any, max = 60): string => {
    if (val === null || val === undefined) return "NULL";
    const s = typeof val === "object" ? JSON.stringify(val) : String(val);
    return s.length > max ? s.slice(0, max) + "..." : s;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4">
        <ViewHeader
          title="Admin"
          subtitle={activeTab === "database" && selectedTable ? (
            <span>
              {selectedTable}
              <span className="ml-2 text-md">({totalCount} rows)</span>
            </span>
          ) : undefined}
          actions={
            <>
              {activeTab === "database" && (
                <>
                  {process.env.NODE_ENV !== "production" && (
                    <Button
                      size="sm"
                      onClick={runDrizzlePush}
                      disabled={drizzlePush.running}
                    >
                      <Play size={14} className="mr-1" />
                      {drizzlePush.running ? "Pushing..." : "Drizzle Push"}
                    </Button>
                  )}
                  <Button
                    variant={sqlOpen ? "active" : "default"}
                    size="sm"
                    onClick={toggleAdminSqlPanel}
                  >
                    <Terminal size={14} className="mr-1" />
                    SQL
                  </Button>
                </>
              )}
              {activeTab === "droplets" && dropletsSubTab === "instances" && (
                <Button
                  size="sm"
                  onClick={loadAdminDroplets}
                  disabled={dropletsLoading}
                >
                  <RefreshCw size={14} className={cn("mr-1", dropletsLoading && "animate-spin")} />
                  Refresh
                </Button>
              )}
            </>
          }
        />
        <ViewTabs
          tabs={[
            { key: "database" as const, label: "Database" },
            { key: "backup" as const, label: "Backup" },
            { key: "droplets" as const, label: "Droplets" },
            { key: "ai" as const, label: "AI" },
            { key: "users" as const, label: "Users" },
            { key: "teams" as const, label: "Teams" },
            { key: "audit" as const, label: "Audit" },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => {
            if (tab === "database") { setAdminTab("database"); router.push(buildAdminPath("database")); }
            else if (tab === "backup") { setAdminTab("backup"); loadBackups(); router.push(buildAdminPath("backup")); }
            else if (tab === "droplets") { setAdminTab("droplets"); loadAdminDroplets(); loadBaseImageConfigs(); router.push(buildAdminPath("droplets", dropletsSubTab)); }
            else if (tab === "ai") { setAdminTab("ai"); loadAiCosts(); router.push(buildAdminPath("ai", aiState.subTab)); }
            else if (tab === "users") { setAdminTab("users"); loadAdminUsers(); router.push(buildAdminPath("users")); }
            else if (tab === "teams") { setAdminTab("teams"); loadAdminTeams(); loadAdminUsers(); router.push(buildAdminPath("teams")); }
            else if (tab === "audit") { setAdminTab("audit"); loadAuditLogs(); router.push(buildAdminPath("audit")); }
          }}
        />
      </div>

      {activeTab === "database" ? (
        /* ===== DATABASE TAB ===== */
        <div className="flex-1 flex overflow-hidden">
          {/* Table list sidebar */}
          <div className="w-48 shrink-0 border-r border-surface0 overflow-y-auto">
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => selectAdminTable(t.name)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-base border-none cursor-pointer transition-colors",
                  t.name === selectedTable
                    ? "bg-surface0 text-text"
                    : "bg-transparent text-subtext0 hover:bg-surface0/50 hover:text-text"
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="truncate">{t.name}</span>
                  <span className="text-md text-overlay0 shrink-0">{t.rowCount}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {!selectedTable ? (
              <div className="flex-1 flex items-center justify-center text-overlay0 text-base">
                Select a table to browse
              </div>
            ) : (
              <>
                {/* Data grid */}
                <div className="flex-1 overflow-auto">
                  {loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-base text-overlay0">
                      Loading...
                    </div>
                  ) : (
                    <table className="w-full text-base border-collapse">
                      <thead className="sticky top-0 bg-mantle z-10">
                        <tr>
                          {columns.map((col) => (
                            <th
                              key={col.name}
                              onClick={() => setAdminSort(col.name)}
                              className="text-left px-3 py-1.5 text-md font-medium text-overlay0 border-b border-surface0 cursor-pointer hover:text-text select-none whitespace-nowrap"
                            >
                              <span className="inline-flex items-center gap-1">
                                {col.name}
                                {orderBy === col.name ? (
                                  orderDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                ) : (
                                  <ChevronsUpDown size={10} className="opacity-30" />
                                )}
                              </span>
                            </th>
                          ))}
                          <th className="w-20 px-3 py-1.5 border-b border-surface0" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => {
                          const key = primaryKey ? row[primaryKey] : i;
                          return (
                            <tr
                              key={key}
                              className="border-b border-surface0/50 hover:bg-surface0/30 transition-colors"
                            >
                              {columns.map((col) => (
                                <td
                                  key={col.name}
                                  className={cn(
                                    "px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate",
                                    row[col.name] === null ? "text-overlay0 italic" : "text-text"
                                  )}
                                  title={row[col.name] === null ? "NULL" : typeof row[col.name] === "object" ? JSON.stringify(row[col.name]) : String(row[col.name] ?? "")}
                                >
                                  {truncate(row[col.name])}
                                </td>
                              ))}
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => openAdminRowDrawer("edit", row)}
                                    className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
                                    title="Edit"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (primaryKey && confirm("Delete this row?")) {
                                        deleteAdminRow(String(row[primaryKey]));
                                      }
                                    }}
                                    className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-red transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Bottom toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-surface0 text-md text-overlay0">
                  <span>
                    {totalCount} rows · Page {page} of {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => loadAdminRows(page - 1)}
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => loadAdminRows(page + 1)}
                    >
                      <ChevronRight size={14} />
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openAdminRowDrawer("create")}
                    >
                      <Plus size={14} className="mr-1" />
                      New Row
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* SQL panel */}
            {sqlOpen && (
              <div className="border-t border-surface0 flex flex-col max-h-[40%]">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-surface0/50">
                  <span className="text-md font-medium text-subtext0">SQL Query</span>
                  <div className="flex-1" />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleRunSql}
                    disabled={sqlLoading || !sqlInput.trim()}
                  >
                    <Play size={12} className="mr-1" />
                    {sqlLoading ? "Running..." : "Run"}
                  </Button>
                </div>
                <textarea
                  value={sqlInput}
                  onChange={(e) => setSqlInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="SELECT * FROM users LIMIT 10  (Cmd+Enter to run)"
                  className="px-4 py-2 bg-background border-none text-base text-text font-mono resize-none outline-none"
                  rows={3}
                />
                {sqlError && (
                  <div className="px-4 py-2 text-md text-red bg-red/10 border-t border-surface0/50">
                    {sqlError}
                  </div>
                )}
                {sqlResult && (
                  <div className="flex-1 overflow-auto border-t border-surface0/50">
                    <div className="px-4 py-1 text-md text-overlay0">
                      {sqlResult.rowCount} row{sqlResult.rowCount !== 1 ? "s" : ""} returned
                    </div>
                    {sqlResult.rows.length > 0 && (
                      <table className="w-full text-md border-collapse">
                        <thead className="sticky top-0 bg-mantle">
                          <tr>
                            {sqlResult.columns.map((col) => (
                              <th key={col} className="text-left px-3 py-1 text-overlay0 font-medium border-b border-surface0 whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sqlResult.rows.map((row, i) => (
                            <tr key={i} className="border-b border-surface0/30">
                              {sqlResult!.columns.map((col) => (
                                <td key={col} className="px-3 py-1 text-text whitespace-nowrap max-w-[200px] truncate">
                                  {truncate(row[col], 80)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "droplets" ? (
        /* ===== DROPLETS TAB ===== */
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-4">
            <ViewTabs
              tabs={[
                { key: "instances" as const, label: "Instances" },
                { key: "templates" as const, label: "Templates" },
                { key: "configs" as const, label: "Configs" },
                { key: "sshkey" as const, label: "SSH Key" },
              ]}
              activeTab={dropletsSubTab}
              onTabChange={(tab) => {
                setDropletsSubTab(tab);
                if (tab === "sshkey") loadSshKey();
                router.push(buildAdminPath("droplets", tab));
              }}
            />
          </div>


          {/* ── Instances sub-tab ── */}
          {dropletsSubTab === "instances" && (
            <>
              {dropletsError ? (
                <div className="flex-1 flex items-center justify-center text-overlay0 text-base">
                  {dropletsError}
                </div>
              ) : dropletsLoading && droplets.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-overlay0 text-base">
                  Loading...
                </div>
              ) : droplets.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-overlay0 text-base">
                  No droplets found. Deploy a project to DigitalOcean to see it here.
                </div>
              ) : (
                <div className="flex-1 overflow-auto flex flex-col gap-2 p-2">
                  {droplets.map((d) => {
                    const isActive = d.status === "active";
                    const stats = dropletStats[d.id];
                    return (
                      <div key={d.id} className="bg-background rounded-lg px-3 py-2">
                        <DropletInstanceBar
                          name={d.name}
                          status={d.status}
                          ip={d.ip}
                          region={d.region}
                          sizeSlug={d.size}
                          stats={stats ?? null}
                          statsLoading={isActive && !stats}
                          onRefresh={() => { loadAdminDroplets(); loadAdminDropletStats(); }}
                          onSshTerminal={isActive && d.ip ? () => {
                            addTerminalTab(undefined, `SSH ${d.ip}`, `ssh -o StrictHostKeyChecking=no -i ~/.genie/ssh/genie_ed25519 root@${d.ip} -t 'cd /opt/project || true; exec bash'`);
                          } : undefined}
                          onDelete={() => {
                            if (confirm(`Delete droplet "${d.name}"? This cannot be undone.`)) {
                              adminDeleteDroplet(d.id);
                            }
                          }}
                        />
                        {/* Extra info row */}
                        <div className="flex items-center gap-4 mt-1 text-md text-overlay0">
                          {d.projectName && <span>Project: <span className="text-text">{d.projectName}</span></span>}
                          {d.createdAt && <span>Active: <span className="text-text">{formatActiveSince(d.createdAt)}</span></span>}
                          {d.createdBy && <span>By: <span className="text-text">{d.createdBy}</span></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Templates sub-tab ── */}
          {dropletsSubTab === "templates" && (
            <div className="flex-1 overflow-auto px-4 py-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-base font-medium text-text">Templates</span>
                <div className="flex-1" />
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => { setAddingNewTemplate(true); setNewTemplateName(""); setNewTemplateDraft({ configName: Object.keys(baseImage.configs)[0] || "", snapshotPrefix: "genie-base" }); }}
                >
                  <Plus size={14} className="mr-1" />
                  Add New
                </Button>
              </div>
              {Object.keys(baseImage.templates).length === 0 && !addingNewTemplate && (
                <p className="text-md text-overlay0">
                  No templates yet. Create a template referencing a config, then build it to create a snapshot.
                </p>
              )}
              <div className="space-y-1">
                {Object.entries(baseImage.templates).map(([name, tmpl]) => {
                  const isExpanded = expandedTemplate === name;
                  const isBuilding = baseImage.buildingName === name;
                  const draft = editTemplateDrafts[name] || { ...tmpl, editName: name };
                  const updateDraft = (patch: Partial<BaseImageTemplate & { editName: string }>) =>
                    setEditTemplateDrafts((d) => ({ ...d, [name]: { ...draft, ...patch } }));
                  return (
                    <div key={name} className="rounded border border-surface0 bg-background">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-base font-medium text-text font-mono">"{name}"</span>
                        <span className="text-md text-overlay0">config: {tmpl.configName}</span>
                        {tmpl.snapshotId && tmpl.verified ? (
                          <span className="px-2 py-0.5 rounded text-md font-medium bg-green/20 text-green">Active</span>
                        ) : tmpl.snapshotId ? (
                          <span className="px-2 py-0.5 rounded text-md font-medium bg-yellow/20 text-yellow">Not verified</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-md font-medium bg-overlay0/20 text-overlay0">Not built</span>
                        )}
                        {tmpl.snapshotName && (
                          <span className="text-md text-overlay0 font-mono truncate max-w-[200px]">{tmpl.snapshotName}</span>
                        )}
                        <div className="flex-1" />
                        {tmpl.snapshotId && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => testBaseImageTemplate(name)}
                            disabled={!!baseImage.buildingName}
                          >
                            Test
                          </Button>
                        )}
                        <Button
                          variant={tmpl.snapshotId ? "default" : "primary"}
                          size="sm"
                          onClick={() => createAdminBaseImage(name)}
                          disabled={!!baseImage.buildingName}
                        >
                          {isBuilding ? (
                            <>
                              <RefreshCw size={14} className="mr-1 animate-spin" />
                              Building...
                            </>
                          ) : tmpl.snapshotId ? "Rebuild" : "Build"}
                        </Button>
                        <button
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedTemplate(null);
                            } else {
                              setExpandedTemplate(name);
                              setEditTemplateDrafts((d) => ({ ...d, [name]: { ...tmpl, editName: name } }));
                            }
                          }}
                          className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
                          title={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-surface0/50 pt-3">
                          <div>
                            <label className="block text-md font-medium text-subtext0 mb-1">Template Name</label>
                            <input
                              type="text"
                              value={draft.editName}
                              onChange={(e) => updateDraft({ editName: e.target.value })}
                              className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-base text-text outline-none font-sans focus:border-mauve"
                            />
                          </div>
                          <div>
                            <label className="block text-md font-medium text-subtext0 mb-1">Config</label>
                            <Select
                              value={draft.configName}
                              onChange={(e) => updateDraft({ configName: e.target.value })}
                              className="w-full text-base font-sans focus:border-mauve"
                            >
                              {Object.keys(baseImage.configs).map((cn) => (
                                <option key={cn} value={cn}>{cn}</option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <label className="block text-md font-medium text-subtext0 mb-1">Snapshot Prefix</label>
                            <input
                              type="text"
                              value={draft.snapshotPrefix}
                              onChange={(e) => updateDraft({ snapshotPrefix: e.target.value })}
                              className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-base text-text outline-none font-sans focus:border-mauve"
                              placeholder="genie-base"
                            />
                          </div>
                          <div className="flex justify-between">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Delete template "${name}"?`)) {
                                  deleteBaseImageTemplate(name);
                                  setExpandedTemplate(null);
                                }
                              }}
                            >
                              <Trash2 size={14} className="mr-1 text-red" />
                              Delete
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                const { editName, verified, ...tmplData } = draft;
                                saveBaseImageTemplate(editName.trim() || name, tmplData as BaseImageTemplate, editName.trim() !== name ? name : undefined);
                                setExpandedTemplate(null);
                                setEditTemplateDrafts((d) => { const next = { ...d }; delete next[name]; return next; });
                              }}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add New Template inline form */}
              {addingNewTemplate && (
                <div className="mt-2 rounded border border-surface0 bg-background p-4 space-y-3">
                  <div>
                    <label className="block text-md font-medium text-subtext0 mb-1">Template Name</label>
                    <input
                      type="text"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-base text-text outline-none font-sans focus:border-mauve"
                      placeholder="e.g. default, heavy, gpu..."
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-md font-medium text-subtext0 mb-1">Config</label>
                    <Select
                      value={newTemplateDraft.configName}
                      onChange={(e) => setNewTemplateDraft({ ...newTemplateDraft, configName: e.target.value })}
                      className="w-full text-base font-sans focus:border-mauve"
                    >
                      {Object.keys(baseImage.configs).length === 0 && (
                        <option value="">No configs available</option>
                      )}
                      {Object.keys(baseImage.configs).map((cn) => (
                        <option key={cn} value={cn}>{cn}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-md font-medium text-subtext0 mb-1">Snapshot Prefix</label>
                    <input
                      type="text"
                      value={newTemplateDraft.snapshotPrefix}
                      onChange={(e) => setNewTemplateDraft({ ...newTemplateDraft, snapshotPrefix: e.target.value })}
                      className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-base text-text outline-none font-sans focus:border-mauve"
                      placeholder="genie-base"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="default" size="sm" onClick={() => setAddingNewTemplate(false)}>Cancel</Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!newTemplateName.trim() || !newTemplateDraft.configName}
                      onClick={() => {
                        saveBaseImageTemplate(newTemplateName.trim(), { ...newTemplateDraft, snapshotId: null, snapshotName: null });
                        setAddingNewTemplate(false);
                        setNewTemplateName("");
                      }}
                    >
                      Create
                    </Button>
                  </div>
                </div>
              )}

              {/* Deleted Templates (trash) */}
              {Object.keys(baseImage.deletedTemplates || {}).length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Trash2 size={14} className="text-overlay0" />
                    <span className="text-md font-medium text-overlay0">Recently Deleted</span>
                  </div>
                  <div className="space-y-1">
                    {Object.entries(baseImage.deletedTemplates).map(([name, tmpl]) => (
                      <div key={name} className="flex items-center gap-2 px-3 py-2 rounded border border-surface0/50 bg-background/50 opacity-60">
                        <span className="text-base font-medium text-text font-mono">"{name}"</span>
                        <span className="text-md text-overlay0">config: {tmpl.configName}</span>
                        {tmpl.deletedAt && (
                          <span className="text-md text-overlay0">deleted {new Date(tmpl.deletedAt).toLocaleDateString()}</span>
                        )}
                        <div className="flex-1" />
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => restoreBaseImageTemplate(name)}
                        >
                          <RotateCcw size={14} className="mr-1 text-green" />
                          Restore
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Permanently delete template "${name}"? This cannot be undone.`)) {
                              hardDeleteBaseImageTemplate(name);
                            }
                          }}
                        >
                          <Trash2 size={14} className="text-red" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Template History */}
              <div className="mt-4">
                <button
                  onClick={() => {
                    if (baseImage.history.length > 0) {
                      const a = $admin.getValue();
                      $admin.next({ ...a, baseImage: { ...a.baseImage, history: [] } });
                    } else {
                      loadTemplateHistory();
                    }
                  }}
                  className="flex items-center gap-2 text-md font-medium text-overlay0 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-0"
                >
                  <History size={14} />
                  {baseImage.history.length > 0 ? "Hide History" : "Show History"}
                </button>
                {baseImage.history.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                    {baseImage.history.map((entry: TemplateHistoryEntry) => (
                      <div key={entry.id} className="flex items-center gap-2 px-3 py-1.5 rounded border border-surface0/50 bg-background text-md">
                        <Clock size={12} className="text-overlay0 shrink-0" />
                        <span className="text-overlay0">{new Date(entry.createdAt).toLocaleString()}</span>
                        <span className={`px-1.5 py-0.5 rounded text-md font-medium ${
                          entry.action === "created" ? "bg-green/20 text-green" :
                          entry.action === "updated" ? "bg-blue/20 text-blue" :
                          entry.action === "deleted" ? "bg-red/20 text-red" :
                          "bg-yellow/20 text-yellow"
                        }`}>{entry.action}</span>
                        <span className="font-mono text-text">"{entry.templateName}"</span>
                        <span className="text-overlay0">config: {entry.data.configName}</span>
                        {entry.data.snapshotId && (
                          <span className="text-overlay0 font-mono">snap: {entry.data.snapshotId}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Configs sub-tab ── */}
          {dropletsSubTab === "configs" && (
            <div className="flex-1 overflow-auto px-4 py-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-base font-medium text-text">Configs</span>
                <div className="flex-1" />
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => { setAddingNewConfig(true); setNewConfigName(""); }}
                >
                  <Plus size={14} className="mr-1" />
                  Add New
                </Button>
              </div>
              {Object.keys(baseImage.configs).length === 0 && !addingNewConfig && (
                <p className="text-md text-overlay0">
                  No configs yet. Add a config to define build recipes (region, size, commands).
                </p>
              )}
              <div className="space-y-1">
                {Object.entries(baseImage.configs).map(([name, cfg]) => {
                  const isExpanded = expandedConfig === name;
                  const draft = editConfigDrafts[name] || { ...cfg, editName: name };
                  const updateDraft = (patch: Partial<BaseImageConfig & { editName: string }>) =>
                    setEditConfigDrafts((d) => ({ ...d, [name]: { ...draft, ...patch } }));
                  return (
                    <div key={name} className="rounded border border-surface0 bg-background">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-base font-medium text-text font-mono">"{name}"</span>
                        <span className="text-md text-overlay0">{cfg.region} / {cfg.size}</span>
                        <div className="flex-1" />
                        <button
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedConfig(null);
                            } else {
                              setExpandedConfig(name);
                              setEditConfigDrafts((d) => ({ ...d, [name]: { ...cfg, editName: name } }));
                            }
                          }}
                          className="p-1 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
                          title={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-surface0/50 pt-3">
                          <div>
                            <label className="block text-md font-medium text-subtext0 mb-1">Config Name</label>
                            <input
                              type="text"
                              value={draft.editName}
                              onChange={(e) => updateDraft({ editName: e.target.value })}
                              className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-base text-text outline-none font-sans focus:border-mauve"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-md font-medium text-subtext0 mb-1">Region</label>
                              <Select
                                value={draft.region}
                                onChange={(e) => updateDraft({ region: e.target.value })}
                                className="w-full text-base font-sans focus:border-mauve"
                              >
                                <option value="nyc1">NYC 1 (New York)</option>
                                <option value="sfo3">SFO 3 (San Francisco)</option>
                                <option value="ams3">AMS 3 (Amsterdam)</option>
                                <option value="lon1">LON 1 (London)</option>
                                <option value="fra1">FRA 1 (Frankfurt)</option>
                                <option value="sgp1">SGP 1 (Singapore)</option>
                                <option value="blr1">BLR 1 (Bangalore)</option>
                                <option value="syd1">SYD 1 (Sydney)</option>
                              </Select>
                            </div>
                            <div>
                              <label className="block text-md font-medium text-subtext0 mb-1">Size</label>
                              <Select
                                value={draft.size}
                                onChange={(e) => updateDraft({ size: e.target.value })}
                                className="w-full text-base font-sans focus:border-mauve"
                              >
                                <option value="s-1vcpu-1gb">1 vCPU / 1 GB</option>
                                <option value="s-1vcpu-2gb">1 vCPU / 2 GB</option>
                                <option value="s-2vcpu-2gb">2 vCPU / 2 GB</option>
                                <option value="s-2vcpu-4gb">2 vCPU / 4 GB</option>
                                <option value="s-4vcpu-8gb">4 vCPU / 8 GB</option>
                                <option value="s-8vcpu-16gb">8 vCPU / 16 GB</option>
                              </Select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-md font-medium text-subtext0 mb-1">Provision Script</label>
                            <div className="rounded-md overflow-hidden border border-surface1">
                              <MonacoEditor
                                height={`${Math.max(150, (draft.provisionScript || "").split("\n").length * 20 + 20)}px`}
                                language="shell"
                                theme="catppuccin-mocha"
                                value={draft.provisionScript}
                                onChange={(v) => updateDraft({ provisionScript: v ?? "" })}
                                beforeMount={handleEditorWillMount}
                                options={{
                                  minimap: { enabled: false },
                                  lineNumbers: "on",
                                  scrollBeyondLastLine: false,
                                  fontSize: 13,
                                  wordWrap: "on",
                                  automaticLayout: true,
                                  padding: { top: 8, bottom: 8 },
                                  renderLineHighlight: "gutter",
                                  overviewRulerLanes: 0,
                                  scrollbar: { verticalScrollbarSize: 6 },
                                }}
                              />
                            </div>
                          </div>
                          <div className="flex justify-between">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Delete config "${name}"?`)) {
                                  deleteBaseImageConfig(name);
                                  setExpandedConfig(null);
                                }
                              }}
                            >
                              <Trash2 size={14} className="mr-1 text-red" />
                              Delete
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                const { editName, ...configData } = draft;
                                saveBaseImageConfig(editName.trim() || name, configData, editName.trim() !== name ? name : undefined);
                                setExpandedConfig(null);
                                setEditConfigDrafts((d) => { const next = { ...d }; delete next[name]; return next; });
                              }}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add New Config inline form */}
              {addingNewConfig && (
                <div className="mt-2 rounded border border-surface0 bg-background p-4 space-y-3">
                  <div>
                    <label className="block text-md font-medium text-subtext0 mb-1">Config Name</label>
                    <input
                      type="text"
                      value={newConfigName}
                      onChange={(e) => setNewConfigName(e.target.value)}
                      className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-base text-text outline-none font-sans focus:border-mauve"
                      placeholder="e.g. heavy, gpu, default..."
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-md font-medium text-subtext0 mb-1">Region</label>
                      <Select
                        value={newConfigDraft.region}
                        onChange={(e) => setNewConfigDraft({ ...newConfigDraft, region: e.target.value })}
                        className="w-full text-base font-sans focus:border-mauve"
                      >
                        <option value="nyc1">NYC 1 (New York)</option>
                        <option value="sfo3">SFO 3 (San Francisco)</option>
                        <option value="ams3">AMS 3 (Amsterdam)</option>
                        <option value="lon1">LON 1 (London)</option>
                        <option value="fra1">FRA 1 (Frankfurt)</option>
                        <option value="sgp1">SGP 1 (Singapore)</option>
                        <option value="blr1">BLR 1 (Bangalore)</option>
                        <option value="syd1">SYD 1 (Sydney)</option>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-md font-medium text-subtext0 mb-1">Size</label>
                      <Select
                        value={newConfigDraft.size}
                        onChange={(e) => setNewConfigDraft({ ...newConfigDraft, size: e.target.value })}
                        className="w-full text-base font-sans focus:border-mauve"
                      >
                        <option value="s-1vcpu-1gb">1 vCPU / 1 GB</option>
                        <option value="s-1vcpu-2gb">1 vCPU / 2 GB</option>
                        <option value="s-2vcpu-2gb">2 vCPU / 2 GB</option>
                        <option value="s-2vcpu-4gb">2 vCPU / 4 GB</option>
                        <option value="s-4vcpu-8gb">4 vCPU / 8 GB</option>
                        <option value="s-8vcpu-16gb">8 vCPU / 16 GB</option>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-md font-medium text-subtext0 mb-1">Provision Script</label>
                    <div className="rounded-md overflow-hidden border border-surface1">
                      <MonacoEditor
                        height={`${Math.max(150, (newConfigDraft.provisionScript || "").split("\n").length * 20 + 20)}px`}
                        language="shell"
                        theme="catppuccin-mocha"
                        value={newConfigDraft.provisionScript}
                        onChange={(v) => setNewConfigDraft({ ...newConfigDraft, provisionScript: v ?? "" })}
                        beforeMount={handleEditorWillMount}
                        options={{
                          minimap: { enabled: false },
                          lineNumbers: "on",
                          scrollBeyondLastLine: false,
                          fontSize: 13,
                          wordWrap: "on",
                          automaticLayout: true,
                          padding: { top: 8, bottom: 8 },
                          renderLineHighlight: "gutter",
                          overviewRulerLanes: 0,
                          scrollbar: { verticalScrollbarSize: 6 },
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="default" size="sm" onClick={() => setAddingNewConfig(false)}>Cancel</Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!newConfigName.trim()}
                      onClick={() => {
                        saveBaseImageConfig(newConfigName.trim(), newConfigDraft);
                        setAddingNewConfig(false);
                        setNewConfigName("");
                      }}
                    >
                      Create
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SSH Key sub-tab ── */}
          {dropletsSubTab === "sshkey" && (
            <div className="flex-1 overflow-auto px-4 py-3">
              <div className="space-y-4">
                {/* Status */}
                <div className="bg-mantle rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Key size={16} className="text-mauve" />
                    <span className="text-base font-medium text-text">Genie SSH Key</span>
                  </div>
                  {sshKey.loading ? (
                    <p className="text-md text-overlay0">Loading key info...</p>
                  ) : sshKey.exists ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-green" />
                        <span className="text-md text-green">Key exists</span>
                      </div>

                      {/* Fingerprint */}
                      {sshKey.fingerprint && (
                        <div>
                          <label className="block text-md font-medium text-subtext0 mb-1">Fingerprint</label>
                          <div className="flex items-center gap-2">
                            <code className="text-md text-text font-mono bg-surface0 rounded px-2 py-1 select-all">
                              MD5:{sshKey.fingerprint}
                            </code>
                            <CopyButton text={`MD5:${sshKey.fingerprint}`} />
                          </div>
                        </div>
                      )}

                      {/* Public key */}
                      {sshKey.publicKey && (
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-md font-medium text-subtext0">Public Key</label>
                            <CopyButton text={sshKey.publicKey.trim()} />
                          </div>
                          <textarea
                            readOnly
                            value={sshKey.publicKey.trim()}
                            rows={3}
                            className="w-full bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-md text-text font-mono outline-none resize-none select-all"
                          />
                          <p className="text-md text-overlay0 mt-1">
                            Paste this key into your DigitalOcean account under Settings → Security → SSH Keys.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-yellow" />
                      <span className="text-md text-yellow">No key generated</span>
                    </div>
                  )}
                </div>

                {/* Regenerate */}
                <div className="bg-mantle rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={16} className="text-yellow" />
                    <span className="text-base font-medium text-text">Regenerate Key</span>
                  </div>
                  <p className="text-md text-overlay0 mb-3">
                    Regenerating the SSH key will replace the current key pair. Existing DigitalOcean SSH keys will
                    become orphaned and SSH access to current droplets may break. You will need to re-add the new
                    public key in DigitalOcean.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={sshKey.regenerating}
                    onClick={() => {
                      if (confirm("Are you sure you want to regenerate the SSH key? This will break SSH access to existing droplets until you update the key in DigitalOcean.")) {
                        regenerateSshKey();
                      }
                    }}
                  >
                    <RefreshCw size={14} className={cn("mr-1", sshKey.regenerating && "animate-spin")} />
                    {sshKey.regenerating ? "Regenerating..." : "Regenerate SSH Key"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === "backup" ? (
        /* ===== BACKUP TAB ===== */
        <BackupPanel backups={admin.backups} />
      ) : activeTab === "ai" ? (
        /* ===== AI TAB ===== */
        <AiCostsPanel aiState={aiState} />
      ) : activeTab === "users" ? (
        /* ===== USERS TAB ===== */
        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-2">
            {usersState.loading ? (
              <p className="text-subtext0">Loading users...</p>
            ) : usersState.list.length === 0 ? (
              <p className="text-subtext0">No users yet.</p>
            ) : (
              <table className="w-full text-md" onClick={() => setContextMenu(null)}>
                <thead>
                  <tr className="border-b border-surface0 text-subtext1 text-left">
                    <th className="py-2 px-3">Name</th>
                    <th className="py-2 px-3">Email</th>
                    <th className="py-2 px-3">Role</th>
                    <th className="py-2 px-3">Teams</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {usersState.list.filter((u: AdminUser) => !u.isAgent).map((u: AdminUser) => (
                    <tr key={u.id} className="border-b border-surface0/50 hover:bg-surface0/30 cursor-pointer" onClick={() => setEditingUser(u)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, user: u }); }}>
                      <td className="py-2 px-3 flex items-center gap-2">
                        {u.avatarUrl && <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
                        <span>{u.name}</span>
                      </td>
                      <td className="py-2 px-3 text-subtext0">{u.email}</td>
                      <td className="py-2 px-3">
                        {u.role === "superadmin" ? (
                          <span className="text-mauve inline-flex items-center gap-1"><Shield size={14} /> Super Admin</span>
                        ) : u.role === "admin" ? (
                          <span className="text-blue inline-flex items-center gap-1"><Shield size={14} /> Admin</span>
                        ) : (
                          <span className="text-subtext0">User</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {teamsState.members
                            .filter((m: AdminTeamMember) => m.userId === u.id)
                            .map((m: AdminTeamMember) => {
                              const team = teamsState.list.find((t: AdminTeam) => t.id === m.teamId);
                              const roleColor = m.role === "superadmin" ? "bg-mauve/20 text-mauve" : m.role === "owner" ? "bg-yellow/20 text-yellow" : "bg-surface1 text-subtext0";
                              return (
                                <span key={m.id} className={cn("px-2 py-0.5 rounded-full text-md", roleColor)}>
                                  {team?.name || "?"}{m.role !== "member" ? ` · ${m.role}` : ""}
                                </span>
                              );
                            })}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        {u.validated ? (
                          <span className="text-green inline-flex items-center gap-1"><Check size={14} /> Validated</span>
                        ) : (
                          <span className="text-yellow inline-flex items-center gap-1"><AlertTriangle size={14} /> Pending</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-subtext0">{new Date(u.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {contextMenu && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
                <div className="fixed z-50 bg-mantle border border-surface0 rounded-lg shadow-lg py-1 min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
                  <button
                    className="w-full text-left px-4 py-2 text-md hover:bg-surface0 text-text"
                    onClick={() => { validateUser(contextMenu.user.id, !contextMenu.user.validated); setContextMenu(null); }}
                  >
                    {contextMenu.user.validated ? "Revoke validation" : "Validate"}
                  </button>
                  <button
                    className="w-full text-left px-4 py-2 text-md hover:bg-surface0 text-red"
                    onClick={() => { if (confirm(`Delete user ${contextMenu.user.name}?`)) deleteUser(contextMenu.user.id); setContextMenu(null); }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : activeTab === "teams" ? (
        /* ===== TEAMS TAB ===== */
        <TeamsPanel teams={teamsState} users={usersState.list} />
      ) : activeTab === "audit" ? (
        /* ===== AUDIT TAB ===== */
        <AuditPanel audit={admin.audit} />
      ) : null}

      {/* User edit drawer */}
      {editingUser && (
        <UserDrawer
          user={editingUser}
          teams={teamsState.list}
          teamMembers={teamsState.members}
          onClose={() => setEditingUser(null)}
        />
      )}

      {/* Row drawer (database tab only) */}
      <AdminRowDrawer
        open={drawerOpen}
        mode={drawerMode}
        columns={columns}
        primaryKey={primaryKey}
        row={drawerRow}
        onSave={saveAdminRow}
        onClose={closeAdminRowDrawer}
      />

      {/* Drizzle Push floating window */}
      {drizzlePush.open && <DrizzlePushWindow output={drizzlePush.output} running={drizzlePush.running} onClose={closeDrizzlePush} />}

    </div>
  );
}

/* ===== AUDIT PANEL ===== */

function AuditPanel({ audit }: { audit: AdminState["audit"] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState("");

  const uniqueActions = [...new Set(audit.logs.map((l: AuditLogEntry) => l.action))].sort();

  const filteredLogs = filterAction
    ? audit.logs.filter((l: AuditLogEntry) => l.action === filterAction)
    : audit.logs;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-surface0 flex items-center gap-3">
        <Button size="sm" onClick={() => loadAuditLogs()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Refresh
        </Button>
        <select
          className="bg-surface0 text-text border border-surface1 rounded px-2 py-1 text-md"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
        >
          <option value="">All actions</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span className="text-md text-overlay0">{filteredLogs.length} entries</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-md">
          <thead className="sticky top-0 bg-mantle z-10">
            <tr className="text-left text-overlay0">
              <th className="px-4 py-2 font-medium w-44">Time</th>
              <th className="px-4 py-2 font-medium w-40">User</th>
              <th className="px-4 py-2 font-medium w-56">Action</th>
              <th className="px-4 py-2 font-medium">Payload</th>
            </tr>
          </thead>
          <tbody>
            {audit.loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-overlay0">Loading...</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-overlay0">No audit logs found</td></tr>
            ) : (
              filteredLogs.map((log: AuditLogEntry) => (
                <tr
                  key={log.id}
                  className="border-t border-surface0 hover:bg-surface0/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <td className="px-4 py-2 text-overlay1 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-text truncate">
                    {log.userName || log.userId?.slice(0, 8) || "-"}
                  </td>
                  <td className="px-4 py-2">
                    <span className="px-1.5 py-0.5 bg-surface1 rounded text-text font-mono">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-overlay0 truncate max-w-md">
                    {expandedId === log.id ? (
                      <pre className="whitespace-pre-wrap text-md text-overlay1 max-h-60 overflow-auto">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    ) : (
                      <span className="truncate block">
                        {log.payload ? JSON.stringify(log.payload).slice(0, 100) : "-"}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
