import type { ProjectDef } from "../shared/types";

/**
 * Match a tab URL to a project by comparing the hostname against
 * VPS instance IPs and hostnames.
 */
export function matchProject(
  tabUrl: string,
  projects: ProjectDef[],
): ProjectDef | null {
  let hostname: string;
  try {
    hostname = new URL(tabUrl).hostname;
  } catch {
    return null;
  }

  for (const project of projects) {
    for (const vps of project.vpsInstances) {
      // Match against SSH host
      if (vps.connection.host === hostname) return project;
      // Match against DO IP
      if (vps.digitalocean?.ipAddress === hostname) return project;
    }
  }

  return null;
}
