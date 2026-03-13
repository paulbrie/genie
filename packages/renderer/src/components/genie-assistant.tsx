"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Bot, Send, Square, X, Minus, Maximize2, Minimize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  $chat,
  $activeNav,
  $selectedProjectId,
  $selectedAppId,
  $windowManager,
  $auth,
  $projects,
  $apps,
  $fileEditor,
  sendChatMessage,
  stopChat,
  resetChat,
  registerWindow,
  openWindow,
  closeWindow,
  minimizeWindow,
  focusWindow,
  updateWindowPosition,
  setChatModel,
  CHAT_MODELS,
  type ChatModelId,
  type ChatMessage,
  type ToolUse,
  type StreamingStep,
  type NavKey,
  type AuthUser,
  type ProjectDef,
  type AppDef,
  type FloatingWindowState,
} from "@/store";
import { cn } from "@/lib/utils";
import { markdownComponents } from "@/components/ui/markdown-link";
import { ToolPill, getToolStatusText } from "@/components/ui/tool-pill";
import { UsageLine } from "@/components/ui/usage-line";
import { useDraggable, useResizable } from "@/components/use-draggable";

const WINDOW_ID = "genie-assistant";
const DEFAULT_W = 420;
const DEFAULT_H = 540;

// --- Dynamic context builder ---

function buildAssistantContext(): string {
  const lines: string[] = ["=== Assistant Context ==="];

  // User info
  const authState = $auth.getValue();
  const user = authState?.user as AuthUser | null;
  if (user) {
    lines.push(`User: ${user.name} (${user.email})`);
  }

  // Current view
  const nav = $activeNav.getValue();
  lines.push(`Current view: ${nav}`);

  // Selected project
  const projectId = $selectedProjectId.getValue();
  if (projectId) {
    const projects = $projects.getValue();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      lines.push("", `Project: ${project.name} (id: ${projectId})`);
      if (project.setupFiles) {
        const fileNames = Object.keys(project.setupFiles);
        if (fileNames.length) {
          lines.push(`Setup files: ${fileNames.join(", ")}`);
        }
      }
      if (project.setupFiles?.["AGENT.md"]) {
        lines.push("", "=== Agent Memory (AGENT.md) ===", project.setupFiles["AGENT.md"]);
      }
      for (const inst of project.vpsInstances ?? []) {
        const region = inst.digitalocean?.region ?? project.vpsRegion ?? "";
        lines.push(`VPS [${inst.label}]: ${inst.connection.host}${region ? ` (${region})` : ""}`);
      }

      // Include setup file contents if loaded in the file editor
      const fe = $fileEditor.getValue();
      if (fe.projectId === projectId && project.setupFiles) {
        for (const name of Object.keys(project.setupFiles)) {
          const content = project.setupFiles[name];
          if (content != null) {
            lines.push("", `--- ${name} ---`, content);
          }
        }
      }
    }
  }

  // Selected app
  const appId = $selectedAppId.getValue();
  if (appId) {
    const apps = $apps.getValue();
    const app = apps.find((a) => a.id === appId);
    if (app) {
      lines.push("", `App: ${app.name} [${app.status}] cmd="${app.command}"`);
    }
  }

  return lines.join("\n");
}

// --- Context pills ---

interface ContextItem { label: string; value: string }

function getContextItems(): ContextItem[] {
  const items: ContextItem[] = [];

  const nav = $activeNav.getValue();
  items.push({ label: "View", value: nav });

  const authState = $auth.getValue();
  const user = authState?.user as AuthUser | null;
  if (user) items.push({ label: "User", value: user.name });

  const projectId = $selectedProjectId.getValue();
  if (projectId) {
    const projects = $projects.getValue();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      items.push({ label: "Project", value: project.name });
      if (project.setupFiles) {
        const count = Object.keys(project.setupFiles).length;
        if (count) items.push({ label: "Files", value: String(count) });
      }
      if (project.vpsInstances?.length) items.push({ label: "VPS", value: `${project.vpsInstances.length} instance(s)` });
    }
  }

  const appId = $selectedAppId.getValue();
  if (appId) {
    const apps = $apps.getValue();
    const app = apps.find((a) => a.id === appId);
    if (app) items.push({ label: "App", value: app.name });
  }

  return items;
}

// --- Floating chat window ---

