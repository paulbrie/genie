"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { Loader2, Check, X, Minus, Copy, Rocket, Maximize2, Minimize2, ArrowDownToLine, Search, Trash2 } from "lucide-react";
import type { FloatingWindowState, PendingDeploy, ProjectDef, VpsDeployState } from "@/store/types";
import { $projects, $vpsDeploy, $windowManager } from "@/store/subjects";
import { clearVpsDeployState, closeWindow, destroyFailedDroplet, focusWindow, keepFailedDroplet, minimizeWindow, openWindow, registerWindow, setWindowBusy, updateWindowPosition } from "@/store/actions";
import { useDraggable, useResizable } from "@/hooks/use-draggable";
import { ErrorMessage } from "@/components/ui/error-message";

const WINDOW_PREFIX = "deploy-";
const DEFAULT_W = 400;
const DEFAULT_H = 420;
const CASCADE_OFFSET = 30;

const ERROR_PATTERNS = /^(error|err!|fatal|exception|failed|stderr)/i;

function isErrorLine(line: string): boolean {
  return ERROR_PATTERNS.test(line.trim());
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((now - startedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return (
    <span className="text-md text-overlay0 font-mono">
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function HighlightedLine({ line, search }: { line: string; search: string }) {
  if (!search) return <>{line}</>;
  const idx = line.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return <>{line}</>;
  return (
    <>
      {line.slice(0, idx)}
      <mark className="bg-yellow text-crust rounded px-0.5">{line.slice(idx, idx + search.length)}</mark>
      {line.slice(idx + search.length)}
    </>
  );
}

function FloatingDeployWindow({
  deploy,
  windowId,
  windowState,
  onClose,
  onMinimize,
}: {
  deploy: PendingDeploy;
  windowId: string;
  windowState: FloatingWindowState;
  onClose: () => void;
  onMinimize: () => void;
}) {
  const [projects] = useSubject($projects);
  const endRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll when new lines arrive (if enabled)
  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [deploy.progress.length, autoScroll]);

  // Detect manual scroll to auto-disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  const [windowManager] = useSubject($windowManager);
  const allWindows = windowManager.windows;
  const storedPos = windowState.position;
  const initial = useMemo(() => {
    if (storedPos.x >= 0 && storedPos.y >= 0) return storedPos;
    // Collect positions of all other open windows to avoid overlap
    const takenPositions = Object.values(allWindows)
      .filter((w) => w.id !== windowId && w.status === "open" && w.position.x >= 0)
      .map((w) => w.position);
    let pos = { x: Math.max(window.innerWidth - 440, 20), y: Math.max(window.innerHeight - DEFAULT_H - 40, 20) };
    while (takenPositions.some((p) => Math.abs(p.x - pos.x) < 20 && Math.abs(p.y - pos.y) < 20)) {
      pos = { x: pos.x - CASCADE_OFFSET, y: pos.y - CASCADE_OFFSET };
      if (pos.x < 20) pos.x = 20 + CASCADE_OFFSET * Math.floor(Math.random() * 5);
      if (pos.y < 20) pos.y = 20 + CASCADE_OFFSET * Math.floor(Math.random() * 5);
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the cascaded initial position so subsequently-opened windows can see it and cascade past it
  useEffect(() => {
    if (storedPos.x < 0 || storedPos.y < 0) updateWindowPosition(windowId, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnd = useCallback(
    (pos: { x: number; y: number }) => {
      updateWindowPosition(windowId, pos);
    },
    [windowId]
  );

  const { elRef, onPointerDown } = useDraggable(initial, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, { w: DEFAULT_W, h: DEFAULT_H });

  // Filter lines by search
  const filteredLines = useMemo(() => {
    if (!search) return deploy.progress.map((line, i) => ({ line, idx: i }));
    const lower = search.toLowerCase();
    return deploy.progress
      .map((line, i) => ({ line, idx: i }))
      .filter(({ line }) => line.toLowerCase().includes(lower));
  }, [deploy.progress, search]);

  const project = projects.find((p) => p.id === deploy.projectId);
  const projectName = project?.name ?? "project";
  const templateName = project?.vpsBaseImageConfigName || null;
  const isDeploying = deploy.deploying;
  const hasError = !!deploy.error;
  const isDone = !isDeploying && deploy.progress.length > 0;

  const title = isDeploying
    ? `Deploying to ${projectName}...`
    : hasError
      ? "Deployment failed"
      : "Deployment complete";

  const fullText = [...deploy.progress, ...(deploy.error ? [deploy.error] : [])].join("\n");

  function handleDismiss() {
    clearVpsDeployState(deploy.instanceId);
    closeWindow(windowId);
  }

  function handleCopy() {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: windowState.zIndex }
    : { left: initial.x, top: initial.y, width: DEFAULT_W, height: DEFAULT_H, zIndex: windowState.zIndex };

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle border border-surface0 shadow-2xl shadow-black/50 flex flex-col ${maximized ? "rounded-none" : "rounded-xl"}`}
      style={containerStyle}
      onPointerDown={() => focusWindow(windowId)}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={maximized ? undefined : onPointerDown}
      >
        <div className="flex items-center gap-2 text-md font-semibold text-subtext0 min-w-0 truncate">
          {isDeploying && <Loader2 size={14} className="text-blue animate-spin shrink-0" />}
          {!isDeploying && hasError && <X size={14} className="text-red shrink-0" />}
          {!isDeploying && !hasError && isDone && <Check size={14} className="text-green shrink-0" />}
          {!isDeploying && !hasError && !isDone && <Rocket size={14} className="text-blue shrink-0" />}
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isDeploying && deploy.startedAt && <span className="mr-1.5"><ElapsedTime startedAt={deploy.startedAt} /></span>}
          <button
            onClick={() => setShowSearch((v) => !v)}
            className={`p-1 rounded transition-colors ${showSearch ? "text-blue bg-surface0" : "text-overlay0 hover:text-text hover:bg-surface0"}`}
            title="Search logs"
          >
            <Search size={13} />
          </button>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`p-1 rounded transition-colors ${autoScroll ? "text-blue bg-surface0" : "text-overlay0 hover:text-text hover:bg-surface0"}`}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            <ArrowDownToLine size={13} />
          </button>
          <button
            onClick={onMinimize}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => setMaximized((v) => !v)}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Template info */}
      {templateName && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-surface0 shrink-0">
          <span className="text-md text-overlay0">Template:</span>
          <span className="text-md text-subtext0 font-medium">{templateName}</span>
        </div>
      )}

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface0 shrink-0">
          <Search size={12} className="text-overlay0 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs..."
            className="flex-1 bg-transparent text-md text-text placeholder:text-overlay0 outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("");
                setShowSearch(false);
              }
            }}
          />
          {search && (
            <span className="text-md text-overlay0">{filteredLines.length} match{filteredLines.length !== 1 ? "es" : ""}</span>
          )}
        </div>
      )}

      {/* Log lines */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-md select-text scrollbar-thin min-h-0"
      >
        {filteredLines.map(({ line, idx }) => (
          <div key={idx} className={`leading-relaxed ${isErrorLine(line) ? "text-red" : "text-overlay1"}`}>
            <HighlightedLine line={line} search={search} />
          </div>
        ))}
        {deploy.error && (
          <ErrorMessage className="font-semibold">{deploy.error}</ErrorMessage>
        )}
        <div ref={endRef} />
      </div>

      {/* Failed droplet action bar */}
      {!isDeploying && hasError && deploy.failedDroplet && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-surface0 bg-surface0/50 shrink-0">
          <span className="text-md text-subtext0 flex-1">
            Droplet {deploy.failedDroplet.ipAddress ? `(${deploy.failedDroplet.ipAddress})` : `#${deploy.failedDroplet.dropletId}`} is still running.
          </span>
          <button
            onClick={() => keepFailedDroplet(deploy.instanceId)}
            className="px-2 py-1 rounded text-md text-overlay0 hover:text-text hover:bg-surface1 transition-colors"
          >
            Keep
          </button>
          <button
            onClick={() => destroyFailedDroplet(deploy.instanceId)}
            disabled={deploy.destroyingDroplet}
            className="flex items-center gap-1 px-2 py-1 rounded text-md text-red hover:bg-red/10 transition-colors disabled:opacity-50"
          >
            {deploy.destroyingDroplet ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {deploy.destroyingDroplet ? "Destroying..." : "Destroy"}
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-surface0 shrink-0">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-md text-overlay0 hover:text-text transition-colors"
          title="Copy logs"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy logs"}
        </button>
        {!isDeploying && (
          <button
            onClick={handleDismiss}
            className="text-md text-overlay0 hover:text-text transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Resize handle */}
      {!maximized && (
        <div
          onPointerDown={onResizePointerDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ touchAction: "none" }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="text-overlay0/50">
            <path d="M14 14L8 14L14 8Z" fill="currentColor" />
            <path d="M14 14L11 14L14 11Z" fill="currentColor" opacity="0.5" />
          </svg>
        </div>
      )}
    </div>,
    document.body
  );
}

function DeployWindowInstance({ instanceId }: { instanceId: string }) {
  const [windowManager] = useSubject($windowManager);
  const windows = windowManager.windows;
  const vpsDeploy = useDeepSubjectAll($vpsDeploy);
  const activeDeploys = vpsDeploy.activeDeploys;
  const deploy = activeDeploys[instanceId];
  const windowId = WINDOW_PREFIX + instanceId;
  const windowState = windows[windowId];
  const prevDeployingRef = useRef(false);

  useEffect(() => {
    registerWindow(windowId, "Deploy Progress", "rocket");
    openWindow(windowId);
  }, [windowId]);

  const deploying = deploy?.deploying ?? false;
  useEffect(() => {
    if (deploying && !prevDeployingRef.current) {
      openWindow(windowId);
    }
    prevDeployingRef.current = deploying;
    setWindowBusy(windowId, deploying);
  }, [deploying, windowId]);

  const isOpen = windowState?.status === "open";
  if (!isOpen || !windowState || !deploy) return null;

  return (
    <FloatingDeployWindow
      deploy={deploy}
      windowId={windowId}
      windowState={windowState}
      onClose={() => closeWindow(windowId)}
      onMinimize={() => minimizeWindow(windowId)}
    />
  );
}

export function DeployWindow() {
  const vpsDeploy = useDeepSubjectAll($vpsDeploy);
  const activeDeploys = vpsDeploy.activeDeploys;
  const ids = Object.keys(activeDeploys);

  return (
    <>
      {ids.map((id) => (
        <DeployWindowInstance key={id} instanceId={id} />
      ))}
    </>
  );
}
