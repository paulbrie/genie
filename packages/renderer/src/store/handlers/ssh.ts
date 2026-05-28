import { $ssh } from "../subjects/ssh";
import type { HandlerMap } from "./types";

export const handlers: HandlerMap = {
  "ssh:list": (payload) => {
    $ssh.next({ sessions: payload.sessions ?? [], loading: false, killing: {} });
  },
  "ssh:kill:result": (payload) => {
    const s = $ssh.getValue();
    if (!payload.id) return;
    const { [payload.id]: _, ...rest } = s.killing;
    $ssh.next({ ...s, killing: rest });
  },
};
