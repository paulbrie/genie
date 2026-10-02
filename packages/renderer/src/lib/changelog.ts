// Hardcoded changelog displayed by the "What's new" modal.
//
// To announce a release: prepend a new entry to CHANGELOG. The renderer
// compares the user's `lastSeenUpdateVersion` (persisted server-side) against
// the latest entry; anything newer pops the modal on next login. Dismissing
// the modal stores the latest entry's `version` so it never shows again
// unless a newer entry ships.
//
// Versions are plain strings ordered by recency of the entry's position in
// the array (latest first). Use YYYY-MM-DD-N for natural sort if you ever
// need string comparison.

export interface ChangelogEntry {
  /** Stable identifier — used as the per-user "last seen" marker. */
  version: string;
  /** Human-readable date for the modal header (e.g. "May 25, 2026"). */
  date: string;
  /** Short release headline. */
  title: string;
  /** Bullet list of what shipped. Keep them user-visible, not internal. */
  items: string[];
}

/** Latest entry first. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2026-06-18",
    date: "June 18, 2026",
    title: "Claude Chat upgrades",
    items: [
      "Plan mode: toggle it on and Claude researches and proposes a plan before changing anything.",
      "Sessions: reopen and continue any previous Claude session — the full conversation loads back in.",
      "Live token usage, cost, thinking time, and a meter for how much of the context window you've used.",
      "Long runs of tool calls collapse into a single expandable pill instead of a long list.",
      "Click a Claude session pill to open it as a chat — Enter sends, Esc stops.",
    ],
  },
  {
    version: "2026-05-25",
    date: "May 25, 2026",
    title: "Topology + What's New",
    items: [
      "Topology graph now connects users to the actual servers they have live terminal sessions on, not just the project they're viewing.",
      "Added this update log — you'll see it once per release.",
    ],
  },
];

/** The entries the user has not yet acknowledged. Returns latest-first. */
export function unseenChangelogEntries(lastSeenVersion: string | null | undefined): ChangelogEntry[] {
  if (!lastSeenVersion) return [...CHANGELOG];
  const idx = CHANGELOG.findIndex((e) => e.version === lastSeenVersion);
  // Unknown version → user is on a totally different track; show everything
  // rather than silently skip. Index 0 means the user already saw the latest.
  if (idx === -1) return [...CHANGELOG];
  return CHANGELOG.slice(0, idx);
}

/** The version of the most recent entry, or null if the changelog is empty. */
export function latestChangelogVersion(): string | null {
  return CHANGELOG[0]?.version ?? null;
}
