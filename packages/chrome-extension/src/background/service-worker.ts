import type {
  WsMessage,
  PanelMessage,
  BackgroundMessage,
  ProjectDef,
  ContentScriptMessage,
  ContentScriptResponse,
} from "../shared/types";
import { matchProject } from "./project-matcher";

// Production builds (`webpack --mode production`) talk ONLY to the public
// manager. The localhost dev URL is omitted entirely so a prod extension never
// connects to, fails on, or rotates into 127.0.0.1 — that was generating failed-
// connect noise and reconnect churn for real users. webpack's DefinePlugin
// inlines process.env.NODE_ENV as a string literal at build time, so the unused
// branch is dead-code-eliminated.
declare const process: { env: { NODE_ENV?: string } };
const WS_URLS = process.env.NODE_ENV === "production"
  ? ["wss://api.genie.teleporthq.ai"]
  : ["ws://127.0.0.1:9876", "wss://api.genie.teleporthq.ai"];
let WS_URL = WS_URLS[0];
const RECONNECT_DELAY = 3000;
const KEEPALIVE_INTERVAL = 20000;
const AUTH_TOKEN_KEY = "genie-auth-token";
const WS_URL_KEY = "genie-ws-url";

let ws: WebSocket | null = null;
let wsOpenedAt = 0;
let authenticated = false;

// Decode a WS close code so the disconnect log says *why* it dropped. 1006
// (abnormal, no close frame) = TCP reset / proxy idle-kill / server vanished.
function describeWsCloseCode(code: number): string {
  switch (code) {
    case 1000: return "normal";
    case 1001: return "going-away";
    case 1005: return "no-status";
    case 1006: return "abnormal-no-close-frame";
    case 1011: return "server-error";
    case 1012: return "service-restart";
    case 1013: return "try-again-later";
    case 1015: return "tls-failure";
    default: return code >= 4000 ? "app-defined" : "other";
  }
}
// The token this connection authenticated with. Shared with the renderer iframe
// (and seeded by it) so a single login authenticates both the SW and iframe sockets.
let authToken: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let projects: ProjectDef[] = [];
let currentDetectedProject: ProjectDef | null = null;
let currentTabUrl = "";

// Connected side panel / popup ports
const ports = new Set<chrome.runtime.Port>();

// Pending DOM action requests (requestId → resolve)
const pendingDomActions = new Map<
  string,
  { resolve: (result: string) => void; timer: ReturnType<typeof setTimeout> }
>();

// --- WebSocket connection ---

let wsUrlIndex = 0;

