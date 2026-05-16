// --- Recipe types ---
//
// User-created VPS install recipes. The canonical shape lives in the manager's
// schema (packages/manager/src/db/schema.ts → `recipes` table) and the
// recipes-service module. These are merged with the built-in VPS_RECIPES (from
// `components/project-detail.tsx`) in the admin recipes panel — a user recipe
// whose `slug` matches a built-in overrides the built-in.

/** A row from the manager's `recipes` table. */
export interface UserRecipe {
  id: string;
  /** URL-safe stable id (e.g. "redis"). Unique. A built-in's id is matched
   *  against this to detect overrides. */
  slug: string;
  /** Display name shown on the pill (e.g. "Redis 7"). */
  label: string;
  description: string;
  /** Lucide icon component name (e.g. "Database", "Container"). The renderer
   *  maps this string to a component, falling back to Package on misses. */
  icon: string;
  /** Service port — informational, surfaced in the admin panel. */
  port: number | null;
  checkScript: string;
  installScript: string;
  uninstallScript: string;
  /** Optional setup.sh snippet auto-injected when a project is deployed. */
  setupShSnippet: string;
  /** Post-install operator commands (e.g. "Restart Redis"). Typed `unknown[]`
   *  on the DB side; the admin panel casts to its in-code `RecipeCommand[]`. */
  commands: unknown[];
  /** Pre-install options shown as a tiny form (e.g. PG_VERSION dropdown). */
  options: unknown[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipesState {
  list: UserRecipe[];
  loading: boolean;
  error: string | null;
  /** Surfaced separately from `error` so the panel can show a "Save failed"
   *  banner without disturbing the list-load error state. */
  saveError: string | null;
}
