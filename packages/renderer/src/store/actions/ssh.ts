import { wsSend } from "@/lib/ws";
import { $ssh } from "../subjects/ssh";

export function loadSshSessions(): void {
  $ssh.next({ ...$ssh.getValue(), loading: true });
  wsSend("ssh:list", {});
}

export function killSshSession(id: string): void {
  const s = $ssh.getValue();
  $ssh.next({ ...s, killing: { ...s.killing, [id]: true } });
  wsSend("ssh:kill", { id });
}
