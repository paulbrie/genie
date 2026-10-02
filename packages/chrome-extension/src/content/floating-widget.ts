/**
 * Floating Genie chat button — injected into pages by the content script.
 * Creates a draggable round button (like Next.js dev indicator) that opens
 * an iframe overlay with the renderer's /extension chat UI.
 */

const WIDGET_URL = chrome.runtime.getURL("widget.html");
const STORAGE_KEY = "genie-fab-position";
const PANEL_STORAGE_KEY = "genie-panel-size";
const WIDGET_SIZE = 40;
const DEFAULT_PANEL_WIDTH = 380;
const DEFAULT_PANEL_HEIGHT = 520;
const MIN_PANEL_WIDTH = 300;
const MIN_PANEL_HEIGHT = 350;

let root: HTMLDivElement | null = null;
let fab: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let iframe: HTMLIFrameElement | null = null;
let panelOpen = false;
let isMaximized = false;

// Current panel size (persisted)
let panelWidth = DEFAULT_PANEL_WIDTH;
let panelHeight = DEFAULT_PANEL_HEIGHT;

// Saved position/size before maximize
let preMaxState: { left: string; top: string; width: number; height: number } | null = null;

// Dragging state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let fabStartX = 0;
let fabStartY = 0;
let hasMoved = false;

// Port for snapshot requests (forwarded from widget-bridge via postMessage)
let port: chrome.runtime.Port | null = null;

function getSavedPosition(): { x: number; y: number } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { x: window.innerWidth - WIDGET_SIZE - 20, y: window.innerHeight - WIDGET_SIZE - 20 };
}

function savePosition(x: number, y: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
  } catch { /* ignore */ }
}

function getSavedPanelSize(): { w: number; h: number } {
  try {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { w: DEFAULT_PANEL_WIDTH, h: DEFAULT_PANEL_HEIGHT };
}

function savePanelSize(w: number, h: number): void {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ w, h }));
  } catch { /* ignore */ }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

let expandBtn: HTMLButtonElement | null = null;

function updateExpandIcon(): void {
  if (!expandBtn) return;
  if (isMaximized) {
    // Minimize icon (two overlapping squares)
    expandBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 4 20 10 20"/><polyline points="20 10 20 4 14 4"/><line x1="14" y1="10" x2="20" y2="4"/><line x1="4" y1="20" x2="10" y2="14"/></svg>`;
    expandBtn.title = "Minimize";
  } else {
    // Expand icon (arrows pointing outward)
    expandBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    expandBtn.title = "Expand";
  }
}

