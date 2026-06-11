"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDeepSubject, useSubject } from "subjecto/react";
import { $admin, $serverMetrics } from "@/store/subjects";
import {
  watchServerMetrics,
  unwatchServerMetrics,
  fetchServerMetricsHistory,
  fetchRequestsByUser,
} from "@/store/actions/server-metrics";
import { loadAdminUsers } from "@/store/actions";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { SystemStats } from "@/components/ui/system-stats";
import { cn } from "@/lib/utils";
import type { RequestVolumeResult, ServerMetricSample } from "@/store/types/common";

/** Unified per-point shape for the charts: `stats`/`ws` are per-second rates. */
interface ChartPoint {
  t: number;
  stats: number;
  ws: number;
}

const chartConfig = {
  stats: { label: "Stats req/s", color: "var(--color-blue)" },
  ws: { label: "WS msgs/s", color: "var(--color-mauve)" },
} satisfies ChartConfig;

const RANGES = [
  { hours: 1, label: "1h" },
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
] as const;

/** Average-downsample points to keep the chart light. Values are per-second
 *  rates, so averaging preserves the unit. */
function downsample(points: ChartPoint[], maxPoints = 300): ChartPoint[] {
  if (points.length <= maxPoints) return points;
  const groupSize = Math.ceil(points.length / maxPoints);
  const out: ChartPoint[] = [];
  for (let i = 0; i < points.length; i += groupSize) {
    const slice = points.slice(i, i + groupSize);
    const n = slice.length;
    out.push({
      t: slice[n - 1]!.t,
      stats: slice.reduce((a, b) => a + b.stats, 0) / n,
      ws: slice.reduce((a, b) => a + b.ws, 0) / n,
    });
  }
  return out;
}

function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-surface0 bg-mantle px-4 py-3 min-w-[150px]">
      <span className="text-[11px] uppercase tracking-wide text-overlay0">{label}</span>
      <span
        className="text-2xl font-semibold tabular-nums leading-none"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-subtext0 tabular-nums">{sub}</span>}
    </div>
  );
}

function MetricChart({
  data,
  dataKey,
  color,
  unit,
  showDate,
}: {
  data: ChartPoint[];
  dataKey: "stats" | "ws";
  color: string;
  unit: string;
  showDate: boolean;
}) {
  const gradientId = `fill-${dataKey}`;
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full">
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} />
        <ChartTooltip
          cursor={{ stroke: "var(--color-surface1)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const t = payload?.[0]?.payload?.t as number | undefined;
                if (!t) return "";
                const d = new Date(t);
                return showDate ? d.toLocaleString() : d.toLocaleTimeString();
              }}
              formatter={(value) => [`${Number(value).toFixed(1)} ${unit}`, chartConfig[dataKey].label]}
            />
          }
        />
        <Area
          dataKey={dataKey}
          type="monotone"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function dbToPoints(rows: ServerMetricSample[]): ChartPoint[] {
  return rows.map((r) => {
    const w = Math.max(1, r.windowSec);
    return { t: r.t, stats: r.statsRequests / w, ws: r.wsSent / w };
  });
}