function connect(): void {
  if (ws && ws.readyState <= WebSocket.OPEN) return;

  WS_URL = WS_URLS[wsUrlIndex];
  console.log(`[Genie] Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsOpenedAt = Date.now();
    console.log(`[Genie] Connected to manager at ${WS_URL}`);
    startKeepalive();
    // Try to authenticate with stored token
    chrome.storage.local.get(AUTH_TOKEN_KEY, (data) => {
      const token = data[AUTH_TOKEN_KEY];
      if (token) {
        authToken = token;
        wsSend("auth:token", { token });
      }
    });
    broadcastToPorts({ type: "ws:status", connected: true, authenticated });
    broadcastToPorts({ type: "ws:url", url: WS_URL });
  };

  ws.onmessage = (event) => {
    try {
      const msg: WsMessage = JSON.parse(event.data as string);
      handleWsMessage(msg);
    } catch (e) {
      console.error("[Genie] Bad message:", e);
    }
  };

  ws.onclose = (event) => {
    const connectedSec = wsOpenedAt ? Math.round((Date.now() - wsOpenedAt) / 1000) : -1;
    console.warn(
      `[Genie] WS closed code=${event.code} (${describeWsCloseCode(event.code)}) ` +
      `wasClean=${event.wasClean}${event.reason ? ` reason="${event.reason}"` : ""} ` +
      `connectedSec=${connectedSec} url=${WS_URL}`,
    );
    wsOpenedAt = 0;
    ws = null;
    authenticated = false;
    stopKeepalive();
    broadcastToPorts({ type: "ws:status", connected: false, authenticated: false });
    // Only rotate URLs if no manual choice was persisted
    chrome.storage.local.get(WS_URL_KEY, (data) => {
      if (!data[WS_URL_KEY]) {
        wsUrlIndex = (wsUrlIndex + 1) % WS_URLS.length;
      }
      scheduleReconnect();
    });
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY);
}

function startKeepalive(): void {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      // Send a ping-like message to keep the service worker alive
      wsSend("ping", {});
    }
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function wsSend(type: string, payload: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

// --- WS message handling ---

function handleWsMessage(msg: WsMessage): void {
  switch (msg.type) {
    case "auth:success": {
      authenticated = true;
      // Store token for reconnections and share it down to the iframe.
      if (msg.payload?.token) {
        const token: string = msg.payload.token;
        authToken = token;
        chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token });
        broadcastToPorts({ type: "auth:token", token });
      }
      // Identify as chrome extension
      wsSend("extension:identify", {});
      broadcastToPorts({ type: "ws:status", connected: true, authenticated: true });
      break;
    }

    case "auth:failed": {
      authenticated = false;
      authToken = null;
      chrome.storage.local.remove(AUTH_TOKEN_KEY);
      broadcastToPorts({ type: "ws:status", connected: true, authenticated: false });
      break;
    }

    case "auth:google:url": {
      // Open the Google OAuth URL in a new tab
      const url = msg.payload?.url;
      if (url) {
        chrome.tabs.create({ url });
      }
      break;
    }

    case "auth:error": {
      console.error("[Genie] Auth error:", msg.payload?.message);
      break;
    }

    case "project:list": {
      projects = msg.payload.projects || [];
      broadcastToPorts({ type: "project:list", projects });
      // Re-run detection — query active tab if we don't have a URL yet
      if (currentTabUrl) {
        detectProject(currentTabUrl);
      } else {
        detectActiveTab();
      }
      break;
    }

    // DOM action request from the manager (Claude wants to interact with the page)
    case "extension:dom_action": {
      const { requestId, action, params } = msg.payload;
      forwardDomActionToContentScript(requestId, action, params);
      break;
    }
  }
}

// --- DOM action forwarding ---

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "dom:ping" });
  } catch {
    // Content script not loaded — inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

async function forwardDomActionToContentScript(
  requestId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      wsSend("extension:dom_action_result", {
        requestId,
        success: false,
        result: "No active tab found",
      });
      return;
    }

    // Handle navigate directly in the service worker (works on any tab, including restricted pages)
    if (action === "navigate" && params.url) {
      await chrome.tabs.update(tab.id, { url: params.url as string });
      wsSend("extension:dom_action_result", {
        requestId,
        success: true,
        result: `Navigating to ${params.url}`,
      });
      return;
    }

    // Ensure content script is injected before sending the action
    await ensureContentScript(tab.id);

    const message: ContentScriptMessage = {
      type: "dom:action",
      requestId,
      action: action as any,
      params: params as any,
    };

    const response = await chrome.tabs.sendMessage(tab.id, message) as any;

    wsSend("extension:dom_action_result", {
      requestId,
      success: response?.success ?? false,
      result: response?.result ?? "No response from content script",
    });
  } catch (err: any) {
    wsSend("extension:dom_action_result", {
      requestId,
      success: false,
      result: `Content script error: ${err.message}`,
    });
  }
}

// --- DOM snapshot for chat context ---

async function getDomSnapshot(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return "";

    await ensureContentScript(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "dom:get_snapshot",
    } as ContentScriptMessage) as ContentScriptResponse;

    return (response as any)?.html || "";
  } catch {
    return "";
  }
}

// --- Project auto-detection ---

function detectProject(tabUrl: string): void {
  currentTabUrl = tabUrl;
  const matched = matchProject(tabUrl, projects);
  // Always broadcast when we have a URL — the page needs the tabUrl even if project is null
  if (matched?.id !== currentDetectedProject?.id || tabUrl) {
    currentDetectedProject = matched;
    broadcastToPorts({ type: "project:detected", project: matched, tabUrl });
  }
}

/** Query the active tab and run detection — call on startup and when projects arrive */
async function detectActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) detectProject(tab.url);
  } catch {
    // Tabs API may not be available
  }
}

// Listen for tab URL changes
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    detectProject(changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) detectProject(tab.url);
  } catch {
    // Tab may not exist
  }
});

// --- Port communication (side panel & popup) ---

function broadcastToPorts(msg: BackgroundMessage): void {
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch {
      ports.delete(port);
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "genie-panel" && port.name !== "genie-popup") return;

  ports.add(port);

  // Send current state
  port.postMessage({
    type: "ws:status",
    connected: ws?.readyState === WebSocket.OPEN,
    authenticated,
  } satisfies BackgroundMessage);

  // Seed the panel with the active WS URL (so the iframe can match it) and the
  // shared auth token (so the iframe authenticates without a separate login).
  port.postMessage({ type: "ws:url", url: WS_URL } satisfies BackgroundMessage);
  if (authToken) {
    port.postMessage({ type: "auth:token", token: authToken } satisfies BackgroundMessage);
  }

  if (projects.length > 0) {
    port.postMessage({ type: "project:list", projects } satisfies BackgroundMessage);
  }

  if (currentDetectedProject || currentTabUrl) {
    port.postMessage({
      type: "project:detected",
      project: currentDetectedProject,
      tabUrl: currentTabUrl,
    } satisfies BackgroundMessage);
  } else {
    // No tab URL yet — query the active tab now
    detectActiveTab();
  }

  port.onMessage.addListener(async (msg: PanelMessage) => {
    switch (msg.type) {
      case "connect":
        connect();
        break;

      case "disconnect":
        ws?.close();
        break;

      case "login":
        wsSend("auth:google:start", {});
        break;

      case "get:snapshot": {
        const html = await getDomSnapshot();
        port.postMessage({ type: "dom:snapshot", html } satisfies BackgroundMessage);
        break;
      }

      case "navigate": {
        if (msg.type === "navigate" && msg.url) {
          try {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const [tab] = tabs;
            if (tab?.id) {
              await chrome.tabs.update(tab.id, { url: msg.url });
            }
          } catch (err) {
            console.error("[SW] navigate error:", err);
          }
        }
        break;
      }

      case "get:status":
        port.postMessage({
          type: "ws:status",
          connected: ws?.readyState === WebSocket.OPEN,
          authenticated,
        } satisfies BackgroundMessage);
        break;

      case "get:project":
        port.postMessage({
          type: "project:detected",
          project: currentDetectedProject,
          tabUrl: currentTabUrl,
        } satisfies BackgroundMessage);
        break;

      case "open:sidepanel":
        chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id! });
        break;

      case "set:ws-url": {
        const newUrl = msg.url;
        // Find the index or add it
        const idx = WS_URLS.indexOf(newUrl);
        wsUrlIndex = idx >= 0 ? idx : 0;
        WS_URL = newUrl;
        // Persist the choice
        chrome.storage.local.set({ [WS_URL_KEY]: newUrl });
        // Disconnect and reconnect
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) { ws.onclose = null; ws.close(); ws = null; }
        authenticated = false;
        stopKeepalive();
        connect();
        break;
      }

      case "set:auth-token": {
        // The iframe authenticated (or shares the web app's session) — adopt its
        // token so the SW socket authenticates too (required for DOM actions).
        const token = msg.token;
        if (token && token !== authToken) {
          authToken = token;
          chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token });
          if (ws?.readyState === WebSocket.OPEN) {
            wsSend("auth:token", { token });
          } else {
            connect();
          }
        }
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
});

// --- Startup ---
// Load persisted WS URL preference, then connect
chrome.storage.local.get([WS_URL_KEY, AUTH_TOKEN_KEY], (data) => {
  const saved = data[WS_URL_KEY];
  // Only honor a persisted choice if it's a URL this build actually allows. A
  // prod build thus ignores a stale "ws://127.0.0.1:9876" left over from a dev
  // session instead of booting straight into a doomed localhost connect.
  if (saved && WS_URLS.includes(saved)) {
    WS_URL = saved;
    wsUrlIndex = WS_URLS.indexOf(saved);
  }
  if (data[AUTH_TOKEN_KEY]) authToken = data[AUTH_TOKEN_KEY];
  connect();
});
detectActiveTab();