function createWidget(): void {
  // Don't inject into the renderer itself
  if (window.location.hostname === "localhost" && window.location.port === "3000") return;

  const savedSize = getSavedPanelSize();
  panelWidth = savedSize.w;
  panelHeight = savedSize.h;

  root = document.createElement("div");
  root.id = "genie-floating-root";
  // Use shadow DOM to isolate styles
  const shadow = root.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    @keyframes genie-glow {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }

    .genie-fab {
      position: fixed;
      z-index: 2147483647;
      width: ${WIDGET_SIZE}px;
      height: ${WIDGET_SIZE}px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1e1e2e 0%, #2a2040 25%, #1e1e2e 50%, #1e2a3a 75%, #1e1e2e 100%);
      background-size: 400% 400%;
      animation: genie-glow 6s ease infinite;
      border: 2px solid #313244;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
      user-select: none;
      -webkit-user-select: none;
    }
    .genie-fab:hover {
      transform: scale(1.1);
      box-shadow: 0 4px 16px rgba(203,166,247,0.2);
      border-color: #cba6f7;
    }
    .genie-fab:active, .genie-fab.dragging {
      cursor: grabbing;
      transform: scale(0.95);
    }
    .genie-fab .genie-logo {
      font: 700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #cba6f7;
      line-height: 1;
      pointer-events: none;
    }

    .genie-panel {
      position: fixed;
      z-index: 2147483646;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      display: none;
      flex-direction: column;
      background: #1e1e2e;
      transition: none;
    }
    .genie-panel.open { display: flex; }
    .genie-panel.maximized {
      left: 0 !important;
      top: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      border-radius: 0;
    }

    .genie-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #181825;
      border-bottom: 1px solid #313244;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    .genie-panel-header span {
      font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #cdd6f4;
    }

    .genie-header-buttons {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .genie-panel-btn {
      width: 24px; height: 24px;
      border: none; background: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      border-radius: 4px; color: #a6adc8;
    }
    .genie-panel-btn:hover { background: #313244; color: #cdd6f4; }
    .genie-panel-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; pointer-events: none; }

    .genie-panel iframe {
      flex: 1;
      width: 100%;
      border: none;
      background: #1e1e2e;
    }

    .genie-resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      z-index: 10;
    }
    .genie-resize-handle::after {
      content: '';
      position: absolute;
      bottom: 3px;
      right: 3px;
      width: 8px;
      height: 8px;
      border-right: 2px solid #585b70;
      border-bottom: 2px solid #585b70;
      opacity: 0.6;
    }
    .genie-resize-handle:hover::after {
      border-color: #cba6f7;
      opacity: 1;
    }
    .genie-panel.maximized .genie-resize-handle { display: none; }

    .genie-context-menu {
      position: fixed;
      z-index: 2147483647;
      background: #1e1e2e;
      border: 1px solid #313244;
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      min-width: 140px;
      display: none;
    }
    .genie-context-menu.open { display: block; }
    .genie-context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 10px;
      border: none;
      background: none;
      color: #cdd6f4;
      font: 400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      border-radius: 4px;
      text-align: left;
    }
    .genie-context-menu-item:hover { background: #313244; }
    .genie-context-menu-item svg {
      width: 14px; height: 14px;
      stroke: currentColor; fill: none;
      flex-shrink: 0;
    }
    .genie-context-menu-item.danger { color: #f38ba8; }
    .genie-context-menu-item.danger:hover { background: #f38ba8; color: #1e1e2e; }
  `;

  // FAB button
  const pos = getSavedPosition();
  fab = document.createElement("button");
  fab.className = "genie-fab";
  fab.style.left = `${pos.x}px`;
  fab.style.top = `${pos.y}px`;
  fab.innerHTML = `<span class="genie-logo">G</span>`;
  fab.title = "Genie Assistant";

  // Panel
  panel = document.createElement("div");
  panel.className = "genie-panel";
  panel.style.width = `${panelWidth}px`;
  panel.style.height = `${panelHeight}px`;

  const header = document.createElement("div");
  header.className = "genie-panel-header";
  const title = document.createElement("span");
  title.textContent = "Genie";

  const buttonsDiv = document.createElement("div");
  buttonsDiv.className = "genie-header-buttons";

  expandBtn = document.createElement("button");
  expandBtn.className = "genie-panel-btn";
  updateExpandIcon();

  const closeBtn = document.createElement("button");
  closeBtn.className = "genie-panel-btn";
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.title = "Close";

  buttonsDiv.appendChild(expandBtn);
  buttonsDiv.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(buttonsDiv);

  iframe = document.createElement("iframe");
  iframe.src = WIDGET_URL;
  iframe.allow = "clipboard-write";

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "genie-resize-handle";

  panel.appendChild(header);
  panel.appendChild(iframe);
  panel.appendChild(resizeHandle);

  // Context menu
  const ctxMenu = document.createElement("div");
  ctxMenu.className = "genie-context-menu";

  const hideItem = document.createElement("button");
  hideItem.className = "genie-context-menu-item danger";
  hideItem.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Hide Genie`;
  ctxMenu.appendChild(hideItem);

  shadow.appendChild(style);
  shadow.appendChild(fab);
  shadow.appendChild(panel);
  shadow.appendChild(ctxMenu);
  document.documentElement.appendChild(root);

  // --- Events ---

  // Context menu on FAB right-click
  fab.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu.style.left = `${e.clientX}px`;
    ctxMenu.style.top = `${e.clientY}px`;
    ctxMenu.classList.add("open");
  });

  hideItem.addEventListener("click", () => {
    ctxMenu.classList.remove("open");
    destroyWidget();
  });

  // Dismiss context menu on any click
  shadow.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".genie-context-menu")) {
      ctxMenu.classList.remove("open");
    }
  });
  document.addEventListener("click", () => ctxMenu.classList.remove("open"));
  document.addEventListener("contextmenu", () => ctxMenu.classList.remove("open"));

  // FAB drag
  fab.addEventListener("pointerdown", onFabPointerDown);

  // FAB click (only if not dragged)
  fab.addEventListener("click", (e) => {
    if (hasMoved) { e.preventDefault(); return; }
    togglePanel();
  });

  // Close button
  closeBtn.addEventListener("click", () => togglePanel(false));

  // Expand/minimize button
  expandBtn.addEventListener("click", () => toggleMaximize());

  // Panel header drag
  let panelDragging = false;
  let panelDragStartX = 0, panelDragStartY = 0;
  let panelStartLeft = 0, panelStartTop = 0;

  header.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".genie-panel-btn")) return;
    if (isMaximized) return;
    panelDragging = true;
    panelDragStartX = e.clientX;
    panelDragStartY = e.clientY;
    const rect = panel!.getBoundingClientRect();
    panelStartLeft = rect.left;
    panelStartTop = rect.top;
    header.setPointerCapture(e.pointerId);
  });

  header.addEventListener("pointermove", (e) => {
    if (!panelDragging) return;
    const dx = e.clientX - panelDragStartX;
    const dy = e.clientY - panelDragStartY;
    const newLeft = clamp(panelStartLeft + dx, 0, window.innerWidth - panelWidth);
    const newTop = clamp(panelStartTop + dy, 0, window.innerHeight - panelHeight);
    panel!.style.left = `${newLeft}px`;
    panel!.style.top = `${newTop}px`;
  });

  header.addEventListener("pointerup", () => { panelDragging = false; });

  // Resize handle
  let resizing = false;
  let resizeStartX = 0, resizeStartY = 0;
  let resizeStartW = 0, resizeStartH = 0;

  resizeHandle.addEventListener("pointerdown", (e) => {
    if (isMaximized) return;
    e.stopPropagation();
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = panelWidth;
    resizeStartH = panelHeight;
    resizeHandle.setPointerCapture(e.pointerId);
  });

  resizeHandle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    panelWidth = Math.max(MIN_PANEL_WIDTH, resizeStartW + dx);
    panelHeight = Math.max(MIN_PANEL_HEIGHT, resizeStartH + dy);
    panel!.style.width = `${panelWidth}px`;
    panel!.style.height = `${panelHeight}px`;
  });

  resizeHandle.addEventListener("pointerup", () => {
    if (resizing) {
      resizing = false;
      savePanelSize(panelWidth, panelHeight);
    }
  });

  // Keep FAB visible on window resize
  window.addEventListener("resize", () => {
    if (!fab) return;
    const rect = fab.getBoundingClientRect();
    const x = clamp(rect.left, 0, window.innerWidth - WIDGET_SIZE);
    const y = clamp(rect.top, 0, window.innerHeight - WIDGET_SIZE);
    fab.style.left = `${x}px`;
    fab.style.top = `${y}px`;
    savePosition(x, y);
  });

  // Double-click header to toggle maximize
  header.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".genie-panel-btn")) return;
    toggleMaximize();
  });

  // Bridge: connect port and forward messages
  connectBridgePort();

  // Listen for iframe messages
  window.addEventListener("message", onIframeMessage);
}

