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
}

export interface StatsOutboundMessage {
  type: "stats";
  ts: number;
  stats: VpsStatsPayload;
}
