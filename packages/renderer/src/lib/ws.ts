import { $auth, $manager } from "@/store/subjects";
import { logSent, logReceived } from "@/lib/ws-log";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let managerRunning = false;
let currentWsUrl = "";

// Lazy-loaded to break the circular import: ws.ts ↔ store/handlers/{auth,conversation}.
// `connectWs()` is only called at component mount, so by then ws.ts has fully initialized.
let dispatcher: ((msg: { type: string; payload: any }) => void) | null = null;
const pendingInbound: { type: string; payload: any }[] = [];
function ensureDispatcherLoaded() {
  if (dispatcher) return;
  import("@/store/handlers")
    .then((mod) => {
      dispatcher = mod.handleWsMessage;
      while (pendingInbound.length) dispatcher(pendingInbound.shift()!);
    })
    .catch((err) => {
      // Without this catch, a chunk-load failure would leave `dispatcher` null
      // forever — every inbound WS message would silently pile into
      // `pendingInbound` and the UI would look like the server stopped responding.
      console.error("[ws] Failed to load store handlers; inbound messages will not be processed:", err);
    });
}

export function getWsUrl(): string {
  return currentWsUrl;
}

const AUTH_TOKEN_KEY = "genie-auth-token";

const pendingRequests = new Map<string, (payload: any) => void>();

export function wsRequest<T = any>(type: string, payload: Record<string, any> = {}, timeout = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => { pendingRequests.delete(reqId); reject(new Error("timeout")); }, timeout);
    pendingRequests.set(reqId, (p: any) => { clearTimeout(timer); pendingRequests.delete(reqId); resolve(p); });
    wsSend(type, { ...payload, reqId });
  });
}

export function isWsConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function setManagerRunning(running: boolean) {
  managerRunning = running;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function connectWs(): void {
  if (typeof window === "undefined") return;
  if (ws && ws.readyState <= 1) return;

  ensureDispatcherLoaded();

  const url = process.env.NEXT_PUBLIC_WS_URL || (window.location.hostname !== "localhost" ? "wss://api.genie.teleporthq.ai" : "ws://localhost:9876");
  currentWsUrl = url;
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("Connected to manager");
    // Drive the sidebar's "connected" dot off the actual socket lifecycle.
    // setManagerRunning(true) elsewhere only flips an internal reconnect-intent
    // flag — it never touched the Subject, so the dot was stuck gray.
    $manager.next({ running: true });
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Check for token in URL (from OAuth redirect)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setStoredToken(urlToken);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      sendAuthToken(urlToken);
      return;
    }

    // Try stored token
    const storedToken = getStoredToken();
    if (storedToken) {
      sendAuthToken(storedToken);
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      logReceived(msg.type, msg.payload);

      // Resolve pending request-response if reqId matches
      if (msg.payload?.reqId && pendingRequests.has(msg.payload.reqId)) {
        const cb = pendingRequests.get(msg.payload.reqId)!;
        cb(msg.payload);
        return;
      }

      if (dispatcher) dispatcher(msg);
      else pendingInbound.push(msg);
    } catch (e) {
      console.error("Bad message:", e);
    }
  };

  ws.onclose = () => {
    ws = null;
    $manager.next({ running: false });
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
    logSent(type, payload);
  }
}

export function triggerGoogleLogin(): void {
  wsSend("auth:google:start", {});
}

export function sendAuthToken(token: string): void {
  wsSend("auth:token", { token });
}

export function logout(): void {
  setStoredToken(null);
  wsSend("auth:logout", {});
  $auth.next({ status: "unauthenticated", user: null, token: null, impersonatedBy: null });
}