function FloatingChatWindow({
  windowState,
  onClose,
  onMinimize,
}: {
  windowState: FloatingWindowState;
  onClose: () => void;
  onMinimize: () => void;
}) {
  const [chatState] = useSubject($chat);
  const { messages: chatMessages, loading: chatLoading, streamingContent: chatStreaming, toolUses: chatToolUses, streamingSteps, statusText: chatStatusText, modelId: chatModelId, maxToolRounds, toolRoundsUsed } = chatState;

  // Subscribe to store values that affect context pills
  const [activeNav] = useSubject($activeNav);
  const [selectedProjectId] = useSubject($selectedProjectId);
  const [selectedAppId] = useSubject($selectedAppId);
  const contextItems = getContextItems();

  const [input, setInput] = useState("");
  const [maximized, setMaximized] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute initial position: use stored position if valid, otherwise default
  const storedPos = windowState.position;
  const initial = storedPos.x >= 0 && storedPos.y >= 0
    ? storedPos
    : { x: Math.max(window.innerWidth - 460, 20), y: Math.max(window.innerHeight - 580, 20) };

  const handleDragEnd = useCallback((pos: { x: number; y: number }) => {
    updateWindowPosition(WINDOW_ID, pos);
  }, []);

  const { elRef, onPointerDown } = useDraggable(initial, handleDragEnd);
  const { onResizePointerDown } = useResizable(elRef, { w: DEFAULT_W, h: DEFAULT_H });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatStreaming, chatToolUses, streamingSteps]);

  function handleSend() {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");
    const context = buildAssistantContext();
    const domSnapshot = document.body.innerText;
    sendChatMessage(text, context, domSnapshot);
  }

  const containerStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: windowState.zIndex }
    : { left: initial.x, top: initial.y, width: DEFAULT_W, height: DEFAULT_H, zIndex: windowState.zIndex };

  return createPortal(
    <div
      ref={elRef}
      className={`fixed bg-mantle border border-surface0 shadow-2xl shadow-black/50 flex flex-col ${maximized ? "rounded-none" : "rounded-xl"}`}
      style={containerStyle}
      onPointerDown={() => focusWindow(WINDOW_ID)}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-surface0 cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={maximized ? undefined : onPointerDown}
      >
        <div className="flex items-center gap-2 text-md font-semibold text-subtext0">
          <Bot size={14} className="text-mauve" />
          Genie Assistant
        </div>
        <div className="flex items-center gap-0.5">
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

      {/* Context pills + model selector */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-surface0/50 shrink-0">
        <div className="flex flex-wrap gap-1 flex-1">
          {contextItems.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface0 text-[11px]">
              <span className="text-overlay0">{item.label}:</span>
              <span className="text-subtext0 font-medium">{item.value}</span>
            </span>
          ))}
        </div>
        <select
          value={chatModelId}
          onChange={(e) => setChatModel(e.target.value as ChatModelId)}
          className="bg-surface0 border border-surface1 rounded px-1.5 py-0.5 text-[11px] text-subtext0 outline-none focus:border-mauve cursor-pointer"
        >
          {Object.entries(CHAT_MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2 scrollbar-thin min-h-0">
        {chatMessages.length === 0 && !chatStreaming && !chatLoading && (
          <div className="flex-1 flex items-center justify-center py-8">
            <p className="text-overlay0 text-md text-center">
              Ask Genie anything — I know what you&apos;re looking at
            </p>
          </div>
        )}

        {chatMessages.map((msg: ChatMessage, i: number) => (
          <div key={i} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
            {msg.role === "user" ? (
              <div className="max-w-[90%] px-2.5 py-1.5 rounded-lg text-md break-words select-text cursor-text bg-surface0 text-text rounded-br-sm whitespace-pre-wrap">
                {msg.content}
              </div>
            ) : msg.steps ? (
              <div className={cn(
                "max-w-[90%] px-2.5 py-1.5 rounded-lg text-md break-words select-text cursor-text",
                msg.content.startsWith("Error:")
                  ? "bg-red/10 text-red border border-red/20 rounded-bl-sm"
                  : "text-text rounded-bl-sm"
              )}>
                {msg.steps.map((step, j) => (
                  <div key={j}>
                    {step.content && (
                      <div className="chat-markdown select-text cursor-text">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {step.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {step.toolUse && (
                      <div className="my-1">
                        <ToolPill tool={step.toolUse} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <>
                {msg.toolUses && msg.toolUses.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-0.5">
                    {msg.toolUses.map((tool, j) => (
                      <ToolPill key={j} tool={tool} />
                    ))}
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[90%] px-2.5 py-1.5 rounded-lg text-md break-words select-text cursor-text",
                    msg.content.startsWith("Error:")
                      ? "bg-red/10 text-red border border-red/20 rounded-bl-sm"
                      : "text-text rounded-bl-sm"
                  )}
                >
                  <div className="chat-markdown select-text cursor-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              </>
            )}
            {msg.role === "assistant" && msg.usage && (
              <UsageLine usage={msg.usage} />
            )}
          </div>
        ))}

        {/* Streaming: step-by-step rendering */}
        {chatLoading && (streamingSteps.length > 0 || chatStreaming) && (
          <div className="flex flex-col items-start">
            <div className="max-w-[90%] px-2.5 py-1.5 rounded-lg text-md text-text rounded-bl-sm select-text cursor-text">
              {streamingSteps.map((step, i) => (
                <div key={i}>
                  {step.content && (
                    <div className="chat-markdown select-text cursor-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {step.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {step.toolUse && (
                    <div className="my-1">
                      <ToolPill tool={step.toolUse} />
                    </div>
                  )}
                </div>
              ))}
              {chatStreaming && (
                <div className="chat-markdown select-text cursor-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {chatStreaming}
                  </ReactMarkdown>
                </div>
              )}
              <span className="inline-block w-1.5 h-3 bg-text/50 ml-0.5 animate-pulse align-text-bottom" />
            </div>
          </div>
        )}

        {chatLoading && !chatStreaming && streamingSteps.length === 0 && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-md text-overlay0">
              <div className="w-3.5 h-3.5 border-2 border-mauve/40 border-t-mauve rounded-full animate-spin" />
              <span>
                {chatStatusText || (chatToolUses.length > 0 ? getToolStatusText(chatToolUses[chatToolUses.length - 1]) : "Thinking...")}
              </span>
              {maxToolRounds > 0 && toolRoundsUsed > 0 && (
                <span className="text-[11px] text-overlay0 ml-1">
                  {toolRoundsUsed}/{maxToolRounds} tools
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-surface0 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Genie anything..."
          className="flex-1 bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text placeholder:text-overlay0 outline-none focus:border-mauve"
        />
        {chatLoading ? (
          <button
            onClick={stopChat}
            className="p-1.5 rounded-md bg-red text-background hover:bg-red/80 transition-colors"
            title="Stop generating"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              !input.trim()
                ? "bg-surface0 text-overlay0 cursor-not-allowed"
                : "bg-mauve text-background hover:bg-mauve/80"
            )}
          >
            <Send size={12} />
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

// --- Main export: floating trigger button + chat window ---

export function GenieAssistant() {
  const [windowManager] = useSubject($windowManager);
  const windowState = windowManager.windows[WINDOW_ID];

  useEffect(() => {
    registerWindow(WINDOW_ID, "Genie Assistant", "bot");
  }, []);

  const isOpen = windowState?.status === "open";
  const isMinimized = windowState?.status === "minimized";

  const handleOpen = useCallback(() => {
    openWindow(WINDOW_ID);
  }, []);

  const handleClose = useCallback(() => {
    resetChat();
    closeWindow(WINDOW_ID);
  }, []);

  const handleMinimize = useCallback(() => {
    minimizeWindow(WINDOW_ID);
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      handleClose();
    } else {
      handleOpen();
    }
  }, [isOpen, handleClose, handleOpen]);

  return (
    <>
      {/* Fixed floating trigger button — hidden when minimized (it's in the toolbar) */}
      {!isMinimized && (
        <button
          onClick={toggle}
          className={cn(
            "fixed bottom-6 right-6 z-40 p-3 rounded-full shadow-lg transition-colors",
            isOpen
              ? "bg-mauve text-background hover:bg-mauve/80"
              : "bg-mantle text-mauve border border-surface0 hover:bg-surface0"
          )}
          title="Genie Assistant"
        >
          <Bot size={20} />
        </button>
      )}

      {/* Floating chat window */}
      {isOpen && windowState && (
        <FloatingChatWindow
          windowState={windowState}
          onClose={handleClose}
          onMinimize={handleMinimize}
        />
      )}
    </>
  );
}
