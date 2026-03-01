(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "genie",
    ()=>genie
]);
function getGenie() {
    if (("TURBOPACK compile-time value", "object") !== "undefined" && window.genie) {
        return window.genie;
    }
    return null;
}
const noopFs = {
    ok: false,
    error: "Not available"
};
const genie = {
    startManager: ()=>getGenie()?.startManager() ?? Promise.resolve(false),
    stopManager: ()=>getGenie()?.stopManager() ?? Promise.resolve(false),
    getManagerStatus: ()=>getGenie()?.getManagerStatus() ?? Promise.resolve(false),
    onManagerStatus: (cb)=>{
        getGenie()?.onManagerStatus(cb);
    },
    pickFolder: ()=>getGenie()?.pickFolder() ?? Promise.resolve(null),
    // File explorer
    getHomePath: ()=>getGenie()?.getHomePath() ?? Promise.resolve("/"),
    readDirectory: (path)=>getGenie()?.readDirectory(path) ?? Promise.resolve({
            ok: false,
            error: "Not available"
        }),
    readFile: (path)=>getGenie()?.readFile(path) ?? Promise.resolve({
            ok: false,
            error: "Not available"
        }),
    createFolder: (path)=>getGenie()?.createFolder(path) ?? Promise.resolve(noopFs),
    renameEntry: (oldPath, newPath)=>getGenie()?.renameEntry(oldPath, newPath) ?? Promise.resolve(noopFs),
    deleteEntry: (path)=>getGenie()?.deleteEntry(path) ?? Promise.resolve(noopFs),
    openInFinder: (path)=>getGenie()?.openInFinder(path) ?? Promise.resolve(noopFs),
    openFile: (path)=>getGenie()?.openFile(path) ?? Promise.resolve(noopFs)
};
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "connectWs",
    ()=>connectWs,
    "disconnectWs",
    ()=>disconnectWs,
    "setManagerRunning",
    ()=>setManagerRunning,
    "wsSend",
    ()=>wsSend
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
;
let ws = null;
let reconnectTimer = null;
let managerRunning = false;
function setManagerRunning(running) {
    managerRunning = running;
}
function connectWs() {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket("ws://localhost:9876");
    ws.onopen = ()=>{
        console.log("Connected to manager");
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        wsSend("app:list", {});
    };
    ws.onmessage = (event)=>{
        try {
            const msg = JSON.parse(event.data);
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["handleWsMessage"])(msg);
        } catch (e) {
            console.error("Bad message:", e);
        }
    };
    ws.onclose = ()=>{
        ws = null;
        if (managerRunning) {
            reconnectTimer = setTimeout(connectWs, 2000);
        }
    };
    ws.onerror = ()=>{
        ws?.close();
    };
}
function disconnectWs() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    ws?.close();
    ws = null;
}
function wsSend(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type,
            payload
        }));
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "clearLogs",
    ()=>clearLogs,
    "deselectApp",
    ()=>deselectApp,
    "handleWsMessage",
    ()=>handleWsMessage,
    "hideAddForm",
    ()=>hideAddForm,
    "loadUiState",
    ()=>loadUiState,
    "navigateBack",
    ()=>navigateBack,
    "navigateForward",
    ()=>navigateForward,
    "navigateTo",
    ()=>navigateTo,
    "navigateUp",
    ()=>navigateUp,
    "refreshDirectory",
    ()=>refreshDirectory,
    "saveUiState",
    ()=>saveUiState,
    "selectApp",
    ()=>selectApp,
    "selectFileEntry",
    ()=>selectFileEntry,
    "sendChatMessage",
    ()=>sendChatMessage,
    "setFileExplorerPanelWidth",
    ()=>setFileExplorerPanelWidth,
    "setRenamingEntry",
    ()=>setRenamingEntry,
    "showAddForm",
    ()=>showAddForm,
    "store",
    ()=>store,
    "switchNav",
    ()=>switchNav,
    "toggleFileExplorer",
    ()=>toggleFileExplorer,
    "togglePortFilter",
    ()=>togglePortFilter,
    "toggleSort",
    ()=>toggleSort
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
;
;
;
;
const MAX_LOG_BUFFER = 50000;
const UI_STATE_KEY = "genie-ui-state";
const store = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DeepSubject"]({
    manager: {
        running: false
    },
    apps: [],
    appStats: {},
    selectedAppId: null,
    activeNav: "apps",
    processSortBy: "mem",
    filterPortsOnly: false,
    system: {
        cpu: 0,
        mem: 0,
        memory: null
    },
    processes: [],
    docker: {
        daemonRunning: false,
        containers: []
    },
    logBuffers: {},
    viewingLogsFor: null,
    showAddForm: false,
    pendingRestoreAppId: null,
    fileExplorer: {
        open: false,
        currentPath: "",
        entries: [],
        loading: false,
        error: null,
        history: [],
        historyIndex: -1,
        selectedEntry: null,
        renamingEntry: null,
        panelWidth: 380
    },
    chat: {
        messages: [],
        loading: false,
        streamingContent: ""
    }
});
function selectApp(id) {
    const s = store.getValue();
    const app = s.apps.find((a)=>a.id === id);
    if (!app) return;
    s.selectedAppId = id;
    s.viewingLogsFor = id;
    s.activeNav = "apps";
    s.showAddForm = false;
}
function deselectApp() {
    const s = store.getValue();
    s.selectedAppId = null;
    s.viewingLogsFor = null;
    saveUiState();
}
function switchNav(nav) {
    const s = store.getValue();
    s.activeNav = nav;
    if (nav !== "apps") {
        s.showAddForm = false;
    }
    saveUiState();
}
function toggleSort() {
    const s = store.getValue();
    s.processSortBy = s.processSortBy === "cpu" ? "mem" : "cpu";
    saveUiState();
}
function togglePortFilter() {
    const s = store.getValue();
    s.filterPortsOnly = !s.filterPortsOnly;
    saveUiState();
}
function showAddForm() {
    const s = store.getValue();
    s.selectedAppId = null;
    s.viewingLogsFor = null;
    s.activeNav = "apps";
    s.showAddForm = true;
}
function hideAddForm() {
    store.getValue().showAddForm = false;
}
function clearLogs(appId) {
    const s = store.getValue();
    s.logBuffers[appId] = "";
}
function sendChatMessage(text) {
    const s = store.getValue();
    s.chat.messages.push({
        role: "user",
        content: text
    });
    s.chat.loading = true;
    s.chat.streamingContent = "";
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("chat:send", {
        messages: s.chat.messages
    });
}
async function toggleFileExplorer() {
    const s = store.getValue();
    s.fileExplorer.open = !s.fileExplorer.open;
    if (s.fileExplorer.open && !s.fileExplorer.currentPath) {
        const home = await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].getHomePath();
        await navigateTo(home);
    }
}
async function navigateTo(dirPath) {
    const s = store.getValue();
    const fe = s.fileExplorer;
    fe.loading = true;
    fe.error = null;
    fe.selectedEntry = null;
    fe.renamingEntry = null;
    const result = await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].readDirectory(dirPath);
    if (result.ok && result.entries) {
        fe.entries = result.entries;
        fe.currentPath = dirPath;
        // Push to history, trimming any forward entries
        const newHistory = fe.history.slice(0, fe.historyIndex + 1);
        newHistory.push(dirPath);
        fe.history = newHistory;
        fe.historyIndex = newHistory.length - 1;
    } else {
        fe.error = result.error || "Failed to read directory";
    }
    fe.loading = false;
}
async function navigateBack() {
    const fe = store.getValue().fileExplorer;
    if (fe.historyIndex <= 0) return;
    const prevPath = fe.history[fe.historyIndex - 1];
    fe.loading = true;
    fe.error = null;
    fe.selectedEntry = null;
    fe.renamingEntry = null;
    const result = await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].readDirectory(prevPath);
    if (result.ok && result.entries) {
        fe.entries = result.entries;
        fe.currentPath = prevPath;
        fe.historyIndex -= 1;
    } else {
        fe.error = result.error || "Failed to read directory";
    }
    fe.loading = false;
}
async function navigateForward() {
    const fe = store.getValue().fileExplorer;
    if (fe.historyIndex >= fe.history.length - 1) return;
    const nextPath = fe.history[fe.historyIndex + 1];
    fe.loading = true;
    fe.error = null;
    fe.selectedEntry = null;
    fe.renamingEntry = null;
    const result = await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].readDirectory(nextPath);
    if (result.ok && result.entries) {
        fe.entries = result.entries;
        fe.currentPath = nextPath;
        fe.historyIndex += 1;
    } else {
        fe.error = result.error || "Failed to read directory";
    }
    fe.loading = false;
}
async function navigateUp() {
    const fe = store.getValue().fileExplorer;
    if (!fe.currentPath || fe.currentPath === "/") return;
    const parent = fe.currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    await navigateTo(parent);
}
async function refreshDirectory() {
    const fe = store.getValue().fileExplorer;
    if (!fe.currentPath) return;
    fe.loading = true;
    fe.error = null;
    const result = await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].readDirectory(fe.currentPath);
    if (result.ok && result.entries) {
        fe.entries = result.entries;
    } else {
        fe.error = result.error || "Failed to read directory";
    }
    fe.loading = false;
}
function selectFileEntry(entryPath) {
    store.getValue().fileExplorer.selectedEntry = entryPath;
}
function setRenamingEntry(entryPath) {
    store.getValue().fileExplorer.renamingEntry = entryPath;
}
function setFileExplorerPanelWidth(width) {
    store.getValue().fileExplorer.panelWidth = Math.max(280, Math.min(800, width));
}
function handleWsMessage(msg) {
    const s = store.getValue();
    switch(msg.type){
        case "app:list":
            {
                s.apps = msg.payload.apps;
                // Restore saved app selection on first load
                if (s.pendingRestoreAppId) {
                    const restoreApp = s.apps.find((a)=>a.id === s.pendingRestoreAppId);
                    s.pendingRestoreAppId = null;
                    if (restoreApp) {
                        selectApp(restoreApp.id);
                        break;
                    }
                }
                // If selected app was removed, deselect
                if (s.selectedAppId && !s.apps.find((a)=>a.id === s.selectedAppId)) {
                    s.selectedAppId = null;
                    s.viewingLogsFor = null;
                }
                break;
            }
        case "app:status":
            {
                const app = s.apps.find((a)=>a.id === msg.payload.id);
                if (app) {
                    app.status = msg.payload.status;
                    if (msg.payload.status === "crashed") {
                        selectApp(msg.payload.id);
                    }
                }
                break;
            }
        case "app:log":
            {
                const logId = msg.payload.id;
                const clean = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stripAnsi"])(msg.payload.data);
                if (!s.logBuffers[logId]) s.logBuffers[logId] = "";
                s.logBuffers[logId] += clean;
                if (s.logBuffers[logId].length > MAX_LOG_BUFFER) {
                    s.logBuffers[logId] = s.logBuffers[logId].slice(-MAX_LOG_BUFFER);
                }
                break;
            }
        case "stats":
            {
                s.system.cpu = msg.payload.system.cpu;
                s.system.mem = msg.payload.system.mem;
                if (msg.payload.system.memory) {
                    s.system.memory = msg.payload.system.memory;
                }
                s.appStats = msg.payload.apps;
                if (msg.payload.processes) {
                    s.processes = msg.payload.processes;
                }
                if (msg.payload.docker) {
                    s.docker = msg.payload.docker;
                }
                break;
            }
        case "chat:token":
            {
                s.chat.streamingContent += msg.payload.token;
                break;
            }
        case "chat:done":
            {
                s.chat.messages.push({
                    role: "assistant",
                    content: s.chat.streamingContent
                });
                s.chat.streamingContent = "";
                s.chat.loading = false;
                break;
            }
        case "chat:error":
            {
                s.chat.messages.push({
                    role: "assistant",
                    content: `Error: ${msg.payload.message}`
                });
                s.chat.streamingContent = "";
                s.chat.loading = false;
                break;
            }
        case "error":
            console.error("Manager error:", msg.payload.message);
            break;
    }
}
function saveUiState() {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    const s = store.getValue();
    const state = {
        activeNav: s.activeNav,
        selectedAppId: s.selectedAppId,
        processSortBy: s.processSortBy,
        filterPortsOnly: s.filterPortsOnly
    };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
}
function loadUiState() {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    try {
        const raw = localStorage.getItem(UI_STATE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        const s = store.getValue();
        s.processSortBy = saved.processSortBy;
        s.filterPortsOnly = saved.filterPortsOnly ?? false;
        if (saved.activeNav === "processes" || saved.activeNav === "docker") {
            s.activeNav = saved.activeNav;
        } else if (saved.selectedAppId) {
            s.pendingRestoreAppId = saved.selectedAppId;
        }
    } catch  {
    // ignore
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/system-stats.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SystemStats",
    ()=>SystemStats
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/tooltip.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
function SystemStats() {
    _s();
    const cpu = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "system/cpu");
    const mem = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "system/mem");
    const memory = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "system/memory");
    const total = memory?.physical || 1;
    const wiredPct = memory ? Math.min(memory.wired / total * 100, 100) : 0;
    const appPct = memory ? Math.min(memory.appMem / total * 100, 100) : 0;
    const compPct = memory ? Math.min(memory.compressed / total * 100, 100) : 0;
    const cachedPct = memory ? Math.min(memory.cached / total * 100, 100) : 0;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
        className: "flex flex-col gap-1.5 py-2 px-2.5 bg-crust rounded-lg",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        className: "w-[30px] text-xs font-bold uppercase tracking-wide text-subtext0",
                        children: "CPU"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                        lineNumber: 27,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "h-full bg-blue rounded-full transition-[width] duration-500 ease-out",
                            style: {
                                width: `${cpu}%`
                            }
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                            lineNumber: 31,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                        lineNumber: 30,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "w-8 text-right text-sm tabular-nums text-subtext1",
                        children: [
                            cpu,
                            "%"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                        lineNumber: 36,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                lineNumber: 26,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Tooltip"], {
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TooltipTrigger"], {
                        asChild: true,
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "flex items-center gap-2 cursor-default",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                    className: "w-[30px] text-xs font-bold uppercase tracking-wide text-subtext0",
                                    children: "MEM"
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 43,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex-1 h-1.5 bg-surface0 rounded-full overflow-hidden flex",
                                    children: memory ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "h-full bg-blue transition-[width] duration-500 ease-out",
                                                style: {
                                                    width: `${wiredPct}%`
                                                }
                                            }, void 0, false, {
                                                fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                                lineNumber: 49,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "h-full bg-mauve transition-[width] duration-500 ease-out",
                                                style: {
                                                    width: `${appPct}%`
                                                }
                                            }, void 0, false, {
                                                fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                                lineNumber: 53,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "h-full bg-yellow transition-[width] duration-500 ease-out",
                                                style: {
                                                    width: `${compPct}%`
                                                }
                                            }, void 0, false, {
                                                fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                                lineNumber: 57,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "h-full bg-teal opacity-50 transition-[width] duration-500 ease-out",
                                                style: {
                                                    width: `${cachedPct}%`
                                                }
                                            }, void 0, false, {
                                                fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                                lineNumber: 61,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, void 0, true) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "h-full bg-green rounded-full transition-[width] duration-500 ease-out",
                                        style: {
                                            width: `${mem}%`
                                        }
                                    }, void 0, false, {
                                        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                        lineNumber: 67,
                                        columnNumber: 17
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 46,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "w-8 text-right text-sm tabular-nums text-subtext1",
                                    children: [
                                        mem,
                                        "%"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 73,
                                    columnNumber: 13
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                            lineNumber: 42,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                        lineNumber: 41,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TooltipContent"], {
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "flex flex-col gap-0.5 text-xs",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "flex items-center gap-1.5",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "w-2 h-2 rounded-sm bg-blue shrink-0"
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                            lineNumber: 81,
                                            columnNumber: 15
                                        }, this),
                                        "Wired ",
                                        memory ? `${wiredPct.toFixed(1)}%` : ""
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 80,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "flex items-center gap-1.5",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "w-2 h-2 rounded-sm bg-mauve shrink-0"
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                            lineNumber: 85,
                                            columnNumber: 15
                                        }, this),
                                        "App ",
                                        memory ? `${appPct.toFixed(1)}%` : ""
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 84,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "flex items-center gap-1.5",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "w-2 h-2 rounded-sm bg-yellow shrink-0"
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                            lineNumber: 89,
                                            columnNumber: 15
                                        }, this),
                                        "Compressed ",
                                        memory ? `${compPct.toFixed(1)}%` : ""
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 88,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "flex items-center gap-1.5",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "w-2 h-2 rounded-sm bg-teal opacity-50 shrink-0"
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                            lineNumber: 93,
                                            columnNumber: 15
                                        }, this),
                                        "Cached ",
                                        memory ? `${cachedPct.toFixed(1)}%` : ""
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                                    lineNumber: 92,
                                    columnNumber: 13
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                            lineNumber: 79,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                        lineNumber: 78,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
                lineNumber: 40,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/system-stats.tsx",
        lineNumber: 25,
        columnNumber: 5
    }, this);
}
_s(SystemStats, "UXvvrVMM/MC81biLaw6XcUbOB1A=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = SystemStats;
var _c;
__turbopack_context__.k.register(_c, "SystemStats");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/sidebar-nav.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SidebarNav",
    ()=>SidebarNav
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$layout$2d$grid$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__LayoutGrid$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/layout-grid.js [app-client] (ecmascript) <export default as LayoutGrid>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$activity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Activity$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/activity.js [app-client] (ecmascript) <export default as Activity>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$container$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Container$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/container.js [app-client] (ecmascript) <export default as Container>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
const navItems = [
    {
        key: "apps",
        label: "Apps",
        icon: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$layout$2d$grid$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__LayoutGrid$3e$__["LayoutGrid"]
    },
    {
        key: "processes",
        label: "Processes",
        icon: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$activity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Activity$3e$__["Activity"]
    },
    {
        key: "docker",
        label: "Docker",
        icon: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$container$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Container$3e$__["Container"]
    }
];
function SidebarNav() {
    _s();
    const activeNav = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "activeNav");
    const docker = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "docker");
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
        className: "flex flex-col gap-0.5",
        children: navItems.map(({ key, label, icon: Icon })=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["switchNav"])(key),
                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("flex items-center gap-2 px-2.5 py-1.5 rounded-md border-none", "text-base font-medium cursor-pointer transition-colors duration-150", key === activeNav ? "bg-background text-text" : "bg-transparent text-overlay0 hover:bg-background hover:text-subtext0"),
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Icon, {
                        size: 16,
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("shrink-0", key === activeNav ? "text-text" : "text-overlay0")
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/sidebar-nav.tsx",
                        lineNumber: 35,
                        columnNumber: 11
                    }, this),
                    label,
                    key === "docker" && docker.daemonRunning && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "w-2 h-2 rounded-full bg-green shrink-0"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/sidebar-nav.tsx",
                        lineNumber: 44,
                        columnNumber: 13
                    }, this)
                ]
            }, key, true, {
                fileName: "[project]/packages/renderer/src/components/sidebar-nav.tsx",
                lineNumber: 24,
                columnNumber: 9
            }, this))
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/sidebar-nav.tsx",
        lineNumber: 22,
        columnNumber: 5
    }, this);
}
_s(SidebarNav, "F5cr7ME1GW7ny4Dq97F53Pj/63A=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = SidebarNav;
var _c;
__turbopack_context__.k.register(_c, "SidebarNav");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Button",
    ()=>Button,
    "buttonVariants",
    ()=>buttonVariants
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$class$2d$variance$2d$authority$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/class-variance-authority/dist/index.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
;
;
;
const buttonVariants = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$class$2d$variance$2d$authority$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cva"])("inline-flex items-center justify-center rounded-md text-sm font-medium cursor-pointer transition-colors disabled:pointer-events-none disabled:opacity-50", {
    variants: {
        variant: {
            default: "bg-surface0 text-text border border-surface1 hover:bg-surface1",
            primary: "bg-mauve text-background border border-mauve font-semibold hover:bg-lavender hover:border-lavender",
            danger: "bg-surface0 text-red border border-red hover:bg-red hover:text-background",
            ghost: "bg-transparent border-none text-overlay0 hover:bg-background hover:text-subtext0",
            active: "bg-mauve text-background border border-mauve font-semibold hover:bg-lavender hover:border-lavender"
        },
        size: {
            default: "px-2.5 py-1 text-sm",
            sm: "px-2 py-0.5 text-sm"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "default"
    }
});
const Button = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["forwardRef"])(_c = ({ className, variant, size, ...props }, ref)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])(buttonVariants({
            variant,
            size,
            className
        })),
        ref: ref,
        ...props
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/ui/button.tsx",
        lineNumber: 39,
        columnNumber: 5
    }, ("TURBOPACK compile-time value", void 0)));
