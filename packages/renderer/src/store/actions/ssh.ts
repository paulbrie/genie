import { wsSend } from "@/lib/ws";
import { $ssh } from "../subjects/ssh";

export function loadSshSessions(opts?: { silent?: boolean }): void {
  if (!opts?.silent) {
    $ssh.next({ ...$ssh.getValue(), loading: true });
  }
  wsSend("ssh:list", {});
}

export function killSshSession(id: string): void {
  const s = $ssh.getValue();
  $ssh.next({ ...s, killing: { ...s.killing, [id]: true } });
  wsSend("ssh:kill", { id });
}

export function killSshSessionsForHost(host: string): void {
  const s = $ssh.getValue();
  const ids = s.sessions.filter((sess) => sess.host === host).map((sess) => sess.id);
  if (ids.length > 0) {
    $ssh.next({
      ...s,
      killing: Object.fromEntries(ids.map((id) => [id, true])),
    });
  }
  wsSend("ssh:kill", { host });
}

export function reconnectSshTunnelForHost(host: string): void {
  const s = $ssh.getValue();
  $ssh.next({
    ...s,
    reconnectingHosts: { ...s.reconnectingHosts, [host]: true },
  });
  wsSend("ssh:tunnel:reconnect", { host });
}

/** Member-facing "Reconnect MCP servers" — project/ownership-scoped on the
 *  server (`vps:mcp:ensure`), so any project member (not just admins) can
 *  re-establish the shared MCP tunnels + rewrite the VM's .mcp.json. Reuses the
 *  `reconnectingHosts` in-flight flag so the button can show a spinner. */
export function ensureMcpForHost(host: string): void {
  const s = $ssh.getValue();
  $ssh.next({
    ...s,
    reconnectingHosts: { ...s.reconnectingHosts, [host]: true },
  });
  wsSend("vps:mcp:ensure", { host });
}
