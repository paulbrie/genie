export interface SshSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  kind: "client" | "pty";
  openedAt: number;
  opener: string;
}

export interface SshState {
  sessions: SshSessionInfo[];
  loading: boolean;
  killing: Record<string, boolean>;
}
