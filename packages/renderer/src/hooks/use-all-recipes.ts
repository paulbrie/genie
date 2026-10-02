import { Package, Database, Container, Globe, Cloud, FileText, Activity, Network, Shield, Server, Layers, Bug, KeyRound, Sparkles } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import type { VpsRecipeDef } from "@/components/project/project-detail";
import type { UserRecipe } from "@/store/types";
import { $recipes } from "@/store/subjects";

// Lucide icon names → components. Used to resolve `UserRecipe.icon` (string)
// into a renderable component. Built-in recipes (seeded by the manager from
// default-recipes.ts) use Sparkles/Bug/KeyRound — they must be listed here.
// Unknown names fall back to Package.
const ICON_MAP: Record<string, typeof Package> = {
  Package, Database, Container, Globe, Cloud, FileText, Activity, Network, Shield, Server, Layers,
  Bug, KeyRound, Sparkles,
};

/** Convert a DB row into the in-code VpsRecipeDef shape so call sites that
 *  expect a Lucide component for `icon` (and the typed RecipeCommand[] /
 *  RecipeOption[] arrays) don't need to know it came from the DB. */
export function userRecipeToDef(r: UserRecipe): VpsRecipeDef {
  return {
    id: r.slug,
    label: r.label,
    icon: ICON_MAP[r.icon] ?? Package,
    description: r.description,
    port: r.port ?? undefined,
    checkScript: r.checkScript,
    installScript: r.installScript,
    uninstallScript: r.uninstallScript,
    setupShSnippet: r.setupShSnippet,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commands: (r.commands as any[]) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: (r.options as any[]) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    secrets: Array.isArray(r.secrets) && r.secrets.length > 0 ? (r.secrets as any[]) : undefined,
  };
}

/** Every recipe shown in the Add-ons panel — there is no longer a separate
 *  "built-in" source. The manager seeds default recipes into the `recipes`
 *  table on boot (see packages/manager/src/default-recipes.ts), so what comes
 *  back from `recipes:list` already contains both built-ins and any user
 *  additions. */
export function useAllRecipes(): VpsRecipeDef[] {
  const recipes = useDeepSubjectAll($recipes);
  return recipes.list.map(userRecipeToDef);
}
