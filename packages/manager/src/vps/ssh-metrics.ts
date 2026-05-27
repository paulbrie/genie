// Live count of outbound SSH connections (ssh2 Clients) the manager currently
// holds open — VM exec/stat/forward connections + their pooled bastion
// connections (ssh-client.ts) and interactive terminal connections
// (pty-manager.ts). Surfaced in the sidebar so operators can watch SSH load.
// Each open is paired with exactly one close at the instrumented sites.
let active = 0;

export function sshConnOpened(): void {
  active++;
}

export function sshConnClosed(): void {
  active = Math.max(0, active - 1);
}

export function getActiveSshConnections(): number {
  return active;
}
