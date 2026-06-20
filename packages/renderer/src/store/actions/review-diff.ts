import { wsRequest } from "@/lib/ws";
import { parseUnifiedDiff, parseStatus } from "@/lib/parse-diff";
import { $reviewDiff } from "../subjects/review-diff";
import { $claudeStream } from "../subjects/claude-stream";
import { emptyReviewDiffState, type ReviewComment } from "../types/review-diff";
import { sendClaudeStreamMessage } from "./claude-stream";

const MIN_W = 420;
const MAX_W = 1100;

/** Open the review drawer for a Claude session and load its working-tree diff. */
export async function openReviewDiff(claudeStreamId: string, label: string): Promise<void> {
  const prev = $reviewDiff.getValue();
  // Switching to a different session drops the old session's comments/reviewed
  // state; re-opening the same one keeps them.
  const carry = prev.claudeStreamId === claudeStreamId;
  $reviewDiff.nextAssign({
    open: true,
    claudeStreamId,
    label,
    error: null,
    files: carry ? prev.files : [],
    comments: carry ? prev.comments : [],
    reviewed: carry ? prev.reviewed : [],
    extraPaths: carry ? prev.extraPaths : [],
    activeFile: carry ? prev.activeFile : null,
  });
  await refreshReviewDiff();
}

export function closeReviewDiff(): void {
  $reviewDiff.nextAssign({ open: false });
}

/** Re-run `git diff` on the VM and reparse. Preserves comments/reviewed flags. */
export async function refreshReviewDiff(): Promise<void> {
  const st = $reviewDiff.getValue();
  if (!st.claudeStreamId) return;
  const session = $claudeStream.getValue().sessions[st.claudeStreamId];
  if (!session) {
    $reviewDiff.nextAssign({ error: "This Claude session is no longer open.", loading: false });
    return;
  }
  $reviewDiff.nextAssign({ loading: true, error: null });
  try {
    const res = await wsRequest<{ status?: string; diff?: string; error?: string }>(
      "claude:stream:gitdiff",
      { claudeStreamId: st.claudeStreamId, projectId: session.projectId },
      40_000,
    );
    if (res.error) {
      $reviewDiff.nextAssign({ loading: false, error: res.error });
      return;
    }
    const diffText = res.diff ?? "";
    if (diffText.includes("__GENIE_NOREPO__")) {
      $reviewDiff.nextAssign({ loading: false, files: [], extraPaths: [], error: "The project directory is not a git repository." });
      return;
    }
    if (diffText.includes("__GENIE_NOPROJECT__")) {
      $reviewDiff.nextAssign({ loading: false, files: [], extraPaths: [], error: "No project directory found on the VM." });
      return;
    }
    const files = parseUnifiedDiff(diffText);
    const status = parseStatus(res.status ?? "");
    // Files git lists but that produced no renderable hunks (binary, mode-only) —
    // surface them so the count is honest.
    const diffPaths = new Set(files.map((f) => f.path));
    const extraPaths = status.map((s) => s.path).filter((p) => !diffPaths.has(p));
    const cur = $reviewDiff.getValue();
    $reviewDiff.nextAssign({
      loading: false,
      files,
      extraPaths,
      activeFile: cur.activeFile && diffPaths.has(cur.activeFile) ? cur.activeFile : files[0]?.path ?? null,
    });
  } catch {
    $reviewDiff.nextAssign({ loading: false, error: "Failed to load the diff (timed out or no connection)." });
  }
}

export function setReviewViewMode(mode: "split" | "unified"): void {
  $reviewDiff.nextAssign({ viewMode: mode });
}

export function setReviewActiveFile(path: string | null): void {
  $reviewDiff.nextAssign({ activeFile: path });
}

export function setReviewPanelWidth(width: number): void {
  $reviewDiff.nextAssign({ panelWidth: Math.max(MIN_W, Math.min(MAX_W, width)) });
}

export function toggleReviewFileReviewed(path: string): void {
  const st = $reviewDiff.getValue();
  const reviewed = st.reviewed.includes(path)
    ? st.reviewed.filter((p) => p !== path)
    : [...st.reviewed, path];
  $reviewDiff.nextAssign({ reviewed });
}

export function addReviewComment(
  file: string,
  side: "old" | "new",
  line: number,
  snippet: string,
  body: string,
): void {
  const trimmed = body.trim();
  if (!trimmed) return;
  const comment: ReviewComment = {
    id: crypto.randomUUID(),
    file,
    side,
    line,
    snippet: snippet.slice(0, 200),
    body: trimmed,
    status: "open",
  };
  $reviewDiff.nextAssign({ comments: [...$reviewDiff.getValue().comments, comment] });
}

export function updateReviewComment(id: string, body: string): void {
  const trimmed = body.trim();
  const comments = $reviewDiff.getValue().comments.map((c) =>
    c.id === id ? { ...c, body: trimmed } : c,
  );
  $reviewDiff.nextAssign({ comments });
}

export function removeReviewComment(id: string): void {
  $reviewDiff.nextAssign({ comments: $reviewDiff.getValue().comments.filter((c) => c.id !== id) });
}

export function setReviewCommentStatus(id: string, status: ReviewComment["status"]): void {
  const comments = $reviewDiff.getValue().comments.map((c) => (c.id === id ? { ...c, status } : c));
  $reviewDiff.nextAssign({ comments });
}

/** Serialise the open review comments to the XML envelope diffx uses for agents. */
export function reviewCommentsXml(comments: ReviewComment[]): string {
  const body = comments
    .map(
      (c) =>
        `  <comment file="${escapeAttr(c.file)}" line="${c.line}" side="${c.side}">\n` +
        `    <code>${escapeXml(c.snippet)}</code>\n` +
        `    <note>${escapeXml(c.body)}</note>\n` +
        `  </comment>`,
    )
    .join("\n");
  return `<review-comments>\n${body}\n</review-comments>`;
}

/** Copy the open comments to the clipboard as XML (diffx parity). */
export async function copyReviewCommentsXml(): Promise<number> {
  const open = $reviewDiff.getValue().comments.filter((c) => c.status === "open");
  if (!open.length) return 0;
  try {
    await navigator.clipboard.writeText(reviewCommentsXml(open));
  } catch {
    /* clipboard blocked — best effort */
  }
  return open.length;
}

/** Send all open comments into the bound Claude session as the next turn, then
 *  mark them replied. The XML goes on the wire (rich context for Claude) while a
 *  clean summary shows in the chat bubble. */
export async function sendReviewComments(): Promise<void> {
  const st = $reviewDiff.getValue();
  if (!st.claudeStreamId || st.sending) return;
  const open = st.comments.filter((c) => c.status === "open");
  if (!open.length) return;
  const xml = reviewCommentsXml(open);
  const wire =
    `${xml}\n\nPlease address the review comments above. Make the edits, then briefly summarise what you changed per file.`;
  const shown = `Sent ${open.length} review comment${open.length === 1 ? "" : "s"} for you to address →`;
  $reviewDiff.nextAssign({ sending: true });
  sendClaudeStreamMessage(st.claudeStreamId, wire, undefined, shown);
  const openIds = new Set(open.map((c) => c.id));
  $reviewDiff.nextAssign({
    sending: false,
    comments: $reviewDiff.getValue().comments.map((c) =>
      openIds.has(c.id) ? { ...c, status: "replied" as const } : c,
    ),
  });
}

/** Reset everything (used when the bound session closes). */
export function resetReviewDiff(): void {
  $reviewDiff.next(emptyReviewDiffState());
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}
