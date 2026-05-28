/** Live stats from the VM daemon (`vps:stats:watch` → `vps:stats:update`). On by default. */
export function sshStatsPostbackEnabled(): boolean {
  return process.env.GENIE_SSH_STATS_POSTBACK !== "0";
}

/** Fleet / one-shot SSH probes (`admin:*:stats`, `vps:stats`). Off unless
 *  GENIE_SSH_STATS_PROBE=1 or legacy GENIE_SSH_STATS=1. */
export function sshStatsProbeEnabled(): boolean {
  return process.env.GENIE_SSH_STATS_PROBE === "1" || process.env.GENIE_SSH_STATS === "1";
}

/** @deprecated Prefer sshStatsPostbackEnabled / sshStatsProbeEnabled. */
export function sshStatsEnabled(): boolean {
  return sshStatsPostbackEnabled() || sshStatsProbeEnabled();
}
