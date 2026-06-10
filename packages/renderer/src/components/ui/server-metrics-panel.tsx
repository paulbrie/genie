"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { useSubject } from "subjecto/react";
import { $serverMetrics } from "@/store/subjects";
import {
  watchServerMetrics,
  unwatchServerMetrics,
  fetchServerMetricsHistory,
} from "@/store/actions/server-metrics";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SystemStats } from "@/components/ui/system-stats";
import { cn } from "@/lib/utils";
import type { ServerMetricSample } from "@/store/types/common";

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
      </div>
    </div>
  );
}

function CollectingPlaceholder({ loading }: { loading: boolean }) {
  return (
    <div className="h-44 w-full rounded-lg border border-surface0/80 bg-surface0/30 flex items-center justify-center text-sm text-overlay0">
      {loading ? "Loading history…" : "Collecting data…"}
    </div>
  );
}
