"use client";

import { useMemo } from "react";
import { Line, LineChart, YAxis } from "recharts";
import type { VpsMetricSample } from "@/store/types/vps";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { historyLabelSuffix } from "@/lib/cloud-vm-metrics";

const chartConfig = {
  cpu: { label: "CPU", color: "var(--color-green)" },
  mem: { label: "MEM", color: "var(--color-mauve)" },
  disk: { label: "DISK", color: "#94e2d5" },
} satisfies ChartConfig;

type MetricKey = keyof typeof chartConfig;

function downsampleSamples(samples: VpsMetricSample[], maxPoints = 120): VpsMetricSample[] {
  if (samples.length <= maxPoints) return samples;
  const step = samples.length / maxPoints;
  const out: VpsMetricSample[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(samples[Math.floor(i * step)]!);
  }
  return out;
}

export function CloudMetricSparklines({
  history,
  hours,
}: {
  history: VpsMetricSample[] | undefined;
  hours: number;
}) {
  const suffix = historyLabelSuffix(hours);

  const chartData = useMemo(
    () =>
      downsampleSamples(history ?? []).map((s) => ({
        cpu: s.cpuPercent,
        mem: s.memPercent,
        disk: s.diskPercent,
      })),
    [history],
  );

  const latest = chartData.at(-1);
  const hasData = chartData.length >= 2;

  if (!hasData) {
    return (
      <div className="flex flex-col gap-1 mt-3 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          {(Object.keys(chartConfig) as MetricKey[]).map((key) => (
            <span key={key} className="text-[10px] uppercase tracking-wide text-overlay0">
              {chartConfig[key].label}
            </span>
          ))}
          <span className="text-[10px] text-overlay0 italic">{suffix}</span>
        </div>
        <div
          className="w-full h-9 rounded bg-surface0/50 border border-surface0/80"
          title="Collecting history…"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 mt-3 min-w-0">
      <div className="flex items-center gap-3 flex-wrap">
        {(Object.keys(chartConfig) as MetricKey[]).map((key) => (
          <span key={key} className="inline-flex items-center gap-1 text-[10px]">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: chartConfig[key].color }}
            />
            <span className="uppercase tracking-wide text-overlay0">{chartConfig[key].label}</span>
            <span className="font-mono text-subtext0 tabular-nums">
              {Math.round(latest?.[key] ?? 0)}%
            </span>
          </span>
        ))}
        <span className="text-[10px] text-overlay0 uppercase tracking-wide ml-auto">{suffix}</span>
      </div>
      <ChartContainer config={chartConfig} className="aspect-auto h-9 w-full">
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <YAxis domain={[0, 100]} hide />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, name) => [`${Math.round(Number(value))}%`, chartConfig[name as MetricKey]?.label ?? name]}
              />
            }
          />
          <Line
            dataKey="cpu"
            type="monotone"
            stroke="var(--color-cpu)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="mem"
            type="monotone"
            stroke="var(--color-mem)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="disk"
            type="monotone"
            stroke="var(--color-disk)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            opacity={0.85}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
