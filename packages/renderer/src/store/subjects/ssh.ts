import { Subject } from "subjecto/core";
import type { SshState } from "../types/ssh";

export const $ssh = new Subject<SshState>({ sessions: [], tunnels: [], events: [], loading: false, killing: {}, reconnectingHosts: {} });
