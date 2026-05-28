import type { ProjectDef, VpsInstance, VpsMetricSample } from "@/store/types/vps";

export function vpsMetricKey(projectId: string, instanceId: string): string {
  return `${projectId}:${instanceId}`;
}

export function findLinkedInstance(
  projects: ProjectDef[],
  match: { tazVmId?: string; dropletId?: number },
): { projectId: string; instanceId: string; instance: VpsInstance } | null {
  for (const project of projects) {
    for (const instance of project.vpsInstances) {
      if (match.tazVmId && instance.tazcloud?.vmId === match.tazVmId) {
        return { projectId: project.id, instanceId: instance.id, instance };
      }
      if (match.dropletId != null && instance.digitalocean?.dropletId === match.dropletId) {
        return { projectId: project.id, instanceId: instance.id, instance };
      }
    }
  }
  return null;
}

export function downsample(values: number[], maxPoints = 120): number[] {
  if (values.length <= maxPoints) return values;
  const step = values.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(values[Math.floor(i * step)]);
  }
  return out;
}

export function seriesFromHistory(
  samples: VpsMetricSample[] | undefined,
  field: keyof VpsMetricSample,
): number[] {
  if (!samples?.length) return [];
  return samples.map((s) => {
    const v = s[field];
    return typeof v === "number" ? v : 0;
  });
}

export function historyLabelSuffix(hours: number): string {
  if (hours === 1) return "1h";
  if (hours === 6) return "6h";
  return "24h";
}
