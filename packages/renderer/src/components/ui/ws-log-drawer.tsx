"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, ArrowDown, X, Trash2, GripHorizontal, ArrowDownToLine, Copy, Check } from "lucide-react";
import { getLog, clearLog, subscribe, type WsLogEntry } from "@/lib/ws-log";
import { cn } from "@/lib/utils";

export function useWsLogCount() {
  const log = useSyncExternalStore(subscribe, getLog, getLog);
  return log.length;
}

function useWsLog() {
  return useSyncExternalStore(subscribe, getLog, getLog);
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0") +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function MessageRow({
  entry,
  selected,
  onClick,
}: {
  entry: WsLogEntry;
  selected: boolean;
  onClick: () => void;
}) {
  const isSent = entry.direction === "sent";

  return (
    <div
      className={cn(
        "px-3 py-1.5 border-b border-surface0 hover:bg-surface0/50 cursor-pointer text-md",
        selected && "bg-surface0"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {isSent ? (
          <ArrowUp size={12} className="text-blue shrink-0" />
        ) : (
          <ArrowDown size={12} className="text-green shrink-0" />
        )}
        <span className="text-overlay0 shrink-0">{formatTime(entry.timestamp)}</span>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-md font-medium truncate",
            isSent ? "bg-blue/15 text-blue" : "bg-green/15 text-green"
          )}
        >
          {entry.type}
        </span>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function InspectorPanel({ entry }: { entry: WsLogEntry | null }) {
  if (!entry) {
    return (
      <div className="flex items-center justify-center h-full text-md text-overlay0">
        Select a message to inspect
      </div>
    );
  }

  const isSent = entry.direction === "sent";
  const payloadText = entry.payload !== undefined
    ? JSON.stringify(entry.payload, null, 2)
    : "(no payload)";

  return (
    <div className="flex flex-col h-full">
      {/* Inspector header */}
      <div className="px-3 py-2 border-b border-surface0 shrink-0 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {isSent ? (
            <ArrowUp size={12} className="text-blue shrink-0" />
          ) : (
            <ArrowDown size={12} className="text-green shrink-0" />
          )}
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-md font-medium",
              isSent ? "bg-blue/15 text-blue" : "bg-green/15 text-green"
            )}
          >
            {entry.type}
          </span>
          <span className="text-md text-overlay0">{isSent ? "Sent" : "Received"}</span>
          <div className="ml-auto">
            <CopyButton text={payloadText} />
          </div>
        </div>
        <span className="text-md text-overlay0">{formatTime(entry.timestamp)}</span>
      </div>

      {/* Payload */}
      <div className="flex-1 overflow-auto min-h-0 scrollbar-thin">
        <pre className="p-3 text-md text-subtext0 whitespace-pre-wrap break-all select-text cursor-text">
          {payloadText}
        </pre>
      </div>
    </div>
  );
}

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 300;

export function WsLogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const log = useWsLog();
  const [filter, setFilter] = useState("");
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const filtered = filter
    ? log.filter((e) => e.type.toLowerCase().includes(filter.toLowerCase()))
    : log;

  const selectedEntry = selectedIndex !== null ? filtered[selectedIndex] ?? null : null;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = listRef.current;
    if (el && autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [height]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = startY.current - e.clientY;
    const maxH = window.innerHeight - 60;
    setHeight(Math.max(MIN_HEIGHT, Math.min(maxH, startH.current + delta)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-50 flex flex-col bg-mantle border-t border-surface0 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        className="h-2 shrink-0 cursor-ns-resize flex items-center justify-center hover:bg-surface0 transition-colors group"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripHorizontal size={14} className="text-overlay0 group-hover:text-subtext0" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface0 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-md font-semibold text-text">WS Messages</h2>
          <span className="text-md text-overlay0 bg-surface0 px-1.5 py-0.5 rounded-full tabular-nums">
            {log.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter type..."
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setSelectedIndex(null); }}
            className="w-40 px-2 py-0.5 text-md bg-crust border border-surface0 rounded text-text placeholder:text-overlay0 outline-none focus:border-blue"
          />
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={cn(
              "p-1 rounded bg-transparent border-none cursor-pointer transition-colors",
              autoScroll ? "text-blue" : "text-overlay0 hover:text-text"
            )}
            title={autoScroll ? "Auto-scroll on (click to disable)" : "Auto-scroll off (click to enable)"}
          >
            <ArrowDownToLine size={14} />
          </button>
          <button
            onClick={() => { clearLog(); setSelectedIndex(null); }}
            className="p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
            title="Clear log"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex-1 flex min-h-0">
        {/* Left: message list */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-surface0">
          <div ref={listRef} className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full text-md text-overlay0">
                {log.length === 0 ? "No messages yet" : "No matches"}
              </div>
            ) : (
              filtered.map((entry, i) => (
                <MessageRow
                  key={i}
                  entry={entry}
                  selected={selectedIndex === i}
                  onClick={() => setSelectedIndex(i)}
                />
              ))
            )}
          </div>
          <div className="px-3 py-1 border-t border-surface0 text-md text-overlay0 shrink-0">
            {filtered.length} message{filtered.length !== 1 ? "s" : ""}
            {filter && ` (${log.length} total)`}
          </div>
        </div>

        {/* Right: inspector */}
        <div className="w-[40%] min-w-[280px] max-w-[50%] shrink-0">
          <InspectorPanel entry={selectedEntry} />
        </div>
      </div>
    </div>
  );
}
