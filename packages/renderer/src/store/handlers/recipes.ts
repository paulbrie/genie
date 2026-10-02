import { batch } from "subjecto";
import { $recipes } from "../subjects/recipes";
import { loadRecipes } from "../actions/recipes";
import type { UserRecipe } from "../types/recipes";
import type { HandlerMap } from "./types";

// --- User recipes messages ---
//
// Wire format from packages/manager/src/ws-server.ts (case "recipes:..."):
//   recipes:list       → { recipes: UserRecipe[], error?: string }
//   recipes:upserted   → { recipe: UserRecipe }
//   recipes:deleted    → { id: string }
//   recipes:error      → { message: string }
//   recipes:list:stale → {} (broadcast — refetch)

export const handlers: HandlerMap = {
  "recipes:list": (payload) => {
    batch(() => {
      const v = $recipes.getValue();
      v.list = (payload.recipes as UserRecipe[]) || [];
      v.error = payload.error ?? null;
      v.loading = false;
    });
  },

  "recipes:upserted": (payload) => {
    const v = $recipes.getValue();
    const recipe = payload.recipe as UserRecipe;
    const idx = v.list.findIndex((r) => r.id === recipe.id);
    if (idx >= 0) v.list[idx] = recipe;
    else v.list.push(recipe);
    v.saveError = null;
  },

  "recipes:deleted": (payload) => {
    const v = $recipes.getValue();
    v.list = v.list.filter((r) => r.id !== payload.id);
  },

  "recipes:error": (payload) => {
    $recipes.getValue().saveError = payload.message ?? "Unknown error";
  },

  // Broadcast after any mutation by any client — refetch so all panels stay
  // in sync. Cheap because the list is small.
  "recipes:list:stale": (_payload) => {
    loadRecipes();
  },
};
