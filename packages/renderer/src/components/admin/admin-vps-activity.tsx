"use client";

import { useEffect, useMemo } from "react";
import { useDeepSubject, useSubject } from "subjecto/react";
import { RefreshCw, Users, Activity, MousePointerClick, TerminalSquare, Eye } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { $admin, $projects } from "@/store/subjects";
import type { VpsActivitySummary } from "@/store/types/admin";
import { loadVpsActivitySummary } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { cn } from "@/lib/utils";

const RANGES = [1, 7, 30, 90] as const;
const BLUE = "#89b4fa";

const EVENT_LABELS: Record<string, string> = {
  "page.view": "Page view",
  action: "Action",
  "terminal.attach": "Terminal attach",
  "terminal.detach": "Terminal detach",
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.failed": "Failed login",
};
const labelFor = (e: string) => EVENT_LABELS[e] ?? e;

/** 0 → "0m", 540 → "9m", 5400 → "1h 30m". */
function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** One-line description of an event's props for the recent list. */
function describe(e: VpsActivitySummary["recent"][number]): string {
  const p = e.props as Record<string, string | number | boolean | null | undefined>;
  switch (e.event) {
    case "page.view": return String(p.path ?? "");
    case "action": return `${p.name ?? ""}${p.ok === false ? " (failed)" : ""}`;
    case "terminal.attach": return String(p.terminal ?? "");
    case "terminal.detach": return `${p.terminal ?? ""}${typeof p.seconds === "number" ? ` · ${duration(p.seconds)}` : ""}`;
    case "auth.failed": return String(p.reason ?? "");
    default: return "";
  }
}

/** genie-local user activity (page views, actions, terminals, logins) shipped
 *  by each genie-local server's genie-stats daemon. Superadmin-only; shown in
 *  the Analytics tab next to the product analytics. */
