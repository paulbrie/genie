"use client";

import { useEffect, useMemo } from "react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import type { VpsDeployState } from "@/store/types/vps";
import { Loader2, RefreshCw, Server } from "lucide-react";
import { $projects, $vpsDeploy, $vpsMonitor } from "@/store/subjects";
import { loadVpsMonitor, unwatchVpsStats, watchVpsStats } from "@/store/actions/vps";
import type { ProjectDef, VpsInstance, VpsMetricSample } from "@/store/types/vps";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { MetricSparkline } from "@/components/ui/metric-sparkline";
import { openManageDropletWindow } from "@/components/admin/digitalocean-panel";
import { openManageVmWindow } from "@/components/tazcloud/manage-vm-popup";
import { cn } from "@/lib/utils";

const HISTORY_REFRESH_MS = 60_000;

function metricKey(projectId: string, instanceId: string): string {
  return `${projectId}:${instanceId}`;
}

function providerLabel(instance: VpsInstance): string {
  if (instance.digitalocean) return "DigitalOcean";
  if (instance.tazcloud) return "TazCloud";
  return "SSH";
}

function providerColor(instance: VpsInstance): string {
  if (instance.digitalocean) return "text-blue bg-blue/15";
  if (instance.tazcloud) return "text-teal bg-teal/15";
  return "text-lavender bg-lavender/15";
}

function canManageInstance(instance: VpsInstance): boolean {
  return !!(instance.tazcloud?.vmId || instance.digitalocean?.dropletId || instance.ssh);
}

function openManageForInstance(instance: VpsInstance): void {
  const name = instance.label || instance.connection.host;
  const tazVmId = instance.tazcloud?.vmId;
  const doDropletId = instance.digitalocean?.dropletId;
  if (tazVmId) {
    openManageVmWindow({ id: tazVmId, name });
  } else if (doDropletId) {
    openManageDropletWindow({ id: doDropletId, name });
  } else if (instance.ssh) {
    openManageVmWindow({ id: instance.id, name });
  }
}

function downsample(values: number[], maxPoints = 120): number[] {
  if (values.length <= maxPoints) return values;
  const step = values.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(values[Math.floor(i * step)]);
  }
  return out;
}

function seriesFromHistory(samples: VpsMetricSample[] | undefined, field: keyof VpsMetricSample): number[] {
  if (!samples?.length) return [];
  return samples.map((s) => {
    const v = s[field];
    return typeof v === "number" ? v : 0;
  });
}

function VmMonitorCard({
  project,
  instance,
  history,
}: {
  project: ProjectDef;
  instance: VpsInstance;
  history: VpsMetricSample[];
}) {
  const vpsDeploy = useDeepSubjectAll<VpsDeployState>($vpsDeploy);
  const stats = vpsDeploy.instances[instance.id]?.stats ?? null;
  const statsError = vpsDeploy.instances[instance.id]?.statsError ?? null;
  const host = instance.connection.host;

  const cpuSeries = useMemo(() => downsample(seriesFromHistory(history, "cpuPercent")), [history]);
  const memSeries = useMemo(() => downsample(seriesFromHistory(history, "memPercent")), [history]);
  const diskSeries = useMemo(() => downsample(seriesFromHistory(history, "diskPercent")), [history]);
  const manageable = canManageInstance(instance);

  return (
    <article
      role={manageable ? "button" : undefined}
      tabIndex={manageable ? 0 : undefined}
      onClick={manageable ? () => openManageForInstance(instance) : undefined}
      onKeyDown={
        manageable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openManageForInstance(instance);
              }
            }
          : undefined
      }
      title={manageable ? "Open Manage popup" : undefined}
      className={cn(
        "flex flex-col gap-3 p-3 rounded-lg border border-overlay0/20 bg-mantle transition-colors",
        manageable && "cursor-pointer hover:border-blue/30 hover:bg-mantle/80",
      )}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Server size={14} className="text-overlay0 shrink-0" />
            <span className="font-medium text-text truncate">{instance.label || host}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide", providerColor(instance))}>
              {providerLabel(instance)}
            </span>
          </div>
          <div className="text-[11px] text-overlay0 mt-0.5 truncate">
            {project.name} · <span className="font-mono text-overlay1">{host}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <CircularGauge
          label="CPU"
          percent={stats ? Math.round(stats.cpuPercent) : 0}
          size={44}
          strokeWidth={4}
          valueFontSize={12}
          showPercentSign
        />
        <CircularGauge
          label="MEM"
          percent={stats ? Math.round(stats.memPercent) : 0}
          size={44}
          strokeWidth={4}
          valueFontSize={12}
          showPercentSign
        />
        <CircularGauge
          label="DISK"
          percent={stats ? Math.round(stats.diskPercent) : 0}
          size={44}
          strokeWidth={4}
          valueFontSize={12}
          showPercentSign
        />
        {!stats && !statsError && (
          <span className="text-[11px] text-overlay0 flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Live…
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MetricSparkline values={cpuSeries} label="CPU 1h" />
        <MetricSparkline values={memSeries} label="MEM 1h" />
        <MetricSparkline values={diskSeries} label="DISK 1h" />
      </div>

      {statsError && (
        <div className="text-[10px] text-red font-mono truncate" title={statsError}>
          {statsError}
        </div>
      )}
    </article>
  );
}

