"use client";

import { useEffect } from "react";
import { RefreshCw, AlertTriangle, Activity, Network } from "lucide-react";
import type { AdminState, SshEventsReport } from "@/store/types";
import { loadSshEventsReport } from "@/store/actions";
import { $admin } from "@/store/subjects";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { cn } from "@/lib/utils";

const CAUSE_HINTS: Record<string, string> = {
  "keepalive-timeout": "Path silently dead — usually WG handshake stale / NAT mapping expired",
  "socks-failure": "wireproxy/SOCKS dial failed — sidecar down or wedged",
  "tcp-reset": "Peer/network reset (ECONNRESET) mid-traffic",
  "host-unreachable": "EHOSTUNREACH/ENETUNREACH — routing or VM down",
  "handshake-timeout": "ETIMEDOUT before SSH ready — sshd not answering",
  "auth-failure": "SSH key rejected",
  "remote-disconnect": "Server sent SSH_MSG_DISCONNECT",
  "stream-end": "Long-lived stream ended (e.g. stats daemon died)",
  "tcp-close": "Clean FIN, no error attribution",
  "process-exit": "Remote process exited (normal)",
  "unknown": "Classifier didn't match a known pattern",
};

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function fmtBucketStart(startMs: number): string {
  const d = new Date(startMs);
  const end = new Date(startMs + 5 * 60_000);
  const hhmm = (x: Date) => `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
  return `${d.toLocaleDateString()} ${hhmm(d)}–${hhmm(end)}`;
}

function CauseBar({ count, max }: { count: number; max: number }) {
  const pct = max === 0 ? 0 : Math.max(2, Math.round((count / max) * 100));
  return (
    <div className="w-full bg-surface0 rounded-sm h-2 overflow-hidden">
      <div className="h-full bg-blue/70" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SshEventsPanel({ sshEvents }: { sshEvents: AdminState["sshEvents"] }) {
  const { report, hours, host, loading, error, lastRunAt } = sshEvents;

  useEffect(() => {
    if (!report && !loading) loadSshEventsReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      {/* Controls */}
      <div className="flex items-center gap-3 mb-3">
        <Activity size={16} className="text-blue" />
        <span className="text-md font-medium text-subtext0">SSH Events</span>
        {lastRunAt && <span className="text-xs text-overlay0">checked {new Date(lastRunAt).toLocaleTimeString()}</span>}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-md text-subtext0">
          Window
          <select
            value={hours}
            onChange={(e) => loadSshEventsReport({ hours: Number(e.target.value) })}
            disabled={loading}
            className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text"
          >
            <option value={1}>1 h</option>
            <option value={6}>6 h</option>
            <option value={24}>24 h</option>
            <option value={72}>3 d</option>
            <option value={168}>7 d</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-md text-subtext0">
          Host
          <input
            type="text"
            value={host}
            placeholder="10.128.x.y (blank = all)"
            onChange={(e) => { $admin.getValue().sshEvents.host = e.target.value; }}
            onBlur={() => loadSshEventsReport()}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadSshEventsReport(); } }}
            className="bg-surface0 border border-surface1 rounded px-2 py-1 text-md text-text font-mono w-48"
          />
        </label>
        <Button size="sm" onClick={() => loadSshEventsReport()} disabled={loading}>
          <RefreshCw size={14} className={cn("mr-1", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && <ErrorMessage className="mb-3">{error}</ErrorMessage>}

      {!report ? (
        <div className="text-overlay0 text-md py-8 text-center">{loading ? "Building report…" : "No data."}</div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryTile label="Window" value={`${report.windowHours} h`} sub={report.host ? `host: ${report.host}` : "all hosts"} />
            <SummaryTile label="Total events" value={report.totalEvents.toLocaleString()} />
            <SummaryTile label="Disconnects" value={report.disconnects.toLocaleString()} accent={report.disconnects > 0 ? "warn" : "ok"} />
            <SummaryTile label="Wireproxy lifecycle" value={report.wireproxyEvents.toLocaleString()} accent={report.wireproxyEvents > 0 ? "warn" : "ok"} />
          </div>

          {report.unknownPct > 10 && (
            <div className="mb-4 p-3 rounded border border-peach/30 bg-peach/10 text-md text-peach flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{report.unknownPct}%</span> of disconnects classified as <code className="font-mono">unknown</code> —
                the classifier in <code className="font-mono">ssh-events.ts:classifySshDisconnect</code> is missing a pattern. Open the
                most recent unknown rows in the SQL panel to find the message shape.
              </span>
            </div>
          )}

          {/* By cause */}
          <Section title="By cause" subtitle="Layer that owned the drop · avg connection life & idle-time-before-death">
            {report.byCause.length === 0 ? (
              <div className="text-overlay0 text-md">No disconnects in window — clean.</div>
            ) : (
              <table className="w-full text-md">
                <thead>
                  <tr className="text-left text-overlay0">
                    <th className="px-2 py-1 font-medium w-44">Cause</th>
                    <th className="px-2 py-1 font-medium w-16 text-right">Count</th>
                    <th className="px-2 py-1 font-medium">Share</th>
                    <th className="px-2 py-1 font-medium w-24">Avg life</th>
                    <th className="px-2 py-1 font-medium w-24" title="Time since last byte before death — diagnostic for keepalive-timeout: idle≈45s means dead path; idle≈0 means hard reset.">Avg idle</th>
                    <th className="px-2 py-1 font-medium">Hint</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const max = report.byCause[0]?.count ?? 1;
                    return report.byCause.map((c) => (
                      <tr key={c.cause} className="border-t border-surface0/60">
                        <td className="px-2 py-1.5 font-mono text-text">{c.cause}</td>
                        <td className="px-2 py-1.5 text-right text-text">{c.count}</td>
                        <td className="px-2 py-1.5"><CauseBar count={c.count} max={max} /></td>
                        <td className="px-2 py-1.5 text-subtext0 font-mono">{fmtMs(c.avgLifeMs)}</td>
                        <td className="px-2 py-1.5 text-subtext0 font-mono">{fmtMs(c.avgIdleMs)}</td>
                        <td className="px-2 py-1.5 text-overlay0">{CAUSE_HINTS[c.cause] ?? ""}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )}
          </Section>

          {/* By host × cause */}
          <Section title="By host × cause" subtitle="Top 20 — clustered on one host = VM issue; spread = path issue">
            {report.byHostCause.length === 0 ? (
              <div className="text-overlay0 text-md">No host-keyed drops.</div>
            ) : (
              <table className="w-full text-md">
                <thead>
                  <tr className="text-left text-overlay0">
                    <th className="px-2 py-1 font-medium">Host</th>
                    <th className="px-2 py-1 font-medium w-44">Cause</th>
                    <th className="px-2 py-1 font-medium w-16 text-right">Count</th>
                    <th className="px-2 py-1 font-medium w-40">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byHostCause.map((r, i) => (
                    <tr key={`${r.host}-${r.cause}-${i}`} className="border-t border-surface0/60">
                      <td className="px-2 py-1.5 font-mono text-text">{r.host}</td>
                      <td className="px-2 py-1.5 font-mono text-subtext0">{r.cause}</td>
                      <td className="px-2 py-1.5 text-right text-text">{r.count}</td>
                      <td className="px-2 py-1.5 text-subtext0">{new Date(r.lastAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Hot windows */}
          <Section title="Hot 5-min windows" subtitle="≥10 disconnects in a 5-minute bucket — flags wireproxy events landing in the same window">
            {report.hotWindows.length === 0 ? (
              <div className="text-overlay0 text-md">No bursts.</div>
            ) : (
              <table className="w-full text-md">
                <thead>
                  <tr className="text-left text-overlay0">
                    <th className="px-2 py-1 font-medium w-56">Window</th>
                    <th className="px-2 py-1 font-medium w-20 text-right">Drops</th>
                    <th className="px-2 py-1 font-medium">Correlates with</th>
                  </tr>
                </thead>
                <tbody>
                  {report.hotWindows.map((w) => (
                    <tr key={w.startMs} className="border-t border-surface0/60">
                      <td className="px-2 py-1.5 font-mono text-text">{fmtBucketStart(w.startMs)}</td>
                      <td className="px-2 py-1.5 text-right text-red font-medium">{w.drops}</td>
                      <td className="px-2 py-1.5">
                        {w.wpEvents.length > 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-peach/15 text-peach text-xs font-medium">
                            <Network size={11} />
                            {w.wpEvents.join(", ")}
                          </span>
                        ) : (
                          <span className="text-overlay0 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Wireproxy lifecycle */}
          <Section title="Wireproxy lifecycle" subtitle="Exits, respawns, and gave-up signals from the wireproxy supervisor">
            {report.wireproxyLifecycle.length === 0 ? (
              <div className="text-overlay0 text-md">No wireproxy lifecycle events.</div>
            ) : (
              <div className="flex flex-col">
                {report.wireproxyLifecycle.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs font-mono py-0.5 border-t border-surface0/40 first:border-t-0">
                    <span className="text-overlay0 w-40 shrink-0">{new Date(e.occurredAt).toLocaleString()}</span>
                    <span className={cn(
                      "w-28 shrink-0",
                      e.event === "wireproxy-gaveup" ? "text-red font-medium" : e.event === "wireproxy-exit" ? "text-peach" : "text-subtext0",
                    )}>{e.event}</span>
                    {e.detail && <span className="text-overlay0 break-all">{e.detail}</span>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "ok" | "warn" }) {
  return (
    <div className="border border-overlay0/20 rounded-lg bg-mantle/60 p-3">
      <div className="text-xs text-overlay0 uppercase tracking-wide mb-1">{label}</div>
      <div className={cn("text-lg font-semibold font-mono", accent === "warn" ? "text-peach" : accent === "ok" ? "text-green" : "text-text")}>{value}</div>
      {sub && <div className="text-xs text-overlay0 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 border border-overlay0/20 rounded-lg bg-mantle/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-overlay0/15 bg-crust/40">
        <div className="text-md font-medium text-text">{title}</div>
        {subtitle && <div className="text-xs text-overlay0 mt-0.5">{subtitle}</div>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
