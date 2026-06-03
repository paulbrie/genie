"use client";

import type { VpsMetricSample } from "@/store/types/vps";
import { cn } from "@/lib/utils";
import {
  ResourceGaugeCluster,
  VpsResourceBar,
  type VpsResourceBarProps,
} from "@/components/project/vps-resource-gauges";
import { CloudMetricChart, CloudMetricLegend } from "@/components/cloud/cloud-metric-sparklines";

type CloudVmResourceBlockProps = Omit<VpsResourceBarProps, "hideGauges" | "className"> & {
  className?: string;
  history?: VpsMetricSample[];
  hours?: number;
};

/** Clouds card metrics: domain/IP on top; ring gauges + history legend on one row; chart below. */
export function CloudVmResourceBlock({
  className,
  history,
  hours = 1,
  stats,
  statsLoading,
  statsError,
  ...barProps
}: CloudVmResourceBlockProps) {
  const showHistory = history !== undefined;

  return (
    <section
      className={cn(
        "mt-3 py-2 px-3 bg-mantle rounded-lg border border-overlay0/20 min-w-0",
        className,
      )}
    >
      <VpsResourceBar
        {...barProps}
        hideGauges
        stats={stats}
        statsLoading={statsLoading}
        statsError={statsError}
        className="border-0 bg-transparent p-0 shadow-none"
      />

      <div className="flex items-center justify-between gap-3 flex-wrap mt-2 pt-2 border-t border-overlay0/15 min-w-0">
        <ResourceGaugeCluster
          stats={stats}
          statsLoading={statsLoading}
          statsError={statsError}
        />
        {showHistory && (
          <CloudMetricLegend
            history={history}
            hours={hours}
            className="flex-1 justify-end"
          />
        )}
      </div>

      {showHistory && <CloudMetricChart history={history} className="mt-2" />}
    </section>
  );
}
