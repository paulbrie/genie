"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { AlertTriangle, ArrowDown, ArrowUp, Gauge, Pencil, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { $admin, $auth, $projects } from "@/store/subjects";
import { loadAdminTazcloudStats, loadAdminTazVms, loadTazCapacity, loadTazProjects, saveTazCapacity } from "@/store/actions";
import { useDeepSubjectAll } from "@/lib/hooks";
import type { VpsMonitorState } from "@/store/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  distribution, formatResource, GROUP_BY_LABEL, RESOURCE_LABEL, RESOURCES, resourceVmsOf, STATUS_LABEL, summarize, topGroups,
  type GroupBy, type Level, type ResourceKey, type ResourceRow, type ResourceVm, type StatusGroup, type TazCapacity,
} from "@/lib/taz-resources";

/** Catppuccin Mocha, as the rest of genie: readable on its dark base, and told apart by more than hue in the tooltip */
const GROUP_COLORS = ["#89b4fa", "#cba6f7", "#a6e3a1", "#fab387", "#94e2d5", "#f5c2e7", "#b4befe", "#89dceb"];
const FREE_COLOR = "#45475a";
const LEVEL_STYLE: Record<Level, { bar: string; text: string; label: string }> = {
  ok: { bar: "bg-green", text: "text-green", label: "OK" },
  warn: { bar: "bg-yellow", text: "text-yellow", label: "Nearly full" },
  critical: { bar: "bg-red", text: "text-red", label: "Full" },
};
const STATUS_STYLE: Record<StatusGroup, string> = {
  running: "text-green", stopped: "text-overlay1", provisioning: "text-blue", error: "text-red", other: "text-subtext0",
};
/** groups shown by name in the distribution; the rest summed */
const MAX_GROUPS = 7;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-surface0 bg-mantle p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** a headline meter: allocated of capacity, free, and the level in words as well as colour */
function Meter({ k, total }: { k: ResourceKey; total: ReturnType<typeof summarize>["totals"][ResourceKey] }) {
  const style = LEVEL_STYLE[total.level];
  const width = Math.min(100, total.pct);
  return (
    <div className="rounded-xl border border-surface0 bg-mantle p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-subtext0">{RESOURCE_LABEL[k]}</span>
        <span className={cn("text-xs font-semibold", style.text)}>{total.pct > 100 ? "Over capacity" : style.label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("text-3xl font-bold tabular-nums", style.text)}>{total.pct}%</span>
        <span className="text-sm text-subtext0">allocated</span>
      </div>
      <div
        role="meter"
        aria-label={`${RESOURCE_LABEL[k]} allocated`}
        aria-valuemin={0}
        aria-valuemax={total.capacity}
        aria-valuenow={Math.min(total.allocated, total.capacity)}
        aria-valuetext={`${formatResource(k, total.allocated)} of ${formatResource(k, total.capacity)} (${total.pct}%)`}
        className="relative mt-3 h-3 overflow-hidden rounded-full bg-surface0"
      >
        <div className={cn("h-full rounded-full transition-[width]", style.bar)} style={{ width: `${width}%` }} />
        {/* (where amber and red start) */}
        <span className="absolute inset-y-0 left-[80%] w-px bg-base/70" aria-hidden />
        <span className="absolute inset-y-0 left-[90%] w-px bg-base/70" aria-hidden />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-overlay1">Allocated</dt><dd className="font-semibold tabular-nums text-text">{formatResource(k, total.allocated)}</dd></div>
        <div><dt className="text-overlay1">Capacity</dt><dd className="font-semibold tabular-nums text-text">{formatResource(k, total.capacity)}</dd></div>
        <div><dt className="text-overlay1">Free</dt><dd className="font-semibold tabular-nums text-text">{formatResource(k, total.free)}</dd></div>
      </dl>
    </div>
  );
}

/** the capacity's three totals, editable by a superadmin */
function CapacityForm({ capacity, onDone }: { capacity: TazCapacity; onDone: () => void }) {
  const [draft, setDraft] = useState({ vcpu: String(capacity.vcpu), ramGb: String(capacity.ramGb), diskGb: String(capacity.diskGb) });
  const valid = RESOURCES.every(k => Number(draft[k]) > 0);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={e => {
        e.preventDefault();
        if (!valid) return;
        saveTazCapacity({ ...capacity, vcpu: Number(draft.vcpu), ramGb: Number(draft.ramGb), diskGb: Number(draft.diskGb) });
        onDone();
      }}
    >
      {RESOURCES.map(k => (
        <label key={k} className="flex flex-col gap-1 text-xs text-subtext0">
          {k === "vcpu" ? "vCPU" : `${RESOURCE_LABEL[k]} (GB)`}
          <input
            type="number" min={1} step="any" required value={draft[k]}
            onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
            className="h-8 w-28 rounded-md border border-surface1 bg-base px-2 text-sm text-text outline-none focus:border-blue"
          />
        </label>
      ))}
      <Button type="submit" size="sm" disabled={!valid}>Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}

