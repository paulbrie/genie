// Resolve a VpsConnectionConfig from (projectId, instanceId). Shared between
// ws-server and the handler modules under ../handlers so we don't create a
// handler→ws-server import cycle.

import * as projectService from "../project-service.js";
import type { VpsConnectionConfig } from "../types.js";

/** Look up a VPS instance's persisted connection config by project + instance
 *  id. Throws when the project or instance is missing — callers typically
 *  catch and surface a user-friendly error. */
export async function getVpsConnection(projectId: string, instanceId: string): Promise<VpsConnectionConfig> {
  const project = await projectService.getById(projectId);
  const inst = project?.vpsInstances.find((v) => v.id === instanceId);
  if (!inst) throw new Error("VPS instance not found");
  return inst.connection;
}
