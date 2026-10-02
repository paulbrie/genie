// Unified-diff parser for the review-changes panel (diffx-style). Turns the raw
// `git diff` text captured from the project VM into a structured model the panel
// can render side-by-side or inline, with stable per-line anchors for comments.
//
// Deliberately dependency-free: git emits a well-defined format and we only need
// the subset produced by `git diff -M HEAD` plus `git diff --no-index` (used for
// untracked/new files). No syntax highlighting here — the panel colours lines by
// type, which keeps us off a heavyweight highlighter dependency.

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  /** 1-based line number on the old side (null for added lines). */
  oldNo: number | null;
  /** 1-based line number on the new side (null for deleted lines). */
  newNo: number | null;
  /** Line content without the leading +/-/space marker. */
  text: string;
}

export interface DiffHunk {
  /** The raw `@@ -a,b +c,d @@ section` header line. */
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type DiffChangeType = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  /** Path shown in the UI (new path unless the file was deleted). */
  path: string;
  oldPath: string;
  newPath: string;
  changeType: DiffChangeType;
  binary: boolean;
  hunks: DiffHunk[];
  /** Net added / removed line counts across all hunks. */
  additions: number;
  deletions: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Strip a leading `a/` or `b/` (git's default src/dst prefixes). `--no-index`
 *  against /dev/null yields `a/dev/null`; leave that for the caller to ignore. */
function stripPrefix(p: string): string {
  if (p === "/dev/null") return p;
  return p.replace(/^[ab]\//, "");
}

/** Parse a full multi-file unified diff into structured files. */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split("\n");
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const pushHunk = () => {
    if (cur && hunk) cur.hunks.push(hunk);
    hunk = null;
  };
  const pushFile = () => {
    pushHunk();
    if (cur) files.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      pushFile();
      // `diff --git a/x b/y` — capture both; refined by ---/+++ headers below.
      const m = line.match(/^diff --git (.+?) (.+)$/);
      const a = m ? stripPrefix(m[1]) : "";
      const b = m ? stripPrefix(m[2]) : "";
      cur = {
        path: b && b !== "/dev/null" ? b : a,
        oldPath: a,
        newPath: b,
        changeType: "modified",
        binary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!cur) continue; // preamble before the first file — skip

    if (line.startsWith("new file mode")) { cur.changeType = "added"; continue; }
    if (line.startsWith("deleted file mode")) { cur.changeType = "deleted"; continue; }
    if (line.startsWith("rename from ")) { cur.oldPath = line.slice("rename from ".length); cur.changeType = "renamed"; continue; }
    if (line.startsWith("rename to ")) { cur.newPath = cur.path = line.slice("rename to ".length); cur.changeType = "renamed"; continue; }
    if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) { cur.binary = true; continue; }

    if (line.startsWith("--- ")) {
      const p = stripPrefix(line.slice(4).trim());
      if (p !== "/dev/null") cur.oldPath = p;
      else cur.changeType = "added";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = stripPrefix(line.slice(4).trim());
      if (p !== "/dev/null") { cur.newPath = cur.path = p; }
      else cur.changeType = "deleted";
      continue;
    }

    const hm = line.match(HUNK_RE);
    if (hm) {
      pushHunk();
      oldNo = parseInt(hm[1], 10);
      newNo = parseInt(hm[3], 10);
      hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] };
      continue;
    }

    if (!hunk) continue; // index lines / "\ No newline" outside a hunk
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      hunk.lines.push({ type: "add", oldNo: null, newNo, text });
      newNo++;
      cur.additions++;
    } else if (marker === "-") {
      hunk.lines.push({ type: "del", oldNo, newNo: null, text });
      oldNo++;
      cur.deletions++;
    } else {
      // context (leading space) — also covers blank lines git emits as "".
      hunk.lines.push({ type: "context", oldNo, newNo, text });
      oldNo++;
      newNo++;
    }
  }
  pushFile();
  return files;
}

export interface StatusEntry {
  path: string;
  /** Two-char porcelain code, e.g. " M", "??", "A ", "R ". */
  code: string;
}

/** Parse `git status --porcelain=v1` into entries (used for the untracked/total
 *  file count and to surface files that produced no diff text, e.g. mode-only
 *  changes). */
export function parseStatus(raw: string): StatusEntry[] {
  if (!raw || !raw.trim()) return [];
  return raw.split("\n").filter(Boolean).map((l) => {
    const code = l.slice(0, 2);
    let path = l.slice(3);
    // Renames are "R  old -> new"; keep the new path.
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    return { code, path };
  });
}

/** Stable anchor key for a comment on a specific diff line. */
export function lineAnchor(filePath: string, side: "old" | "new", lineNo: number): string {
  return `${filePath}::${side}::${lineNo}`;
}
