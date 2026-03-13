"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { RefreshCw, X, Check, Copy, Minus, Maximize2, Minimize2, Terminal, Trash2 } from "lucide-react";
import {
  $admin,
  $windowManager,
  registerWindow,
  openWindow,
  closeWindow,
  minimizeWindow,
  focusWindow,
  updateWindowPosition,
  addTerminalTab,
  destroyFailedBuildDroplet,
  type AdminBaseImageState,
  type FloatingWindowState,
} from "@/store";
import { useDraggable, useResizable } from "@/components/use-draggable";

const WINDOW_ID = "build-log";
const DEFAULT_W = 480;
const DEFAULT_H = 380;

function BuildLogWindowInner({
  baseImage, windowState, title, isBuilding, hasError,
  maximized, setMaximized, copied, handleCopy,
  containerStyle, endRef, logContainerRef, handleScroll, handleDragEnd,
}: {
  baseImage: AdminBaseImageState;
  windowState: FloatingWindowState;
  title: string;
  isBuilding: boolean;
  hasError: boolean;
  maximized: boolean;
  setMaximized: (v: boolean) => void;
  copied: boolean;
  handleCopy: () => void;
  containerStyle: React.CSSProperties;
  endRef: React.RefObject<HTMLDivElement | null>;
  logContainerRef: React.RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  handleDragEnd: (pos: { x: number; y: number }) => void;
}) {
  const { elRef, onPointerDown } = useDraggable(
    { x: containerStyle.left as number, y: containerStyle.top as number },
    handleDragEnd
  );
  const { onResizePointerDown } = useResizable(elRef, { w: DEFAULT_W, h: DEFAULT_H });

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle border border-surface0 shadow-2xl shadow-black/50 flex flex-col ${maximized ? "rounded-none" : "rounded-xl"}`}
      style={containerStyle}
      onPointerDown={() => focusWindow(WINDOW_ID)}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={maximized ? undefined : onPointerDown}
      >
        <div className="flex items-center gap-2 text-md font-semibold text-subtext0 min-w-0 truncate">
          {isBuilding && <RefreshCw size={14} className="text-blue animate-spin shrink-0" />}
          {!isBuilding && hasError && <X size={14} className="text-red shrink-0" />}
          {!isBuilding && !hasError && <Check size={14} className="text-green shrink-0" />}
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => minimizeWindow(WINDOW_ID)}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => setMaximized(!maximized)}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={() => closeWindow(WINDOW_ID)}
            className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Log lines */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-md select-text scrollbar-thin min-h-0"
      >
        {baseImage.progress.map((line, i) => (
          <div key={i} className="leading-relaxed text-overlay1">{line}</div>
        ))}
        {baseImage.error && (
          <div className="text-red leading-relaxed font-semibold">{baseImage.error}</div>
        )}
        <div ref={endRef} />
      </div>

      {/* Failed droplet action bar */}
      {!isBuilding && hasError && baseImage.failedDropletIp && baseImage.failedDropletId && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-surface0 bg-surface0/50 shrink-0">
          <span className="text-md text-subtext0 flex-1">
            Droplet {baseImage.failedDropletIp} kept alive for debugging
          </span>
          <button
            onClick={() => {
              addTerminalTab(
                undefined,
                `SSH ${baseImage.failedDropletIp}`,
                `ssh -o StrictHostKeyChecking=no -i ~/.genie/ssh/genie_ed25519 root@${baseImage.failedDropletIp} -t 'exec bash'`
              );
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-md text-blue hover:bg-blue/10 transition-colors"
          >
            <Terminal size={12} />
            Connect
          </button>
          <button
            onClick={() => {
              if (confirm("Destroy the failed build droplet?")) {
                destroyFailedBuildDroplet(baseImage.failedDropletId!);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-md text-red hover:bg-red/10 transition-colors"
          >
            <Trash2 size={12} />
            Destroy
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
        {!isBuilding && (
          <button
            onClick={() => closeWindow(WINDOW_ID)}
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

export function BuildLogWindow() {
  const admin = useDeepSubjectAll($admin);
  const baseImage = admin.baseImage;
  const [windowManager] = useSubject($windowManager);
  const windowState = windowManager.windows[WINDOW_ID] as FloatingWindowState | undefined;
  const endRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const prevBuildingRef = useRef<string | null>(null);

  // Register window on mount
  useEffect(() => {
    registerWindow(WINDOW_ID, "Build Log", "terminal");
  }, []);

  // Auto-open when a build starts
  useEffect(() => {
    if (baseImage.buildingName && !prevBuildingRef.current) {
      openWindow(WINDOW_ID);
    }
    prevBuildingRef.current = baseImage.buildingName;
  }, [baseImage.buildingName]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [baseImage.progress.length, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const isOpen = windowState?.status === "open";
  if (!isOpen || !windowState) return null;
  if (!baseImage.buildingName && baseImage.progress.length === 0 && !baseImage.error) return null;

  const isBuilding = !!baseImage.buildingName;
  const hasError = !!baseImage.error;
  const title = isBuilding
    ? `Building: ${baseImage.buildingName}...`
    : hasError
      ? "Build failed"
      : "Build complete";

  const fullText = [...baseImage.progress, ...(baseImage.error ? [baseImage.error] : [])].join("\n");

  function handleCopy() {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const storedPos = windowState.position;
  const initial = storedPos.x >= 0 && storedPos.y >= 0
    ? storedPos
    : { x: Math.max(window.innerWidth - DEFAULT_W - 24, 20), y: Math.max(window.innerHeight - DEFAULT_H - 40, 20) };

  const handleDragEnd = (pos: { x: number; y: number }) => {
    updateWindowPosition(WINDOW_ID, pos);
  };

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: windowState.zIndex }
    : { left: initial.x, top: initial.y, width: DEFAULT_W, height: DEFAULT_H, zIndex: windowState.zIndex };

  return <BuildLogWindowInner
    baseImage={baseImage}
    windowState={windowState}
    title={title}
    isBuilding={isBuilding}
    hasError={hasError}
    maximized={maximized}
    setMaximized={setMaximized}
    copied={copied}
    handleCopy={handleCopy}
    containerStyle={containerStyle}
    endRef={endRef}
    logContainerRef={logContainerRef}
    handleScroll={handleScroll}
    handleDragEnd={handleDragEnd}
  />;
}
