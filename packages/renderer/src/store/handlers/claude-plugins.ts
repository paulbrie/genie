import { batch } from "subjecto";
import { $claudePlugins } from "../subjects/claude-plugins";
import { loadClaudePlugins } from "../actions/claude-plugins";
import type { ClaudePlugin } from "../types/claude-plugins";
import type { HandlerMap } from "./types";

// --- Claude plugin catalog messages ---
//
// Wire format from packages/manager/src/handlers/claude-plugins-handler.ts:
//   claude-plugins:list       → { plugins: ClaudePlugin[], error?: string }
//   claude-plugins:upserted   → { plugin: ClaudePlugin }
//   claude-plugins:deleted    → { id: string }
//   claude-plugins:error      → { message: string }
//   claude-plugins:list:stale → {} (broadcast — refetch)

export const handlers: HandlerMap = {
  "claude-plugins:list": (payload) => {
    batch(() => {
      const v = $claudePlugins.getValue();
      v.list = (payload.plugins as ClaudePlugin[]) || [];
      v.error = payload.error ?? null;
      v.loading = false;
    });
  },

  "claude-plugins:upserted": (payload) => {
    const v = $claudePlugins.getValue();
    const plugin = payload.plugin as ClaudePlugin;
    const idx = v.list.findIndex((p) => p.id === plugin.id);
    if (idx >= 0) v.list[idx] = plugin;
    else v.list.push(plugin);
    v.saveError = null;
  },

  "claude-plugins:deleted": (payload) => {
    const v = $claudePlugins.getValue();
    v.list = v.list.filter((p) => p.id !== payload.id);
  },

  "claude-plugins:error": (payload) => {
    $claudePlugins.getValue().saveError = payload.message ?? "Unknown error";
  },

  "claude-plugins:list:stale": (_payload) => {
    loadClaudePlugins();
  },
};
