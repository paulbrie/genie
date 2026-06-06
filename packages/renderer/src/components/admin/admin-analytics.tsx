"use client";

import { useEffect } from "react";
import { useDeepSubject } from "subjecto/react";
import { RefreshCw, Users, LogIn, TerminalSquare, SendHorizonal, AppWindow } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { $admin } from "@/store/subjects";
import { loadAnalyticsSummary } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90] as const;

const BLUE = "#89b4fa";

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
};
const labelFor = (e: string) => EVENT_LABELS[e] ?? e;

export function AdminAnalytics() {
  const [analytics] = useDeepSubject($admin, "analytics");
  const { summary, days, loading } = analytics;

  useEffect(() => {
    loadAnalyticsSummary();
  }, []);

  const countOf = (event: string) => summary?.eventCounts.find((e) => e.event === event)?.count ?? 0;
  const hasData = !!summary && summary.eventCounts.length > 0;

  return (
    <div className="py-4 flex flex-col gap-4">
      {/* Range + refresh */}
      <div className="flex items-center gap-2">
        <span className="text-md text-overlay0">Last</span>
        {RANGES.map((d) => (
          <button
            key={d}
            onClick={() => loadAnalyticsSummary(d)}
            className={cn(
              "px-2.5 py-1 rounded text-md transition-colors",
              d === days ? "bg-blue/20 text-blue" : "bg-surface0 text-subtext0 hover:text-text",
            )}
          >
            {d}d
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" onClick={() => loadAnalyticsSummary()} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {!hasData ? (
        <div className="text-center text-overlay0 text-md py-16 border border-dashed border-surface0 rounded">
          {loading ? "Loading…" : "No analytics yet — events appear here as users use the app."}
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
        </>
      )}
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