_c1 = Button;
Button.displayName = "Button";
;
var _c, _c1;
__turbopack_context__.k.register(_c, "Button$forwardRef");
__turbopack_context__.k.register(_c1, "Button");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/apps-list.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AppsList",
    ()=>AppsList
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
function AppsList() {
    _s();
    const apps = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "apps");
    const selectedAppId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "selectedAppId");
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex justify-between items-center",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                        className: "text-xs font-semibold uppercase tracking-wide text-subtext0",
                        children: "Apps"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                        lineNumber: 18,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        size: "sm",
                        onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["showAddForm"])(),
                        children: "+ Add"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                        lineNumber: 21,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                lineNumber: 17,
                columnNumber: 7
            }, this),
            apps.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "text-center text-overlay0 text-base py-5",
                children: "No apps configured"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                lineNumber: 26,
                columnNumber: 9
            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                className: "flex-1 overflow-y-auto flex flex-col gap-0.5 scrollbar-thin",
                children: apps.map((app)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["selectApp"])(app.id),
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150", "border-none bg-transparent text-left w-full", app.id === selectedAppId ? "bg-background" : "hover:bg-background"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(StatusDot, {
                                status: app.status
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                                lineNumber: 43,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "font-medium text-base whitespace-nowrap overflow-hidden text-ellipsis",
                                children: app.name
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                                lineNumber: 44,
                                columnNumber: 15
                            }, this)
                        ]
                    }, app.id, true, {
                        fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                        lineNumber: 32,
                        columnNumber: 13
                    }, this))
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
                lineNumber: 30,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true);
}
_s(AppsList, "giQr+RNo/bCitOi0PtwQ649eJjE=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = AppsList;
function StatusDot({ status }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("w-2 h-2 rounded-full shrink-0", status === "running" && "bg-green shadow-[0_0_4px_var(--color-green)]", status === "stopped" && "bg-overlay0", status === "crashed" && "bg-red shadow-[0_0_4px_var(--color-red)]")
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/apps-list.tsx",
        lineNumber: 57,
        columnNumber: 5
    }, this);
}
_c1 = StatusDot;
var _c, _c1;
__turbopack_context__.k.register(_c, "AppsList");
__turbopack_context__.k.register(_c1, "StatusDot");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/file-explorer-toggle.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FileExplorerToggle",
    ()=>FileExplorerToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$folder$2d$open$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FolderOpen$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/folder-open.js [app-client] (ecmascript) <export default as FolderOpen>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
