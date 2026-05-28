/** Human-readable age since an SSH session/tunnel opened. */
export function formatSshAge(openedAt: number, now: number): string {
  const ms = Math.max(0, now - openedAt);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function mcpTunnelServices(t: {
  browser: boolean;
  stream: boolean;
  security: boolean;
  notify: boolean;
  storage: boolean;
}): string {
  return [
    t.browser ? "browser" : null,
    t.stream ? "stream" : null,
    t.security ? "security" : null,
    t.notify ? "notify" : null,
    t.storage ? "storage" : null,
  ].filter(Boolean).join(", ");
}
