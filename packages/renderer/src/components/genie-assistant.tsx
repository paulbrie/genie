"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSubject } from "subjecto/react";
import { Bot, Send, Square, X, Minus, Maximize2, Minimize2, Pin, PinOff, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AuthUser, ChatMessage, FloatingWindowState, NavKey, PinnedAssistantVm, ProjectDef, StreamingStep, ToolUse } from "@/store/types";
import { $activeNav, $admin, $auth, $chat, $fileEditor, $pinnedAssistantVm, $projects, $selectedProjectId, $terminal, $windowManager } from "@/store/subjects";
import { useDeepSubjectAll } from "@/lib/hooks";
import type { AdminTazVm } from "@/store/types";
import type { ChatModelId } from "@/store/actions";
import { CHAT_MODELS, closeWindow, focusWindow, loadAdminTazVms, minimizeWindow, openWindow, registerWindow, resetChat, sendChatMessage, setChatModel, setPinnedAssistantVm, stopChat, updateWindowPosition } from "@/store/actions";
import { wsSend } from "@/lib/ws";
import { Play } from "lucide-react";
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

  // Pinned VM — the assistant's ssh_exec is locked to this target on the server.
  const pin = $pinnedAssistantVm.getValue();
  if (pin) {
    lines.push(
      "",
      "=== Pinned VM ===",
      `Label: ${pin.label}`,
      `Project: ${pin.projectName} (id: ${pin.projectId})`,
      `Instance: ${pin.instanceId}`,
      `Host: ${pin.host} (${pin.provider})`,
      "All ssh_exec calls run on this VM. Do not propose commands intended for another VM.",
    );
  }

  // Active terminal — so the LLM knows where commands will land if the user clicks Run.
  const terminalState = $terminal.getValue();
  if (terminalState.activeTabId) {
    const activeTab = terminalState.tabs.find((t) => t.id === terminalState.activeTabId);
    if (activeTab) {
      lines.push("", "=== Active Terminal ===");
      lines.push(`Title: ${activeTab.title}`);
      if (activeTab.ssh) {
        const u = activeTab.ssh.username || "?";
        const h = activeTab.ssh.host;
        const p = activeTab.ssh.port ?? 22;
        lines.push(`Connection: SSH ${u}@${h}:${p}`);
      } else {
        lines.push("Connection: local terminal");
      }
      if (activeTab.cwd) lines.push(`CWD: ${activeTab.cwd}`);
      lines.push(
        "",
        "Shell code blocks (```bash, ```sh, ```shell, or unlabeled fenced code) will get a 'Run' button in the UI that executes them in this terminal. Tailor command suggestions to that environment.",
      );
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

  const terminalState = $terminal.getValue();
  if (terminalState.activeTabId) {
    const activeTab = terminalState.tabs.find((t) => t.id === terminalState.activeTabId);
    if (activeTab) items.push({ label: "Terminal", value: activeTab.title });
  }

  const pin = $pinnedAssistantVm.getValue();
  if (pin) items.push({ label: "Pinned VM", value: pin.label });

  return items;
}

// --- Runnable code blocks ---

/** When a fenced code block in an assistant message is shell-flavored (or
 *  unlabeled), show a hovering "Run" button that pipes it into whichever
 *  terminal tab is currently active. */
function RunnableCode({ inline, className, children }: { inline?: boolean; className?: string; children: React.ReactNode }) {
  const [terminal] = useSubject($terminal);
  // ReactMarkdown passes `inline: true` for `<code>` (vs `<pre><code>`). We only
  // augment block code blocks.
  if (inline) {
    return <code className={className}>{children}</code>;
  }
  const lang = (className || "").match(/language-(\S+)/)?.[1]?.toLowerCase() ?? "";
  const isShell = lang === "" || lang === "bash" || lang === "sh" || lang === "shell" || lang === "zsh";
  const text = String(children).replace(/\n$/, "");
  const activeTab = terminal.tabs.find((t) => t.id === terminal.activeTabId);
  const canRun = isShell && !!activeTab;

  function run() {
    if (!activeTab) return;
    // Each line as its own write so multi-line snippets land naturally in the shell.
    wsSend("terminal:data", { id: activeTab.id, data: text + "\n" });
  }

  return (
    <span className="relative group block">
      <code className={className}>{children}</code>
      {canRun && (
        <button
          onClick={run}
          className="absolute top-1 right-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue/20 text-blue text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue/30"
          title={`Run in ${activeTab!.title}`}
        >
          <Play size={10} /> Run
        </button>
      )}
    </span>
  );
}

const assistantMarkdownComponents = {
  ...markdownComponents,
  code: RunnableCode as unknown as React.ComponentType<React.HTMLAttributes<HTMLElement> & { inline?: boolean }>,
};

// --- Pin VM picker ---

/** TazCloud's per-image default user (matches imageDefaultUser in tazcloud-panel.tsx).
 *  Used for bare-VM pins where there's no project.vpsInstance carrying a username. */
function tazImageDefaultUser(image?: string): string {
  switch (image) {
    case "ubuntu-22":
    case "ubuntu-24": return "ubuntu";
    case "debian-12": return "debian";
    case "almalinux-9": return "almalinux";
    default: return "ubuntu";
  }
}

/** Flatten all projects' VPS instances into a pickable list, then append any
 *  admin-only TazCloud VMs that aren't attached to a project. For tazcloud
 *  admins this surfaces bare VMs ("databases", etc.) that would otherwise be
 *  invisible to the assistant; the manager routes those via TAZCLOUD_SSH_PRIVATE_KEY. */
function getPinCandidates(projects: ProjectDef[], adminTazVms: AdminTazVm[]): PinnedAssistantVm[] {
  const out: PinnedAssistantVm[] = [];
  for (const p of projects) {
    for (const inst of p.vpsInstances ?? []) {
      const provider: PinnedAssistantVm["provider"] = inst.tazcloud
        ? "tazcloud"
        : inst.digitalocean
          ? "digitalocean"
          : "other";
      out.push({
        projectId: p.id,
        projectName: p.name,
        instanceId: inst.id,
        label: `${p.name} / ${inst.label}`,
        host: inst.connection.host,
        provider,
      });
    }
  }
  // Append bare admin TazCloud VMs (no project link). Skipped silently when the
  // user isn't a tazcloud admin — $admin.tazcloud.vms is empty in that case.
  for (const vm of adminTazVms) {
    if (vm.projectId) continue;  // already represented above via the project
    if (!vm.ipv6) continue;       // can't connect without a host
    out.push({
      projectId: null,
      projectName: null,
      instanceId: vm.id,
      label: vm.name,
      host: vm.ipv6,
      provider: "tazcloud",
      sshUser: tazImageDefaultUser(vm.image),
    });
  }
  return out;
}

function PinPicker() {
  const [pin] = useSubject($pinnedAssistantVm);
  const [projects] = useSubject($projects);
  const [auth] = useSubject($auth);
  const admin = useDeepSubjectAll($admin);
  const [open, setOpen] = useState(false);
  const candidates = getPinCandidates(projects, admin.tazcloud.vms);

  // Lazy-load the admin TazCloud VM list when the picker opens. Bare cloud VMs
  // ("databases" et al.) only appear here once that list is populated, and the
  // tazcloud panel may not have been visited this session. Non-admins get an
  // empty list back (the server gates it) so this is safe to fire for anyone.
  const canSeeAdminTaz = auth.user?.role === "superadmin" || auth.user?.role === "tazcloud";
  useEffect(() => {
    if (open && canSeeAdminTaz && admin.tazcloud.vms.length === 0 && !admin.tazcloud.loading) {
      loadAdminTazVms();
    }
  }, [open, canSeeAdminTaz, admin.tazcloud.vms.length, admin.tazcloud.loading]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors",
          pin
            ? "bg-mauve/15 text-mauve border-mauve/40 hover:bg-mauve/20"
            : "bg-surface0 text-overlay1 border-surface1 hover:bg-surface1",
        )}
        title={pin ? `Pinned to ${pin.label} — ${pin.host}` : "Pin the assistant to a single VM"}
      >
        {pin ? <Pin size={10} /> : <PinOff size={10} />}
        <span className="max-w-[160px] truncate font-medium">
          {pin ? pin.label : "Pin VM"}
        </span>
        <ChevronDown size={9} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-mantle border border-surface0 rounded-md shadow-lg py-1 min-w-[260px] max-h-[300px] overflow-auto">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-overlay0">
              ssh_exec target
            </div>
            <button
              onClick={() => { setPinnedAssistantVm(null); setOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2",
                !pin && "text-mauve",
              )}
            >
              <PinOff size={11} />
              <span>No pin (LLM picks based on context)</span>
            </button>
            {candidates.length === 0 ? (
              <div className="px-3 py-1.5 text-md text-overlay0">
                No project-attached VMs. Attach a cloud VM to a project first.
              </div>
            ) : (
              candidates.map((c) => {
                const active = pin?.projectId === c.projectId && pin?.instanceId === c.instanceId;
                return (
                  <button
                    key={`${c.projectId}:${c.instanceId}`}
                    onClick={() => { setPinnedAssistantVm(c); setOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2",
                      active && "bg-mauve/10 text-mauve",
                    )}
                  >
                    <Pin size={11} className="shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{c.label}</span>
                      <span className="block text-[10px] text-overlay0 font-mono truncate">
                        {c.provider} · {c.host}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
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
  const [pin] = useSubject($pinnedAssistantVm);
  const contextItems = getContextItems();

  const [input, setInput] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Read clipboard items on paste, extract any images, push their data URLs as previews. */
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const newImages: Promise<string>[] = [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const blob = it.getAsFile();
        if (blob) {
          newImages.push(new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
          }));
        }
      }
    }
    if (newImages.length > 0) {
      e.preventDefault();
      Promise.all(newImages).then((urls) => setPendingImages((prev) => [...prev, ...urls]));
    }
  }

  function removePendingImage(idx: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

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
    const hasImages = pendingImages.length > 0;
    if ((!text && !hasImages) || chatLoading) return;
    setInput("");
    const images = hasImages ? pendingImages : undefined;
    setPendingImages([]);
    const context = buildAssistantContext();
    const domSnapshot = document.body.innerText;
    sendChatMessage(text, context, domSnapshot, images);
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

      {/* Context pills + pin + model selector */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-surface0/50 shrink-0">
        <div className="flex flex-wrap gap-1 flex-1">
          {contextItems.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface0 text-[11px]">
              <span className="text-overlay0">{item.label}:</span>
              <span className="text-subtext0 font-medium">{item.value}</span>
            </span>
          ))}
        </div>
        <PinPicker />
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

      {/* Pinned VM banner — makes it unambiguous where ssh_exec lands. Always
          visible while a pin is set so it can't be missed mid-conversation. */}
      {pin && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-mauve/20 bg-mauve/10 text-[11px] shrink-0">
          <Pin size={10} className="text-mauve shrink-0" />
          <span className="text-mauve font-medium truncate">
            Commands run on <span className="font-mono">{pin.label}</span>
          </span>
          <span className="text-overlay0 font-mono truncate hidden sm:inline">· {pin.host}</span>
          <div className="flex-1" />
          <button
            onClick={() => setPinnedAssistantVm(null)}
            className="text-overlay0 hover:text-text transition-colors"
            title="Unpin"
          >
            <X size={11} />
          </button>
        </div>
      )}

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
              <div className="max-w-[90%] flex flex-col items-end gap-1">
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end">
                    {msg.images.map((url, k) => (
                      <img
                        key={k}
                        src={url}
                        alt={`sent ${k + 1}`}
                        className="max-h-48 max-w-full rounded border border-surface1"
                      />
                    ))}
                  </div>
                )}
                {msg.content && (
                  <div className="px-2.5 py-1.5 rounded-lg text-md break-words select-text cursor-text bg-surface0 text-text rounded-br-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                )}
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
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
      <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-surface0 shrink-0">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingImages.map((url, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={url}
                  alt={`pasted ${idx + 1}`}
                  className="h-14 w-14 object-cover rounded border border-surface1"
                />
                <button
                  onClick={() => removePendingImage(idx)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red text-background flex items-center justify-center text-[10px] leading-none border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={pendingImages.length > 0 ? "Add a question about the image…" : "Ask Genie anything..."}
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
              disabled={!input.trim() && pendingImages.length === 0}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                !input.trim() && pendingImages.length === 0
                  ? "bg-surface0 text-overlay0 cursor-not-allowed"
                  : "bg-mauve text-background hover:bg-mauve/80"
              )}
            >
              <Send size={12} />
            </button>
          )}
        </div>
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
