"use client";

import { useEffect } from "react";
import { RefreshCw, Plug } from "lucide-react";
import type { ConnectionLogRow } from "@/store/types";
import { loadConnectionLogs } from "@/store/actions";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { cn } from "@/lib/utils";

interface ConnectionsState {
  rows: ConnectionLogRow[];
  hours: number;
  closeCode: number | null;
  loading: boolean;
  error: string | null;
  lastRunAt: number | null;
}

const WINDOWS = [1, 6, 24, 72, 168] as const;
const CODE_FILTERS: { label: string; code: number | null }[] = [
  { label: "All", code: null },
  { label: "1006 edge-drop", code: 1006 },
  { label: "1001 going-away", code: 1001 },
  { label: "1000 normal", code: 1000 },
];

/** A clean app-close (normal/going-away) vs an edge/peer drop (1006 etc.). */
function codeTone(code: number | null): string {
  if (code === 1000 || code === 1001) return "text-subtext0";
  if (code === 1006) return "text-red";
  return "text-peach";
}

function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export function ConnectionsPanel({ connections }: { connections: ConnectionsState }) {
  const c = connections;
  // Self-load on first mount (covers a deep-link to /admin/connections).
  useEffect(() => {
    if (!c.lastRunAt && !c.loading) loadConnectionLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Plug size={16} className="text-blue" />
        <span className="text-md font-medium text-subtext0">WebSocket disconnects</span>
        <span className="text-md text-overlay0 font-mono">{c.rows.length}</span>
        {c.lastRunAt && <span className="text-xs text-overlay0">checked {new Date(c.lastRunAt).toLocaleTimeString()}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {WINDOWS.map((h) => (
            <button
              key={h}
              onClick={() => loadConnectionLogs({ hours: h })}
              className={cn("px-2 py-1 text-md rounded transition-colors", c.hours === h ? "bg-blue/20 text-blue" : "text-overlay0 hover:text-text")}
            >
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {CODE_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => loadConnectionLogs({ closeCode: f.code })}
              className={cn("px-2 py-1 text-md rounded transition-colors", c.closeCode === f.code ? "bg-surface1 text-text" : "text-overlay0 hover:text-text")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => loadConnectionLogs()} disabled={c.loading}>
          <RefreshCw size={14} className={cn("mr-1", c.loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {c.error && <ErrorMessage className="mb-3">{c.error}</ErrorMessage>}

      <div className="border border-overlay0/20 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1.3fr_1.4fr_1.1fr_0.7fr_0.7fr_1.2fr_1.4fr] gap-2 px-3 py-2 bg-crust/60 text-xs font-medium text-overlay0 uppercase tracking-wide">
          <span>Closed</span>
          <span>User</span>
          <span>Close code</span>
          <span>Alive</span>
          <span>Lifetime</span>
          <span>Client / IP</span>
          <span>Reason / reqId</span>
        </div>
        {c.rows.length === 0 && (
          <div className="px-3 py-4 text-overlay0 text-md">{c.loading ? "Loading…" : "No disconnects in this window."}</div>
        )}
        {c.rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[1.3fr_1.4fr_1.1fr_0.7fr_0.7fr_1.2fr_1.4fr] gap-2 px-3 py-2 border-t border-overlay0/10 text-md items-start">
            <span className="text-xs text-subtext0 font-mono">{new Date(r.closedAt).toLocaleString()}</span>
            <span className="text-text truncate" title={r.userId ?? ""}>{r.userName ?? r.userId ?? "unauthed"}</span>
            <span className={cn("text-xs font-mono", codeTone(r.closeCode))}>
              {r.closeCode ?? "—"} {r.closeDescription ?? ""}
              {r.closeHint && <span className="text-overlay0"> · server:{r.closeHint}</span>}
            </span>
            <span className={cn("text-xs", r.aliveLastPing === false ? "text-red" : "text-overlay0")}>
              {r.aliveLastPing == null ? "—" : r.aliveLastPing ? "yes" : "no-pong"}
            </span>
            <span className="text-xs font-mono text-subtext0">{fmtDur(r.durationSec)}</span>
            <span className="text-xs text-subtext0 break-all">
              {r.clientType ?? "?"}
              <div className="text-overlay0 font-mono">{r.ip ?? "—"}</div>
            </span>
            <span className="text-xs text-overlay0 break-all">
              {r.closeReason || "—"}
              {r.railwayRequestId && <div className="font-mono">{r.railwayRequestId}</div>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
