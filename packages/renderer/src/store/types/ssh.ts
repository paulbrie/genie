export interface SshSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  kind: "client" | "pty";
  openedAt: number;
  opener: string;
}

export interface SshTunnelInfo {
  host: string;
  projectName: string;
  openedAt: number;
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
