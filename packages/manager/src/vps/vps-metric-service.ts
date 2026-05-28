import { and, eq, gte, inArray } from "drizzle-orm";
import type { VpsStatsPayload } from "@genie/vps-stats";
import { getDb } from "../db/index.js";
import { vpsMetricSamples } from "../db/schema.js";

interface QueuedSample {
  projectId: string;
  instanceId: string;
  sampledAt: Date;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
}

const queue: QueuedSample[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 30_000;
const MAX_QUEUE = 500;

export interface VpsMetricSampleRow {
  sampledAt: string;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  memUsedBytes: number;
  diskUsedBytes: number;
}

export function enqueueVpsMetricSample(
  projectId: string,
  instanceId: string,
  ts: number,
  stats: VpsStatsPayload,
): void {
  queue.push({
    projectId,
    instanceId,
    sampledAt: new Date(ts),
    cpuPercent: stats.cpuPercent,
    memUsedBytes: stats.memUsedBytes,
    memTotalBytes: stats.memTotalBytes,
    memPercent: stats.memPercent,
    diskUsedBytes: stats.diskUsedBytes,
    diskTotalBytes: stats.diskTotalBytes,
    diskPercent: stats.diskPercent,
  });
  if (queue.length >= MAX_QUEUE) {
    void flushVpsMetricSamples();
  }
}

export async function flushVpsMetricSamples(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    const db = getDb();
    await db.insert(vpsMetricSamples).values(batch);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vps-metrics] flush failed (${batch.length} rows): ${message}`);
  }
}

export function startVpsMetricFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushVpsMetricSamples();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

export async function stopVpsMetricFlusher(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushVpsMetricSamples();
}

function rowToSample(row: {
  sampledAt: Date;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  memUsedBytes: number;
  diskUsedBytes: number;
}): VpsMetricSampleRow {
  return {
    sampledAt: row.sampledAt.toISOString(),
    cpuPercent: row.cpuPercent,
    memPercent: row.memPercent,
    diskPercent: row.diskPercent,
    memUsedBytes: row.memUsedBytes,
    diskUsedBytes: row.diskUsedBytes,
  };
}

export async function getVpsMetricHistory(
  projectId: string,
  instanceId: string,
  hours: number,
): Promise<VpsMetricSampleRow[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const db = getDb();
  const rows = await db
    .select({
      sampledAt: vpsMetricSamples.sampledAt,
      cpuPercent: vpsMetricSamples.cpuPercent,
      memPercent: vpsMetricSamples.memPercent,
      diskPercent: vpsMetricSamples.diskPercent,
      memUsedBytes: vpsMetricSamples.memUsedBytes,
      diskUsedBytes: vpsMetricSamples.diskUsedBytes,
    })
    .from(vpsMetricSamples)
    .where(
      and(
        eq(vpsMetricSamples.projectId, projectId),
        eq(vpsMetricSamples.instanceId, instanceId),
        gte(vpsMetricSamples.sampledAt, since),
      ),
    )
    .orderBy(vpsMetricSamples.sampledAt);
  return rows.map(rowToSample);
}

export async function getBulkVpsMetricHistory(
  instances: { projectId: string; instanceId: string }[],
  hours: number,
): Promise<Record<string, VpsMetricSampleRow[]>> {
  if (instances.length === 0) return {};

  const since = new Date(Date.now() - hours * 3_600_000);
  const db = getDb();
  const result: Record<string, VpsMetricSampleRow[]> = {};
  const projectIds = [...new Set(instances.map((i) => i.projectId))];

  for (const projectId of projectIds) {
    const instanceIds = instances
      .filter((i) => i.projectId === projectId)
      .map((i) => i.instanceId);
    if (instanceIds.length === 0) continue;

    const rows = await db
      .select({
        instanceId: vpsMetricSamples.instanceId,
        sampledAt: vpsMetricSamples.sampledAt,
        cpuPercent: vpsMetricSamples.cpuPercent,
        memPercent: vpsMetricSamples.memPercent,
        diskPercent: vpsMetricSamples.diskPercent,
        memUsedBytes: vpsMetricSamples.memUsedBytes,
        diskUsedBytes: vpsMetricSamples.diskUsedBytes,
      })
      .from(vpsMetricSamples)
      .where(
        and(
          eq(vpsMetricSamples.projectId, projectId),
          inArray(vpsMetricSamples.instanceId, instanceIds),
          gte(vpsMetricSamples.sampledAt, since),
        ),
      )
      .orderBy(vpsMetricSamples.sampledAt);

    for (const row of rows) {
      const key = `${projectId}:${row.instanceId}`;
      if (!result[key]) result[key] = [];
      result[key].push(rowToSample(row));
    }
  }

  return result;
}
