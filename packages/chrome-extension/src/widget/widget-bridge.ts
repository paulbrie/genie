/**
 * Bridge for the widget.html extension page.
 * Connects to the service worker and forwards project/snapshot messages
 * between the service worker port and the renderer iframe.
 * Also relays messages from the parent content script (floating-widget.ts).
 */

import type { BackgroundMessage, PanelMessage } from "../shared/types";

const iframe = document.getElementById("genie-iframe") as HTMLIFrameElement;
const fallback = document.getElementById("genie-fallback") as HTMLDivElement;
const retryBtn = document.getElementById("genie-retry") as HTMLButtonElement;

let port: chrome.runtime.Port | null = null;
let iframeReady = false;

// Current context
let currentProject: any = null;
let currentTabUrl = "";

function showFallback(): void {
  fallback.style.display = "flex";
  iframe.style.display = "none";
}

function hideFallback(): void {
  fallback.style.display = "none";
  iframe.style.display = "block";
}

// --- Service worker port ---

function connectPort(): void {
  port = chrome.runtime.connect({ name: "genie-panel" });

  port.onMessage.addListener((msg: BackgroundMessage) => {
    switch (msg.type) {
      case "project:detected":
        currentProject = msg.project;
        currentTabUrl = msg.tabUrl;
        if (iframeReady && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "genie:context-update", project: msg.project, tabUrl: msg.tabUrl },
            "*",
          );
        }
        // Also forward to parent content script
        window.parent.postMessage(
          { type: "genie:project-detected", project: msg.project, tabUrl: msg.tabUrl },
          "*",
        );
        break;

      case "dom:snapshot":
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "genie:snapshot-result", snapshot: (msg as any).html },
            "*",
          );
        }
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connectPort, 2000);
  });
}

// --- iframe load ---

iframe.addEventListener("load", () => {
  if (!iframe.contentWindow) {
    showFallback();
    return;
  }
  iframeReady = true;
  hideFallback();

  // Request a proactive snapshot
  if (port) {
    port.postMessage({ type: "get:snapshot" } satisfies PanelMessage);
  }

  // Send init to iframe
  setTimeout(() => {
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "genie:init", project: currentProject, tabUrl: currentTabUrl, snapshot: "" },
        "*",
      );
    }
  }, 100);
});

iframe.addEventListener("error", showFallback);

// --- Listen for messages from the renderer iframe ---

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data?.type?.startsWith("genie:")) return;

  switch (data.type) {
    case "genie:request-snapshot":
      if (port) {
        port.postMessage({ type: "get:snapshot" } satisfies PanelMessage);
      }
      break;

    case "genie:navigate":
      if (data.url && port) {
        port.postMessage({ type: "navigate", url: data.url } satisfies PanelMessage);
      }
      break;
  }
});

// --- Retry ---

retryBtn.addEventListener("click", () => {
  iframe.src = "http://localhost:3000/extension";
  hideFallback();
});

// --- Init ---

connectPort();