/** Fleet-wide VM resource monitor — live gauges + 1h Postgres history sparklines. */
export function MonitorPanel() {
  const [projects] = useSubject($projects);
  const [monitor] = useSubject($vpsMonitor);

  const vms = useMemo(
    () =>
      projects.flatMap((p) =>
        p.vpsInstances
          .filter((instance) => !instance.hibernate && !instance.deployFailed)
          .map((instance) => ({
            project: p,
            instance,
            key: metricKey(p.id, instance.id),
          })),
      ),
    [projects],
  );

  useEffect(() => {
    const vmKeys = vms.map((v) => v.key).join("|");
    loadVpsMonitor(monitor.hours);
    for (const { project, instance } of vms) {
      watchVpsStats(project.id, instance.id);
    }
    const historyId = window.setInterval(() => loadVpsMonitor(monitor.hours), HISTORY_REFRESH_MS);
    return () => {
      window.clearInterval(historyId);
      for (const { project, instance } of vms) {
        unwatchVpsStats(project.id, instance.id);
      }
    };
  }, [vms, monitor.hours]);

  const setHours = (hours: number) => {
    loadVpsMonitor(hours);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        <div className="flex flex-col gap-4 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text">Monitor</h1>
          <p className="text-md text-overlay0 mt-0.5">
            Live CPU, memory, and disk for every project VM. History is stored in Postgres while this tab is open.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-overlay0 uppercase tracking-wide">History</label>
          <select
            value={monitor.hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="text-md bg-surface0 border border-overlay0/30 rounded px-2 py-1 text-text"
          >
            <option value={1}>1 hour</option>
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
          </select>
          <button
            type="button"
            onClick={() => loadVpsMonitor(monitor.hours)}
            disabled={monitor.loading}
            className="p-1.5 rounded text-overlay0 hover:text-blue transition-colors disabled:opacity-50"
            title="Refresh history"
          >
            <RefreshCw size={14} className={cn(monitor.loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {monitor.error && (
        <div className="text-md text-red bg-red/10 border border-red/20 rounded px-3 py-2">{monitor.error}</div>
      )}

      {vms.length === 0 ? (
        <div className="text-md text-overlay0 bg-mantle border border-overlay0/20 rounded-lg p-6 text-center">
          No VMs deployed yet. Deploy a project to a cloud provider to see metrics here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
          {vms.map(({ project, instance, key }) => (
            <VmMonitorCard
              key={key}
              project={project}
              instance={instance}
              history={monitor.history[key] ?? []}
            />
          ))}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