export function AdminVpsActivity() {
  const [state] = useDeepSubject($admin, "vpsActivity");
  const [projects] = useSubject($projects);
  const { summary, days, loading, error, filterProjectId, filterInstanceId } = state;

  useEffect(() => {
    loadVpsActivitySummary();
  }, []);

  const projectOptions = useMemo(
    () => [{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    [projects],
  );
  const instanceOptions = useMemo(() => {
    const p = projects.find((x) => x.id === filterProjectId);
    return [{ value: "", label: "All servers" }, ...(p?.vpsInstances ?? []).map((v) => ({ value: v.id, label: v.label || v.id }))];
  }, [projects, filterProjectId]);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const hasData = !!summary && summary.totals.events > 0;
  const isFiltered = !!filterProjectId || !!filterInstanceId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-md text-overlay0">Last</span>
        {RANGES.map((d) => (
          <button
            key={d}
            onClick={() => loadVpsActivitySummary({ days: d })}
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
            value={filterProjectId ?? ""}
            options={projectOptions}
            onChange={(v) => loadVpsActivitySummary({ projectId: v || null })}
            placeholder="All projects"
          />
        </div>
        {filterProjectId && (
          <div className="w-44">
            <FilterableSelect
              value={filterInstanceId ?? ""}
              options={instanceOptions}
              onChange={(v) => loadVpsActivitySummary({ instanceId: v || null })}
              placeholder="All servers"
            />
          </div>
        )}
        {isFiltered && (
          <Button size="sm" variant="ghost" onClick={() => loadVpsActivitySummary({ projectId: null, instanceId: null })}>
            Clear
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={() => loadVpsActivitySummary()} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error ? (
        <div className="text-md text-red border border-red/30 bg-red/5 rounded px-3 py-2">Could not load activity: {error}</div>
      ) : !hasData ? (
        <div className="text-center text-overlay0 text-md py-16 border border-dashed border-surface0 rounded">
          {loading
            ? "Loading…"
            : isFiltered
              ? "No genie-local activity matches this filter in the selected range."
              : "No genie-local activity yet. Servers running genie-local ship it through their genie-stats daemon."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi icon={<Activity size={15} />} label="Active now (15 min)" value={summary!.totals.activeSessions15m.toLocaleString()} />
            <Kpi icon={<Users size={15} />} label="Active today" value={summary!.totals.activeSessionsToday.toLocaleString()} />
            <Kpi icon={<Eye size={15} />} label="Events" value={summary!.totals.events.toLocaleString()} />
            <Kpi icon={<MousePointerClick size={15} />} label="Sessions in range" value={summary!.totals.sessions.toLocaleString()} />
            <Kpi icon={<TerminalSquare size={15} />} label="Terminal time" value={duration(summary!.totals.terminalSeconds)} />
          </div>

          <Card title="Servers">
            <div className="overflow-x-auto">
              <table className="w-full text-md">
                <thead>
                  <tr className="text-overlay0 text-left">
                    <th className="font-medium py-1.5 pr-3">Project · server</th>
                    <th className="font-medium py-1.5 px-3 text-right">Active (15 min)</th>
                    <th className="font-medium py-1.5 px-3 text-right">Active today</th>
                    <th className="font-medium py-1.5 px-3 text-right">Sessions</th>
                    <th className="font-medium py-1.5 px-3 text-right">Events</th>
                    <th className="font-medium py-1.5 px-3 text-right">Terminal time</th>
                    <th className="font-medium py-1.5 pl-3 text-right">Last event</th>
                  </tr>
                </thead>
                <tbody>
                  {summary!.instances.map((i) => (
                    <tr
                      key={`${i.projectId}:${i.instanceId}`}
                      className="border-t border-surface0/40 hover:bg-surface0/30 cursor-pointer"
                      onClick={() => loadVpsActivitySummary({ projectId: i.projectId, instanceId: i.instanceId })}
                      title="Show only this server"
                    >
                      <td className="py-1.5 pr-3 text-text truncate max-w-[280px]">
                        {i.projectName} <span className="text-overlay0">· {i.instanceLabel ?? i.instanceId.slice(0, 8)}</span>
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-subtext0">{i.activeSessions15m}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-subtext0">{i.activeSessionsToday}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-subtext0">{i.sessions}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-subtext0">{i.events.toLocaleString()}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-subtext0">{duration(i.terminalSeconds)}</td>
                      <td className="py-1.5 pl-3 text-right text-overlay0">{ago(i.lastEventAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Events per day">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary!.daily} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vpsActivityDaily" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BLUE} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#313244" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#7f849c", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fill: "#7f849c", fontSize: 11 }} width={44} />
                  <Tooltip
                    contentStyle={{ background: "#181825", border: "1px solid #313244", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#cdd6f4" }}
                  />
                  <Area type="monotone" dataKey="events" name="Events" stroke={BLUE} fill="url(#vpsActivityDaily)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Top pages">
              <Bars rows={summary!.topPages.map((p) => ({ key: p.path, label: p.path, value: p.count, note: `${p.sessions} session${p.sessions === 1 ? "" : "s"}` }))} empty="No page views in range." />
            </Card>
            <Card title="Top actions">
              <Bars rows={summary!.topActions.map((a) => ({ key: a.name, label: a.name, value: a.count, note: a.failed > 0 ? `${a.failed} failed` : undefined }))} empty="No actions in range." />
            </Card>
            <Card title="Terminal time">
              <Bars rows={summary!.terminals.map((t) => ({ key: t.terminal, label: t.terminal, value: t.seconds, display: duration(t.seconds), note: `${t.attaches} attach${t.attaches === 1 ? "" : "es"}` }))} empty="No terminal use in range." />
            </Card>
            <Card title="Events by type">
              <Bars rows={summary!.eventCounts.map((e) => ({ key: e.event, label: labelFor(e.event), value: e.count }))} empty="No events." />
            </Card>
          </div>

          <Card title="Recent events">
            <div className="overflow-x-auto">
              <table className="w-full text-md">
                <tbody>
                  {summary!.recent.map((e) => (
                    <tr key={e.id} className="border-t border-surface0/40 first:border-0">
                      <td className="py-1 pr-3 text-overlay0 whitespace-nowrap" title={new Date(e.occurredAt).toLocaleString()}>{ago(e.occurredAt)}</td>
                      <td className="py-1 px-3 text-subtext0 whitespace-nowrap">{labelFor(e.event)}</td>
                      <td className="py-1 px-3 text-text truncate max-w-[320px]">{describe(e)}</td>
                      <td className="py-1 px-3 text-overlay0 truncate max-w-[200px]">{projectName.get(e.projectId) ?? e.projectId.slice(0, 8)}</td>
                      <td className="py-1 px-3 text-overlay0 font-mono text-xs">{e.sessionId ? e.sessionId.slice(0, 8) : "anonymous"}</td>
                      <td className="py-1 pl-3 text-overlay0 truncate max-w-[160px]">{e.ua ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-mantle border border-surface0 rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-overlay0 text-md">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-xl font-semibold text-text tabular-nums">{value}</div>
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

function Bars({ rows, empty }: { rows: { key: string; label: string; value: number; display?: string; note?: string }[]; empty: string }) {
  if (rows.length === 0) return <span className="text-md text-overlay0">{empty}</span>;
  const top = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.slice(0, 12).map((r) => (
        <div key={r.key} className="flex items-center gap-3" title={r.note ? `${r.label} · ${r.note}` : r.label}>
          <span className="w-48 text-md text-subtext0 truncate">{r.label}</span>
          <div className="flex-1 h-4 bg-surface0/40 rounded overflow-hidden">
            <div className="h-full bg-blue/40" style={{ width: `${Math.round((r.value / top) * 100)}%` }} />
          </div>
          <span className="w-16 text-right text-md text-subtext0 tabular-nums">{r.display ?? r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
