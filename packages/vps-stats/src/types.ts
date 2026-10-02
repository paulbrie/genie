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
  /** Established TCP connections to the VM's sshd (local port 22), counted from
   *  `ss`. Unlike sshSessions (pty logins via `who`), this includes the manager's
   *  non-pty exec/tunnel channels — the connections that actually pile up when a
   *  client dies without a clean close. A count that climbs and never settles is
   *  the signature of orphaned sshd accumulating (e.g. a manager restarting on a
   *  dev watch without ClientAlive reaping them). Optional for rollout. */
  sshEstablished?: number;
  /** Configured sshd `MaxStartups` (e.g. "10:30:100" = start:rate%:full), or
   *  null if it couldn't be read. Optional so the manager tolerates payloads
   *  from VMs still running an older agent during rollout. */
  sshMaxStartups?: string | null;
  /** SSH connections sshd dropped due to MaxStartups during the interval since
   *  the previous sample (count of "past MaxStartups" journal lines). A non-zero
   *  value means the daemon is refusing unauthenticated connections — i.e. it's
   *  being hit by a connection burst. Optional for the same rollout reason. */
  sshMaxStartupsDrops?: number;
  /** Effective sshd `ClientAliveInterval` / `ClientAliveCountMax` (seconds /
   *  count) from `sshd -T`. 0 interval = the server never probes, so a client
   *  that vanishes leaves an orphaned sshd until TCP keepalive (~2h). Surfacing
   *  these lets you confirm the genie-standard reaper config is applied fleet-wide
   *  and catch drift. null when unreadable. Optional for rollout. */
  sshClientAliveInterval?: number | null;
  sshClientAliveCountMax?: number | null;
}

export interface StatsOutboundMessage {
  type: "stats";
  ts: number;
  stats: VpsStatsPayload;
}
