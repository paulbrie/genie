// Resolve a VpsConnectionConfig from (projectId, instanceId). Shared between
// ws-server and the handler modules under ../handlers so we don't create a
// handler→ws-server import cycle.

import * as projectService from "../projects/project-service.js";
import type { VpsConnectionConfig } from "../types.js";
import { ensureServerKeyOnDisk } from "./server-credential-service.js";
import { createTazClient } from "./tazcloud-api-client.js";

/** For TazCloud VMs, prefer the API's current `ssh_host` over the persisted
 *  connection — project rows can retain legacy IPv6 while the live VM is on
 *  10.x over WireGuard (or vice versa). Falls back silently on API errors. */
async function refreshTazcloudHost(
  vmId: string,
  conn: VpsConnectionConfig,
): Promise<VpsConnectionConfig> {
  const token = process.env.TAZCLOUD_API_TOKEN;
  if (!token) return conn;
  try {
    const vm = await createTazClient(token).getVm(vmId);
    const host = vm?.ssh_host;
    if (!host) return conn;
    return {
      ...conn,
      host,
      port: vm.ssh_port || conn.port,
    };
  } catch {
    return conn;
  }
}

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
  if (inst.tazcloud?.vmId) {
    return refreshTazcloudHost(inst.tazcloud.vmId, inst.connection);
  }
  return inst.connection;
}
