// Resolve a VpsConnectionConfig from (projectId, instanceId). Shared between
// ws-server and the handler modules under ../handlers so we don't create a
// handler→ws-server import cycle.

import * as projectService from "../project-service.js";
import type { VpsConnectionConfig } from "../types.js";
import { ensureServerKeyOnDisk } from "./server-credential-service.js";

/** Look up a VPS instance's persisted connection config by project + instance
 *  id. Throws when the project or instance is missing — callers typically
 *  catch and surface a user-friendly error.
 *
 *  For generic "bring-your-own" servers connected with a stored (encrypted) key,
 *  the key is materialized to a 0600 file on demand and the returned connection
 *  points its privateKeyPath there — so every connectSsh-based handler (and
 *  vps:terminal:spawn, which goes through here) works without provider logic and
 *  survives a manager restart that cleared the temp dir. */
export async function getVpsConnection(projectId: string, instanceId: string): Promise<VpsConnectionConfig> {
  const project = await projectService.getById(projectId);
  const inst = project?.vpsInstances.find((v) => v.id === instanceId);
  if (!inst) throw new Error("VPS instance not found");
  if (inst.ssh?.authMethod === "stored-key" && inst.ssh.credentialId) {
    const privateKeyPath = await ensureServerKeyOnDisk(inst.ssh.credentialId);
    return { ...inst.connection, privateKeyPath };
  }
  return inst.connection;
}
