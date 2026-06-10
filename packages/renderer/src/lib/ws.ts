import { $auth, $manager } from "@/store/subjects";
import { logSent, logReceived } from "@/lib/ws-log";
import { tryDevLoginRedirect } from "@/lib/dev-login";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let managerRunning = false;
let currentWsUrl = "";
// Runtime override for the manager URL. Set by the Chrome extension sidepanel so
// the iframe's socket targets the same manager the service worker uses (otherwise
// chat hits one manager while DOM actions are brokered on another). Null → use env.
let wsUrlOverride: string | null = null;

// App-level heartbeat. A socket can go HALF-OPEN (laptop sleep, edge idle-timeout,
// network blip during a long no-token "thinking" gap) without firing `onclose`,
// so the chat stream freezes mid-answer and the onclose-driven reconnect never
// runs. We send a JSON `ping` every HEARTBEAT_MS and expect a `pong`; if none has
// arrived for HEARTBEAT_TIMEOUT_MS we treat the socket as dead and close it,
// which triggers onclose → reconnect. (Browsers can't send WS-protocol ping
// frames, hence app-level.)
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;
const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 70_000; // ~3 missed pongs before we give up

// When the current socket opened — lets onclose report how long it survived, so
// we can tell "drops right after an idle gap" (edge timeout) from "drops mid-use".
let wsOpenedAt = 0;

// Decode a WebSocket close code into a human label. The code is the single most
// diagnostic signal for *why* a socket dropped:
//   1000 normal · 1001 going-away (server shutdown/nav) · 1005 no-status
//   1006 abnormal — no close frame: TCP reset / proxy idle-kill / server vanished
//   1011 server-error · 1012 service-restart · 1013 try-again-later
function describeWsCloseCode(code: number): string {
  switch (code) {
    case 1000: return "normal";
    case 1001: return "going-away";
    case 1002: return "protocol-error";
    case 1005: return "no-status";
    case 1006: return "abnormal-no-close-frame";
    case 1008: return "policy-violation";
    case 1009: return "message-too-big";
    case 1011: return "server-error";
    case 1012: return "service-restart";
    case 1013: return "try-again-later";
    case 1015: return "tls-failure";
    default: return code >= 4000 ? "app-defined" : "other";
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      // No pong in the window → assume half-open. Close to force onclose+reconnect.
      console.warn("[ws] heartbeat timeout — closing half-open socket");
      try { ws.close(); } catch { /* ignore */ }
      return;
    }
    try { ws.send(JSON.stringify({ type: "ping", payload: {} })); } catch { /* ignore */ }
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

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

/** Point the socket at a specific manager URL and reconnect. Used by the Chrome
 *  extension sidepanel to keep the iframe on the same manager as the service
 *  worker. No-op if it already matches the live URL. */
export function setWsUrl(url: string): void {
  if (!url || url === currentWsUrl) return;
  wsUrlOverride = url;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
  connectWs();
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

/** Modules with their own pending-promise registries (e.g. admin exec calls
 *  that wait minutes for SSH to return) register a drain callback here. When
 *  the WS closes — typically because `tsx watch` restarted the dev manager —
 *  every drain runs so dangling promises fail fast instead of waiting on a
 *  response that the dead connection will never deliver. UI components see a
 *  rejected promise and can retry on their next poll instead of sitting on
 *  "Loading…" until the per-request timeout (often 15 min). */
const closeDrains = new Set<(reason: string) => void>();

export function onWsClose(handler: (reason: string) => void): () => void {
  closeDrains.add(handler);
  return () => { closeDrains.delete(handler); };
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
  if (tryDevLoginRedirect()) return;
  if (ws && ws.readyState <= 1) return;

  ensureDispatcherLoaded();

  const url = wsUrlOverride || process.env.NEXT_PUBLIC_WS_URL || (window.location.hostname !== "localhost" ? "wss://api.genie.teleporthq.ai" : "ws://localhost:9876");
  currentWsUrl = url;
  ws = new WebSocket(url);

  ws.onopen = () => {
    wsOpenedAt = Date.now();
    console.log("Connected to manager");
    // Drive the sidebar's "connected" dot off the actual socket lifecycle.
    // setManagerRunning(true) elsewhere only flips an internal reconnect-intent
    // flag — it never touched the Subject, so the dot was stuck gray.
    $manager.next({ running: true });
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    startHeartbeat();

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

      // Heartbeat pong — update liveness and swallow (never reaches dispatcher).
      if (msg.type === "pong") { lastPongAt = Date.now(); return; }

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

  ws.onclose = (event) => {
    // Record WHY the socket dropped. code+wasClean distinguish an edge/proxy
    // idle-kill (1006, !wasClean) from a graceful server close (1000/1001), and
    // connectedSec shows whether it died after an idle gap or mid-stream.
    const connectedSec = wsOpenedAt ? Math.round((Date.now() - wsOpenedAt) / 1000) : -1;
    console.warn(
      `[ws] closed code=${event.code} (${describeWsCloseCode(event.code)}) ` +
      `wasClean=${event.wasClean}${event.reason ? ` reason="${event.reason}"` : ""} ` +
      `connectedSec=${connectedSec} url=${currentWsUrl}`,
    );
    wsOpenedAt = 0;
    ws = null;
    stopHeartbeat();
    $manager.next({ running: false });
    // Drain pending request-response promises so callers (UI panels) see a
    // rejection right away instead of dangling until their per-request timeout
    // fires. Without this a dev-time `tsx watch` restart leaves every in-flight
    // call hanging — gauges show 0% and "Loading…" forever even though new
    // requests succeed once the manager comes back.
    const reason = "WebSocket disconnected";
    for (const cb of pendingRequests.values()) {
      try { cb({ error: reason, __wsClose: true }); } catch { /* ignore */ }
    }
    pendingRequests.clear();
    for (const drain of closeDrains) {
      try { drain(reason); } catch (err) { console.warn("[ws] drain handler threw:", err); }
    }
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
  stopHeartbeat();
  ws?.close();
  ws = null;
}

export function wsSend(type: string, payload: unknown): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
    logSent(type, payload);
    return true;
  }
  return false;
}

export function triggerGoogleLogin(inviteToken?: string): void {
  wsSend("auth:google:start", inviteToken ? { inviteToken } : {});
}

export function sendAuthToken(token: string): void {
  wsSend("auth:token", { token });
}

export function logout(): void {
  setStoredToken(null);
  wsSend("auth:logout", {});
  $auth.next({ status: "unauthenticated", user: null, token: null, impersonatedBy: null });
}