function FileExplorerToggle() {
    _s();
    const open = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/open");
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
        onClick: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toggleFileExplorer"],
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-subtext0", "hover:bg-surface0 hover:text-text transition-colors", open && "bg-surface0 text-text"),
        title: "Toggle File Explorer",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$folder$2d$open$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FolderOpen$3e$__["FolderOpen"], {
                size: 16
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer-toggle.tsx",
                lineNumber: 21,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                children: "Files"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer-toggle.tsx",
                lineNumber: 22,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/file-explorer-toggle.tsx",
        lineNumber: 12,
        columnNumber: 5
    }, this);
}
_s(FileExplorerToggle, "NLD1nYfCM9SkISudPobtxvgiZ3A=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = FileExplorerToggle;
var _c;
__turbopack_context__.k.register(_c, "FileExplorerToggle");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/sidebar.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Sidebar",
    ()=>Sidebar
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$system$2d$stats$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/system-stats.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$sidebar$2d$nav$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/sidebar-nav.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$apps$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/apps-list.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2d$toggle$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer-toggle.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
;
;
;
function Sidebar() {
    _s();
    const managerRunning = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "manager/running");
    async function handleManagerToggle() {
        if (managerRunning) {
            await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].stopManager();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["disconnectWs"])();
            const s = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"].getValue();
            s.manager.running = false;
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setManagerRunning"])(false);
        } else {
            await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].startManager();
            const s = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"].getValue();
            s.manager.running = true;
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setManagerRunning"])(true);
            setTimeout(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["connectWs"], 1200);
        }
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("aside", {
        className: "w-60 min-w-60 bg-mantle border-r border-surface0 flex flex-col gap-2.5 px-3 pb-3 overflow-hidden",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "h-[38px] shrink-0 [-webkit-app-region:drag]"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                lineNumber: 39,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center justify-between",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                        className: "text-xl font-semibold text-mauve",
                        children: "Genie"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                        lineNumber: 43,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-1.5 text-sm",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("w-2 h-2 rounded-full", managerRunning ? "bg-green shadow-[0_0_4px_var(--color-green)]" : "bg-overlay0")
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                                lineNumber: 45,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                onClick: handleManagerToggle,
                                children: managerRunning ? "Stop" : "Start"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                                lineNumber: 53,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                        lineNumber: 44,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                lineNumber: 42,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$system$2d$stats$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SystemStats"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                lineNumber: 59,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$sidebar$2d$nav$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SidebarNav"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                lineNumber: 60,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$apps$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AppsList"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                lineNumber: 61,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-auto pt-2 border-t border-surface0",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2d$toggle$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FileExplorerToggle"], {}, void 0, false, {
                    fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                    lineNumber: 63,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
                lineNumber: 62,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/sidebar.tsx",
        lineNumber: 37,
        columnNumber: 5
    }, this);
}
_s(Sidebar, "VZ2bX+i5j0ORs46gTjPjcegecKg=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = Sidebar;
var _c;
__turbopack_context__.k.register(_c, "Sidebar");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/welcome-panel.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "WelcomePanel",
    ()=>WelcomePanel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
;
function WelcomePanel() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex-1 flex items-center justify-center text-overlay0 text-lg",
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
            children: "Select an app or add a new one"
        }, void 0, false, {
            fileName: "[project]/packages/renderer/src/components/welcome-panel.tsx",
            lineNumber: 4,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/welcome-panel.tsx",
        lineNumber: 3,
        columnNumber: 5
    }, this);
}
_c = WelcomePanel;
var _c;
__turbopack_context__.k.register(_c, "WelcomePanel");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/app-detail.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AppDetail",
    ()=>AppDetail
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
function AppDetail() {
    _s();
    const apps = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "apps");
    const selectedAppId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "selectedAppId");
    const appStats = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "appStats");
    const logBuffers = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "logBuffers");
    const viewingLogsFor = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "viewingLogsFor");
    const logsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const prevLogLen = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const app = apps.find((a)=>a.id === selectedAppId);
    if (!app) return null;
    const stats = appStats[app.id];
    const logContent = viewingLogsFor ? logBuffers[viewingLogsFor] || "" : "";
    // Auto-scroll logs
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "AppDetail.useEffect": ()=>{
            if (logsRef.current && logContent.length > prevLogLen.current) {
                logsRef.current.scrollTop = logsRef.current.scrollHeight;
            }
            prevLogLen.current = logContent.length;
        }
    }["AppDetail.useEffect"], [
        logContent
    ]);
    // Save UI state when selection changes
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "AppDetail.useEffect": ()=>{
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["saveUiState"])();
        }
    }["AppDetail.useEffect"], [
        selectedAppId
    ]);
    function handleToggle() {
        if (app.status === "running") {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("app:stop", {
                id: app.id
            });
        } else {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("app:start", {
                id: app.id
            });
        }
    }
    function handleRemove() {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("app:remove", {
            id: app.id
        });
        const s = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"].getValue();
        s.selectedAppId = null;
        s.viewingLogsFor = null;
    }
    function handleClearLogs() {
        if (viewingLogsFor) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clearLogs"])(viewingLogsFor);
        }
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex-1 flex flex-col px-5 pb-5 overflow-hidden",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center justify-between pb-4 border-b border-surface0",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-2.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("w-2.5 h-2.5 rounded-full", app.status === "running" && "bg-green shadow-[0_0_4px_var(--color-green)]", app.status === "stopped" && "bg-overlay0", app.status === "crashed" && "bg-red shadow-[0_0_4px_var(--color-red)]")
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                lineNumber: 79,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "text-2xl font-semibold text-text",
                                        children: app.name
                                    }, void 0, false, {
                                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                        lineNumber: 90,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "text-sm text-overlay0 font-mono",
                                        children: app.command
                                    }, void 0, false, {
                                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                        lineNumber: 91,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                lineNumber: 89,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 78,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                onClick: handleToggle,
                                children: app.status === "running" ? "Stop" : "Start"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                lineNumber: 95,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                variant: "danger",
                                onClick: handleRemove,
                                children: "Remove"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                lineNumber: 98,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 94,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                lineNumber: 77,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "grid grid-cols-4 gap-2.5 py-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(StatCard, {
                        label: "CPU",
                        value: stats ? `${stats.cpu}%` : "—"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 106,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(StatCard, {
                        label: "Memory",
                        value: stats ? `${stats.mem} MB` : "—"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 107,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(StatCard, {
                        label: "PID",
                        value: stats ? `${stats.pid}` : "—"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 108,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(StatCard, {
                        label: "Status",
                        value: app.status.charAt(0).toUpperCase() + app.status.slice(1)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 109,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                lineNumber: 105,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1 flex flex-col gap-1.5 overflow-hidden",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex justify-between items-center",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                className: "text-xs font-semibold uppercase tracking-wide text-subtext0",
                                children: "Logs"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                lineNumber: 118,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                onClick: handleClearLogs,
                                children: "Clear"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                                lineNumber: 121,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 117,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("pre", {
                        ref: logsRef,
                        className: "flex-1 bg-crust rounded-md p-2 font-mono text-xs leading-relaxed overflow-y-auto text-subtext0 whitespace-pre-wrap break-all select-text cursor-text scrollbar-thin",
                        children: logContent
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                        lineNumber: 125,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                lineNumber: 116,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
        lineNumber: 75,
        columnNumber: 5
    }, this);
}
_s(AppDetail, "w71bow5ISsnprza62bArjFL7jR0=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = AppDetail;
function StatCard({ label, value }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "bg-mantle rounded-lg px-3 py-2.5 flex flex-col gap-1",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-xs font-bold uppercase tracking-wide text-subtext0",
                children: label
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                lineNumber: 139,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-3xl font-semibold tabular-nums text-text",
                children: value
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
                lineNumber: 142,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/app-detail.tsx",
        lineNumber: 138,
        columnNumber: 5
    }, this);
}
_c1 = StatCard;
var _c, _c1;
__turbopack_context__.k.register(_c, "AppDetail");
__turbopack_context__.k.register(_c1, "StatCard");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/add-app-form.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AddAppForm",
    ()=>AddAppForm
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
function AddAppForm() {
    _s();
    const [name, setName] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [command, setCommand] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [cwd, setCwd] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    function handleSave() {
        const trimName = name.trim();
        const trimCommand = command.trim();
        if (!trimName || !trimCommand) return;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("app:add", {
            name: trimName,
            command: trimCommand,
            cwd: cwd.trim() || undefined
        });
        setName("");
        setCommand("");
        setCwd("");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hideAddForm"])();
    }
    function handleCancel() {
        setName("");
        setCommand("");
        setCwd("");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hideAddForm"])();
    }
    async function handleBrowse() {
        const folder = await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].pickFolder();
        if (folder) setCwd(folder);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "px-5 py-6 flex flex-col gap-3.5 max-w-[480px]",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                className: "text-lg font-semibold text-text mb-1",
                children: "Add New App"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                lineNumber: 44,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-col gap-1",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        className: "text-sm font-semibold text-subtext0",
                        children: "Name"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 47,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                        type: "text",
                        value: name,
                        onChange: (e)=>setName(e.target.value),
                        placeholder: "My App",
                        className: "bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 48,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                lineNumber: 46,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-col gap-1",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        className: "text-sm font-semibold text-subtext0",
                        children: "Command"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 58,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                        type: "text",
                        value: command,
                        onChange: (e)=>setCommand(e.target.value),
                        placeholder: "node server.js",
                        className: "bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 59,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                lineNumber: 57,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-col gap-1",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                        className: "text-sm font-semibold text-subtext0",
                        children: "Working Directory"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 69,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex gap-1.5 items-center",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                type: "text",
                                value: cwd,
                                readOnly: true,
                                placeholder: "(optional)",
                                className: "flex-1 min-w-0 bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                                lineNumber: 73,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                onClick: handleBrowse,
                                children: "Browse"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                                lineNumber: 80,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 72,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                lineNumber: 68,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex gap-1.5 justify-end pt-1",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        size: "sm",
                        onClick: handleCancel,
                        children: "Cancel"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 87,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: "primary",
                        onClick: handleSave,
                        children: "Save"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                        lineNumber: 90,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
                lineNumber: 86,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/add-app-form.tsx",
        lineNumber: 43,
        columnNumber: 5
    }, this);
}
_s(AddAppForm, "52x4e1w7JSYQVzHPIkqkOX0q/xI=");
_c = AddAppForm;
var _c;
__turbopack_context__.k.register(_c, "AddAppForm");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/memory-stats.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MemoryStats",
    ()=>MemoryStats
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/tooltip.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
function MemoryStats() {
    _s();
    const memory = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "system/memory");
    if (!memory) return null;
    const total = memory.physical || 1;
    const pct = (v)=>`${Math.min(v / total * 100, 100).toFixed(1)}%`;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex gap-4 py-2.5 px-3 bg-mantle rounded-lg mb-2.5 items-stretch",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-col gap-1.5 min-w-[180px] flex-1",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex justify-between items-baseline",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-xs font-bold uppercase tracking-wide text-subtext0",
                                children: "Memory Pressure"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 29,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-sm font-semibold tabular-nums text-text",
                                children: [
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.used),
                                    " / ",
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.physical)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 32,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                        lineNumber: 28,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex h-2.5 bg-surface1 rounded-[5px] overflow-hidden",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "h-full bg-blue transition-[width] duration-500 ease-out",
                                style: {
                                    width: pct(memory.wired)
                                }
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 37,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "h-full bg-mauve transition-[width] duration-500 ease-out",
                                style: {
                                    width: pct(memory.appMem)
                                }
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 41,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "h-full bg-yellow transition-[width] duration-500 ease-out",
                                style: {
                                    width: pct(memory.compressed)
                                }
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 45,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                        lineNumber: 36,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex gap-2.5 flex-wrap",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(LegendItem, {
                                color: "bg-blue",
                                label: "Wired",
                                tooltip: "Memory required by the system that cannot be compressed or paged out"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 51,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(LegendItem, {
                                color: "bg-mauve",
                                label: "App",
                                tooltip: "Memory used by applications and their data"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 52,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(LegendItem, {
                                color: "bg-yellow",
                                label: "Compressed",
                                tooltip: "Memory that has been compressed to make more RAM available"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 53,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(LegendItem, {
                                color: "bg-surface1",
                                label: "Free",
                                tooltip: "Memory not currently in use and available for allocation"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 54,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                        lineNumber: 50,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                lineNumber: 27,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex gap-5 border-l border-surface0 pl-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col gap-1",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "Physical Memory",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.physical),
                                tooltip: "Total installed RAM on this machine"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 61,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "Memory Used",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.used),
                                tooltip: "App + Wired + Compressed memory currently in use"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 62,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "Cached Files",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.cached),
                                tooltip: "Files cached in RAM for faster access, reclaimable when needed"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 63,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "Swap Used",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.swap),
                                tooltip: "Data written to disk when RAM is full — high values may indicate memory pressure"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 64,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                        lineNumber: 60,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col gap-1",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "App Memory",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.appMem),
                                tooltip: "Memory used by applications and their data"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 67,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "Wired Memory",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.wired),
                                tooltip: "Memory required by the system that cannot be compressed or paged out"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 68,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MemStatRow, {
                                label: "Compressed",
                                value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBytes"])(memory.compressed),
                                tooltip: "Inactive memory compressed to free up RAM — counts toward used memory"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                                lineNumber: 69,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                        lineNumber: 66,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                lineNumber: 59,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
        lineNumber: 25,
        columnNumber: 5
    }, this);
}
_s(MemoryStats, "HR2ylf+GcBaPq/3sWXmp8Z0QRrg=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = MemoryStats;
function LegendItem({ color, label, tooltip }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Tooltip"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TooltipTrigger"], {
                asChild: true,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    className: "flex items-center gap-1 text-xs text-overlay0 cursor-default",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            className: `w-2 h-2 rounded-sm shrink-0 ${color}`
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                            lineNumber: 89,
                            columnNumber: 11
                        }, this),
                        label
                    ]
                }, void 0, true, {
                    fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                    lineNumber: 88,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                lineNumber: 87,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TooltipContent"], {
                children: tooltip
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                lineNumber: 93,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
        lineNumber: 86,
        columnNumber: 5
    }, this);
}
_c1 = LegendItem;
function MemStatRow({ label, value, tooltip }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Tooltip"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TooltipTrigger"], {
                asChild: true,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "flex items-baseline gap-2 cursor-default",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            className: "text-sm text-subtext0 whitespace-nowrap",
                            children: label
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                            lineNumber: 111,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            className: "text-sm font-semibold tabular-nums text-text ml-auto whitespace-nowrap",
                            children: value
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                            lineNumber: 114,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                    lineNumber: 110,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                lineNumber: 109,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$tooltip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TooltipContent"], {
                children: tooltip
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
                lineNumber: 119,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/memory-stats.tsx",
        lineNumber: 108,
        columnNumber: 5
    }, this);
}
_c2 = MemStatRow;
var _c, _c1, _c2;
__turbopack_context__.k.register(_c, "MemoryStats");
__turbopack_context__.k.register(_c1, "LegendItem");
__turbopack_context__.k.register(_c2, "MemStatRow");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/ui/context-menu.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ContextMenu",
    ()=>ContextMenu,
    "ContextMenuItem",
    ()=>ContextMenuItem
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
function ContextMenu({ x, y, onClose, children }) {
    _s();
    const ref = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "ContextMenu.useEffect": ()=>{
            function handleClick(e) {
                if (ref.current && !ref.current.contains(e.target)) {
                    onClose();
                }
            }
            function handleKey(e) {
                if (e.key === "Escape") onClose();
            }
            document.addEventListener("mousedown", handleClick);
            document.addEventListener("keydown", handleKey);
            return ({
                "ContextMenu.useEffect": ()=>{
                    document.removeEventListener("mousedown", handleClick);
                    document.removeEventListener("keydown", handleKey);
                }
            })["ContextMenu.useEffect"];
        }
    }["ContextMenu.useEffect"], [
        onClose
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: ref,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("fixed z-[1000] bg-surface0 border border-surface1 rounded-lg p-1", "shadow-lg shadow-black/40"),
        style: {
            left: x,
            top: y
        },
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/ui/context-menu.tsx",
        lineNumber: 34,
        columnNumber: 5
    }, this);
}
_s(ContextMenu, "8uVE59eA/r6b92xF80p7sH8rXLk=");
_c = ContextMenu;
function ContextMenuItem({ onClick, className, children }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
        onClick: onClick,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("block w-full bg-transparent border-none text-base font-medium", "py-1.5 px-3.5 rounded-[5px] cursor-pointer text-left whitespace-nowrap", "hover:bg-surface1", className),
        children: children
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/ui/context-menu.tsx",
        lineNumber: 59,
        columnNumber: 5
    }, this);
}
_c1 = ContextMenuItem;
var _c, _c1;
__turbopack_context__.k.register(_c, "ContextMenu");
__turbopack_context__.k.register(_c1, "ContextMenuItem");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/process-context-menu.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ProcessContextMenu",
    ()=>ProcessContextMenu
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/context-menu.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
"use client";
;
;
;
function ProcessContextMenu({ pid, x, y, onClose }) {
    function handleKill() {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("process:kill", {
            pid
        });
        onClose();
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenu"], {
        x: x,
        y: y,
        onClose: onClose,
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenuItem"], {
            onClick: handleKill,
            className: "text-red",
            children: "Kill Process"
        }, void 0, false, {
            fileName: "[project]/packages/renderer/src/components/process-context-menu.tsx",
            lineNumber: 26,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/process-context-menu.tsx",
        lineNumber: 25,
        columnNumber: 5
    }, this);
}
_c = ProcessContextMenu;
var _c;
__turbopack_context__.k.register(_c, "ProcessContextMenu");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/processes-panel.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ProcessesPanel",
    ()=>ProcessesPanel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$memory$2d$stats$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/memory-stats.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$process$2d$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/process-context-menu.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
