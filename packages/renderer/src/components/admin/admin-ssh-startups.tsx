"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, ShieldCheck } from "lucide-react";
import { wsRequest } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SshStartupsEvent {
  projectId: string;
  projectName: string | null;
  instanceId: string;
  occurredAt: string;
  drops: number;
  maxStartups: string | null;
}

const RANGES = [1, 6, 24] as const;

/** Fleet-wide trace of SSH MaxStartups drop events — each row is an interval
 *  where a VM's sshd refused unauthenticated connections (the app-side handshake
 *  gate keeps this near zero; non-empty here means a VM is being hit harder than
 *  the gate + its MaxStartups allow). Superadmin-only. Self-fetches via
 *  admin:ssh-startups:list. */
export function SshStartupsPanel() {
  const [hours, setHours] = useState<number>(24);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<SshStartupsEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await wsRequest<{ events?: SshStartupsEvent[] }>("admin:ssh-startups:list", { hours: h }, 20000);
      setEvents(res.events ?? []);
    } catch {
      setError("Failed to load — check the manager connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(hours); }, [hours, load]);

  // Per-VM rollup: how many drop intervals + total dropped connections, worst first.
  const perVm = (() => {
    const m = new Map<string, { projectName: string | null; instanceId: string; intervals: number; totalDrops: number; maxStartups: string | null; lastAt: string }>();
    for (const e of events) {
      const key = `${e.projectId}:${e.instanceId}`;
      const cur = m.get(key);
      if (cur) {
        cur.intervals += 1;
        cur.totalDrops += e.drops;
        if (e.occurredAt > cur.lastAt) cur.lastAt = e.occurredAt;
      } else {
        m.set(key, { projectName: e.projectName, instanceId: e.instanceId, intervals: 1, totalDrops: e.drops, maxStartups: e.maxStartups, lastAt: e.occurredAt });
      }
    }
    return [...m.values()].sort((a, b) => b.totalDrops - a.totalDrops);
  })();

  const totalDrops = events.reduce((s, e) => s + e.drops, 0);

  return (
    <div className="flex-1 overflow-auto px-5 py-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-base font-medium text-text">SSH MaxStartups drops</span>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <Button key={r} size="sm" variant={hours === r ? "active" : "default"} onClick={() => setHours(r)}>
              {r}h
            </Button>
          ))}
        </div>
        <Button size="sm" variant="default" onClick={() => void load(hours)} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
        <div className="flex-1" />
        <span className="text-md text-overlay0">
          {events.length === 0
            ? "no drops in range"
            : `${totalDrops} drop(s) across ${perVm.length} VM(s)`}
        </span>
      </div>

      <p className="text-md text-overlay0 mb-3 max-w-3xl">
        Each event is a stats interval where a VM&apos;s sshd hit its <code className="font-mono">MaxStartups</code> limit and
        refused unauthenticated connections (logged as <code className="font-mono">past MaxStartups</code> on the VM).
        The app-side handshake gate caps our concurrent dials per VM, so a healthy fleet shows nothing here.
      </p>

      {error && <div className="text-md text-red mb-3">{error}</div>}

      {events.length === 0 && !loading && !error ? (
        <div className="flex items-center gap-2 text-md text-green bg-green/10 border border-green/30 rounded-md px-3 py-2 w-fit">
          <ShieldCheck size={16} />
          No MaxStartups drops in the last {hours}h — sshd is keeping up across the fleet.
        </div>
      ) : (
        <>
          {/* Per-VM rollup */}
          <div className="mb-5">
            <div className="text-md font-medium text-subtext0 mb-1">By VM (worst first)</div>
            <table className="w-full text-md border-collapse">
              <thead>
                <tr className="text-left text-overlay0 border-b border-surface0">
                  <th className="py-1.5 px-2 font-medium">Project</th>
                  <th className="py-1.5 px-2 font-medium">Instance</th>
                  <th className="py-1.5 px-2 font-medium">MaxStartups</th>
                  <th className="py-1.5 px-2 font-medium text-right">Intervals</th>
                  <th className="py-1.5 px-2 font-medium text-right">Total dropped</th>
                  <th className="py-1.5 px-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {perVm.map((v) => (
                  <tr key={`${v.projectName}:${v.instanceId}`} className="border-b border-surface0/40">
                    <td className="py-1.5 px-2 text-text">{v.projectName ?? "—"}</td>
                    <td className="py-1.5 px-2 text-subtext0 font-mono">{v.instanceId.slice(0, 12)}</td>
                    <td className="py-1.5 px-2 text-subtext0 font-mono">{v.maxStartups ?? "?"}</td>
                    <td className="py-1.5 px-2 text-right text-subtext0">{v.intervals}</td>
                    <td className="py-1.5 px-2 text-right">
                      <span className={cn("inline-flex items-center gap-1 font-medium", v.totalDrops > 0 ? "text-peach" : "text-subtext0")}>
                        {v.totalDrops > 0 && <AlertTriangle size={12} />}
                        {v.totalDrops}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-overlay0">{new Date(v.lastAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Raw events */}
          <div>
            <div className="text-md font-medium text-subtext0 mb-1">Events ({events.length})</div>
            <table className="w-full text-md border-collapse">
              <thead>
                <tr className="text-left text-overlay0 border-b border-surface0">
                  <th className="py-1.5 px-2 font-medium">Time</th>
                  <th className="py-1.5 px-2 font-medium">Project</th>
                  <th className="py-1.5 px-2 font-medium">Instance</th>
                  <th className="py-1.5 px-2 font-medium text-right">Dropped</th>
                  <th className="py-1.5 px-2 font-medium">MaxStartups</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-surface0/30">
                    <td className="py-1.5 px-2 text-overlay0 whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-text">{e.projectName ?? "—"}</td>
                    <td className="py-1.5 px-2 text-subtext0 font-mono">{e.instanceId.slice(0, 12)}</td>
                    <td className="py-1.5 px-2 text-right text-peach font-medium">{e.drops}</td>
                    <td className="py-1.5 px-2 text-subtext0 font-mono">{e.maxStartups ?? "?"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
