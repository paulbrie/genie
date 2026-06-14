// Aggregates a live "what's flowing to/from this VM" snapshot for the Manage
// popup's Traffic tab: cumulative byte totals (for the client to derive a live
// throughput graph by diffing), per-PTY-session byte breakdown, the recent
// exec/probe command log, and the connect/drop event timeline. Read-only; pulls
// from the session cache, the command ring, and the SSH event ring.

import { listSharedTunnels } from "./ssh-session-cache.js";
import { listRecentSshEvents, type SshEvent } from "./ssh-events.js";
import { execTotals, listCommands, type SshCommandRecord } from "./ssh-traffic.js";

export interface VmSessionTraffic {
  terminalId: string;
  status: "open" | "closed";
  openedByUserName: string | null;
  openedAt: number;
  bytesIn: number;
  bytesOut: number;
}

export interface VmTrafficSnapshot {
  host: string;
  /** Cumulative since manager boot: PTY channel bytes + exec/probe bytes. The
   *  client diffs successive snapshots to plot throughput. */
  totals: { bytesIn: number; bytesOut: number };
  sessions: VmSessionTraffic[];
  commands: SshCommandRecord[];
  events: SshEvent[];
}

export function getVmTraffic(host: string): VmTrafficSnapshot {
  const tunnels = listSharedTunnels().filter((t) => t.host === host);
  let ptyIn = 0;
  let ptyOut = 0;
  const sessions: VmSessionTraffic[] = [];
  for (const t of tunnels) {
    for (const ch of t.channels) {
      ptyIn += ch.bytesIn;
      ptyOut += ch.bytesOut;
      sessions.push({
        terminalId: ch.terminalId,
        status: ch.status,
        openedByUserName: ch.openedByUserName,
        openedAt: ch.openedAt,
        bytesIn: ch.bytesIn,
        bytesOut: ch.bytesOut,
      });
    }
  }
  const ex = execTotals(host);
  return {
    host,
    totals: { bytesIn: ptyIn + ex.bytesIn, bytesOut: ptyOut + ex.bytesOut },
    sessions: sessions.sort((a, b) => b.openedAt - a.openedAt),
    commands: listCommands(host, 100),
    events: listRecentSshEvents(200).filter((e) => e.host === host).slice(0, 100),
  };
}