export function ServerMetricsPanel() {
  const [metrics] = useSubject($serverMetrics);
  const [range, setRange] = useState<number>(1);
  const [history, setHistory] = useState<ServerMetricSample[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Re-render every second so the uptime clock keeps ticking even between frames.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    watchServerMetrics();
    return () => unwatchServerMetrics();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // For 6h/24h, pull persisted per-minute history (and refresh it each minute).
  useEffect(() => {
    if (range === 1) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingHistory(true);
      try {
        const rows = await fetchServerMetricsHistory(range);
        if (!cancelled) setHistory(rows);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [range]);

  const { buckets, startedAt } = metrics;

  // Current per-second rates always come from the live 1s stream.
  const last = buckets.at(-1);
  const statsPerSec = last?.statsRequests ?? 0;
  const wsPerSec = last?.wsSent ?? 0;

  // Chart data + window totals depend on the selected range.
  const { chartData, statsTotal, wsTotal, hasData } = useMemo(() => {
    if (range === 1) {
      const points: ChartPoint[] = buckets.map((b) => ({ t: b.t, stats: b.statsRequests, ws: b.wsSent }));
      return {
        chartData: downsample(points),
        statsTotal: buckets.reduce((a, b) => a + b.statsRequests, 0),
        wsTotal: buckets.reduce((a, b) => a + b.wsSent, 0),
        hasData: buckets.length >= 2,
      };
    }
    return {
      chartData: downsample(dbToPoints(history)),
      statsTotal: history.reduce((a, r) => a + r.statsRequests, 0),
      wsTotal: history.reduce((a, r) => a + r.wsSent, 0),
      hasData: history.length >= 2,
    };
  }, [range, buckets, history]);

  const rangeLabel = RANGES.find((r) => r.hours === range)?.label ?? "1h";
  const showDate = range !== 1;
  const collecting = range === 1 ? false : loadingHistory;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-4 border-b border-surface0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-text">Server</h1>
            <p className="text-md text-subtext0 mt-1">
              Manager throughput — stats-daemon postbacks and WebSocket frames sent. The 1h view is
              live (per-second); 6h/24h are per-minute history from the database.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-surface0 bg-mantle p-0.5 shrink-0">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                type="button"
                onClick={() => setRange(r.hours)}
                className={cn(
                  "px-3 py-1 rounded-md text-sm font-medium border-none cursor-pointer transition-colors",
                  range === r.hours
                    ? "bg-surface0 text-text"
                    : "bg-transparent text-overlay0 hover:text-subtext0",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-subtext0 mt-2">
          {startedAt ? (
            <>
              Server up since{" "}
              <span className="text-text font-medium">{new Date(startedAt).toLocaleString()}</span>
              <span className="text-overlay0"> · {formatUptime(now - startedAt)}</span>
            </>
          ) : (
            <span className="text-overlay0">Connecting…</span>
          )}
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-6 p-5">
        <div className="flex flex-wrap gap-3 items-stretch">
          <StatCard
            label="Stats req / sec"
            value={formatNumber(statsPerSec)}
            sub={`${formatNumber(statsTotal)} in last ${rangeLabel}`}
            accent="var(--color-blue)"
          />
          <StatCard
            label="WS msgs / sec"
            value={formatNumber(wsPerSec)}
            sub="current rate"
            accent="var(--color-mauve)"
          />
          <StatCard
            label={`WS msgs sent (${rangeLabel})`}
            value={hasData ? formatNumber(wsTotal) : "—"}
            sub={`total sent, last ${rangeLabel}`}
            accent="var(--color-mauve)"
          />
          {/* Live gauges relocated from the left sidebar. */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-surface0 bg-mantle px-4 py-3 min-w-[260px] flex-1 max-w-md">
            <span className="text-[11px] uppercase tracking-wide text-overlay0">System &amp; connections</span>
            <SystemStats />
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-subtext0">Stats requests / sec · last {rangeLabel}</h2>
          {hasData ? (
            <MetricChart data={chartData} dataKey="stats" color="var(--color-blue)" unit="req/s" showDate={showDate} />
          ) : (
            <CollectingPlaceholder loading={collecting} />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-subtext0">WebSocket messages sent / sec · last {rangeLabel}</h2>
          {hasData ? (
            <MetricChart data={chartData} dataKey="ws" color="var(--color-mauve)" unit="msg/s" showDate={showDate} />
          ) : (
            <CollectingPlaceholder loading={collecting} />
          )}
        </section>

        <RequestsByUserSection range={range} rangeLabel={rangeLabel} showDate={showDate} />
      </div>
    </div>
  );
}

/** Distinct band colours for the stacked "Requests by user" chart; "Other" gets
 *  a muted overlay tone so it reads as the catch-all. */
const SERIES_COLORS = [
  "#89b4fa", "#cba6f7", "#a6e3a1", "#fab387", "#94e2d5",
  "#f9e2af", "#f38ba8", "#89dceb", "#f5c2e7", "#b4befe",
];
const OTHER_COLOR = "#6c7086";
const seriesColor = (key: string, i: number) => (key === "other" ? OTHER_COLOR : SERIES_COLORS[i % SERIES_COLORS.length]!);

/** Stacked request-volume chart sourced from analytics_events. With no user
 *  selected it stacks the top users (+ Other); with one selected it splits that
 *  user's volume by surface (Claude popup / Genie Chat / Terminal). Shares the
 *  panel's 1h/6h/24h range. */
function RequestsByUserSection({
  range,
  rangeLabel,
  showDate,
}: {
  range: number;
  rangeLabel: string;
  showDate: boolean;
}) {
  const [usersSlice] = useDeepSubject($admin, "users");
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<RequestVolumeResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (usersSlice.list.length === 0) loadAdminUsers();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetchRequestsByUser(range, userId || null);
        if (!cancelled) setResult(r);
      } catch {
        if (!cancelled) setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [range, userId]);

  const userOptions = useMemo(
    () => [
      { value: "", label: "All users (stack by user)" },
      ...usersSlice.list
        .filter((u) => !u.isAgent)
        .map((u) => ({ value: u.id, label: u.name || u.email || u.id })),
    ],
    [usersSlice.list],
  );

  const hasData =
    !!result &&
    result.series.length > 0 &&
    result.points.some((p) => result.series.some((s) => (p[s.key] ?? 0) > 0));

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-medium text-subtext0">
          Requests by user · last {rangeLabel}
          <span className="text-overlay0 font-normal"> · Claude popup + Genie Chat + Terminal</span>
        </h2>
        <div className="w-64">
          <FilterableSelect
            value={userId}
            options={userOptions}
            onChange={(v) => setUserId(v)}
            placeholder="All users"
          />
        </div>
      </div>
      {hasData ? (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={result!.points} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#313244" vertical={false} />
              <XAxis
                dataKey="t"
                tick={{ fill: "#7f849c", fontSize: 11 }}
                minTickGap={24}
                tickFormatter={(t: number) => {
                  const d = new Date(t);
                  return showDate
                    ? d.toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit" })
                    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                }}
              />
              <YAxis allowDecimals={false} tick={{ fill: "#7f849c", fontSize: 11 }} width={32} />
              <Tooltip
                contentStyle={{ background: "#181825", border: "1px solid #313244", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#cdd6f4" }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {result!.series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stackId="1"
                  stroke={seriesColor(s.key, i)}
                  fill={seriesColor(s.key, i)}
                  fillOpacity={0.5}
                  strokeWidth={1}
                  isAnimationActive={false}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <CollectingPlaceholder loading={loading} />
      )}
    </section>
  );
}

function CollectingPlaceholder({ loading }: { loading: boolean }) {
  return (
    <div className="h-44 w-full rounded-lg border border-surface0/80 bg-surface0/30 flex items-center justify-center text-sm text-overlay0">
      {loading ? "Loading history…" : "Collecting data…"}
    </div>
  );
}
