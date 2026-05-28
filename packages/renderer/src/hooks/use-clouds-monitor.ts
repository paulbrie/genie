"use client";

import { useEffect, useMemo } from "react";
import { useSubject } from "subjecto/react";
import { loadVpsMonitor, unwatchVpsStats, watchVpsStats } from "@/store/actions/vps";
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
    loadVpsMonitor(monitor.hours);
    for (const pair of watchKey.split("|")) {
      const [projectId, instanceId] = pair.split(":");
      watchVpsStats(projectId, instanceId);
    }
    const historyId = window.setInterval(() => loadVpsMonitor(monitor.hours), HISTORY_REFRESH_MS);
    return () => {
      window.clearInterval(historyId);
      for (const pair of watchKey.split("|")) {
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
