import { handleWsMessage } from "@/store";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let managerRunning = false;

export function setManagerRunning(running: boolean) {
  managerRunning = running;
}

export function connectWs(): void {
  if (typeof window === "undefined") return;
  if (ws && ws.readyState <= 1) return;

  ws = new WebSocket("ws://localhost:9876");

  ws.onopen = () => {
    console.log("Connected to manager");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    wsSend("app:list", {});
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error("Bad message:", e);
    }
  };

  ws.onclose = () => {
    ws = null;
    if (managerRunning) {
      reconnectTimer = setTimeout(connectWs, 2000);
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function disconnectWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

export function wsSend(type: string, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}
