"use client";

import { useEffect, useMemo } from "react";
import { useSubject } from "subjecto/react";
import {
  loadVpsMonitor,
  setMonitorChartKeys,
  unwatchVpsStats,
  watchVpsStats,
} from "@/store/actions/vps";
import { sshStatsPostbackEnabled } from "@/lib/ssh-stats-enabled";
import { $projects, $vpsMonitor } from "@/store/subjects";

const HISTORY_REFRESH_MS = 60_000;

/** Load Postgres metric history and live stats streams for project-linked VMs. */
export function useCloudsMonitor(enabled: boolean) {
  const [projects] = useSubject($projects);
  const [monitor] = useSubject($vpsMonitor);

  /** Stable string so the effect does not re-subscribe on every $projects emit. */
  const watchKey = useMemo(
    () =>
      projects
        .flatMap((p) =>
          p.vpsInstances
            .filter((i) => !i.hibernate && !i.deployFailed)
            .map((i) => `${p.id}:${i.id}`),
        )
        .sort()
        .join("|"),
    [projects],
  );

  useEffect(() => {
    if (!enabled || !watchKey) return;
    const pairs = watchKey.split("|");
    // One-shot backfill; re-runs when `hours` changes (it's an effect dep).
    loadVpsMonitor(monitor.hours);
    for (const pair of pairs) {
      const [projectId, instanceId] = pair.split(":");
      watchVpsStats(projectId, instanceId);
    }
    // With live push on (default/prod), each `vps:stats:update` is appended to
    // the chart — fresher than the old 60s reload, so the poll is dropped. When
    // postback is disabled there's no live feed, so fall back to polling.
    const live = sshStatsPostbackEnabled();
    setMonitorChartKeys(live ? pairs : []);
    const historyId = live
      ? null
      : window.setInterval(() => loadVpsMonitor(monitor.hours), HISTORY_REFRESH_MS);
    return () => {
      if (historyId !== null) window.clearInterval(historyId);
      setMonitorChartKeys([]);
      for (const pair of pairs) {
        const [projectId, instanceId] = pair.split(":");
        unwatchVpsStats(projectId, instanceId);
      }
    };
  }, [enabled, watchKey, monitor.hours]);

  return {
    monitor,
    refreshHistory: () => loadVpsMonitor(monitor.hours),
    setHistoryHours: (hours: number) => loadVpsMonitor(hours),
  };
}
