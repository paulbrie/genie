import { batch } from "subjecto";
import { wsSend } from "@/lib/ws";
import { $vpsDeploy } from "../subjects/vps";
import { $claudePlugins } from "../subjects/claude-plugins";
import type { ClaudePlugin } from "../types/claude-plugins";
import { ensureInstanceState } from "./vps";

// --- Plugin catalog CRUD actions ---

/** Fetch the plugin catalog from the manager. Server replies with
 *  `claude-plugins:list` and pushes `claude-plugins:list:stale` after every
 *  mutation. */
export function loadClaudePlugins(): void {
  batch(() => {
    const v = $claudePlugins.getValue();
    v.loading = true;
    v.error = null;
  });
  wsSend("claude-plugins:list", {});
}

/** Create a new plugin in the catalog (superadmin-only). */
export function createClaudePlugin(input: Partial<ClaudePlugin>): void {
  $claudePlugins.getValue().saveError = null;
  wsSend("claude-plugins:create", input);
}

/** Update an existing plugin in the catalog (superadmin-only). */
export function updateClaudePlugin(id: string, patch: Partial<ClaudePlugin>): void {
  $claudePlugins.getValue().saveError = null;
  wsSend("claude-plugins:update", { id, ...patch });
}

/** Remove a plugin from the catalog (superadmin-only). */
export function deleteClaudePlugin(id: string): void {
  wsSend("claude-plugins:delete", { id });
}

// --- Per-VM plugin actions ---

export function checkVpsClaudePlugin(projectId: string, instanceId: string, pluginId: string, checkScript: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  inst.claudePlugins[pluginId] = { pluginId, checking: true, installed: null, running: false, progress: [], error: null };
  wsSend("vps:claude-plugin:check", { projectId, instanceId, pluginId, script: checkScript });
}

export function uninstallVpsClaudePlugin(projectId: string, instanceId: string, pluginId: string, script: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  inst.claudePlugins[pluginId] = { pluginId, checking: false, installed: true, running: true, progress: [], error: null };
  wsSend("vps:claude-plugin:uninstall", { projectId, instanceId, pluginId, script });
}

export function runVpsClaudePlugin(projectId: string, instanceId: string, pluginId: string, script: string): void {
  ensureInstanceState(instanceId);
  const inst = $vpsDeploy.getValue().instances[instanceId];
  const existing = inst.claudePlugins[pluginId];
  inst.claudePlugins[pluginId] = { pluginId, checking: false, installed: existing?.installed ?? null, running: true, progress: [], error: null };
  wsSend("vps:claude-plugin:run", { projectId, instanceId, pluginId, script });
}
