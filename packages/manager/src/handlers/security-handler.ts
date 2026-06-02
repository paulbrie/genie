// Security-scan handlers: start (runs runSecurityScan with abort support and
// streams progress over `security:scan:progress`), stop, list, delete. The
// per-scan AbortController registry lives here so the ws-server close handler
// can call `abortAllSecurityScans()` on disconnect instead of leaking state
// through ws-server itself.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";


const activeSecurityAbortControllers = new Map<string, AbortController>();

/** Called from the ws-server connection-close path to cancel in-flight scans
 *  that belonged to the disconnecting client. We currently abort all of them
 *  since `runSecurityScan` is keyed by scanId, not by client. */
export function abortAllSecurityScans(): void {
  for (const [scanId, ctrl] of activeSecurityAbortControllers) {
    ctrl.abort();
    activeSecurityAbortControllers.delete(scanId);
  }
}

export async function handleSecurityMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
): Promise<boolean> {
  switch (msg.type) {
    case "security:scan:start": {
      const { target } = msg.payload;
      if (!target) {
        send(ws, { type: "security:scan:error", payload: { scanId: "", message: "Target is required" } });
        return true;
      }
      const abortController = new AbortController();
      let registeredScanId: string | null = null;
      const { runSecurityScan, saveScan } = await import("../security-service.js");
      const scanResult = await runSecurityScan(target, {
        signal: abortController.signal,
        onProgress: (update) => {
          if (update.id && !registeredScanId) {
            registeredScanId = update.id;
            activeSecurityAbortControllers.set(registeredScanId, abortController);
          }
          send(ws, { type: "security:scan:progress", payload: update });
        },
      });
      const scanId = scanResult.id;
      activeSecurityAbortControllers.delete(scanId);
      try {
        await saveScan(userId, scanResult);
      } catch (err) {
        console.error("Failed to persist security scan:", err);
      }
      if (scanResult.status === "completed") {
        send(ws, { type: "security:scan:complete", payload: { scanId, completedAt: scanResult.completedAt } });
      } else if (scanResult.status === "error") {
        send(ws, { type: "security:scan:error", payload: { scanId, message: scanResult.error || "Unknown error" } });
      }
      return true;
    }

    case "security:scan:stop": {
      const { scanId } = msg.payload;
      const ctrl = activeSecurityAbortControllers.get(scanId);
      if (ctrl) {
        ctrl.abort();
        activeSecurityAbortControllers.delete(scanId);
        send(ws, { type: "security:scan:complete", payload: { scanId, completedAt: Date.now() } });
      }
      return true;
    }

    case "security:scans:list": {
      try {
        const { listScans } = await import("../security-service.js");
        const scans = await listScans(userId);
        send(ws, { type: "security:scans:list", payload: { scans } });
      } catch (err: unknown) {
        send(ws, { type: "security:scan:error", payload: { scanId: "", message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "security:scan:delete": {
      try {
        const { deleteScan } = await import("../security-service.js");
        await deleteScan(msg.payload.scanId);
        send(ws, { type: "security:scan:deleted", payload: { scanId: msg.payload.scanId } });
      } catch (err: unknown) {
        send(ws, { type: "security:scan:error", payload: { scanId: msg.payload.scanId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
