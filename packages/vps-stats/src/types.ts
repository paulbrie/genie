export interface VpsProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cpu: number;
  mem: number;
  user: string;
  port: string;
}

export interface VpsStatsPayload {
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
  processes: VpsProcessInfo[];
  openPorts: number[];
  externalPorts: number[];
  /** Interactive SSH login sessions on the VM (`who` count). */
  sshSessions: number;
  /** Configured sshd `MaxStartups` (e.g. "10:30:100" = start:rate%:full), or
   *  null if it couldn't be read. Optional so the manager tolerates payloads
   *  from VMs still running an older agent during rollout. */
  sshMaxStartups?: string | null;
  /** SSH connections sshd dropped due to MaxStartups during the interval since
   *  the previous sample (count of "past MaxStartups" journal lines). A non-zero
   *  value means the daemon is refusing unauthenticated connections — i.e. it's
   *  being hit by a connection burst. Optional for the same rollout reason. */
  sshMaxStartupsDrops?: number;
}

export interface StatsOutboundMessage {
  type: "stats";
  ts: number;
  stats: VpsStatsPayload;
}