type SortKey = "name" | "project" | "size" | "vcpu" | "ramGb" | "diskGb" | "status" | "use";

function sortValue(r: ResourceRow, k: SortKey): string | number {
  switch (k) {
    case "name": return r.name.toLowerCase();
    case "project": return (r.projectName ?? "~").toLowerCase();
    case "size": return r.spec?.vcpu ?? -1;
    case "status": return r.group;
    case "use": return r.use ? r.use.cpu + r.use.ram : -1;
    default: return r.spec?.[k] ?? -1;
  }
}

/**
 * /clouds/taz/resources (T240): the Taz Cloud's capacity, what its VMs are allocated (headline meters, amber from 80 %,
 * red from 90 %), how that is distributed (by project, team, Taz project or status), how many more VMs of each size
 * fit, and every VM in a table that sorts and filters, with its live use where its stats are known.
 */
export function TazResources({ monitor }: { monitor?: VpsMonitorState }) {
  const admin = useDeepSubjectAll($admin);
  const [auth] = useSubject($auth);
  const [projects] = useSubject($projects);
  const taz = admin.tazcloud;
  const superadmin = auth.user?.role === "superadmin";
  const [groupBy, setGroupBy] = useState<GroupBy>("project");
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusGroup | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "vcpu", desc: true });

  useEffect(() => {
    loadTazCapacity();
    loadTazProjects();
    if (!taz.vms.length) loadAdminTazVms();
    loadAdminTazcloudStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vms: ResourceVm[] = useMemo(
    () => resourceVmsOf({ vms: taz.vms, projects, tazProjects: taz.projects, history: monitor?.history, vmStats: taz.vmStats }),
    [taz.vms, taz.vmStats, taz.projects, projects, monitor]
  );

  const capacity = taz.capacity;
  const summary = useMemo(() => (capacity ? summarize(vms, capacity) : null), [vms, capacity]);
  const groups = useMemo(() => (summary ? topGroups(distribution(summary.rows, groupBy), MAX_GROUPS) : []), [summary, groupBy]);

  const chartData = useMemo(() => {
    if (!summary || !capacity) return [];
    return RESOURCES.map(k => {
      const row: Record<string, number | string> = { resource: RESOURCE_LABEL[k] };
      // (data keys g0, g1…: a group's own key may be "" or hold dots, which recharts reads as a path)
      groups.forEach((g, i) => { row[`g${i}`] = Math.round((g[k] / capacity[k]) * 1000) / 10; });
      row.__free = Math.round((summary.totals[k].free / capacity[k]) * 1000) / 10;
      return row;
    });
  }, [summary, groups, capacity]);

  const rows = useMemo(() => {
    if (!summary) return [];
    const q = filter.trim().toLowerCase();
    const list = summary.rows.filter(r =>
      (statusFilter === "all" || r.group === statusFilter) &&
      (!q || [r.name, r.projectName, r.teamName, r.tazProjectName, r.size].some(v => v?.toLowerCase().includes(q)))
    );
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [summary, filter, statusFilter, sort]);

  const loading = !capacity || (taz.loading && !taz.vms.length);
  const refresh = () => { loadAdminTazVms(); loadAdminTazcloudStats(); loadTazCapacity(); };

  const header = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text"><Gauge className="size-5 text-blue" aria-hidden /> Taz Cloud resources</h2>
        {capacity && !editing && (
          <p className="mt-0.5 text-sm text-subtext0">
            Capacity {formatResource("vcpu", capacity.vcpu)} · {formatResource("ramGb", capacity.ramGb)} RAM · {formatResource("diskGb", capacity.diskGb)} SSD
            {superadmin && (
              <button type="button" onClick={() => setEditing(true)} className="ml-2 inline-flex items-center gap-1 text-blue hover:underline">
                <Pencil className="size-3" aria-hidden /> Edit
              </button>
            )}
          </p>
        )}
        {capacity && editing && <div className="mt-2"><CapacityForm capacity={capacity} onDone={() => setEditing(false)} /></div>}
        {taz.capacityError && <p className="mt-1 text-sm text-red" role="alert">{taz.capacityError}</p>}
      </div>
      <Button size="sm" variant="ghost" onClick={refresh} disabled={taz.loading}>
        <RefreshCw className={cn("size-4", taz.loading && "animate-spin")} aria-hidden /> Refresh
      </Button>
    </div>
  );

  if (taz.error) {
    return <div className="py-2">{header}<p className="rounded-lg border border-red/40 bg-red/10 p-3 text-sm text-red" role="alert">{taz.error}</p></div>;
  }
  if (loading || !summary || !capacity) {
    return (
      <div className="py-2" aria-busy="true">
        {header}
        <div className="grid gap-3 md:grid-cols-3">{RESOURCES.map(k => <div key={k} className="h-36 animate-pulse rounded-xl bg-surface0/60" />)}</div>
        <div className="mt-3 h-56 animate-pulse rounded-xl bg-surface0/40" />
      </div>
    );
  }

  const th = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th scope="col" className={cn("px-2 py-2 font-medium", align === "right" && "text-right")} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== "name" && key !== "project" }))}>
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-4 py-2">
      {header}

      <div className="grid gap-3 md:grid-cols-3">
        {RESOURCES.map(k => <Meter key={k} k={k} total={summary.totals[k]} />)}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-subtext0">
        <span><strong className="text-text">{summary.rows.length}</strong> VMs:</span>
        {(Object.keys(summary.byStatus) as StatusGroup[]).filter(s => summary.byStatus[s]).map(s => (
          <span key={s} className={STATUS_STYLE[s]}>{summary.byStatus[s]} {STATUS_LABEL[s].toLowerCase()}</span>
        ))}
        {summary.unsized.length > 0 && (
          <span className="inline-flex items-center gap-1 text-yellow">
            <AlertTriangle className="size-3.5" aria-hidden /> {summary.unsized.length} of unknown size, not counted
          </span>
        )}
      </div>

      {summary.rows.length === 0 ? (
        <Section title="No VMs yet">
          <p className="text-sm text-subtext0">The whole capacity is free. VMs created on the VMs tab show up here with what they take.</p>
        </Section>
      ) : (
        <>
          <Section
            title="Who uses what"
            aside={
              <div role="radiogroup" aria-label="Group by" className="flex rounded-lg border border-surface0 p-0.5 text-xs">
                {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map(g => (
                  <button key={g} type="button" role="radio" aria-checked={groupBy === g} onClick={() => setGroupBy(g)}
                    className={cn("rounded-md px-2.5 py-1", groupBy === g ? "bg-surface1 text-text" : "text-subtext0 hover:text-text")}>
                    {GROUP_BY_LABEL[g]}
                  </button>
                ))}
              </div>
            }
          >
            <div className="h-44" aria-label={`Share of capacity by ${GROUP_BY_LABEL[groupBy].toLowerCase()}`} role="img">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barCategoryGap={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#313244" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fill: "#7f849c", fontSize: 11 }} />
                  <YAxis type="category" dataKey="resource" tick={{ fill: "#cdd6f4", fontSize: 12 }} width={44} />
                  <Tooltip
                    contentStyle={{ background: "#181825", border: "1px solid #313244", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#cdd6f4" }}
                    cursor={{ fill: "#313244", opacity: 0.3 }}
                    formatter={(value: number, name: string) => [`${value}%`, name]}
                  />
                  {/* (allocation past the capacity: where 100 % is) */}
                  {RESOURCES.some(k => summary.totals[k].pct > 100) && (
                    <ReferenceLine x={100} stroke="#f38ba8" strokeDasharray="4 3" label={{ value: "capacity", fill: "#f38ba8", fontSize: 11, position: "top" }} />
                  )}
                  {groups.map((g, i) => <Bar key={g.key} dataKey={`g${i}`} name={g.label} stackId="s" fill={GROUP_COLORS[i % GROUP_COLORS.length]} isAnimationActive={false} />)}
                  <Bar dataKey="__free" name="Free" stackId="s" fill={FREE_COLOR} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3" aria-label="Legend">
              {groups.map((g, i) => (
                <li key={g.key} className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }} aria-hidden />
                  <span className="truncate text-text">{g.label}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-subtext0">{g.vms} VM{g.vms === 1 ? "" : "s"} · {g.vcpu} vCPU · {g.ramGb} GB · {formatResource("diskGb", g.diskGb)}</span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: FREE_COLOR }} aria-hidden />
                <span className="text-text">Free</span>
              </li>
            </ul>
          </Section>

          <Section title="Room for more">
            <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {summary.headroom.map(h => (
                <li key={h.size} className="rounded-lg border border-surface0 bg-base px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-text">{h.size}</span>
                    <span className={cn("text-2xl font-bold tabular-nums", h.fits === 0 ? "text-red" : "text-text")}>{h.fits}</span>
                  </div>
                  <div className="text-xs text-subtext0">
                    {h.spec.vcpu} vCPU · {h.spec.ramGb} GB · {h.spec.diskGb} GB{h.spec.assumed ? "*" : ""}
                  </div>
                  <div className="text-xs text-overlay1">{h.fits === 0 ? "no room" : "more fit"}, {RESOURCE_LABEL[h.limitedBy]} runs out first</div>
                </li>
              ))}
            </ul>
            {summary.headroom.some(h => h.spec.assumed) && (
              <p className="mt-2 text-xs text-overlay1">* assumed: a fresh 2xlarge&apos;s disk hasn&apos;t been seen yet.</p>
            )}
          </Section>

          <Section
            title="VMs"
            aside={
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="taz-res-filter">Filter VMs</label>
                <input id="taz-res-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name, project, team, size…"
                  className="h-8 w-56 rounded-md border border-surface1 bg-base px-2 text-sm text-text outline-none placeholder:text-overlay0 focus:border-blue" />
                <label className="sr-only" htmlFor="taz-res-status">Status</label>
                <select id="taz-res-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusGroup | "all")}
                  className="h-8 rounded-md border border-surface1 bg-base px-2 text-sm text-text">
                  <option value="all">All statuses</option>
                  {(Object.keys(STATUS_LABEL) as StatusGroup[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
            }
          >
            <p className="mb-2 text-xs text-overlay1">
              Live use from the VMs&apos; stats ({summary.withLive} of {summary.rows.length} known). A running VM using under 10% of its CPU and 25% of its RAM is marked over-provisioned.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-surface0 text-left text-xs text-subtext0">
                  <tr>
                    {th("name", "VM")}
                    {th("project", "Project")}
                    <th scope="col" className="px-2 py-2 font-medium">Team</th>
                    {th("size", "Size")}
                    {th("vcpu", "vCPU", "right")}
                    {th("ramGb", "RAM", "right")}
                    {th("diskGb", "Disk", "right")}
                    {th("status", "Status")}
                    {th("use", "Live use")}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-surface0/60 last:border-0">
                      <td className="max-w-[14rem] truncate px-2 py-1.5 font-medium text-text" title={r.name}>{r.name}</td>
                      <td className="max-w-[12rem] truncate px-2 py-1.5 text-subtext0">{r.projectName ?? <span className="text-overlay0">—</span>}</td>
                      <td className="max-w-[10rem] truncate px-2 py-1.5 text-subtext0">{r.teamName ?? <span className="text-overlay0">—</span>}</td>
                      <td className="px-2 py-1.5 text-subtext0">
                        {r.spec ? (
                          <span title={r.sizeFrom === "genie" ? "From genie's record of the VM (Taz gave no size)" : undefined}>
                            {r.sizeLabel}{r.sizeFrom === "genie" && <span className="ml-1 text-xs text-overlay1">(genie record)</span>}
                          </span>
                        ) : (
                          <span className="text-yellow" title={r.unknownWhy ?? undefined}>
                            unknown <span className="text-xs text-overlay1">({r.sizeLabel ? `Taz: ${r.sizeLabel}` : "no size from Taz"})</span>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text">{r.spec?.vcpu ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text">{r.spec ? `${r.spec.ramGb} GB` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text">{r.spec ? `${r.spec.diskGb} GB` : "—"}</td>
                      <td className={cn("px-2 py-1.5", STATUS_STYLE[r.group])}>{STATUS_LABEL[r.group]}</td>
                      <td className="px-2 py-1.5 text-xs tabular-nums text-subtext0">
                        {r.use ? (
                          <span className="inline-flex flex-wrap items-center gap-x-2">
                            <span>CPU {Math.round(r.use.cpu * 100)}%</span>
                            <span>RAM {Math.round(r.use.ram * 100)}%</span>
                            <span>Disk {Math.round(r.use.disk * 100)}%</span>
                            {r.overProvisioned && <span className="rounded bg-peach/15 px-1.5 py-0.5 font-semibold text-peach">over-provisioned</span>}
                          </span>
                        ) : <span className="text-overlay0">not known</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="px-2 py-6 text-center text-subtext0">No VM matches.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
