import { Package, Database, Container, Globe, Cloud, FileText, Activity, Network, Shield, Server, Layers } from "lucide-react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { VPS_RECIPES, type VpsRecipeDef } from "@/components/project-detail";
import type { UserRecipe } from "@/store/types";
import { $recipes } from "@/store/subjects";

// Lucide icon names → components. Used to resolve `UserRecipe.icon` (string)
// into a renderable component. Keep this list short — anything not here falls
// back to Package.
const ICON_MAP: Record<string, typeof Package> = {
  Package, Database, Container, Globe, Cloud, FileText, Activity, Network, Shield, Server, Layers,
};

/** Convert a DB-stored UserRecipe into the in-code VpsRecipeDef shape so call
 *  sites don't need to care which source it came from. */
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
  };
}

/** Built-in + user recipes merged. A user recipe with the same slug as a
 *  built-in overrides the built-in (so users can tweak Chrome's apt step). */
export function useAllRecipes(): VpsRecipeDef[] {
  const recipes = useDeepSubjectAll($recipes);
  const userDefs = recipes.list.map(userRecipeToDef);
  const userSlugs = new Set(userDefs.map((d: VpsRecipeDef) => d.id));
  const builtins = VPS_RECIPES.filter((b) => !userSlugs.has(b.id));
  return [...builtins, ...userDefs];
}
