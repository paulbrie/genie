export interface SshSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  kind: "client" | "pty";
  /** Shared tunnel key (host:port:username) when kind is pty. */
  parentKey?: string;
  /** "connecting" = dial in flight (a hung handshake shows here instead of being
   *  invisible until ready); "connected" = handshake complete. Optional so older
   *  manager builds that omit it still parse. */
  status?: "connecting" | "connected";
  openedAt: number;
  opener: string;
}

export interface SshChannelSnapshot {
  terminalId: string;
  status: "open" | "closed";
  cols: number;
  rows: number;
  projectId: string | null;
  instanceId: string | null;
  openedAt: number;
  bytesIn: number;
  bytesOut: number;
}

export interface SharedTunnelSnapshot {
  key: string;
  host: string;
  port: number;
  username: string;
  status: "connecting" | "connected" | "disconnected";
  manageRefs: number;
  channelCount: number;
  execInFlight: boolean;
  pinned: boolean;
  openedAt: number;
  channels: SshChannelSnapshot[];
}

export interface SshTunnelInfo {
  host: string;
  projectName: string;
  openedAt: number;
  /** False when the underlying SSH session has dropped but the entry hasn't been
   *  evicted yet. Optional for forward-compat with older manager builds. */
  alive?: boolean;
  browser: boolean;
  stream: boolean;
  security: boolean;
  notify: boolean;
  storage: boolean;
}

/** A recorded SSH disconnect / wireproxy lifecycle event (flight recorder). */
export interface SshEventInfo {
  occurredAt: number;
  host: string;
  port?: number;
  username?: string;
  kind: "client" | "pty" | "stats" | "tunnel" | "wireproxy";
  event: "disconnect" | "wireproxy-exit" | "wireproxy-respawn" | "wireproxy-gaveup";
  cause?: string;
  lifetimeMs?: number;
  lastDataAgeMs?: number;
  detail?: string;
}

export interface SshState {
  sessions: SshSessionInfo[];
  tunnels: SshTunnelInfo[];
  sharedTunnels: SharedTunnelSnapshot[];
  /** Recent disconnects / wireproxy events, newest first (in-memory ring). */
  events: SshEventInfo[];
  loading: boolean;
  killing: Record<string, boolean>;
  reconnectingHosts: Record<string, boolean>;
}
