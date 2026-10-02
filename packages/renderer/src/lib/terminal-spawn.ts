import type { ClaudeLaunchOptions, SshConfig, TerminalLaunchKind, TerminalTab } from "@/store/types/vps";

export const GENIE_PROJECT_DIR = "/opt/project";

export type { ClaudeLaunchOptions, TerminalLaunchKind };

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
  _tab: TerminalTab,
  _cols: number,
  _rows: number,
): TerminalSshSpawnPayload | null {
  return null;
}

export function defaultClaudeTabTitle(ssh: SshConfig, vmName?: string): string {
  const user = ssh.username || "genie";
  const host = vmName || ssh.host;
  return `Claude ${user}@${host}`;
}
