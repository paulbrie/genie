"use client";

import { useEffect, useMemo } from "react";
import { useDeepSubject, useSubject } from "subjecto/react";
import { RefreshCw, Users, LogIn, TerminalSquare, SendHorizonal, AppWindow } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Legend, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { $admin, $projects } from "@/store/subjects";
import type { AnalyticsSummary } from "@/store/types/admin";
import { loadAnalyticsSummary, loadAdminUsers } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90] as const;

const BLUE = "#89b4fa";
const MAUVE = "#cba6f7";

/** Friendly labels for the event keys we emit; unknown keys fall back to raw. */
const EVENT_LABELS: Record<string, string> = {
  "auth.login": "Logins (sessions)",
  "app.focus": "Tab focused",
  "app.blur": "Tab blurred",
  "nav.view": "Nav views",
  "manager.open": "Manage popup opened",
  "terminal.open": "Terminal opened",
  "terminal.command_sent": "Terminal command sent",
  "project.created": "Project created",
  "project.removed": "Project removed",
  "vps.deploy": "Server deploy / connect",
  "recipe.run": "Recipe installed",
  "assistant.message": "Genie assistant message",
  "chat.message": "Team chat message",
  "tracker.issue_created": "Tracker issue created",
  "agent.run": "Agent run",
  "doc.created": "Doc created",
  "tab.view": "Tab views",
};
const labelFor = (e: string) => EVENT_LABELS[e] ?? e;

/** Friendly labels for tab-access keys: bare nav keys, plus namespaced
 *  `admin:*` / `manage:*` sub-tab keys. */
const NAV_LABELS: Record<string, string> = {
  projects: "Projects", agents: "Agents", clouds: "Clouds", processes: "Processes",
  docker: "Docker", docs: "Docs", logs: "Logs", chat: "Team chat", history: "History",
  tracker: "Tracker", settings: "Settings", admin: "Admin", architecture: "Architecture",
  topology: "Topology", users: "Connected Users", security: "Security", help: "Help",
  recipes: "Recipes", apps: "Apps", terminal: "Terminal", ssh: "SSH", tazcloud: "TazCloud",
};
const ADMIN_TAB_LABELS: Record<string, string> = {
  database: "Database", backup: "Backup", droplets: "DO Build", ai: "AI", users: "Users",
  teams: "Teams", orgs: "Orgs", communication: "Communication", analytics: "Analytics",
  audit: "Audit", prodlogs: "Prod Logs",
};
const MANAGE_TAB_LABELS: Record<string, string> = {
  manage: "Manage", ssh: "SSH", firewall: "Firewall", ports: "Ports", processes: "Processes",
  sessions: "Sessions", "claude-logs": "Claude Logs", "claude-memory": "Claude Memory",
  files: "Files", db: "DB", commands: "Commands",
};
function tabLabel(key: string): string {
  if (key.startsWith("admin:")) { const k = key.slice(6); return `Admin · ${ADMIN_TAB_LABELS[k] ?? k}`; }
  if (key.startsWith("manage:")) { const k = key.slice(7); return `Manage · ${MANAGE_TAB_LABELS[k] ?? k}`; }
  return NAV_LABELS[key] ?? key;
}

