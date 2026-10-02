/** Live stats from the VM daemon (`vps:stats:watch` → `vps:stats:update`). On by default. */
export function sshStatsPostbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GENIE_SSH_STATS_POSTBACK !== "0";
}

/** Fleet / one-shot SSH resource probes (`admin:*:stats`, `vps:stats`). Off by default. */
export function sshStatsProbeEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_GENIE_SSH_STATS_PROBE === "1"
    || process.env.NEXT_PUBLIC_GENIE_SSH_STATS === "1"
  );
}

/** Tmux session enumeration (`vps:stats:refresh`). On by default. */
export function sshTmuxProbeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GENIE_SSH_TMUX_PROBE !== "0";
}

/** @deprecated Prefer sshStatsPostbackEnabled / sshStatsProbeEnabled. */
export function sshStatsEnabled(): boolean {
  return sshStatsPostbackEnabled() || sshStatsProbeEnabled();
}
