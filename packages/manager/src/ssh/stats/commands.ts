/**
 * Remote stats probe — single bash one-liner that emits `GENIE_STATS …` and
 * one `GENIE_TMUX <name>|<windows>|<attached>` line per tmux session.
 *
 * Single round trip per poll: cpu/mem/disk + tmux session list.
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

const STATS_SCRIPT = `cpu=$(awk '/^cpu /{print int(($2+$4)*100/($2+$3+$4+$5))}' /proc/stat)
mem=$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END {if(t>0) print int((t-a)*100/t); else print 0}' /proc/meminfo)
disk=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
printf 'GENIE_STATS cpu=%s mem=%s disk=%s\\n' "$cpu" "$mem" "$disk"
export PATH="/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
T=$(command -v tmux 2>/dev/null || true)
[ -z "$T" ] && [ -e /snap/bin/tmux ] && T=/snap/bin/tmux
[ -z "$T" ] && [ -e /usr/bin/tmux ] && T=/usr/bin/tmux
if [ -n "$T" ]; then
  "$T" list-sessions -F '#{session_name}|#{session_windows}|#{session_attached}' 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] && printf 'GENIE_TMUX %s\\n' "$line"
  done
fi`;

export const STATS_COMMAND = `echo ${Buffer.from(STATS_SCRIPT).toString("base64")} | base64 -d | bash`;

const STATS_PATTERN = /GENIE_STATS cpu=(\d+(?:\.\d+)?) mem=(\d+(?:\.\d+)?) disk=(\d+(?:\.\d+)?)/;
const TMUX_PATTERN = /^GENIE_TMUX\s+(.+)$/;

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
  return { stats, tmuxSessions };
}

export function statsToClient(stats: VpsResourceStats) {
  return { cpu: stats.cpu, mem: stats.memory, disk: stats.disk };
}

export type TmuxSessionInfo = {
  name: string;
  windows: number | null;
  attached: boolean | null;
};

export function tmuxSessionsToClient(sessions: string[]): TmuxSessionInfo[] {
  return sessions.map((entry) => {
    const [name, windows, attached] = entry.split("|");
    if (!name) return { name: entry, windows: null, attached: null };
    return {
      name,
      windows: windows ? Number(windows) : null,
      attached: attached === "1" ? true : attached === "0" ? false : null,
    };
  });
}
