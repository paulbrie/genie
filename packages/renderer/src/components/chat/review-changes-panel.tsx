"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import {
  X, RefreshCw, Loader2, Plus, Check, Send, Copy, Columns2, Rows3,
  ChevronRight, ChevronDown, Trash2, MessageSquare, GitCompareArrows,
} from "lucide-react";
import { $reviewDiff } from "@/store/subjects/review-diff";
import { $claudeStream } from "@/store/subjects/claude-stream";
import {
  closeReviewDiff, refreshReviewDiff, setReviewViewMode, setReviewActiveFile,
  setReviewPanelWidth, toggleReviewFileReviewed, addReviewComment, removeReviewComment,
  sendReviewComments, copyReviewCommentsXml,
} from "@/store/actions/review-diff";
import { lineAnchor, type DiffFile, type DiffHunk, type DiffLine } from "@/lib/parse-diff";
import type { ReviewComment } from "@/store/types/review-diff";

const CHANGE_BADGE: Record<DiffFile["changeType"], { label: string; cls: string }> = {
  added: { label: "A", cls: "text-green bg-green/10 border-green/30" },
  modified: { label: "M", cls: "text-yellow bg-yellow/10 border-yellow/30" },
  deleted: { label: "D", cls: "text-red bg-red/10 border-red/30" },
  renamed: { label: "R", cls: "text-blue bg-blue/10 border-blue/30" },
};