function ProcessesPanel() {
    _s();
    const processes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "processes");
    const processSortBy = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "processSortBy");
    const filterPortsOnly = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "filterPortsOnly");
    const appStats = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "appStats");
    const [filterText, setFilterText] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [contextMenu, setContextMenu] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [contextTargetPid, setContextTargetPid] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const geniePids = new Set();
    for (const stats of Object.values(appStats)){
        geniePids.add(stats.pid);
    }
    let filtered = filterPortsOnly ? processes.filter((p)=>p.port !== "") : processes;
    if (filterText) {
        const q = filterText.toLowerCase();
        filtered = filtered.filter((p)=>p.name.toLowerCase().includes(q) || p.port.includes(q));
    }
    const sorted = [
        ...filtered
    ].sort((a, b)=>b[processSortBy] - a[processSortBy]);
    const handleContextMenu = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "ProcessesPanel.useCallback[handleContextMenu]": (e, pid)=>{
            e.preventDefault();
            setContextMenu({
                pid,
                x: e.clientX,
                y: e.clientY
            });
            setContextTargetPid(pid);
        }
    }["ProcessesPanel.useCallback[handleContextMenu]"], []);
    const closeContextMenu = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "ProcessesPanel.useCallback[closeContextMenu]": ()=>{
            setContextMenu(null);
            setContextTargetPid(null);
        }
    }["ProcessesPanel.useCallback[closeContextMenu]"], []);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex-1 flex flex-col px-5 pb-5 overflow-hidden",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex justify-between items-center pb-3 border-b border-surface0 mb-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                        className: "text-xs font-semibold uppercase tracking-wide text-subtext0",
                        children: "Processes"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                        lineNumber: 61,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                type: "text",
                                value: filterText,
                                onChange: (e)=>setFilterText(e.target.value),
                                placeholder: "Filter by name or port…",
                                className: "bg-surface0 border border-surface1 rounded-md px-2 py-1 text-xs text-text placeholder:text-overlay0 outline-none focus:border-blue w-40"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 65,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                variant: filterPortsOnly ? "active" : "default",
                                onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["togglePortFilter"])(),
                                children: filterPortsOnly ? "With Ports" : "All"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 72,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toggleSort"])(),
                                children: processSortBy === "cpu" ? "CPU \u2193" : "MEM \u2193"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 79,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-right text-sm tabular-nums text-subtext1 whitespace-nowrap",
                                children: filterPortsOnly || filterText ? `${sorted.length} / ${processes.length}` : `${processes.length}`
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 82,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                        lineNumber: 64,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                lineNumber: 60,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$memory$2d$stats$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MemoryStats"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                lineNumber: 90,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1 overflow-y-auto flex flex-col scrollbar-thin",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "grid grid-cols-[60px_80px_1fr_56px_64px_64px] gap-2 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-overlay0 sticky top-0 bg-background",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "PID"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 96,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "User"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 97,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "Name"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 98,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "Port"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 99,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "CPU"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 100,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "MEM"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                lineNumber: 101,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                        lineNumber: 95,
                        columnNumber: 9
                    }, this),
                    sorted.map((proc)=>{
                        const isGenie = geniePids.has(proc.pid);
                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            onContextMenu: (e)=>handleContextMenu(e, proc.pid),
                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("grid grid-cols-[60px_80px_1fr_56px_64px_64px] gap-2 px-2.5 py-[5px] text-base rounded items-center", contextTargetPid === proc.pid ? "bg-surface0" : "hover:bg-mantle"),
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-overlay0 tabular-nums text-xs",
                                    children: proc.pid
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                    lineNumber: 117,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "whitespace-nowrap overflow-hidden text-ellipsis text-overlay0 text-xs",
                                    children: proc.user
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                    lineNumber: 120,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1",
                                    children: [
                                        proc.name,
                                        isGenie && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "inline-block bg-mauve text-background text-2xs font-bold px-[5px] py-px rounded-lg uppercase tracking-tight shrink-0",
                                            children: "Genie"
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                            lineNumber: 126,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                    lineNumber: 123,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-blue text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis",
                                    children: proc.port
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                    lineNumber: 131,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-right tabular-nums text-subtext1 text-xs",
                                    children: [
                                        proc.cpu,
                                        "%"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                    lineNumber: 134,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-right tabular-nums text-subtext1 text-xs",
                                    children: [
                                        proc.mem,
                                        "M"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                                    lineNumber: 137,
                                    columnNumber: 15
                                }, this)
                            ]
                        }, proc.pid, true, {
                            fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                            lineNumber: 107,
                            columnNumber: 13
                        }, this);
                    })
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                lineNumber: 93,
                columnNumber: 7
            }, this),
            contextMenu && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$process$2d$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ProcessContextMenu"], {
                pid: contextMenu.pid,
                x: contextMenu.x,
                y: contextMenu.y,
                onClose: closeContextMenu
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
                lineNumber: 146,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/processes-panel.tsx",
        lineNumber: 58,
        columnNumber: 5
    }, this);
}
_s(ProcessesPanel, "PRQOF6qLVitBm5+3RcCI8qegdFQ=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = ProcessesPanel;
var _c;
__turbopack_context__.k.register(_c, "ProcessesPanel");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/docker-context-menu.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DockerContextMenu",
    ()=>DockerContextMenu
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/context-menu.tsx [app-client] (ecmascript)");
"use client";
;
;
function DockerContextMenu({ containerId, containerState, x, y, onClose, onAction }) {
    const isRunning = containerState === "running";
    function handleAction() {
        onAction(containerId, isRunning ? "docker:stop" : "docker:start");
        onClose();
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenu"], {
        x: x,
        y: y,
        onClose: onClose,
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenuItem"], {
            onClick: handleAction,
            className: isRunning ? "text-red" : "text-green",
            children: isRunning ? "Stop Container" : "Start Container"
        }, void 0, false, {
            fileName: "[project]/packages/renderer/src/components/docker-context-menu.tsx",
            lineNumber: 31,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/docker-context-menu.tsx",
        lineNumber: 30,
        columnNumber: 5
    }, this);
}
_c = DockerContextMenu;
var _c;
__turbopack_context__.k.register(_c, "DockerContextMenu");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/docker-panel.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DockerPanel",
    ()=>DockerPanel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$external$2d$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ExternalLink$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/external-link.js [app-client] (ecmascript) <export default as ExternalLink>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/loader-circle.js [app-client] (ecmascript) <export default as Loader2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$right$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronRight$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/chevron-right.js [app-client] (ecmascript) <export default as ChevronRight>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$docker$2d$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/docker-context-menu.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
