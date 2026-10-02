/**
 * tmux command builders that resolve the binary across PATH / /snap/bin / /usr/bin
 * (Ubuntu snap installs aren't always on PATH for non-login SSH shells).
 */

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const TMUX_BIN_PREAMBLE =
  'export PATH="/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; ' +
  'T=$(command -v tmux 2>/dev/null || true); ' +
  '[ -z "$T" ] && [ -e /snap/bin/tmux ] && T=/snap/bin/tmux; ' +
  '[ -z "$T" ] && [ -e /usr/bin/tmux ] && T=/usr/bin/tmux';

// Mouse on so the popup's wheel forwards as a mouse event → tmux enters copy
// mode and scrolls the pane history (the only way to see Claude's prior output
// while it's in tmux's alt buffer). 50k-line history-limit keeps long Claude
// sessions fully scrollable. Quiet (-gq) + 2>/dev/null so a stale server / old
// tmux build doesn't surface a noisy line into the user's PTY.
const TMUX_SERVER_OPTIONS =
  '"$T" set-option -gq mouse on 2>/dev/null || true; ' +
  '"$T" set-option -gq history-limit 50000 2>/dev/null || true';

function withTmux(action: string): string {
  return `${TMUX_BIN_PREAMBLE}; if [ -n "$T" ]; then ${action}; else echo "tmux: command not found" >&2; exit 127; fi`;
}

export function tmuxAttachShellCommand(sessionName: string): string {
  const target = shellSingleQuote(sessionName);
  return withTmux(`${TMUX_SERVER_OPTIONS}; ("$T" attach -t ${target} 2>/dev/null || "$T" switch-client -t ${target})`);
}

/** Suppress PTY echo while a one-shot shell line runs (tmux attach on reconnect). */
export function wrapSilentPtyCommand(command: string): string {
  return `{ stty -echo 2>/dev/null; ${command}; stty sane 2>/dev/null; } 2>/dev/null`;
}

export function createTmuxSessionName(): string {
  return `tab-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function tmuxNewSessionShellCommand(sessionName: string): string {
  const quoted = shellSingleQuote(sessionName);
  // start-server up front so set-option -g hits a real server (set-option fails
  // if no server is running, and new-session would otherwise spawn one without
  // the options).
  return withTmux(`"$T" start-server 2>/dev/null || true; ${TMUX_SERVER_OPTIONS}; exec "$T" new-session -s ${quoted}`);
}

/** Attach-or-create a tmux session that runs `command` as its process (e.g.
 *  Claude). `-A` makes a re-launch with the same name reattach instead of
 *  spawning a duplicate. When `command` exits the pane/session ends — that's the
 *  desired behaviour for a Claude tab (the badge disappears once Claude quits). */
export function tmuxNewSessionWithCommandShellCommand(sessionName: string, command: string): string {
  const quotedName = shellSingleQuote(sessionName);
  const quotedCmd = shellSingleQuote(command);
  return withTmux(`"$T" start-server 2>/dev/null || true; ${TMUX_SERVER_OPTIONS}; exec "$T" new-session -A -s ${quotedName} ${quotedCmd}`);
}

export function tmuxRenameCommand(sessionName: string, newName: string): string {
  const target = shellSingleQuote(sessionName);
  const next = shellSingleQuote(newName);
  return withTmux(
    `"$T" rename-session -t ${target} ${next} && "$T" has-session -t ${next}`,
  );
}

export function tmuxKillSessionCommand(sessionName: string): string {
  const target = shellSingleQuote(sessionName);
  return withTmux(`"$T" kill-session -t ${target}`);
}

export function execShellScript(script: string): string {
  return `echo ${Buffer.from(script).toString("base64")} | base64 -d | bash`;
}

export type TmuxShellIntent = "attach" | "new";

export function resolveTmuxShellCommand(intent: TmuxShellIntent, sessionName: string): string {
  return intent === "new"
    ? tmuxNewSessionShellCommand(sessionName)
    : tmuxAttachShellCommand(sessionName);
}
