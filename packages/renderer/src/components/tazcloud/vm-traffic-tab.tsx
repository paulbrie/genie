"use client";

// Manage popup tab: a live view of SSH traffic to/from a VM — throughput graph
// (derived by diffing cumulative byte totals), per-PTY-session byte breakdown,
// the recent exec/probe command log, and the connect/drop event timeline. Polls
// vps:traffic:get every ~1.5s while open. Read-only.

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, TerminalSquare, Zap } from "lucide-react";
import { wsRequest } from "@/lib/ws";
import { cn } from "@/lib/utils";

interface SessionTraffic {
  terminalId: string;
  status: "open" | "closed";
  openedByUserName: string | null;
  openedAt: number;
  bytesIn: number;
  bytesOut: number;
}
interface CommandRecord {
  id: string;
  ts: number;
  kind: "exec" | "probe";
  command: string;
  bytesOut: number;
  bytesIn: number;
  durationMs: number;
  ok: boolean;
}
interface SshEvent {
  occurredAt: number;
  event: string;
  cause?: string;
  lifetimeMs?: number;
  lastDataAgeMs?: number;
  detail?: string;
}
interface TrafficSnapshot {
  host: string;
  totals: { bytesIn: number; bytesOut: number };
  sessions: SessionTraffic[];
  commands: CommandRecord[];
  events: SshEvent[];
  error?: string;
}

const POLL_MS = 1500;
const MAX_SAMPLES = 60;

