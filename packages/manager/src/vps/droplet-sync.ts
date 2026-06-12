import * as settingsService from "../settings-service.js";
import * as projectService from "../projects/project-service.js";
import { createDoClient } from "./do-api-client.js";

/** Module-level cache of the latest DO droplet list. Periodically refreshed by
 *  `syncDropletStatuses`. Other code reads `dropletSync.knownIds` to decide
 *  whether a droplet is still alive without hitting the API on every check. */
export const dropletSync: {
  knownIds: Set<number>;
  lastSync: number;
} = {
  knownIds: new Set(),
  lastSync: 0,
};

/** Refresh the alive-droplet set from DigitalOcean and prune any project VPS
 *  instances whose droplet no longer exists. Called once on startup and then
 *  every 60s by ws-server. Caller passes `onProjectListChanged` to rebroadcast
 *  the project list (we keep this module dependency-free of ws-server). */
export async function syncDropletStatuses(onProjectListChanged: () => Promise<void> | void): Promise<void> {
  const doToken = await settingsService.getGlobalDoToken();
  if (!doToken) return;
  try {
    const client = createDoClient(doToken);
    const droplets = await client.listDroplets("genie");
    dropletSync.knownIds = new Set(droplets.map((d) => d.id));
    dropletSync.lastSync = Date.now();

    const projects = await projectService.getAll();
    let changed = false;
    for (const p of projects) {
      const deadInstances = p.vpsInstances.filter(
        v => v.digitalocean?.dropletId && !dropletSync.knownIds.has(v.digitalocean.dropletId),
      );
      if (deadInstances.length > 0) {
        const remaining = p.vpsInstances.filter(
          v => !v.digitalocean?.dropletId || dropletSync.knownIds.has(v.digitalocean.dropletId),
        );
        await projectService.patchProject(p.id, { vpsInstances: remaining });
        changed = true;
      }
    }
    if (changed) {
      await onProjectListChanged();
    }
  } catch {
    // Silently ignore — sync will retry next interval.
  }
}
