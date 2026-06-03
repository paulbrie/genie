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

/** Close one PTY channel (terminal popup) by terminalId. */
export function killSshChannel(terminalId: string): void {
  wsSend("terminal:close", { terminalId });
}