function destroyWidget(): void {
  if (panelOpen) togglePanel(false);
  if (root) {
    root.remove();
    root = null;
    fab = null;
    panel = null;
    iframe = null;
    expandBtn = null;
  }
  window.removeEventListener("message", onIframeMessage);
  if (port) { port.disconnect(); port = null; }
}

function toggleMaximize(): void {
  if (!panel) return;

  if (isMaximized) {
    // Restore
    panel.classList.remove("maximized");
    if (preMaxState) {
      panel.style.left = preMaxState.left;
      panel.style.top = preMaxState.top;
      panelWidth = preMaxState.width;
      panelHeight = preMaxState.height;
      panel.style.width = `${panelWidth}px`;
      panel.style.height = `${panelHeight}px`;
    }
    preMaxState = null;
    isMaximized = false;
  } else {
    // Save current state and maximize
    preMaxState = {
      left: panel.style.left,
      top: panel.style.top,
      width: panelWidth,
      height: panelHeight,
    };
    isMaximized = true;
    panel.classList.add("maximized");
  }
  updateExpandIcon();
}

function onFabPointerDown(e: PointerEvent): void {
  isDragging = true;
  hasMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = fab!.getBoundingClientRect();
  fabStartX = rect.left;
  fabStartY = rect.top;
  fab!.classList.add("dragging");
  fab!.setPointerCapture(e.pointerId);

  const onMove = (ev: PointerEvent) => {
    if (!isDragging) return;
    const dx = ev.clientX - dragStartX;
    const dy = ev.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
    const newX = clamp(fabStartX + dx, 0, window.innerWidth - WIDGET_SIZE);
    const newY = clamp(fabStartY + dy, 0, window.innerHeight - WIDGET_SIZE);
    fab!.style.left = `${newX}px`;
    fab!.style.top = `${newY}px`;
  };

  const onUp = () => {
    isDragging = false;
    fab!.classList.remove("dragging");
    fab!.removeEventListener("pointermove", onMove);
    fab!.removeEventListener("pointerup", onUp);
    // Save final position
    const rect = fab!.getBoundingClientRect();
    savePosition(rect.left, rect.top);
  };

  fab!.addEventListener("pointermove", onMove);
  fab!.addEventListener("pointerup", onUp);
}

