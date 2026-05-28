/** Live stats from the VM daemon (`vps:stats:watch` → `vps:stats:update`). On by default. */
export function sshStatsPostbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GENIE_SSH_STATS_POSTBACK !== "0";
}

/** Fleet / one-shot SSH probes (`admin:*:stats`, `vps:stats`, Manage gauge polling).
 *  Off by default — set NEXT_PUBLIC_GENIE_SSH_STATS_PROBE=1 (or legacy
 *  NEXT_PUBLIC_GENIE_SSH_STATS=1) to re-enable. */
export function sshStatsProbeEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_GENIE_SSH_STATS_PROBE === "1"
    || process.env.NEXT_PUBLIC_GENIE_SSH_STATS === "1"
  );
}

/** @deprecated Prefer sshStatsPostbackEnabled / sshStatsProbeEnabled. */
export function sshStatsEnabled(): boolean {
  return sshStatsPostbackEnabled() || sshStatsProbeEnabled();
}
