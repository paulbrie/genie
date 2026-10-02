import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import type { Role } from "../auth/ws-acl.js";
import { hasRole } from "./handler-auth.js";
import * as runpodPodService from "../runpod/runpod-pod-service.js";

/** Admin-only status + manual start/stop for the self-hosted Kimi RunPod pod.
 *  The ACL gates runpod:* (admin); we re-check here. Returns true if handled. */
export async function handleRunpodMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  role: Role | null,
): Promise<boolean> {
  switch (msg.type) {
    case "runpod:status": {
      const reqId = msg.payload?.reqId;
      if (!hasRole(role, "admin")) {
        send(ws, { type: "runpod:status", payload: { reqId, state: { enabled: false, status: "UNKNOWN", lastRequestAt: 0, idleTimeoutSeconds: 0, error: null } } });
        return true;
      }
      const state = await runpodPodService.getPodState();
      send(ws, { type: "runpod:status", payload: { reqId, state } });
      return true;
    }
    case "runpod:start": {
      const reqId = msg.payload?.reqId;
      if (!hasRole(role, "admin")) return true;
      // Resuming a pod + loading weights can take minutes — kick it off in the
      // background and respond immediately. The client polls runpod:status,
      // which reports STARTING while the resume is in flight.
      void runpodPodService.manualStart().catch((err) => {
        console.error("[runpod] manual start failed:", err instanceof Error ? err.message : err);
      });
      const state = await runpodPodService.getPodState();
      send(ws, { type: "runpod:start", payload: { reqId, ok: true, state } });
      return true;
    }
    case "runpod:stop": {
      const reqId = msg.payload?.reqId;
      if (!hasRole(role, "admin")) return true;
      try {
        await runpodPodService.manualStop();
        const state = await runpodPodService.getPodState();
        send(ws, { type: "runpod:stop", payload: { reqId, ok: true, state } });
      } catch (err) {
        send(ws, { type: "runpod:stop", payload: { reqId, ok: false, error: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }
    default:
      return false;
  }
}
