import { stripAnsi } from "@/lib/utils";
import {
  $appStats,
  $docker,
  $logs,
  $processes,
  $system,
} from "../subjects/common";
import type { SystemState } from "../types/common";
import type { HandlerMap } from "./types";

const MAX_LOG_BUFFER = 50000;

export const handlers: HandlerMap = {
  stats: (payload) => {
    const prev = $system.getValue();
    const sysUpdate: SystemState = {
      cpu: payload.system.cpu,
      mem: payload.system.mem,
      memory: payload.system.memory || prev.memory,
      // Carry forward the last value if a given frame omits server health.
      wsMessagesPerSec: payload.server?.wsMessagesPerSec ?? prev.wsMessagesPerSec,
      wsConnections: payload.server?.wsConnections ?? prev.wsConnections,
      sshConnections: payload.server?.sshConnections ?? prev.sshConnections,
    };
    $system.next(sysUpdate);
    $appStats.next(payload.apps);
    if (payload.processes) {
      $processes.next(payload.processes);
    }
    if (payload.docker) {
      $docker.next(payload.docker);
    }
  },

  "logs:data": (payload) => {
    const { source, data } = payload;
    const clean = stripAnsi(data);
    const l = $logs.getValue();
    let buf = (l.buffers[source] || "") + clean;
    if (buf.length > MAX_LOG_BUFFER) {
      buf = buf.slice(-MAX_LOG_BUFFER);
    }
    $logs.next({ ...l, buffers: { ...l.buffers, [source]: buf } });
  },

  "logs:backlog": (payload) => {
    const { source, data } = payload;
    const l = $logs.getValue();
    $logs.next({ ...l, buffers: { ...l.buffers, [source]: stripAnsi(data) } });
  },

  "logs:sources": (payload) => {
    $logs.nextAssign({ sources: payload.sources });
  },

  error: (payload) => {
    console.warn("Manager error:", payload.message);
  },
};