export function AdminAnalytics() {
  const [analytics] = useDeepSubject($admin, "analytics");
  const [usersSlice] = useDeepSubject($admin, "users");
  const [projects] = useSubject($projects);
  const { summary, days, loading, filterUserId, filterProjectId } = analytics;

  useEffect(() => {
    loadAnalyticsSummary();
    if (usersSlice.list.length === 0) loadAdminUsers();
  }, []);

  const userOptions = useMemo(
    () => [
      { value: "", label: "All users" },
      ...usersSlice.list
        .filter((u) => !u.isAgent)
        .map((u) => ({ value: u.id, label: u.name || u.email || u.id })),
    ],
    [usersSlice.list],
  );
  const projectOptions = useMemo(
    () => [{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    [projects],
  );

  const countOf = (event: string) => summary?.eventCounts.find((e) => e.event === event)?.count ?? 0;
  const hasData = !!summary && summary.eventCounts.length > 0;
  const isFiltered = !!filterUserId || !!filterProjectId;

  return (
    <div className="flex flex-col gap-4">
      {/* Range + filters + refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-md text-overlay0">Last</span>
        {RANGES.map((d) => (
          <button
            key={d}
            onClick={() => loadAnalyticsSummary({ days: d })}
            className={cn(
              "px-2.5 py-1 rounded text-md transition-colors",
              d === days ? "bg-blue/20 text-blue" : "bg-surface0 text-subtext0 hover:text-text",
            )}
          >
            {d}d
          </button>
        ))}
        <div className="w-px h-5 bg-surface0 mx-1" />
        <div className="w-48">
          <FilterableSelect
            value={filterUserId ?? ""}
            options={userOptions}
            onChange={(v) => loadAnalyticsSummary({ userId: v || null })}
            placeholder="All users"
          />
        </div>
        <div className="w-48">
          <FilterableSelect
            value={filterProjectId ?? ""}
            options={projectOptions}
            onChange={(v) => loadAnalyticsSummary({ projectId: v || null })}
            placeholder="All projects"
          />
        </div>
        {isFiltered && (
          <Button size="sm" variant="ghost" onClick={() => loadAnalyticsSummary({ userId: null, projectId: null })}>
            Clear
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={() => loadAnalyticsSummary()} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {!hasData ? (
        <div className="text-center text-overlay0 text-md py-16 border border-dashed border-surface0 rounded">
          {loading
            ? "Loading…"
            : isFiltered
              ? "No events match this filter in the selected range."
              : "No analytics yet — events appear here as users use the app."}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi icon={<Users size={15} />} label="Active users" value={summary!.activeUsers} />
            <Kpi icon={<LogIn size={15} />} label="Logins" value={countOf("auth.login")} />
            <Kpi icon={<TerminalSquare size={15} />} label="Terminals opened" value={countOf("terminal.open")} />
            <Kpi icon={<SendHorizonal size={15} />} label="Commands sent" value={countOf("terminal.command_sent")} />
            <Kpi icon={<AppWindow size={15} />} label="Manage opened" value={countOf("manager.open")} />
          </div>

          {/* Daily active users */}
          <Card title="Daily active users">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary!.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dau" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BLUE} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#313244" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#7f849c", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fill: "#7f849c", fontSize: 11 }} width={32} />
                  <Tooltip
                    contentStyle={{ background: "#181825", border: "1px solid #313244", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#cdd6f4" }}
                  />
                  <Area type="monotone" dataKey="users" name="Active users" stroke={BLUE} fill="url(#dau)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Onboarding funnel */}
          <Card title="Activation funnel">
            <Funnel
              steps={[
                { label: "Logged in", n: summary!.funnel.loggedIn },
                { label: "Opened a terminal", n: summary!.funnel.openedTerminal },
                { label: "Sent a command", n: summary!.funnel.sentCommand },
              ]}
            />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top events */}
            <Card title="Events by type">
              <EventBars events={summary!.eventCounts} />
            </Card>

            {/* Top users */}
            <Card title="Most active users">
              <div className="flex flex-col">
                {summary!.topUsers.length === 0 ? (
                  <span className="text-md text-overlay0 py-2">No user activity in range.</span>
                ) : (
                  summary!.topUsers.map((u, i) => (
                    <div key={u.userId || i} className="flex items-center gap-2 py-1.5 border-b border-surface0/40 last:border-0">
                      <span className="text-overlay0 text-md w-5 tabular-nums">{i + 1}</span>
                      <span className="flex-1 truncate text-text">{u.name}</span>
                      <span className="text-subtext0 tabular-nums">{u.count.toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          {/* Commands sent by user (Claude vs normal terminal) */}
          {summary!.commandsByUser.length > 0 && (
            <Card title="Commands sent by user">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary!.commandsByUser} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#313244" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#7f849c", fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={64} />
                    <YAxis allowDecimals={false} tick={{ fill: "#7f849c", fontSize: 11 }} width={32} />
                    <Tooltip
                      contentStyle={{ background: "#181825", border: "1px solid #313244", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#cdd6f4" }}
                      cursor={{ fill: "#313244", opacity: 0.3 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="claude" name="Claude" stackId="c" fill={MAUVE} />
                    <Bar dataKey="terminal" name="Terminal" stackId="c" fill={BLUE} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Tabs accessed by user */}
          {summary!.tabAccess.rows.length > 0 && (
            <Card title="Tabs accessed by user">
              <TabHeatmap tabAccess={summary!.tabAccess} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** users×tabs grid: cell background opacity scales with the view count. */
function TabHeatmap({ tabAccess }: { tabAccess: AnalyticsSummary["tabAccess"] }) {
  const { columns, rows } = tabAccess;
  const max = Math.max(1, ...rows.flatMap((r) => columns.map((c) => r.counts[c] ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-md">
        <thead>
          <tr>
            <th className="sticky left-0 bg-mantle z-10 text-left font-medium text-overlay0 px-2 py-1.5">User</th>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1.5 text-overlay0 font-medium whitespace-nowrap">
                <span className="block max-w-[120px] truncate" title={tabLabel(c)}>{tabLabel(c)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.userId || i} className="border-t border-surface0/40">
              <td className="sticky left-0 bg-mantle z-10 px-2 py-1.5 text-text max-w-[160px] truncate" title={r.name}>{r.name}</td>
              {columns.map((c) => {
                const n = r.counts[c] ?? 0;
                const opacity = n > 0 ? 0.12 + 0.6 * (n / max) : 0;
                return (
                  <td
                    key={c}
                    className="px-2 py-1.5 text-center tabular-nums"
                    style={{ background: n > 0 ? `rgba(137, 180, 250, ${opacity.toFixed(3)})` : undefined, color: n > 0 ? "#cdd6f4" : "#45475a" }}
                  >
                    {n > 0 ? n.toLocaleString() : "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-mantle border border-surface0 rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-overlay0 text-md">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-xl font-semibold text-text tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-mantle border border-surface0 rounded-lg p-3">
      <h3 className="text-md font-medium text-subtext1 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; n: number }[] }) {
  const top = Math.max(1, steps[0]?.n ?? 1);
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const pct = Math.round((s.n / top) * 100);
        const conv = i === 0 ? 100 : Math.round((s.n / Math.max(1, steps[i - 1].n)) * 100);
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-40 text-md text-subtext0 truncate">{s.label}</span>
            <div className="flex-1 h-6 bg-surface0/40 rounded overflow-hidden">
              <div className="h-full bg-blue/30 flex items-center px-2" style={{ width: `${pct}%`, minWidth: 40 }}>
                <span className="text-xs text-text tabular-nums">{s.n.toLocaleString()}</span>
              </div>
            </div>
            <span className="w-12 text-right text-xs text-overlay0 tabular-nums">{i === 0 ? "" : `${conv}%`}</span>
          </div>
        );
      })}
    </div>
  );
}

function EventBars({ events }: { events: { event: string; count: number }[] }) {
  const top = Math.max(1, ...events.map((e) => e.count));
  return (
    <div className="flex flex-col gap-1.5">
      {events.slice(0, 12).map((e) => (
        <div key={e.event} className="flex items-center gap-3">
          <span className="w-44 text-md text-subtext0 truncate" title={e.event}>{labelFor(e.event)}</span>
          <div className="flex-1 h-4 bg-surface0/40 rounded overflow-hidden">
            <div className="h-full bg-mauve/40" style={{ width: `${Math.round((e.count / top) * 100)}%` }} />
          </div>
          <span className="w-14 text-right text-md text-subtext0 tabular-nums">{e.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
