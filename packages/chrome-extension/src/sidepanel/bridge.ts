import type { BackgroundMessage, PanelMessage } from "../shared/types";

const RENDERER_URLS = ["http://localhost:3000/extension", "https://genie.teleporthq.ai/extension"];
let rendererUrlIndex = 0;
let RENDERER_URL = RENDERER_URLS[0];
const IFRAME_ID = "genie-iframe";
const FALLBACK_ID = "genie-fallback";

let port: chrome.runtime.Port | null = null;
let iframe: HTMLIFrameElement | null = null;
let iframeReady = false;
let swWsUrl = "";

// Current extension context (updated by service worker)
let currentProject: any = null;
let currentTabUrl = "";

function getIframe(): HTMLIFrameElement | null {
  return document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
}

function showFallback(): void {
  const fb = document.getElementById(FALLBACK_ID);
  if (fb) fb.style.display = "flex";
  const ifr = getIframe();
  if (ifr) ifr.style.display = "none";
}

function hideFallback(): void {
  const fb = document.getElementById(FALLBACK_ID);
  if (fb) fb.style.display = "none";
  const ifr = getIframe();
  if (ifr) ifr.style.display = "block";
}

// --- Connect to service worker ---

function connectPort(): void {
  port = chrome.runtime.connect({ name: "genie-panel" });

  port.onMessage.addListener((msg: BackgroundMessage) => {
    switch (msg.type) {
      case "project:detected":
        currentProject = msg.project;
        currentTabUrl = msg.tabUrl;
        // Forward to iframe
        if (iframeReady && iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "genie:context-update", project: msg.project, tabUrl: msg.tabUrl },
            "*",
          );
        }
        break;

      case "dom:snapshot":
        // Forward snapshot result to iframe
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "genie:snapshot-result", snapshot: (msg as any).html },
            "*",
          );
        }
        break;

      case "ws:url":
        swWsUrl = msg.url;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ type: "genie:sw-ws-url", url: msg.url }, "*");
        }
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    // Try to reconnect after a delay
    setTimeout(connectPort, 2000);
  });
}

// --- iframe load handling ---

function tryNextRenderer(): void {
  if (rendererUrlIndex < RENDERER_URLS.length - 1) {
    rendererUrlIndex++;
    RENDERER_URL = RENDERER_URLS[rendererUrlIndex];
    console.log(`[Genie] Trying renderer at ${RENDERER_URL}`);
    if (iframe) iframe.src = RENDERER_URL;
  } else {
    showFallback();
  }
}

function initIframe(): void {
  iframe = getIframe();
  if (!iframe) return;

  // Set src dynamically instead of hardcoding in HTML
  iframe.src = RENDERER_URL;

  let loadTimer: ReturnType<typeof setTimeout> | null = null;

  iframe.addEventListener("load", () => {
    if (loadTimer) clearTimeout(loadTimer);

    // Check if iframe loaded successfully
    if (!iframe?.contentWindow) {
      tryNextRenderer();
      return;
    }

    iframeReady = true;
    hideFallback();

    // Request a proactive DOM snapshot, then send genie:init
    if (port) {
      port.postMessage({ type: "get:snapshot" } satisfies PanelMessage);
    }

    // Send init after a brief delay to let snapshot arrive
    setTimeout(() => {
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: "genie:init",
            project: currentProject,
            tabUrl: currentTabUrl,
            snapshot: "",
          },
          "*",
        );
      }
    }, 100);
  });

  iframe.addEventListener("error", () => {
    tryNextRenderer();
  });
}

// --- Listen for messages from iframe ---

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data?.type?.startsWith("genie:")) return;

  switch (data.type) {
    case "genie:request-snapshot":
      // iframe wants a fresh DOM snapshot → ask service worker
      if (port) {
        // Listen for the snapshot response and forward it
        port.postMessage({ type: "get:snapshot" } satisfies PanelMessage);
      }
      break;

    case "genie:navigate":
      // iframe wants to navigate the active browser tab to a URL
      if (data.url && port) {
        port.postMessage({ type: "navigate", url: data.url } satisfies PanelMessage);
      }
      break;

    case "genie:request-sw-ws-url":
      // iframe wants to know the service worker's WS URL
      if (swWsUrl && iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: "genie:sw-ws-url", url: swWsUrl }, "*");
      }
      break;

    case "genie:set-sw-ws-url":
      // iframe wants to switch the service worker's WS URL
      if (data.url && port) {
        port.postMessage({ type: "set:ws-url", url: data.url } satisfies PanelMessage);
      }
      break;
  }
});

// --- Retry button ---

function setupRetry(): void {
  const btn = document.getElementById("genie-retry");
  if (btn) {
    btn.addEventListener("click", () => {
      if (iframe) {
        iframe.src = RENDERER_URL;
        hideFallback();
      }
    });
  }
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  connectPort();
  initIframe();
  setupRetry();
});
