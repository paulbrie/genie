import type {
  WsMessage,
  PanelMessage,
  BackgroundMessage,
  ProjectDef,
  ContentScriptMessage,
  ContentScriptResponse,
} from "../shared/types";
import { matchProject } from "./project-matcher";

const WS_URLS = ["wss://api.genie.teleporthq.ai", "ws://localhost:9876"];
let WS_URL = WS_URLS[0];
const RECONNECT_DELAY = 3000;
const KEEPALIVE_INTERVAL = 20000;
const AUTH_TOKEN_KEY = "genie-auth-token";

let ws: WebSocket | null = null;
let authenticated = false;
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
    console.log(`[Genie] Connected to manager at ${WS_URL}`);
    startKeepalive();
    // Try to authenticate with stored token
    chrome.storage.local.get(AUTH_TOKEN_KEY, (data) => {
      const token = data[AUTH_TOKEN_KEY];
      if (token) {
        wsSend("auth:token", { token });
      }
    });
    broadcastToPorts({ type: "ws:status", connected: true, authenticated });
  };

  ws.onmessage = (event) => {
    try {
      const msg: WsMessage = JSON.parse(event.data as string);
      handleWsMessage(msg);
    } catch (e) {
      console.error("[Genie] Bad message:", e);
    }
  };

  ws.onclose = () => {
    ws = null;
    authenticated = false;
    stopKeepalive();
    broadcastToPorts({ type: "ws:status", connected: false, authenticated: false });
    // Try next URL on failure before scheduling reconnect
    wsUrlIndex = (wsUrlIndex + 1) % WS_URLS.length;
    scheduleReconnect();
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
      // Store token for reconnections
      if (msg.payload?.token) {
        chrome.storage.local.set({ [AUTH_TOKEN_KEY]: msg.payload.token });
      }
      // Identify as chrome extension
      wsSend("extension:identify", {});
      broadcastToPorts({ type: "ws:status", connected: true, authenticated: true });
      break;
    }

    case "auth:failed": {
      authenticated = false;
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
      // Re-run detection with current tab
      if (currentTabUrl) {
        detectProject(currentTabUrl);
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
  if (matched?.id !== currentDetectedProject?.id) {
    currentDetectedProject = matched;
    broadcastToPorts({ type: "project:detected", project: matched, tabUrl });
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

  if (projects.length > 0) {
    port.postMessage({ type: "project:list", projects } satisfies BackgroundMessage);
  }

  if (currentDetectedProject || currentTabUrl) {
    port.postMessage({
      type: "project:detected",
      project: currentDetectedProject,
      tabUrl: currentTabUrl,
    } satisfies BackgroundMessage);
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
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
});

// --- Startup ---
connect();
