import { batch } from "subjecto";
import { wsSend } from "@/lib/ws";
import { $vpsDeploy } from "../subjects/vps";
import { $recipes } from "../subjects/recipes";
import type { UserRecipe } from "../types/recipes";
import { ensureInstanceState } from "./vps";

// --- User recipe CRUD actions ---

/** Fetch the user-created recipe list from the manager. The server replies
 *  with `recipes:list` and may also push `recipes:list:stale` to all clients
 *  after any mutation. */
export function loadRecipes(): void {
  batch(() => {
    const v = $recipes.getValue();
    v.loading = true;
    v.error = null;
  });
  wsSend("recipes:list", {});
}

/** Create a new user recipe. The server replies with `recipes:upserted` on
 *  success or `recipes:error` on validation failure. */
export function createRecipe(input: Partial<UserRecipe>): void {
  $recipes.getValue().saveError = null;
  wsSend("recipes:create", input);
}

/** Update an existing user recipe. */
export function updateRecipe(id: string, patch: Partial<UserRecipe>): void {
  $recipes.getValue().saveError = null;
  wsSend("recipes:update", { id, ...patch });
}

/** Delete a user recipe. If the recipe overrode a built-in, the built-in
 *  becomes effective again on next reload. */
export function deleteRecipe(id: string): void {
  wsSend("recipes:delete", { id });
}

// --- VPS recipe actions ---

export function checkVpsRecipe(projectId: string, instanceId: string, recipeId: string, checkScript: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  inst.recipes[recipeId] = { recipeId, checking: true, installed: null, running: false, progress: [], error: null };
  wsSend("vps:recipe:check", { projectId, instanceId, recipeId, script: checkScript });
}

export function uninstallVpsRecipe(projectId: string, instanceId: string, recipeId: string, script: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  inst.recipes[recipeId] = { recipeId, checking: false, installed: true, running: true, progress: [], error: null };
  wsSend("vps:recipe:uninstall", { projectId, instanceId, recipeId, script });
}

export function runVpsRecipe(projectId: string, instanceId: string, recipeId: string, script: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  const existing = inst.recipes[recipeId];
  inst.recipes[recipeId] = { recipeId, checking: false, installed: existing?.installed ?? null, running: true, progress: [], error: null };
  wsSend("vps:recipe:run", { projectId, instanceId, recipeId, script });
}
