/** tmux command builders for remote exec (mirrors manager ssh/tmux/commands.ts). */

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const TMUX_BIN_PREAMBLE =
  'export PATH="/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; ' +
  'T=$(command -v tmux 2>/dev/null || true); ' +
  '[ -z "$T" ] && [ -e /snap/bin/tmux ] && T=/snap/bin/tmux; ' +
  '[ -z "$T" ] && [ -e /usr/bin/tmux ] && T=/usr/bin/tmux';

// Mirrors the server-side constant in ssh/tmux/commands.ts: mouse on so wheel
// events scroll Claude's history (tmux copy mode), and a generous scrollback.
const TMUX_SERVER_OPTIONS =
  '"$T" set-option -gq mouse on 2>/dev/null || true; ' +
  '"$T" set-option -gq history-limit 50000 2>/dev/null || true';

function withTmux(action: string): string {
  return `${TMUX_BIN_PREAMBLE}; if [ -n "$T" ]; then ${action}; else echo "tmux: command not found" >&2; exit 127; fi`;
}

/** Attach or switch to a session — works from a login shell or from inside tmux. */
export function tmuxAttachShellCommand(sessionName: string): string {
  const target = shellSingleQuote(sessionName);
  return withTmux(`${TMUX_SERVER_OPTIONS}; ("$T" attach -t ${target} 2>/dev/null || "$T" switch-client -t ${target})`);
}

/** Wrap a shell one-liner so keystrokes are not echoed into the live PTY (xterm). */
export function wrapSilentPtyCommand(command: string): string {
  return `{ stty -echo 2>/dev/null; ${command}; stty sane 2>/dev/null; } 2>/dev/null`;
}

export function tmuxRenameCommand(sessionName: string, newName: string): string {
  const target = shellSingleQuote(sessionName);
  const next = shellSingleQuote(newName);
  // Verify the new name exists after rename — surfaces failures even when tmux
  // prints to stdout instead of using a non-zero exit in edge cases.
  return withTmux(
    `"$T" rename-session -t ${target} ${next} && "$T" has-session -t ${next}`,
  );
}

export function tmuxKillSessionCommand(sessionName: string): string {
  const target = shellSingleQuote(sessionName);
  return withTmux(`"$T" kill-session -t ${target}`);
}
