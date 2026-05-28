import type { ClaudeLaunchOptions, SshConfig, TerminalLaunchKind, TerminalTab } from "@/store/types/vps";

/** Canonical project root on Genie VPS images (Genie Standard Setup). */
export const GENIE_PROJECT_DIR = "/opt/project";

export type { ClaudeLaunchOptions, TerminalLaunchKind };

/** Persisted / display label for Claude sessions (no `cd` prefix). */
export function claudeCommandLabel(resume?: boolean): string {
  return resume
    ? "claude --dangerously-skip-permissions --resume"
    : "claude --dangerously-skip-permissions";
}

export interface TerminalSshSpawnPayload {
  id: string;
  cols: number;
  rows: number;
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
  title?: string;
  kind: TerminalLaunchKind;
  command?: string;
  cwd?: string;
  claudeResume?: boolean;
}

export function buildTerminalSshSpawnPayload(
  tab: TerminalTab,
  cols: number,
  rows: number,
): TerminalSshSpawnPayload | null {
  if (!tab.ssh) return null;
  const kind: TerminalLaunchKind = tab.kind ?? "shell";
  return {
    id: tab.id,
    cols,
    rows,
    host: tab.ssh.host,
    port: tab.ssh.port,
    username: tab.ssh.username,
    privateKeyPath: tab.ssh.privateKeyPath,
    title: tab.title,
    kind,
    command: kind === "shell" ? tab.command : undefined,
    cwd: kind === "claude" ? (tab.claudeLaunch?.cwd ?? GENIE_PROJECT_DIR) : tab.cwd,
    claudeResume: kind === "claude" ? !!tab.claudeLaunch?.resume : undefined,
  };
}

export function defaultClaudeTabTitle(ssh: SshConfig, vmName?: string): string {
  const user = ssh.username || "genie";
  const host = vmName || ssh.host;
  return `Claude ${user}@${host}`;
}
