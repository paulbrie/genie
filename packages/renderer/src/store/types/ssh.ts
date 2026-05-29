export interface SshSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  kind: "client" | "pty";
  /** "connecting" = dial in flight (a hung handshake shows here instead of being
   *  invisible until ready); "connected" = handshake complete. Optional so older
   *  manager builds that omit it still parse. */
  status?: "connecting" | "connected";
  openedAt: number;
  opener: string;
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

export interface SshState {
  sessions: SshSessionInfo[];
  tunnels: SshTunnelInfo[];
  loading: boolean;
  killing: Record<string, boolean>;
  reconnectingHosts: Record<string, boolean>;
}
