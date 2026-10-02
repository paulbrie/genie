// Recipes CRUD: list/create/update/delete. Mutations broadcast a
// `recipes:list:stale` ping so every connected client refreshes its copy.
// `broadcast` is injected from ws-server (it owns the `clients` map); keeping
// it as a parameter avoids reaching back across modules for shared state.

import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as recipesService from "../recipes-service.js";
import { type Role } from "../auth/ws-acl.js";
import { hasRole } from "./handler-auth.js";


export async function handleRecipesMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  broadcast: (message: WsMessage) => void,
  role: Role | null,
): Promise<boolean> {
  if (!msg.type.startsWith("recipes:")) return false;
  // Recipes are global add-ons whose scripts run as root on every VM; authoring
  // them is superadmin-only. The WS ACL already gates the recipes namespace to
  // superadmin — this is defense in depth in case that's ever loosened.
  if (!hasRole(role, "superadmin")) {
    send(ws, { type: "recipes:error", payload: { message: "Not authorized" } });
    return true;
  }
  switch (msg.type) {
    case "recipes:list": {
      try {
        const rows = await recipesService.listRecipes();
        send(ws, { type: "recipes:list", payload: { recipes: rows } });
      } catch (err: unknown) {
        send(ws, { type: "recipes:list", payload: { recipes: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "recipes:create": {
      try {
        const row = await recipesService.createRecipe(msg.payload as recipesService.RecipeInput, userId);
        send(ws, { type: "recipes:upserted", payload: { recipe: row } });
        broadcast({ type: "recipes:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "recipes:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "recipes:update": {
      try {
        const { id, ...rest } = msg.payload;
        const row = await recipesService.updateRecipe(id, rest);
        if (!row) throw new Error("Recipe not found");
        send(ws, { type: "recipes:upserted", payload: { recipe: row } });
        broadcast({ type: "recipes:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "recipes:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "recipes:delete": {
      try {
        const { id } = msg.payload;
        await recipesService.deleteRecipe(id);
        send(ws, { type: "recipes:deleted", payload: { id } });
        broadcast({ type: "recipes:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "recipes:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
