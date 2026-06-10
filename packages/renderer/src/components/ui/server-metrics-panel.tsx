"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { useSubject } from "subjecto/react";
import { $serverMetrics } from "@/store/subjects";
import { watchServerMetrics, unwatchServerMetrics } from "@/store/actions/server-metrics";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SystemStats } from "@/components/ui/system-stats";
import type { ServerMetricBucket } from "@/store/types/common";

const chartConfig = {
  statsRequests: { label: "Stats req/s", color: "var(--color-blue)" },
  wsSent: { label: "WS msgs/s", color: "var(--color-mauve)" },
} satisfies ChartConfig;

/** Average-downsample the per-second buckets to keep the hour chart light. Each
 *  bucket value is already a per-second rate, so averaging preserves the unit. */
function downsample(buckets: ServerMetricBucket[], maxPoints = 240): ServerMetricBucket[] {
  if (buckets.length <= maxPoints) return buckets;
  const groupSize = Math.ceil(buckets.length / maxPoints);
  const out: ServerMetricBucket[] = [];
  for (let i = 0; i < buckets.length; i += groupSize) {
    const slice = buckets.slice(i, i + groupSize);
    const n = slice.length;
    out.push({
      t: slice[n - 1]!.t,
      statsRequests: slice.reduce((a, b) => a + b.statsRequests, 0) / n,
      wsSent: slice.reduce((a, b) => a + b.wsSent, 0) / n,
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
}: {
  data: ServerMetricBucket[];
  dataKey: "statsRequests" | "wsSent";
  color: string;
  unit: string;
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
                return t ? new Date(t).toLocaleTimeString() : "";
              }}
              formatter={(value) => [`${(Number(value)).toFixed(1)} ${unit}`, chartConfig[dataKey].label]}
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

export function ServerMetricsPanel() {
  const [metrics] = useSubject($serverMetrics);
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

  const { buckets, startedAt } = metrics;
  const chartData = useMemo(() => downsample(buckets), [buckets]);

  const last = buckets.at(-1);
  const statsPerSec = last?.statsRequests ?? 0;
  const wsPerSec = last?.wsSent ?? 0;
  const wsHourTotal = useMemo(() => buckets.reduce((a, b) => a + b.wsSent, 0), [buckets]);
  const statsHourTotal = useMemo(() => buckets.reduce((a, b) => a + b.statsRequests, 0), [buckets]);
  const hasData = buckets.length >= 2;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-4 border-b border-surface0">
        <h1 className="text-xl font-semibold text-text">Server</h1>
        <p className="text-md text-subtext0 mt-1">
          Live manager throughput — stats-daemon postbacks and WebSocket frames sent, per second
          over the last hour. Updates every second.
        </p>
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
            value={hasData ? formatNumber(statsPerSec) : "—"}
            sub={`${formatNumber(statsHourTotal)} in last hour`}
            accent="var(--color-blue)"
          />
          <StatCard
            label="WS msgs / sec"
            value={hasData ? formatNumber(wsPerSec) : "—"}
            sub="current rate"
            accent="var(--color-mauve)"
          />
          <StatCard
            label="WS msgs sent (1h)"
            value={hasData ? formatNumber(wsHourTotal) : "—"}
            sub="total sent, last hour"
            accent="var(--color-mauve)"
          />
          {/* Live gauges relocated from the left sidebar. */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-surface0 bg-mantle px-4 py-3 min-w-[260px] flex-1 max-w-md">
            <span className="text-[11px] uppercase tracking-wide text-overlay0">System &amp; connections</span>
            <SystemStats />
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-subtext0">Stats requests / sec</h2>
          {hasData ? (
            <MetricChart data={chartData} dataKey="statsRequests" color="var(--color-blue)" unit="req/s" />
          ) : (
            <CollectingPlaceholder />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-subtext0">WebSocket messages sent / sec</h2>
          {hasData ? (
            <MetricChart data={chartData} dataKey="wsSent" color="var(--color-mauve)" unit="msg/s" />
          ) : (
            <CollectingPlaceholder />
          )}
        </section>
      </div>
    </div>
  );
}

function CollectingPlaceholder() {
  return (
    <div className="h-44 w-full rounded-lg border border-surface0/80 bg-surface0/30 flex items-center justify-center text-sm text-overlay0">
      Collecting data…
    </div>
  );
}
