/**
 * Delayed command injection on the interactive PTY. Used to send a "tmux
 * attach" or "tmux new" line a few hundred ms after the shell prompt appears.
 */
import type { SshShellSession } from "./shell.js";

export const SHELL_COMMAND_DELAY_MS = 800;
const SHELL_WARMUP_MS = 120;

export type ShellCommandCancel = () => void;

export function scheduleShellCommand(
  session: SshShellSession,
  command: string,
  delayMs = SHELL_COMMAND_DELAY_MS,
): ShellCommandCancel {
  let innerTimer: ReturnType<typeof setTimeout> | null = null;

  const outerTimer = setTimeout(() => {
    if (!session.isActive()) return;
    session.write("\n");
    innerTimer = setTimeout(() => {
      if (!session.isActive()) return;
      session.write(`${command}\n`);
    }, SHELL_WARMUP_MS);
  }, delayMs);

  return () => {
    clearTimeout(outerTimer);
    if (innerTimer) clearTimeout(innerTimer);
  };
}
