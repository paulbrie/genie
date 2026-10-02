/**
 * Remote stats / tmux probe helpers.
 * Prefers `tmux list-sessions -F` machine output; falls back to parsing `tmux ls`.
 */

export type VpsResourceStats = {
  cpu: number;
  memory: number;
  disk: number;
};

export type RemoteProbeResult = {
  stats: VpsResourceStats | null;
  tmuxSessions: string[];
};

const TMUX_BIN_PREAMBLE =
  'export PATH="/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"; ' +
  'T=$(command -v tmux 2>/dev/null || true); ' +
  '[ -z "$T" ] && [ -e /snap/bin/tmux ] && T=/snap/bin/tmux; ' +
  '[ -z "$T" ] && [ -e /usr/bin/tmux ] && T=/usr/bin/tmux';

// `#{pane_current_command}` resolves, in session context, to the active pane's
// foreground command — our signal for "something is running in this session"
// (a non-shell command). Appended as a 4th field; the `tmux ls` fallback can't
// provide it (parsed as empty → unknown).
const TMUX_LIST_WITH_BIN =
  '"$T" list-sessions -F \'GENIE_TMUX #{session_name}|#{session_windows}|#{session_attached}|#{pane_current_command}\' 2>/dev/null ' +
  '|| "$T" ls 2>&1 || true';

const TMUX_LIST_BODY =
  "tmux list-sessions -F 'GENIE_TMUX #{session_name}|#{session_windows}|#{session_attached}|#{pane_current_command}' 2>/dev/null " +
  "|| tmux ls 2>&1 || true";

/** SSH exec fallback when no live terminal — always exits 0. */
export const TMUX_PROBE_COMMAND =
  `${TMUX_BIN_PREAMBLE}; if [ -n "$T" ]; then ${TMUX_LIST_WITH_BIN}; else true; fi`;

const STATS_SCRIPT = `cpu=$(awk '/^cpu /{print int(($2+$4)*100/($2+$3+$4+$5))}' /proc/stat)
mem=$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END {if(t>0) print int((t-a)*100/t); else print 0}' /proc/meminfo)
disk=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
printf 'GENIE_STATS cpu=%s mem=%s disk=%s\\n' "$cpu" "$mem" "$disk"
${TMUX_BIN_PREAMBLE}
if [ -n "$T" ]; then ${TMUX_LIST_WITH_BIN}; fi
exit 0`;

export const STATS_COMMAND = `echo ${Buffer.from(STATS_SCRIPT).toString("base64")} | base64 -d | bash`;

const STATS_PATTERN = /GENIE_STATS cpu=(\d+(?:\.\d+)?) mem=(\d+(?:\.\d+)?) disk=(\d+(?:\.\d+)?)/;
const TMUX_PATTERN = /^GENIE_TMUX\s+(.+)$/;
/** Matches `name: N windows (created …)( attached)` from `tmux ls`. */
const TMUX_LS_PATTERN = /^([^\s:]+):\s+(\d+)\s+windows\b/;

function parseTmuxLsLine(line: string): string | null {
  const trimmed = line.trim();
  const m = trimmed.match(TMUX_LS_PATTERN);
  if (!m) return null;
  const attached = /\(attached\)/.test(trimmed) ? "1" : "0";
  return `${m[1]}|${m[2]}|${attached}|`; // no current-command from `tmux ls`
}

/** Foreground commands that mean "just a shell at the prompt" — i.e. nothing is
 *  actually running. Anything else in the active pane (a build, a test run, vim,
 *  etc.) counts as running and glows the badge. */
const SHELL_COMMANDS = new Set([
  "bash", "-bash", "zsh", "-zsh", "sh", "-sh", "fish", "-fish", "dash", "ksh", "login",
]);

export function parseProbeOutput(output: string): RemoteProbeResult {
  const lines = output.replace(/\r/g, "").split("\n");
  let stats: VpsResourceStats | null = null;
  const tmuxSessions: string[] = [];

  for (const line of lines) {
    const tmuxMatch = line.match(TMUX_PATTERN);
    if (tmuxMatch) {
      tmuxSessions.push(tmuxMatch[1].trim());
      continue;
    }
    const statsMatch = line.match(STATS_PATTERN);
    if (statsMatch && !stats) {
      stats = {
        cpu: Math.round(Number(statsMatch[1])),
        memory: Math.round(Number(statsMatch[2])),
        disk: Math.round(Number(statsMatch[3])),
      };
    }
  }

  if (tmuxSessions.length === 0) {
    for (const line of lines) {
      const entry = parseTmuxLsLine(line);
      if (entry) tmuxSessions.push(entry);
    }
  }

  return { stats, tmuxSessions };
}

export function statsToClient(stats: VpsResourceStats) {
  return { cpu: stats.cpu, mem: stats.memory, disk: stats.disk };
}

export type TmuxSessionInfo = {
  name: string;
  windows: number | null;
  attached: boolean | null;
  /** True when the active pane is running a non-shell command. null = unknown
   *  (e.g. the `tmux ls` fallback, which can't report the current command). */
  running: boolean | null;
};

export function tmuxSessionsToClient(sessions: string[]): TmuxSessionInfo[] {
  return sessions.map((entry) => {
    const [name, windows, attached, command] = entry.split("|");
    if (!name) return { name: entry, windows: null, attached: null, running: null };
    const cmd = (command ?? "").trim();
    return {
      name,
      windows: windows ? Number(windows) : null,
      attached: attached === "1" ? true : attached === "0" ? false : null,
      running: cmd === "" ? null : !SHELL_COMMANDS.has(cmd),
    };
  });
}

export function probeSucceeded(probe: RemoteProbeResult): boolean {
  return probe.stats != null || probe.tmuxSessions.length > 0;
}
