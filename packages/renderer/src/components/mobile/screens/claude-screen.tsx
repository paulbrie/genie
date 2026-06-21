"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, Pin, Terminal, ArrowUp, Square, SquarePen, ChevronDown, Plus, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeLogo } from "@/components/mobile/claude-logo";
import {
  ASSISTANT_CANNED_REPLY,
  MOCK_CHAT,
  QUICK_REPLIES,
  SUGGESTED_PROMPTS,
  type MockMsg,
  type MockTool,
} from "@/components/mobile/mock-data";

export interface ClaudePin {
  label: string;
  host: string;
}

type Phase = "idle" | "thinking" | "streaming";

export function ClaudeScreen({
  pin,
  onBack,
  onRunInTerminal,
}: {
  pin: ClaudePin;
  onBack: () => void;
  onRunInTerminal?: () => void;
}) {
  const [messages, setMessages] = useState<MockMsg[]>(MOCK_CHAT);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [streamed, setStreamed] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ behavior: phase === "streaming" ? "auto" : "smooth" });
  }, [messages, streamed, phase]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || phase !== "idle") return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: t }]);
    setPhase("thinking");
    timers.current.push(
      setTimeout(() => {
        setPhase("streaming");
        const full = ASSISTANT_CANNED_REPLY;
        let i = 0;
        const tick = () => {
          i = Math.min(full.length, i + 3);
          setStreamed(full.slice(0, i));
          if (i < full.length) {
            timers.current.push(setTimeout(tick, 16));
          } else {
            setMessages((m) => [...m, { role: "assistant", text: full }]);
            setStreamed("");
            setPhase("idle");
          }
        };
        tick();
      }, 650),
    );
  }

  function stop() {
    clearTimers();
    if (streamed) setMessages((m) => [...m, { role: "assistant", text: streamed }]);
    setStreamed("");
    setPhase("idle");
  }

  function newChat() {
    clearTimers();
    setMessages([]);
    setStreamed("");
    setPhase("idle");
  }

  const isEmpty = messages.length === 0 && phase === "idle";
  const busy = phase !== "idle";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface0 shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 rounded-lg text-overlay0 active:bg-surface0" aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <span className="text-peach shrink-0">
          <ClaudeLogo size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-md font-semibold text-subtext0 leading-tight">Claude</p>
          <p className="text-xs text-overlay0 truncate">knows what you&apos;re looking at</p>
        </div>
        <button className="flex items-center gap-1 text-xs text-subtext0 bg-surface0 rounded-full px-2 py-1 active:bg-surface1">
          Opus 4.8
          <ChevronDown size={12} className="text-overlay0" />
        </button>
        <button onClick={newChat} className="p-1.5 rounded-lg text-overlay0 active:bg-surface0" aria-label="New chat">
          <SquarePen size={16} />
        </button>
      </div>

      {/* Pinned VM banner */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-peach/20 bg-peach/10 shrink-0">
        <Pin size={11} className="text-peach shrink-0" />
        <span className="text-xs text-peach font-medium truncate">
          Commands run on <span className="font-mono">{pin.label}</span>
        </span>
        <span className="text-2xs text-overlay0 font-mono truncate ml-auto">{pin.host}</span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isEmpty ? (
          <EmptyState onPick={send} />
        ) : (
          <div className="px-4 py-3 flex flex-col gap-3">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserBubble key={i} text={m.text} />
              ) : (
                <ClaudeBubble key={i} text={m.text} tool={m.tool} onRun={onRunInTerminal} />
              ),
            )}
            {phase === "thinking" && <ThinkingBubble />}
            {phase === "streaming" && <ClaudeBubble text={streamed} streaming onRun={onRunInTerminal} />}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Quick replies */}
      {!isEmpty && !busy && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-thin shrink-0">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="shrink-0 text-sm text-peach bg-mantle border border-surface0 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        className="flex items-end gap-2 px-3 py-2.5 border-t border-surface0 shrink-0"
        style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
      >
        <button className="w-9 h-9 rounded-full grid place-items-center text-overlay0 bg-surface0 active:bg-surface1 shrink-0" aria-label="Add context">
          <Plus size={18} />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask or run something…"
          className="flex-1 resize-none bg-surface0 border border-surface1 rounded-2xl px-4 py-2 text-md text-text placeholder:text-overlay0 outline-none focus:border-peach leading-relaxed"
        />
        {busy ? (
          <button
            onClick={stop}
            className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-red text-background active:scale-95 transition-transform"
            aria-label="Stop"
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className={cn(
              "w-9 h-9 rounded-full grid place-items-center shrink-0 transition-colors",
              input.trim() ? "bg-peach text-background" : "bg-surface0 text-overlay0",
            )}
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Empty state ---

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-peach/15 grid place-items-center text-peach">
        <ClaudeLogo size={28} />
      </div>
      <div>
        <p className="text-xl font-semibold text-text">Ask Claude anything</p>
        <p className="text-sm text-overlay0 mt-1">It can read logs, run commands, and deploy — on your VMs.</p>
      </div>
      <div className="flex flex-col gap-2 w-full">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="w-full text-left text-md text-subtext0 bg-mantle border border-surface0 rounded-xl px-3.5 py-3 active:bg-surface0 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Bubbles ---

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-peach text-background text-md px-3.5 py-2 rounded-2xl rounded-br-md max-w-[82%] leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function ClaudeBubble({
  text,
  tool,
  streaming,
  onRun,
}: {
  text: string;
  tool?: MockTool;
  streaming?: boolean;
  onRun?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 max-w-[90%]">
      {tool && <ToolPillStatic tool={tool} />}
      <div
        className={cn(
          "bg-surface0 text-subtext1 text-md px-3.5 py-2.5 rounded-2xl rounded-bl-md leading-relaxed",
          streaming && "claude-thinking border border-peach/40",
        )}
      >
        <MessageBody text={text} streaming={streaming} onRun={onRun} />
      </div>
    </div>
  );
}

/** Renders paragraphs + fenced code blocks. While streaming, an unterminated
 *  fence is closed on the fly so in-progress code still renders as a card. */
function MessageBody({ text, streaming, onRun }: { text: string; streaming?: boolean; onRun?: () => void }) {
  let t = text;
  if (streaming && (t.match(/```/g)?.length ?? 0) % 2 === 1) t += "\n```";

  const blocks: { type: "text" | "code"; lang?: string; content: string }[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) blocks.push({ type: "text", content: t.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1], content: m[2].replace(/\n+$/, "") });
    last = re.lastIndex;
  }
  if (last < t.length) blocks.push({ type: "text", content: t.slice(last) });

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} lang={b.lang} content={b.content} onRun={onRun} />
        ) : (
          <TextBlock key={i} content={b.content} />
        ),
      )}
      {streaming && <span className="inline-block w-1.5 h-4 align-[-2px] bg-peach/80 animate-pulse ml-0.5" />}
    </div>
  );
}

