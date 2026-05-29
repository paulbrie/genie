import { $ssh } from "../subjects/ssh";
import type { HandlerMap } from "./types";

export const handlers: HandlerMap = {
  "ssh:list": (payload) => {
    const prev = $ssh.getValue();
    $ssh.next({
      sessions: payload.sessions ?? [],
      tunnels: payload.tunnels ?? [],
      events: payload.events ?? [],
      loading: false,
      killing: {},
      reconnectingHosts: prev.reconnectingHosts,
    });
  },
  "ssh:kill:result": (payload) => {
    const s = $ssh.getValue();
    if (payload.host) {
      $ssh.next({ ...s, killing: {} });
      return;
    }
    if (!payload.id) return;
    const { [payload.id]: _, ...rest } = s.killing;
    $ssh.next({ ...s, killing: rest });
  },
  "ssh:tunnel:reconnect:result": (payload) => {
    const s = $ssh.getValue();
    if (!payload.host) return;
    const { [payload.host]: _, ...rest } = s.reconnectingHosts;
    $ssh.next({ ...s, reconnectingHosts: rest });
  },
  "vps:mcp:ensure:result": (payload) => {
    const s = $ssh.getValue();
    if (!payload.host) return;
    const { [payload.host]: _, ...rest } = s.reconnectingHosts;
    $ssh.next({ ...s, reconnectingHosts: rest });
    if (!payload.ok && payload.error) {
      console.warn(`[mcp] reconnect failed for ${payload.host}: ${payload.error}`);
    }
  },
};
