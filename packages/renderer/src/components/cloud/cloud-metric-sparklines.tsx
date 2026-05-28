"use client";

import { useMemo } from "react";
import type { VpsMetricSample } from "@/store/types/vps";
import { MetricSparkline } from "@/components/ui/metric-sparkline";
import { downsample, historyLabelSuffix, seriesFromHistory } from "@/lib/cloud-vm-metrics";

export function CloudMetricSparklines({
  history,
  hours,
}: {
  history: VpsMetricSample[] | undefined;
  hours: number;
}) {
  const suffix = historyLabelSuffix(hours);
  const cpuSeries = useMemo(() => downsample(seriesFromHistory(history, "cpuPercent")), [history]);
  const memSeries = useMemo(() => downsample(seriesFromHistory(history, "memPercent")), [history]);
  const diskSeries = useMemo(() => downsample(seriesFromHistory(history, "diskPercent")), [history]);

  return (
    <div className="grid grid-cols-3 gap-3 mt-3">
      <MetricSparkline values={cpuSeries} label={`CPU ${suffix}`} />
      <MetricSparkline values={memSeries} label={`MEM ${suffix}`} />
      <MetricSparkline values={diskSeries} label={`DISK ${suffix}`} />
    </div>
  );
}