function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtRate(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`;
}
function fmtClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour12: false });
}
function fmtAge(ms: number | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Two-series sparkline (in = green, out = blue) over recent throughput samples. */
function ThroughputChart({ samples }: { samples: { in: number; out: number }[] }) {
  const W = 600;
  const H = 90;
  const max = Math.max(1, ...samples.flatMap((s) => [s.in, s.out]));
  const n = Math.max(samples.length, 2);
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 6) - 3;
  const path = (sel: (s: { in: number; out: number }) => number) =>
    samples.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(s)).toFixed(1)}`).join(" ");
  const last = samples[samples.length - 1] ?? { in: 0, out: 0 };
  return (
    <div className="rounded-md border border-surface0 bg-mantle p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-overlay0 text-sm">
          <Zap size={13} /> Throughput (live)
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-green flex items-center gap-1"><ArrowDown size={12} />{fmtRate(last.in)}</span>
          <span className="text-blue flex items-center gap-1"><ArrowUp size={12} />{fmtRate(last.out)}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
        <polyline points="" />
        {samples.length >= 2 && (
          <>
            <path d={path((s) => s.in)} fill="none" stroke="var(--color-green, #a6e3a1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <path d={path((s) => s.out)} fill="none" stroke="var(--color-blue, #89b4fa)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {samples.length < 2 && <div className="text-overlay0 text-xs text-center mt-1">collecting…</div>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-surface0 bg-mantle">
      <div className="px-3 py-2 border-b border-surface0 text-overlay0 text-sm font-medium">
        {title}{count != null && <span className="text-overlay0/70"> · {count}</span>}
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-thin">{children}</div>
    </div>
  );
}

export function VmTrafficTab({ projectId, instanceId }: { projectId: string; instanceId: string }) {
  const [snap, setSnap] = useState<TrafficSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ in: number; out: number }[]>([]);
  const prevRef = useRef<{ bytesIn: number; bytesOut: number; t: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await wsRequest<TrafficSnapshot>("vps:traffic:get", { projectId, instanceId }, 10_000);
        if (!alive) return;
        if (s.error) { setErr(s.error); return; }
        setErr(null);
        setSnap(s);
        const now = Date.now();
        const prev = prevRef.current;
        if (prev) {
          const dt = (now - prev.t) / 1000 || 1;
          setSamples((h) => [
            ...h.slice(-(MAX_SAMPLES - 1)),
            {
              in: Math.max(0, (s.totals.bytesIn - prev.bytesIn) / dt),
              out: Math.max(0, (s.totals.bytesOut - prev.bytesOut) / dt),
            },
          ]);
        }
        prevRef.current = { bytesIn: s.totals.bytesIn, bytesOut: s.totals.bytesOut, t: now };
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [projectId, instanceId]);

  if (!snap && !err) {
    return <div className="flex items-center gap-2 p-4 text-overlay0"><Loader2 size={14} className="animate-spin" /> Loading traffic…</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {err && <div className="text-red text-md">{err}</div>}

      <ThroughputChart samples={samples} />

      {snap && (
        <div className="flex items-center gap-4 text-sm text-overlay0 px-1">
          <span className="flex items-center gap-1"><ArrowDown size={12} className="text-green" /> total in {fmtBytes(snap.totals.bytesIn)}</span>
          <span className="flex items-center gap-1"><ArrowUp size={12} className="text-blue" /> total out {fmtBytes(snap.totals.bytesOut)}</span>
        </div>
      )}

      <Section title="Sessions (PTY)" count={snap?.sessions.length}>
        {!snap?.sessions.length ? (
          <div className="px-3 py-2 text-overlay0 text-sm">No interactive sessions.</div>
        ) : snap.sessions.map((s) => (
          <div key={s.terminalId} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-surface0/50 last:border-0">
            <TerminalSquare size={13} className={cn("shrink-0", s.status === "open" ? "text-green" : "text-overlay0")} />
            <span className="text-text truncate flex-1 font-mono text-xs">{s.openedByUserName ?? "—"} · {fmtClock(s.openedAt)}</span>
            <span className="text-green font-mono shrink-0"><ArrowDown size={11} className="inline" />{fmtBytes(s.bytesIn)}</span>
            <span className="text-blue font-mono shrink-0"><ArrowUp size={11} className="inline" />{fmtBytes(s.bytesOut)}</span>
          </div>
        ))}
      </Section>

      <Section title="Command log" count={snap?.commands.length}>
        {!snap?.commands.length ? (
          <div className="px-3 py-2 text-overlay0 text-sm">No commands recorded yet.</div>
        ) : snap.commands.map((c) => (
          <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-surface0/50 last:border-0">
            <span className="text-overlay0 font-mono text-xs shrink-0 w-16">{fmtClock(c.ts)}</span>
            <span className={cn("text-[10px] uppercase px-1 rounded shrink-0", c.kind === "probe" ? "bg-surface0 text-overlay0" : "bg-surface1 text-subtext0")}>{c.kind}</span>
            <code className={cn("truncate flex-1 text-xs", c.ok ? "text-text" : "text-red")}>{c.command}</code>
            <span className="text-overlay0 font-mono text-xs shrink-0">{fmtAge(c.durationMs)}</span>
            <span className="text-blue font-mono text-xs shrink-0"><ArrowUp size={10} className="inline" />{fmtBytes(c.bytesOut)}</span>
            <span className="text-green font-mono text-xs shrink-0"><ArrowDown size={10} className="inline" />{fmtBytes(c.bytesIn)}</span>
          </div>
        ))}
      </Section>

      <Section title="Connection timeline" count={snap?.events.length}>
        {!snap?.events.length ? (
          <div className="px-3 py-2 text-overlay0 text-sm">No connection events.</div>
        ) : snap.events.map((e, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-surface0/50 last:border-0">
            <span className="text-overlay0 font-mono text-xs shrink-0 w-16">{fmtClock(e.occurredAt)}</span>
            <span className={cn("shrink-0", e.event === "disconnect" ? "text-red" : "text-yellow")}>{e.cause ?? e.event}</span>
            <span className="text-overlay0 text-xs flex-1 truncate">{e.detail}</span>
            {e.lifetimeMs != null && <span className="text-overlay0 font-mono text-xs shrink-0">life {fmtAge(e.lifetimeMs)}</span>}
            {e.lastDataAgeMs != null && <span className="text-overlay0 font-mono text-xs shrink-0">idle {fmtAge(e.lastDataAgeMs)}</span>}
          </div>
        ))}
      </Section>
    </div>
  );
}