export function ReviewChangesPanel() {
  const [state] = useSubject($reviewDiff);
  const [claude] = useSubject($claudeStream);
  const dragging = useRef(false);

  const { open, panelWidth, claudeStreamId, label, loading, error, files, extraPaths, reviewed, comments, viewMode, activeFile, sending } = state;

  // Auto-refresh when the bound Claude session finishes a turn (its `loading`
  // flips true → false), so the diff reflects edits the agent just made.
  const session = claudeStreamId ? claude.sessions[claudeStreamId] : undefined;
  const wasLoading = useRef(false);
  useEffect(() => {
    const now = !!session?.loading;
    if (open && wasLoading.current && !now) void refreshReviewDiff();
    wasLoading.current = now;
  }, [session?.loading, open]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      setReviewPanelWidth(startWidth + (startX - ev.clientX));
    }
    function onUp() {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  const totals = useMemo(() => {
    let add = 0, del = 0;
    for (const f of files) { add += f.additions; del += f.deletions; }
    return { add, del };
  }, [files]);

  const commentsByFile = useMemo(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      const arr = m.get(c.file) ?? [];
      arr.push(c);
      m.set(c.file, arr);
    }
    return m;
  }, [comments]);

  const openCount = comments.filter((c) => c.status === "open").length;
  const active = files.find((f) => f.path === activeFile) ?? null;

  if (!open) return null;

  return (
    <div
      className="fixed top-0 right-0 h-screen bg-mantle border-l border-surface0 flex flex-col z-[2000050] shadow-2xl shadow-black/40"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-peach/40 active:bg-peach/60 z-10"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-[34px] pb-2 border-b border-surface0 shrink-0">
        <GitCompareArrows size={15} className="text-peach shrink-0" />
        <div className="flex flex-col min-w-0 flex-1">
          <h2 className="text-md font-semibold text-text leading-tight">Review changes</h2>
          {label && <span className="text-[11px] text-overlay0 truncate">{label}</span>}
        </div>
        <div className="flex items-center rounded border border-surface1 overflow-hidden mr-1">
          <button
            onClick={() => setReviewViewMode("split")}
            className={`p-1 ${viewMode === "split" ? "bg-surface1 text-text" : "text-overlay0 hover:text-text"}`}
            title="Side-by-side"
          ><Columns2 size={13} /></button>
          <button
            onClick={() => setReviewViewMode("unified")}
            className={`p-1 ${viewMode === "unified" ? "bg-surface1 text-text" : "text-overlay0 hover:text-text"}`}
            title="Unified"
          ><Rows3 size={13} /></button>
        </div>
        <button
          onClick={() => void refreshReviewDiff()}
          disabled={loading}
          className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface1 disabled:opacity-50"
          title="Refresh diff"
        >{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
        <button
          onClick={closeReviewDiff}
          className="p-1 rounded text-overlay0 hover:text-text hover:bg-surface1"
          title="Close"
        ><X size={15} /></button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] border-b border-surface0 shrink-0 text-overlay0">
        <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
        <span className="text-green">+{totals.add}</span>
        <span className="text-red">−{totals.del}</span>
        <span className="ml-auto">{reviewed.length}/{files.length} reviewed</span>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-md text-red/90">{error}</p>
        </div>
      ) : loading && files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-overlay0" />
        </div>
      ) : files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-md text-overlay0">
            No uncommitted changes in the working tree.
            {extraPaths.length > 0 && <><br /><span className="text-[11px]">({extraPaths.length} non-text change{extraPaths.length === 1 ? "" : "s"} not shown)</span></>}
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* File tree */}
          <div className="max-h-[34%] overflow-y-auto scrollbar-thin border-b border-surface0 shrink-0">
            {files.map((f) => {
              const isActive = f.path === activeFile;
              const isReviewed = reviewed.includes(f.path);
              const fileComments = commentsByFile.get(f.path)?.length ?? 0;
              const badge = CHANGE_BADGE[f.changeType];
              return (
                <button
                  key={f.path}
                  onClick={() => setReviewActiveFile(f.path)}
                  className={`w-full flex items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-surface0/60 ${isActive ? "bg-surface0" : ""}`}
                >
                  <span className={`shrink-0 w-4 text-center rounded border text-[10px] font-bold leading-4 ${badge.cls}`}>{badge.label}</span>
                  <span className={`truncate flex-1 ${isReviewed ? "text-overlay0 line-through" : "text-subtext0"}`} title={f.path}>{f.path}</span>
                  {fileComments > 0 && (
                    <span className="shrink-0 flex items-center gap-0.5 text-peach text-[10px]"><MessageSquare size={10} />{fileComments}</span>
                  )}
                  <span className="shrink-0 text-[10px] text-green">+{f.additions}</span>
                  <span className="shrink-0 text-[10px] text-red">−{f.deletions}</span>
                  <span
                    role="checkbox"
                    aria-checked={isReviewed}
                    onClick={(e) => { e.stopPropagation(); toggleReviewFileReviewed(f.path); }}
                    className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center cursor-pointer ${isReviewed ? "bg-green/20 border-green/50 text-green" : "border-surface1 text-transparent hover:border-overlay0"}`}
                    title={isReviewed ? "Mark unreviewed" : "Mark reviewed"}
                  ><Check size={11} /></span>
                </button>
              );
            })}
          </div>

          {/* Diff body */}
          <div className="flex-1 overflow-auto scrollbar-thin min-h-0">
            {active ? (
              <DiffFileView file={active} viewMode={viewMode} comments={commentsByFile.get(active.path) ?? []} />
            ) : (
              <p className="text-overlay0 text-md text-center p-6">Select a file to review.</p>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-surface0 shrink-0">
        <span className="text-[11px] text-overlay0 flex-1">
          {openCount > 0 ? `${openCount} open comment${openCount === 1 ? "" : "s"}` : "No open comments"}
        </span>
        <button
          onClick={() => void copyReviewCommentsXml()}
          disabled={openCount === 0}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-surface1 text-subtext0 hover:bg-surface0 disabled:opacity-40"
          title="Copy comments as XML"
        ><Copy size={12} /> XML</button>
        <button
          onClick={() => void sendReviewComments()}
          disabled={openCount === 0 || sending || !session}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-peach/90 text-crust hover:bg-peach disabled:opacity-40"
          title={session ? "Send comments to Claude" : "Claude session is closed"}
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send to Claude
        </button>
      </div>
    </div>
  );
}

// --- Diff rendering ---------------------------------------------------------

function DiffFileView({ file, viewMode, comments }: { file: DiffFile; viewMode: "split" | "unified"; comments: ReviewComment[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const byAnchor = useMemo(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      const k = lineAnchor(c.file, c.side, c.line);
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  }, [comments]);

  return (
    <div className="font-mono text-[11.5px] leading-[1.5]">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="sticky top-0 z-[1] w-full flex items-center gap-1.5 px-2 py-1 bg-base border-b border-surface0 text-subtext0 hover:bg-surface0/60"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="truncate text-left flex-1" title={file.path}>{file.path}</span>
      </button>
      {!collapsed && (
        file.binary ? (
          <p className="text-overlay0 px-3 py-2 italic">Binary file — not shown.</p>
        ) : file.hunks.length === 0 ? (
          <p className="text-overlay0 px-3 py-2 italic">No textual changes.</p>
        ) : (
          file.hunks.map((h, i) => (
            <HunkView key={i} file={file} hunk={h} viewMode={viewMode} byAnchor={byAnchor} />
          ))
        )
      )}
    </div>
  );
}

function HunkView({ file, hunk, viewMode, byAnchor }: { file: DiffFile; hunk: DiffHunk; viewMode: "split" | "unified"; byAnchor: Map<string, ReviewComment[]> }) {
  return (
    <div>
      <div className="px-2 py-0.5 text-overlay0 bg-surface0/40 select-none">{hunk.header}</div>
      {viewMode === "unified"
        ? hunk.lines.map((ln, i) => <UnifiedRow key={i} file={file} line={ln} byAnchor={byAnchor} />)
        : toSplitRows(hunk.lines).map((row, i) => <SplitRow key={i} file={file} row={row} byAnchor={byAnchor} />)}
    </div>
  );
}

const BG: Record<DiffLine["type"], string> = {
  add: "bg-green/10",
  del: "bg-red/10",
  context: "",
};
const SIGN: Record<DiffLine["type"], string> = { add: "+", del: "−", context: " " };
const FG: Record<DiffLine["type"], string> = { add: "text-green", del: "text-red", context: "text-text" };

/** Anchor a line to a side + line number for comments (new side preferred). */
function anchorFor(line: DiffLine): { side: "old" | "new"; no: number } | null {
  if (line.newNo != null) return { side: "new", no: line.newNo };
  if (line.oldNo != null) return { side: "old", no: line.oldNo };
  return null;
}

function UnifiedRow({ file, line, byAnchor }: { file: DiffFile; line: DiffLine; byAnchor: Map<string, ReviewComment[]> }) {
  const anchor = anchorFor(line);
  const key = anchor ? lineAnchor(file.path, anchor.side, anchor.no) : "";
  const existing = key ? byAnchor.get(key) ?? [] : [];
  return (
    <>
      <div className={`group flex ${BG[line.type]} hover:bg-surface0/40`}>
        <LineGutter no={line.oldNo} />
        <LineGutter no={line.newNo} />
        <AddCommentButton enabled={!!anchor} file={file} anchor={anchor} snippet={line.text} />
        <span className={`w-3 shrink-0 select-none ${FG[line.type]}`}>{SIGN[line.type]}</span>
        <span className={`whitespace-pre-wrap break-all flex-1 pr-2 ${FG[line.type]}`}>{line.text || " "}</span>
      </div>
      {existing.length > 0 && anchor && (
        <CommentThread file={file} anchor={anchor} comments={existing} colSpan />
      )}
    </>
  );
}

interface SplitRowData { left?: DiffLine; right?: DiffLine }

function SplitRow({ file, row, byAnchor }: { file: DiffFile; row: SplitRowData; byAnchor: Map<string, ReviewComment[]> }) {
  const leftAnchor = row.left ? anchorFor(row.left) : null;
  const rightAnchor = row.right ? anchorFor(row.right) : null;
  const leftKey = row.left && leftAnchor ? lineAnchor(file.path, leftAnchor.side, leftAnchor.no) : "";
  const rightKey = row.right && rightAnchor ? lineAnchor(file.path, rightAnchor.side, rightAnchor.no) : "";
  const leftComments = leftKey ? byAnchor.get(leftKey) ?? [] : [];
  const rightComments = rightKey ? byAnchor.get(rightKey) ?? [] : [];
  return (
    <>
      <div className="flex">
        <SplitCell file={file} line={row.left} side="left" />
        <div className="w-px bg-surface0 shrink-0" />
        <SplitCell file={file} line={row.right} side="right" />
      </div>
      {(leftComments.length > 0 && leftAnchor) && <CommentThread file={file} anchor={leftAnchor} comments={leftComments} />}
      {(rightComments.length > 0 && rightAnchor) && <CommentThread file={file} anchor={rightAnchor} comments={rightComments} />}
    </>
  );
}

function SplitCell({ file, line }: { file: DiffFile; line?: DiffLine; side: "left" | "right" }) {
  if (!line) return <div className="flex-1 min-w-0 bg-surface0/20" />;
  const anchor = anchorFor(line);
  return (
    <div className={`group flex flex-1 min-w-0 ${BG[line.type]} hover:bg-surface0/40`}>
      <LineGutter no={line.type === "add" ? line.newNo : line.type === "del" ? line.oldNo : line.newNo} />
      <AddCommentButton enabled={!!anchor} file={file} anchor={anchor} snippet={line.text} />
      <span className={`w-3 shrink-0 select-none ${FG[line.type]}`}>{SIGN[line.type]}</span>
      <span className={`whitespace-pre-wrap break-all flex-1 pr-2 ${FG[line.type]}`}>{line.text || " "}</span>
    </div>
  );
}

function LineGutter({ no }: { no: number | null }) {
  return <span className="w-9 shrink-0 px-1 text-right text-overlay0/70 select-none tabular-nums">{no ?? ""}</span>;
}

function AddCommentButton({ enabled, file, anchor, snippet }: {
  enabled: boolean; file: DiffFile; anchor: { side: "old" | "new"; no: number } | null; snippet: string;
}) {
  const [composing, setComposing] = useState(false);
  if (!enabled || !anchor) return <span className="w-5 shrink-0" />;
  return (
    <span className="relative w-5 shrink-0 flex items-start justify-center">
      <button
        onClick={() => setComposing((v) => !v)}
        className="opacity-0 group-hover:opacity-100 mt-[1px] w-4 h-4 rounded bg-peach/80 text-crust flex items-center justify-center hover:bg-peach"
        title="Add review comment"
      ><Plus size={11} strokeWidth={3} /></button>
      {composing && (
        <CommentComposer
          file={file}
          anchor={anchor}
          snippet={snippet}
          onDone={() => setComposing(false)}
        />
      )}
    </span>
  );
}

function CommentComposer({ file, anchor, snippet, onDone }: {
  file: DiffFile; anchor: { side: "old" | "new"; no: number }; snippet: string; onDone: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => {
    if (text.trim()) addReviewComment(file.path, anchor.side, anchor.no, snippet, text);
    onDone();
  };
  return (
    <div className="absolute left-6 top-0 z-20 w-72 bg-base border border-peach/40 rounded shadow-xl p-2 font-sans">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === "Escape") { e.preventDefault(); onDone(); }
        }}
        placeholder="Leave a comment for Claude…"
        rows={3}
        className="w-full text-[12px] bg-mantle border border-surface1 rounded px-2 py-1 text-text resize-none outline-none focus:border-peach/60"
      />
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[10px] text-overlay0 flex-1">⌘↵ to save</span>
        <button onClick={onDone} className="px-2 py-0.5 text-[11px] rounded text-overlay0 hover:text-text">Cancel</button>
        <button onClick={submit} disabled={!text.trim()} className="px-2 py-0.5 text-[11px] rounded bg-peach/90 text-crust hover:bg-peach disabled:opacity-40">Comment</button>
      </div>
    </div>
  );
}

function CommentThread({ comments }: { file: DiffFile; anchor: { side: "old" | "new"; no: number }; comments: ReviewComment[]; colSpan?: boolean }) {
  return (
    <div className="bg-surface0/30 border-y border-surface0 px-3 py-1.5 font-sans flex flex-col gap-1.5">
      {comments.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-[12px]">
          <MessageSquare size={12} className="text-peach mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className={`whitespace-pre-wrap break-words ${c.status === "resolved" ? "text-overlay0 line-through" : "text-text"}`}>{c.body}</span>
            {c.status === "replied" && <span className="ml-1.5 text-[10px] text-blue">· sent</span>}
          </div>
          <button
            onClick={() => removeReviewComment(c.id)}
            className="shrink-0 text-overlay0 hover:text-red"
            title="Delete comment"
          ><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

/** Pair a hunk's lines into side-by-side rows: runs of deletions line up with the
 *  following run of additions; context lines occupy both columns. */
function toSplitRows(lines: DiffLine[]): SplitRowData[] {
  const rows: SplitRowData[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const ln of lines) {
    if (ln.type === "del") dels.push(ln);
    else if (ln.type === "add") adds.push(ln);
    else { flush(); rows.push({ left: ln, right: ln }); }
  }
  flush();
  return rows;
}
