"use client";

import { cn } from "@/lib/utils";

function sparkColor(values: number[]): string {
  const max = Math.max(...values, 0);
  if (max >= 90) return "var(--color-red)";
  if (max >= 70) return "var(--color-peach)";
  return "var(--color-green)";
}

/** Minimal SVG sparkline for 0–100 percent metrics. */
export function MetricSparkline({
  values,
  label,
  className,
  width = 120,
  height = 28,
}: {
  values: number[];
  label: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <div className={cn("flex flex-col gap-0.5", className)}>
        <span className="text-[10px] uppercase tracking-wide text-overlay0">{label}</span>
        <div
          className="rounded bg-surface0/50 border border-surface0/80"
          style={{ width, height }}
          title="Collecting history…"
        />
      </div>
    );
  }

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = innerW / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + innerH - (Math.min(100, Math.max(0, v)) / 100) * innerH;
      return `${x},${y}`;
    })
    .join(" ");

  const latest = values[values.length - 1];
  const color = sparkColor(values);

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wide text-overlay0">{label}</span>
        <span className="text-[10px] font-mono text-subtext0 tabular-nums">{Math.round(latest)}%</span>
      </div>
      <svg width={width} height={height} className="block" aria-hidden>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
    </div>
  );
}