;
function stateDot(state) {
    if (state === "running") return "bg-green";
    if (state === "exited" || state === "dead") return "bg-red";
    return "bg-overlay0";
}
function groupDot(containers) {
    const allRunning = containers.every((c)=>c.state === "running");
    const someRunning = containers.some((c)=>c.state === "running");
    if (allRunning) return "bg-green";
    if (someRunning) return "bg-yellow";
    return "bg-red";
}
function groupContainers(containers) {
    const projectMap = new Map();
    const standalone = [];
    for (const c of containers){
        if (c.project) {
            const list = projectMap.get(c.project);
            if (list) list.push(c);
            else projectMap.set(c.project, [
                c
            ]);
        } else {
            standalone.push(c);
        }
    }
    const groups = [];
    for (const [project, ctrs] of projectMap){
        groups.push({
            project,
            containers: ctrs
        });
    }
    groups.sort((a, b)=>a.project.localeCompare(b.project));
    return {
        groups,
        standalone
    };
}
const COLS = "grid grid-cols-[16px_1fr_1fr_80px_1fr_56px_72px] gap-2";
function ContainerRow({ c, isPending, isContextTarget, onContextMenu, indent }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        onContextMenu: (e)=>onContextMenu(e, c),
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])(COLS, "px-2.5 py-[5px] text-base rounded items-center", indent && "pl-10", isContextTarget ? "bg-surface0" : "hover:bg-mantle"),
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "flex items-center justify-center",
                children: isPending ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                    size: 12,
                    className: "animate-spin text-overlay0"
                }, void 0, false, {
                    fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                    lineNumber: 81,
                    columnNumber: 11
                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("w-2 h-2 rounded-full", stateDot(c.state))
                }, void 0, false, {
                    fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                    lineNumber: 83,
                    columnNumber: 11
                }, this)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 79,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "whitespace-nowrap overflow-hidden text-ellipsis",
                children: c.service || c.name
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 86,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "whitespace-nowrap overflow-hidden text-ellipsis text-overlay0 text-xs",
                children: c.image
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 89,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-xs text-subtext1 capitalize",
                children: isPending ? c.state === "running" ? "stopping…" : "starting…" : c.state
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 92,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-blue text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis",
                children: c.ports
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 97,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-right tabular-nums text-subtext1 text-xs",
                children: c.state === "running" ? `${c.cpu}%` : "-"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 100,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-right tabular-nums text-subtext1 text-xs",
                children: c.state === "running" ? `${c.mem}M` : "-"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 103,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
        lineNumber: 70,
        columnNumber: 5
    }, this);
}
_c = ContainerRow;
function DockerPanel() {
    _s();
    const docker = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "docker");
    const [daemonPending, setDaemonPending] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [pendingContainers, setPendingContainers] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(new Set());
    const [collapsedGroups, setCollapsedGroups] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(new Set());
    const prevDaemonRunning = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(docker.daemonRunning);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "DockerPanel.useEffect": ()=>{
            if (docker.daemonRunning !== prevDaemonRunning.current) {
                setDaemonPending(false);
                prevDaemonRunning.current = docker.daemonRunning;
            }
        }
    }["DockerPanel.useEffect"], [
        docker.daemonRunning
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "DockerPanel.useEffect": ()=>{
            if (pendingContainers.size === 0) return;
            setPendingContainers({
                "DockerPanel.useEffect": (prev)=>{
                    const next = new Set(prev);
                    let changed = false;
                    for (const id of prev){
                        const c = docker.containers.find({
                            "DockerPanel.useEffect.c": (ct)=>ct.id === id
                        }["DockerPanel.useEffect.c"]);
                        if (!c || c.state === "running" || c.state === "exited") {
                            next.delete(id);
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                }
            }["DockerPanel.useEffect"]);
        }
    }["DockerPanel.useEffect"], [
        docker.containers,
        pendingContainers
    ]);
    const [contextMenu, setContextMenu] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [contextTargetId, setContextTargetId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const handleContextMenu = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "DockerPanel.useCallback[handleContextMenu]": (e, container)=>{
            e.preventDefault();
            setContextMenu({
                id: container.id,
                state: container.state,
                x: e.clientX,
                y: e.clientY
            });
            setContextTargetId(container.id);
        }
    }["DockerPanel.useCallback[handleContextMenu]"], []);
    const closeContextMenu = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "DockerPanel.useCallback[closeContextMenu]": ()=>{
            setContextMenu(null);
            setContextTargetId(null);
        }
    }["DockerPanel.useCallback[closeContextMenu]"], []);
    function handleDaemonToggle() {
        setDaemonPending(true);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])(docker.daemonRunning ? "docker:daemon:stop" : "docker:daemon:start", {});
    }
    function handleContainerAction(id, action) {
        setPendingContainers((prev)=>new Set(prev).add(id));
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])(action, {
            id
        });
    }
    function toggleGroup(project) {
        setCollapsedGroups((prev)=>{
            const next = new Set(prev);
            if (next.has(project)) next.delete(project);
            else next.add(project);
            return next;
        });
    }
    const { groups, standalone } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "DockerPanel.useMemo": ()=>groupContainers(docker.containers)
    }["DockerPanel.useMemo"], [
        docker.containers
    ]);
    const runningCount = docker.containers.filter((c)=>c.state === "running").length;
    const totalCount = docker.containers.length;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex-1 flex flex-col px-5 pb-5 overflow-hidden",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex justify-between items-center pb-3 border-b border-surface0 mb-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                className: "text-xs font-semibold uppercase tracking-wide text-subtext0",
                                children: "Docker"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 195,
                                columnNumber: 11
                            }, this),
                            daemonPending ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                                size: 12,
                                className: "animate-spin text-overlay0"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 199,
                                columnNumber: 13
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("w-2 h-2 rounded-full shrink-0", docker.daemonRunning ? "bg-green" : "bg-red")
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 201,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                        lineNumber: 194,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wsSend"])("docker:open", {}),
                                className: "flex items-center gap-1 text-xs text-blue hover:text-sapphire cursor-pointer bg-transparent border-none",
                                children: [
                                    "Open Docker",
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$external$2d$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ExternalLink$3e$__["ExternalLink"], {
                                        size: 12
                                    }, void 0, false, {
                                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                        lineNumber: 215,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 210,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                onClick: handleDaemonToggle,
                                disabled: daemonPending,
                                children: daemonPending ? docker.daemonRunning ? "Stopping…" : "Starting…" : docker.daemonRunning ? "Stop Daemon" : "Start Daemon"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 217,
                                columnNumber: 11
                            }, this),
                            docker.daemonRunning && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-sm tabular-nums text-subtext1",
                                children: [
                                    runningCount,
                                    " / ",
                                    totalCount
                                ]
                            }, void 0, true, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 227,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                        lineNumber: 209,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 193,
                columnNumber: 7
            }, this),
            !docker.daemonRunning && !daemonPending ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1 flex items-center justify-center",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                    className: "text-overlay0 text-base",
                    children: "Docker daemon is not running"
                }, void 0, false, {
                    fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                    lineNumber: 237,
                    columnNumber: 11
                }, this)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 236,
                columnNumber: 9
            }, this) : !docker.daemonRunning && daemonPending ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1 flex flex-col items-center justify-center gap-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                        size: 24,
                        className: "animate-spin text-overlay0"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                        lineNumber: 241,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-overlay0 text-base",
                        children: "Starting Docker…"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                        lineNumber: 242,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 240,
                columnNumber: 9
            }, this) : docker.containers.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1 flex items-center justify-center",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                    className: "text-overlay0 text-base",
                    children: "No containers"
                }, void 0, false, {
                    fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                    lineNumber: 246,
                    columnNumber: 11
                }, this)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 245,
                columnNumber: 9
            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex-1 overflow-y-auto flex flex-col scrollbar-thin",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])(COLS, "px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-overlay0 sticky top-0 bg-background"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {}, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 252,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "Name"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 253,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "Image"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 254,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "State"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 255,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "Ports"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 256,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "CPU"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 257,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: "MEM"
                            }, void 0, false, {
                                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                lineNumber: 258,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                        lineNumber: 251,
                        columnNumber: 11
                    }, this),
                    groups.map((g)=>{
                        const collapsed = collapsedGroups.has(g.project);
                        const running = g.containers.filter((c)=>c.state === "running").length;
                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                    onClick: ()=>toggleGroup(g.project),
                                    className: "flex items-center gap-2 w-full px-2.5 py-1.5 bg-transparent border-none cursor-pointer hover:bg-mantle rounded text-left",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$right$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronRight$3e$__["ChevronRight"], {
                                            size: 14,
                                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("text-overlay0 transition-transform duration-150 shrink-0", !collapsed && "rotate-90")
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                            lineNumber: 271,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("w-2 h-2 rounded-full shrink-0", groupDot(g.containers))
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                            lineNumber: 278,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "text-sm font-semibold text-text",
                                            children: g.project
                                        }, void 0, false, {
                                            fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                            lineNumber: 279,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "text-xs text-overlay0",
                                            children: [
                                                running,
                                                "/",
                                                g.containers.length
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                            lineNumber: 280,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                    lineNumber: 267,
                                    columnNumber: 17
                                }, this),
                                !collapsed && g.containers.map((c)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(ContainerRow, {
                                        c: c,
                                        isPending: pendingContainers.has(c.id),
                                        isContextTarget: contextTargetId === c.id,
                                        onContextMenu: handleContextMenu,
                                        indent: true
                                    }, c.id, false, {
                                        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                                        lineNumber: 286,
                                        columnNumber: 21
                                    }, this))
                            ]
                        }, g.project, true, {
                            fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                            lineNumber: 266,
                            columnNumber: 15
                        }, this);
                    }),
                    standalone.map((c)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(ContainerRow, {
                            c: c,
                            isPending: pendingContainers.has(c.id),
                            isContextTarget: contextTargetId === c.id,
                            onContextMenu: handleContextMenu
                        }, c.id, false, {
                            fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                            lineNumber: 301,
                            columnNumber: 13
                        }, this))
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 249,
                columnNumber: 9
            }, this),
            contextMenu && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$docker$2d$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DockerContextMenu"], {
                containerId: contextMenu.id,
                containerState: contextMenu.state,
                x: contextMenu.x,
                y: contextMenu.y,
                onClose: closeContextMenu,
                onAction: handleContainerAction
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
                lineNumber: 313,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/docker-panel.tsx",
        lineNumber: 191,
        columnNumber: 5
    }, this);
}
_s(DockerPanel, "CV0jsR7zRUHj4BegaR3sRp1XO5g=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c1 = DockerPanel;
var _c, _c1;
__turbopack_context__.k.register(_c, "ContainerRow");
__turbopack_context__.k.register(_c1, "DockerPanel");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FileExplorerToolbar",
    ()=>FileExplorerToolbar
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$left$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronLeft$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/chevron-left.js [app-client] (ecmascript) <export default as ChevronLeft>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$right$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronRight$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/chevron-right.js [app-client] (ecmascript) <export default as ChevronRight>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$up$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowUp$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/arrow-up.js [app-client] (ecmascript) <export default as ArrowUp>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$folder$2d$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FolderPlus$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/folder-plus.js [app-client] (ecmascript) <export default as FolderPlus>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$refresh$2d$cw$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__RefreshCw$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/refresh-cw.js [app-client] (ecmascript) <export default as RefreshCw>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
function FileExplorerToolbar() {
    _s();
    const currentPath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/currentPath");
    const historyIndex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/historyIndex");
    const history = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/history");
    const [creatingFolder, setCreatingFolder] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [newFolderName, setNewFolderName] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const canGoBack = historyIndex > 0;
    const canGoForward = historyIndex < history.length - 1;
    const canGoUp = currentPath !== "/";
    const segments = currentPath.split("/").filter(Boolean);
    async function handleCreateFolder() {
        if (!newFolderName.trim()) {
            setCreatingFolder(false);
            return;
        }
        const folderPath = currentPath.replace(/\/$/, "") + "/" + newFolderName.trim();
        await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].createFolder(folderPath);
        setNewFolderName("");
        setCreatingFolder(false);
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["refreshDirectory"])();
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col gap-1.5 px-2 pb-1.5",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-0.5",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["navigateBack"],
                        disabled: !canGoBack,
                        className: "p-1 rounded hover:bg-surface1 disabled:opacity-30 disabled:cursor-default text-subtext0",
                        title: "Back",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$left$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronLeft$3e$__["ChevronLeft"], {
                            size: 16
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                            lineNumber: 50,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 44,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["navigateForward"],
                        disabled: !canGoForward,
                        className: "p-1 rounded hover:bg-surface1 disabled:opacity-30 disabled:cursor-default text-subtext0",
                        title: "Forward",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$right$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronRight$3e$__["ChevronRight"], {
                            size: 16
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                            lineNumber: 58,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 52,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["navigateUp"],
                        disabled: !canGoUp,
                        className: "p-1 rounded hover:bg-surface1 disabled:opacity-30 disabled:cursor-default text-subtext0",
                        title: "Up",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$up$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowUp$3e$__["ArrowUp"], {
                            size: 16
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                            lineNumber: 66,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 60,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex-1"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 68,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: ()=>setCreatingFolder(true),
                        className: "p-1 rounded hover:bg-surface1 text-subtext0",
                        title: "New Folder",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$folder$2d$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FolderPlus$3e$__["FolderPlus"], {
                            size: 16
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                            lineNumber: 74,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 69,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["refreshDirectory"],
                        className: "p-1 rounded hover:bg-surface1 text-subtext0",
                        title: "Refresh",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$refresh$2d$cw$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__RefreshCw$3e$__["RefreshCw"], {
                            size: 16
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                            lineNumber: 81,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 76,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                lineNumber: 43,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-0.5 text-xs text-overlay0 overflow-x-auto min-h-[20px] scrollbar-none",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["navigateTo"])("/"),
                        className: "shrink-0 hover:text-text px-0.5 rounded hover:bg-surface1",
                        children: "/"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                        lineNumber: 87,
                        columnNumber: 9
                    }, this),
                    segments.map((seg, i)=>{
                        const segPath = "/" + segments.slice(0, i + 1).join("/");
                        const isLast = i === segments.length - 1;
                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            className: "flex items-center gap-0.5 shrink-0",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-surface2",
                                    children: "/"
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                                    lineNumber: 98,
                                    columnNumber: 15
                                }, this),
                                isLast ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-subtext1 px-0.5",
                                    children: seg
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                                    lineNumber: 100,
                                    columnNumber: 17
                                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                    onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["navigateTo"])(segPath),
                                    className: "hover:text-text px-0.5 rounded hover:bg-surface1",
                                    children: seg
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                                    lineNumber: 102,
                                    columnNumber: 17
                                }, this)
                            ]
                        }, segPath, true, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                            lineNumber: 97,
                            columnNumber: 13
                        }, this);
                    })
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                lineNumber: 86,
                columnNumber: 7
            }, this),
            creatingFolder && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                autoFocus: true,
                value: newFolderName,
                onChange: (e)=>setNewFolderName(e.target.value),
                onKeyDown: (e)=>{
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") {
                        setCreatingFolder(false);
                        setNewFolderName("");
                    }
                },
                onBlur: handleCreateFolder,
                placeholder: "New folder name…",
                className: "bg-surface0 border border-surface1 rounded px-2 py-1 text-xs text-text outline-none focus:border-mauve"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
                lineNumber: 116,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx",
        lineNumber: 41,
        columnNumber: 5
    }, this);
}
_s(FileExplorerToolbar, "6nPuQhGjvD7pQdc2EC9uVoD9fvQ=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = FileExplorerToolbar;
var _c;
__turbopack_context__.k.register(_c, "FileExplorerToolbar");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FileContextMenu",
    ()=>FileContextMenu
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/ui/context-menu.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
"use client";
;
;
;
;
function FileContextMenu({ x, y, entry, onClose }) {
    async function handleOpen() {
        if (entry.isDirectory) {
        // handled via double-click in parent
        } else {
            await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].openFile(entry.path);
        }
        onClose();
    }
    async function handleReveal() {
        await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].openInFinder(entry.path);
        onClose();
    }
    function handleRename() {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setRenamingEntry"])(entry.path);
        onClose();
    }
    async function handleDelete() {
        await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].deleteEntry(entry.path);
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["refreshDirectory"])();
        onClose();
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenu"], {
        x: x,
        y: y,
        onClose: onClose,
        children: [
            !entry.isDirectory && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenuItem"], {
                onClick: handleOpen,
                children: "Open"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx",
                lineNumber: 52,
                columnNumber: 9
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenuItem"], {
                onClick: handleReveal,
                children: "Reveal in Finder"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx",
                lineNumber: 54,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenuItem"], {
                onClick: handleRename,
                children: "Rename"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx",
                lineNumber: 57,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$ui$2f$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContextMenuItem"], {
                onClick: handleDelete,
                className: "text-red",
                children: "Move to Trash"
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx",
                lineNumber: 58,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx",
        lineNumber: 50,
        columnNumber: 5
    }, this);
}
_c = FileContextMenu;
var _c;
__turbopack_context__.k.register(_c, "FileContextMenu");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/file-explorer/file-list.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FileList",
    ()=>FileList
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$folder$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Folder$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/folder.js [app-client] (ecmascript) <export default as Folder>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__File$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/file.js [app-client] (ecmascript) <export default as File>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$text$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileText$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/file-text.js [app-client] (ecmascript) <export default as FileText>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$code$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileCode$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/file-code.js [app-client] (ecmascript) <export default as FileCode>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileImage$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/file-image.js [app-client] (ecmascript) <export default as FileImage>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$json$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileJson$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/file-json.js [app-client] (ecmascript) <export default as FileJson>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/film.js [app-client] (ecmascript) <export default as Film>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$music$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Music$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/music.js [app-client] (ecmascript) <export default as Music>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/utils.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer/file-context-menu.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
function getFileIcon(entry) {
    if (entry.isDirectory) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$folder$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Folder$3e$__["Folder"];
    const ext = entry.name.split(".").pop()?.toLowerCase() || "";
    if ([
        "ts",
        "tsx",
        "js",
        "jsx",
        "py",
        "rb",
        "go",
        "rs",
        "java",
        "c",
        "cpp",
        "h",
        "css",
        "scss",
        "html",
        "vue",
        "svelte"
    ].includes(ext)) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$code$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileCode$3e$__["FileCode"];
    if ([
        "json",
        "yaml",
        "yml",
        "toml"
    ].includes(ext)) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$json$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileJson$3e$__["FileJson"];
    if ([
        "png",
        "jpg",
        "jpeg",
        "gif",
        "svg",
        "webp",
        "ico",
        "bmp"
    ].includes(ext)) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileImage$3e$__["FileImage"];
    if ([
        "mp4",
        "mov",
        "avi",
        "mkv",
        "webm"
    ].includes(ext)) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__["Film"];
    if ([
        "mp3",
        "wav",
        "flac",
        "aac",
        "ogg"
    ].includes(ext)) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$music$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Music$3e$__["Music"];
    if ([
        "md",
        "txt",
        "log",
        "csv",
        "xml"
    ].includes(ext)) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2d$text$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__FileText$3e$__["FileText"];
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$file$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__File$3e$__["File"];
}
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function InlineRenameInput({ entry }) {
    _s();
    const [value, setValue] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(entry.name);
    const inputRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "InlineRenameInput.useEffect": ()=>{
            inputRef.current?.select();
        }
    }["InlineRenameInput.useEffect"], []);
    async function handleSubmit() {
        const trimmed = value.trim();
        if (!trimmed || trimmed === entry.name) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setRenamingEntry"])(null);
            return;
        }
        const dir = entry.path.replace(/\/[^/]+$/, "");
        const newPath = dir + "/" + trimmed;
        await __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].renameEntry(entry.path, newPath);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setRenamingEntry"])(null);
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["refreshDirectory"])();
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
        ref: inputRef,
        autoFocus: true,
        value: value,
        onChange: (e)=>setValue(e.target.value),
        onKeyDown: (e)=>{
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setRenamingEntry"])(null);
            e.stopPropagation();
        },
        onBlur: handleSubmit,
        className: "flex-1 min-w-0 bg-surface0 border border-mauve rounded px-1 py-0.5 text-xs text-text outline-none",
        onClick: (e)=>e.stopPropagation()
    }, void 0, false, {
        fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
        lineNumber: 67,
        columnNumber: 5
    }, this);
}
_s(InlineRenameInput, "u5KDPtjo0C9SphHwFL1l+L/26Ac=");
_c = InlineRenameInput;
function FileList() {
    _s1();
    const entries = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/entries");
    const loading = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/loading");
    const error = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/error");
    const selectedEntry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/selectedEntry");
    const renamingEntry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/renamingEntry");
    const [contextMenu, setContextMenu] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    if (loading) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "flex-1 flex items-center justify-center text-overlay0 text-sm",
            children: "Loading…"
        }, void 0, false, {
            fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
            lineNumber: 99,
            columnNumber: 7
        }, this);
    }
    if (error) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "flex-1 flex items-center justify-center text-red text-sm px-4 text-center",
            children: error
        }, void 0, false, {
            fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
            lineNumber: 107,
            columnNumber: 7
        }, this);
    }
    // Sort: directories first, then alphabetical
    const sorted = [
        ...entries
    ].sort((a, b)=>{
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, {
            sensitivity: "base"
        });
    });
    if (sorted.length === 0) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "flex-1 flex items-center justify-center text-overlay0 text-sm",
            children: "Empty directory"
        }, void 0, false, {
            fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
            lineNumber: 121,
            columnNumber: 7
        }, this);
    }
    function handleDoubleClick(entry) {
        if (entry.isDirectory) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["navigateTo"])(entry.path);
        } else {
            __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].openFile(entry.path);
        }
    }
    function handleContextMenu(e, entry) {
        e.preventDefault();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["selectFileEntry"])(entry.path);
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            entry
        });
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex-1 overflow-y-auto px-1",
        children: [
            sorted.map((entry)=>{
                const Icon = getFileIcon(entry);
                const isSelected = selectedEntry === entry.path;
                const isRenaming = renamingEntry === entry.path;
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("flex items-center gap-2 px-2 py-1 rounded cursor-default text-sm select-none", "hover:bg-surface0", isSelected && "bg-surface0"),
                    onClick: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["selectFileEntry"])(entry.path),
                    onDoubleClick: ()=>handleDoubleClick(entry),
                    onContextMenu: (e)=>handleContextMenu(e, entry),
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Icon, {
                            size: 16,
                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])("shrink-0", entry.isDirectory ? "text-mauve" : "text-overlay1")
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
                            lineNumber: 160,
                            columnNumber: 13
                        }, this),
                        isRenaming ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(InlineRenameInput, {
                            entry: entry
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
                            lineNumber: 168,
                            columnNumber: 15
                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "flex-1 truncate text-text text-xs",
                                    children: entry.name
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
                                    lineNumber: 171,
                                    columnNumber: 17
                                }, this),
                                !entry.isDirectory && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-overlay0 text-[10px] shrink-0",
                                    children: formatSize(entry.size)
                                }, void 0, false, {
                                    fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
                                    lineNumber: 175,
                                    columnNumber: 19
                                }, this)
                            ]
                        }, void 0, true)
                    ]
                }, entry.path, true, {
                    fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
                    lineNumber: 149,
                    columnNumber: 11
                }, this);
            }),
            contextMenu && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$context$2d$menu$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FileContextMenu"], {
                x: contextMenu.x,
                y: contextMenu.y,
                entry: contextMenu.entry,
                onClose: ()=>setContextMenu(null)
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
                lineNumber: 186,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/file-explorer/file-list.tsx",
        lineNumber: 142,
        columnNumber: 5
    }, this);
}
_s1(FileList, "oayUTqhecIoocvh+Z1RPA2DqwF8=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c1 = FileList;
var _c, _c1;
__turbopack_context__.k.register(_c, "InlineRenameInput");
__turbopack_context__.k.register(_c1, "FileList");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FileExplorerPanel",
    ()=>FileExplorerPanel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/x.js [app-client] (ecmascript) <export default as X>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$explorer$2d$toolbar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer/file-explorer-toolbar.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer/file-list.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
function FileExplorerPanel() {
    _s();
    const open = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/open");
    const panelWidth = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "fileExplorer/panelWidth");
    const dragging = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(false);
    const handleMouseDown = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "FileExplorerPanel.useCallback[handleMouseDown]": (e)=>{
            e.preventDefault();
            dragging.current = true;
            const startX = e.clientX;
            const startWidth = panelWidth;
            function onMouseMove(ev) {
                if (!dragging.current) return;
                const delta = startX - ev.clientX;
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setFileExplorerPanelWidth"])(startWidth + delta);
            }
            function onMouseUp() {
                dragging.current = false;
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            }
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        }
    }["FileExplorerPanel.useCallback[handleMouseDown]"], [
        panelWidth
    ]);
    if (!open) return null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "fixed top-0 right-0 h-screen bg-mantle border-l border-surface0 flex flex-col z-50 shadow-xl shadow-black/30",
        style: {
            width: panelWidth
        },
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-mauve/40 active:bg-mauve/60 z-10",
                onMouseDown: handleMouseDown
            }, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                lineNumber: 49,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center justify-between px-3 pt-[38px] pb-1.5",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                        className: "text-sm font-semibold text-text",
                        children: "Files"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                        lineNumber: 56,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        onClick: __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toggleFileExplorer"],
                        className: "p-1 rounded hover:bg-surface1 text-overlay0 hover:text-text",
                        title: "Close",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__["X"], {
                            size: 14
                        }, void 0, false, {
                            fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                            lineNumber: 62,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                        lineNumber: 57,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                lineNumber: 55,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$explorer$2d$toolbar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FileExplorerToolbar"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                lineNumber: 66,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FileList"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
                lineNumber: 67,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx",
        lineNumber: 44,
        columnNumber: 5
    }, this);
}
_s(FileExplorerPanel, "YdrmyY0UyW2qvWqdnBlVLS9zAXo=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = FileExplorerPanel;
var _c;
__turbopack_context__.k.register(_c, "FileExplorerPanel");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/components/file-explorer/index.ts [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$explorer$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx [app-client] (ecmascript)");
;
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/renderer/src/app/page.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/subjecto/dist/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/store/index.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/genie-api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/lib/ws.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$sidebar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/sidebar.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$welcome$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/welcome-panel.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$app$2d$detail$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/app-detail.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$add$2d$app$2d$form$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/add-app-form.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$processes$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/processes-panel.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$docker$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/docker-panel.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer/index.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$explorer$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/renderer/src/components/file-explorer/file-explorer-panel.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
;
;
;
;
;
function MainPanel() {
    _s();
    const activeNav = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "activeNav");
    const selectedAppId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "selectedAppId");
    const showAddForm = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "showAddForm");
    const apps = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"], "apps");
    if (activeNav === "processes") {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$processes$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ProcessesPanel"], {}, void 0, false, {
            fileName: "[project]/packages/renderer/src/app/page.tsx",
            lineNumber: 33,
            columnNumber: 12
        }, this);
    }
    if (activeNav === "docker") {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$docker$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DockerPanel"], {}, void 0, false, {
            fileName: "[project]/packages/renderer/src/app/page.tsx",
            lineNumber: 37,
            columnNumber: 12
        }, this);
    }
    if (showAddForm) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$add$2d$app$2d$form$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AddAppForm"], {}, void 0, false, {
            fileName: "[project]/packages/renderer/src/app/page.tsx",
            lineNumber: 41,
            columnNumber: 12
        }, this);
    }
    const selectedApp = selectedAppId ? apps.find((a)=>a.id === selectedAppId) : null;
    if (selectedApp) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$app$2d$detail$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AppDetail"], {}, void 0, false, {
            fileName: "[project]/packages/renderer/src/app/page.tsx",
            lineNumber: 49,
            columnNumber: 12
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$welcome$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["WelcomePanel"], {}, void 0, false, {
        fileName: "[project]/packages/renderer/src/app/page.tsx",
        lineNumber: 52,
        columnNumber: 10
    }, this);
}
_s(MainPanel, "FmAc3ISA1HJXxwPhx/ZTl9Y4ujg=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$subjecto$2f$dist$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeepSubject"]
    ];
});
_c = MainPanel;
function Home() {
    _s1();
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "Home.useEffect": ()=>{
            // Restore UI state from localStorage
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["loadUiState"])();
            // Listen for manager status from Electron main process
            __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].onManagerStatus({
                "Home.useEffect": (running)=>{
                    const s = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"].getValue();
                    s.manager.running = running;
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setManagerRunning"])(running);
                    if (running) {
                        setTimeout(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["connectWs"], 500);
                    }
                }
            }["Home.useEffect"]);
            // Check initial manager status
            __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$genie$2d$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["genie"].getManagerStatus().then({
                "Home.useEffect": (running)=>{
                    const s = __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$store$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["store"].getValue();
                    s.manager.running = running;
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setManagerRunning"])(running);
                    if (running) {
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$lib$2f$ws$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["connectWs"])();
                    }
                }
            }["Home.useEffect"]);
        }
    }["Home.useEffect"], []);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-row h-screen",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$sidebar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Sidebar"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/app/page.tsx",
                lineNumber: 83,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
                className: "flex-1 flex flex-col overflow-hidden min-w-0",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "h-[38px] shrink-0 [-webkit-app-region:drag]"
                    }, void 0, false, {
                        fileName: "[project]/packages/renderer/src/app/page.tsx",
                        lineNumber: 86,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(MainPanel, {}, void 0, false, {
                        fileName: "[project]/packages/renderer/src/app/page.tsx",
                        lineNumber: 87,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/renderer/src/app/page.tsx",
                lineNumber: 84,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$renderer$2f$src$2f$components$2f$file$2d$explorer$2f$file$2d$explorer$2d$panel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FileExplorerPanel"], {}, void 0, false, {
                fileName: "[project]/packages/renderer/src/app/page.tsx",
                lineNumber: 89,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/renderer/src/app/page.tsx",
        lineNumber: 82,
        columnNumber: 5
    }, this);
}
_s1(Home, "OD7bBpZva5O2jO+Puf00hKivP7c=");
_c1 = Home;
var _c, _c1;
__turbopack_context__.k.register(_c, "MainPanel");
__turbopack_context__.k.register(_c1, "Home");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=packages_renderer_src_39be09cf._.js.map