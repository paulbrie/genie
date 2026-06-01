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

function withTmux(action: string): string {
  return `${TMUX_BIN_PREAMBLE}; if [ -n "$T" ]; then ${action}; else echo "tmux: command not found" >&2; exit 127; fi`;
}

export function createTmuxSessionName(): string {
  return `tab-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function tmuxAttachShellCommand(sessionName: string): string {
  const target = shellSingleQuote(sessionName);
  return withTmux(`("$T" attach -t ${target} 2>/dev/null || "$T" switch-client -t ${target})`);
}

export function tmuxNewSessionShellCommand(sessionName: string): string {
  const quoted = shellSingleQuote(sessionName);
  return withTmux(`exec "$T" new-session -s ${quoted}`);
}

export function tmuxRenameCommand(sessionName: string, newName: string): string {
  const target = shellSingleQuote(sessionName);
  const next = shellSingleQuote(newName);
  return withTmux(`"$T" rename-session -t ${target} ${next}`);
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