function TextBlock({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) =>
        line.trim() === "" ? <div key={i} className="h-1.5" /> : <p key={i}>{renderInline(line)}</p>,
      )}
    </>
  );
}

const SHELL_LANGS = new Set(["", "bash", "sh", "shell", "zsh"]);

function CodeBlock({ lang, content, onRun }: { lang?: string; content: string; onRun?: () => void }) {
  const runnable = SHELL_LANGS.has(lang ?? "");
  return (
    <div className="bg-crust border border-surface0 rounded-lg overflow-hidden my-0.5">
      <div className="flex items-center gap-2 px-2.5 py-1 border-b border-surface0/70">
        <Terminal size={11} className="text-green" />
        <span className="text-2xs text-overlay0 font-mono">{lang || "shell"}</span>
        {runnable && onRun && (
          <button
            onClick={onRun}
            className="ml-auto flex items-center gap-1 text-2xs font-medium text-green bg-green/10 rounded px-1.5 py-0.5 active:bg-green/20"
          >
            <Play size={10} /> Run
          </button>
        )}
      </div>
      <pre className="px-3 py-2 overflow-x-auto text-xs font-mono text-subtext1 leading-relaxed">{content}</pre>
    </div>
  );
}

/** Minimal inline markdown: **bold** and `code`. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-text">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={i} className="font-mono text-[0.9em] bg-mantle px-1 py-0.5 rounded text-subtext1">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function ToolPillStatic({ tool }: { tool: MockTool }) {
  return (
    <div className="bg-mantle border border-surface0 rounded-lg px-2.5 py-2 max-w-full">
      <div className="flex items-center gap-1.5 text-xs">
        <Terminal size={12} className="text-green shrink-0" />
        <span className="text-green font-medium">{tool.name}</span>
        <span className="text-overlay0 font-mono tabular-nums ml-auto">{tool.duration}</span>
      </div>
      <p className="text-xs text-overlay1 font-mono mt-1.5 truncate">$ {tool.detail}</p>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-center gap-2 bg-surface0 text-overlay1 text-sm px-3.5 py-2.5 rounded-2xl rounded-bl-md w-fit claude-thinking border border-peach/40">
      <span className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-peach animate-bounce [animation-delay:-0.2s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-peach animate-bounce [animation-delay:-0.1s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-peach animate-bounce" />
      </span>
      Claude is working…
    </div>
  );
}
