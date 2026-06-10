// --- Claude plugin types ---
//
// Official Claude Code plugins surfaced in the Manager popup's "Claude Plugins"
// tab. Same lifecycle as recipes: canonical shape lives in the manager's schema
// (packages/manager/src/db/schema.ts → `claude_plugins`), built-ins are seeded
// from packages/manager/src/default-claude-plugins.ts on every boot, and
// superadmins extend the catalog via the same panel.

/** A row from the manager's `claude_plugins` table. */
export interface ClaudePlugin {
  id: string;
  /** URL-safe stable id (e.g. "chrome-devtools-mcp"). Unique. */
  slug: string;
  /** Display name shown on the pill. */
  label: string;
  description: string;
  /** Lucide icon component name (e.g. "Chrome", "TestTube"). Falls back to
   *  Puzzle on unknown names. */
  icon: string;
  /** Marketplace / docs URL, surfaced as a "View docs" link. */
  homepageUrl: string;
  checkScript: string;
  installScript: string;
  uninstallScript: string;
  commands: unknown[];
  options: unknown[];
  /** Per-apply prompted values schema (e.g. plugin API key). Values never
   *  persist — only the schema lives in the DB. */
  secrets: unknown[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudePluginsState {
  list: ClaudePlugin[];
  loading: boolean;
  error: string | null;
  saveError: string | null;
}

/** Per-VM install state for a single plugin — drives the install button's
 *  spinner / progress lines in the per-VM Claude Plugins tab. Same shape as
 *  RecipeState (intentional — they share the streaming-output UI pattern). */
export interface ClaudePluginState {
  pluginId: string;
  checking: boolean;
  installed: boolean | null;
  running: boolean;
  progress: string[];
  error: string | null;
}
