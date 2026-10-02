// --- Review-changes panel (diffx-style code review for Claude agent work) ---
//
// A right-side drawer that diffs the project VM's working tree, lets the user
// leave inline review comments, then ships those comments straight back into the
// bound durable Claude session as the next turn (closing the review loop in-app
// instead of via diffx's copy-to-clipboard).

import type { DiffFile } from "@/lib/parse-diff";

export type ReviewCommentStatus = "open" | "replied" | "resolved";

export interface ReviewComment {
  id: string;
  /** File path the comment is anchored to (matches DiffFile.path). */
  file: string;
  /** Which side of the diff the anchored line lives on. */
  side: "old" | "new";
  /** 1-based line number on that side. */
  line: number;
  /** A short snippet of the anchored line, for context when sent to Claude. */
  snippet: string;
  body: string;
  status: ReviewCommentStatus;
}

export interface ReviewDiffState {
  open: boolean;
  /** The Claude stream session whose project we're reviewing. */
  claudeStreamId: string | null;
  /** Window label of that session, shown in the header. */
  label: string;
  loading: boolean;
  error: string | null;
  /** True while review comments are being sent to Claude. */
  sending: boolean;
  panelWidth: number;
  viewMode: "split" | "unified";
  files: DiffFile[];
  /** Paths of untracked/changed files git reported with no renderable diff
   *  (e.g. binary or mode-only) — surfaced so the count is honest. */
  extraPaths: string[];
  /** File paths the reviewer has marked as reviewed. */
  reviewed: string[];
  comments: ReviewComment[];
  /** Currently expanded file in the tree (null = all collapsed to the first). */
  activeFile: string | null;
}

export function emptyReviewDiffState(): ReviewDiffState {
  return {
    open: false,
    claudeStreamId: null,
    label: "",
    loading: false,
    error: null,
    sending: false,
    panelWidth: 640,
    viewMode: "split",
    files: [],
    extraPaths: [],
    reviewed: [],
    comments: [],
    activeFile: null,
  };
}
