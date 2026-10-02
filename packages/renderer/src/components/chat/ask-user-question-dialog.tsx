"use client";

// Claude's AskUserQuestion dialog (human-in-the-loop): option pills per
// question, immediate submit for a lone single-select question, an explicit
// Answer button otherwise. Claude is blocked on the control response, so this
// renders near the input until answered or dismissed. Shared by the desktop
// floating chat window and the mobile Claude screen (`touch` bumps hit areas).

import { useState } from "react";
import { X, Check, ClipboardList } from "lucide-react";
import type { PendingAsk } from "@/store/types/claude-stream";

export function AskUserQuestionDialog({ ask, onAnswer, onDismiss, touch }: {
  ask: PendingAsk;
  onAnswer: (answers: Record<string, string | string[]>) => void;
  onDismiss: () => void;
  /** Mobile: larger tap targets and text. */
  touch?: boolean;
}) {
  const [selected, setSelected] = useState<Record<string, string | string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const immediate = ask.questions.length === 1 && !ask.questions[0].multiSelect;

  const answerFor = (q: PendingAsk["questions"][number]): string | string[] | null => {
    const custom = other[q.question]?.trim();
    if (custom) return q.multiSelect ? [custom] : custom;
    const sel = selected[q.question];
    if (q.multiSelect) return Array.isArray(sel) && sel.length > 0 ? sel : null;
    return typeof sel === "string" && sel ? sel : null;
  };
  const complete = ask.questions.every((q) => answerFor(q) !== null);

  const submit = () => {
    const answers: Record<string, string | string[]> = {};
    for (const q of ask.questions) {
      const a = answerFor(q);
      if (a === null) return;
      answers[q.question] = a;
    }
    onAnswer(answers);
  };

  const toggle = (q: PendingAsk["questions"][number], label: string) => {
    if (immediate) { onAnswer({ [q.question]: label }); return; }
    setSelected((prev) => {
      if (!q.multiSelect) return { ...prev, [q.question]: prev[q.question] === label ? "" : label };
      const cur = Array.isArray(prev[q.question]) ? (prev[q.question] as string[]) : [];
      return { ...prev, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  };

  const pillText = touch ? "text-sm" : "text-[12px]";
  const pillPad = touch ? "px-3.5 py-2" : "px-2.5 py-1";

  return (
    <div className="mx-3 mb-2 rounded-lg border border-peach/50 bg-peach/5 px-3 py-2.5 flex flex-col gap-2.5 shrink-0">
      <div className="flex items-center gap-1.5 text-peach text-[11px] font-medium">
        <ClipboardList size={12} />
        Claude is asking — it waits for your answer
        <button
          onClick={onDismiss}
          className="ml-auto text-overlay0 hover:text-text bg-transparent border-none cursor-pointer p-0.5"
          title="Dismiss — Claude continues with its own judgment"
          aria-label="Dismiss question"
        >
          <X size={touch ? 16 : 12} />
        </button>
      </div>
      {ask.questions.map((q) => {
        const sel = selected[q.question];
        return (
          <div key={q.question} className="flex flex-col gap-1.5">
            <div className={`${touch ? "text-sm" : "text-md"} text-text`}>
              {q.header && (
                <span className="mr-1.5 px-1.5 py-0.5 rounded bg-peach/15 text-peach text-[10px] uppercase tracking-wide">{q.header}</span>
              )}
              {q.question}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const active = q.multiSelect
                  ? Array.isArray(sel) && sel.includes(opt.label)
                  : sel === opt.label;
                return (
                  <button
                    key={opt.label}
                    onClick={() => toggle(q, opt.label)}
                    title={opt.description || opt.label}
                    className={`${pillPad} rounded-full border ${pillText} cursor-pointer transition-colors ${
                      active
                        ? "border-peach bg-peach/25 text-peach"
                        : "border-surface1 bg-surface0/40 text-subtext1 hover:border-peach/60 hover:text-peach"
                    }`}
                  >
                    {q.multiSelect && active && <Check size={10} className="inline mr-1" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <input
              value={other[q.question] || ""}
              onChange={(e) => setOther((prev) => ({ ...prev, [q.question]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && (immediate ? (other[q.question] || "").trim() : complete)) submit(); }}
              placeholder="Other…"
              className={`w-full bg-surface0/40 border border-surface1 rounded px-2 ${touch ? "py-2 text-sm" : "py-1 text-[12px]"} text-text placeholder:text-overlay0 outline-none focus:border-peach/60`}
            />
          </div>
        );
      })}
      {(!immediate || Object.values(other).some((v) => v.trim())) && (
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={!complete}
            className={`${touch ? "px-4 py-1.5 text-sm" : "px-3 py-1 text-[12px]"} rounded border transition-colors ${
              complete
                ? "border-peach bg-peach/20 text-peach hover:bg-peach/30 cursor-pointer"
                : "border-surface1 bg-surface0/30 text-overlay0 cursor-not-allowed"
            }`}
          >
            Answer
          </button>
        </div>
      )}
    </div>
  );
}