function togglePanel(forceOpen?: boolean): void {
  panelOpen = forceOpen !== undefined ? forceOpen : !panelOpen;

  if (panelOpen) {
    // Position panel near the FAB
    const fabRect = fab!.getBoundingClientRect();
    let left = fabRect.left - panelWidth - 12;
    let top = fabRect.top - panelHeight + WIDGET_SIZE;

    // If panel would go off-screen left, put it on the right
    if (left < 8) left = fabRect.right + 12;
    // If panel would go off-screen top, put it below
    if (top < 8) top = fabRect.bottom + 12;
    // Clamp
    left = clamp(left, 8, window.innerWidth - panelWidth - 8);
    top = clamp(top, 8, window.innerHeight - panelHeight - 8);

    panel!.style.left = `${left}px`;
    panel!.style.top = `${top}px`;
    panel!.style.width = `${panelWidth}px`;
    panel!.style.height = `${panelHeight}px`;
    panel!.classList.add("open");

    // Send context to iframe
    sendInitToIframe();
  } else {
    panel!.classList.remove("open");
    if (isMaximized) {
      isMaximized = false;
      panel!.classList.remove("maximized");
      preMaxState = null;
      updateExpandIcon();
    }
  }
}

function sendInitToIframe(): void {
  if (!iframe?.contentWindow) return;
  // Get current project context from the bridge port
  if (port) {
    port.postMessage({ type: "get:project" });
  }
}

function connectBridgePort(): void {
  try {
    port = chrome.runtime.connect({ name: "genie-panel" });

    port.onMessage.addListener((msg: any) => {
      switch (msg.type) {
        case "project:detected":
          // Forward project context to iframe
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(
              { type: "genie:context-update", project: msg.project, tabUrl: msg.tabUrl },
              "*",
            );
          }
          break;

        case "dom:snapshot":
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(
              { type: "genie:snapshot-result", snapshot: msg.html },
              "*",
            );
          }
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectBridgePort, 3000);
    });
  } catch {
    // Extension context might be invalidated
    setTimeout(connectBridgePort, 5000);
  }
}

function onIframeMessage(event: MessageEvent): void {
  const data = event.data;
  if (!data?.type?.startsWith("genie:")) return;

  switch (data.type) {
    case "genie:request-snapshot":
      if (port) {
        port.postMessage({ type: "get:snapshot" });
      }
      break;
  }
}

// --- Toggle via background message ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "genie:toggle-widget") {
    if (!root) {
      createWidget();
      togglePanel(true);
    } else {
      togglePanel();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "genie:show-widget") {
    if (!root) createWidget();
    sendResponse({ ok: true });
    return false;
  }
});

// Auto-create the widget on page load
createWidget();
