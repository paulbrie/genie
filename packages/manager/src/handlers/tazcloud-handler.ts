import { type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { WsMessage, VpsConnectionConfig } from "../types.js";
import { VPS_SSH_USERNAME } from "../types.js";
import type { Role } from "../ws-acl.js";
import { isPrivilegedRole } from "../ws-acl.js";
import * as projectService from "../project-service.js";
import * as analyticsService from "../analytics-service.js";
import * as cloudVmAliases from "../cloud-vm-alias-service.js";
import * as settingsService from "../settings-service.js";
import { tazcloudProvisionAndDeploy, tazcloudDestroyVm, ensureTazcloudKeyOnDisk, applyTazcloudFirewallPreset, cleanupTazcloudVmReferences } from "../vps/tazcloud-provision.js";
import { createTazClient, sshUserForImage } from "../vps/tazcloud-api-client.js";
import { vpsStatus, vpsStats } from "../vps/deploy-service.js";
import type { SshConnectionConfig } from "../vps/ssh-client.js";
import { ensureServerTunnel, releaseServerTunnel, execCached, serverTunnelKey } from "../vps/ssh-session-cache.js";
import { sshStatsProbeEnabled } from "../vps/ssh-stats-disabled.js";
import { dbgSsh } from "../debug-ssh-log.js";
import { getActiveSshConnections } from "../vps/ssh-metrics.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { getDb } from "../db/index.js";
import { deployLogs } from "../db/schema.js";
import {
  activeExecTargets,
  broadcastProjectList,
} from "../ws-server.js";


/** Track active TazCloud deploy AbortControllers by projectId. */
const activeTazAbortControllers = new Map<string, AbortController>();

/** Coalesce concurrent `admin:tazcloud:stats` requests into one probe round. */
let tazcloudStatsInflight: Promise<{ stats: Record<string, unknown>; errors: Record<string, string> }> | null = null;

/** Handle every `tazcloud:*` and `admin:tazcloud:*` message. Returns true if handled.
 *  Also handles `admin:server:tunnel:ensure` and `admin:server:tunnel:release` since
 *  they coordinate the same provider-agnostic SSH tunnel pool used by Taz exec. */
export async function handleTazcloudMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  role: Role | null,
  broadcast: (message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "tazcloud:deploy": {
      const { projectId: tazProjectId, instanceId: tazInstanceId, label: tazLabel } = msg.payload;
      const tazProject = await projectService.getById(tazProjectId);
      if (!tazProject) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: tazProjectId, message: "Project not found" } });
        return true;
      }
      // Provisioning a VM is an owner-level action — plain project members may
      // see the project but can't create servers on it.
      if (!isPrivilegedRole(role) && !(await projectService.userCanManageProject(userId, tazProjectId))) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: tazProjectId, message: "Not authorized to deploy to this project" } });
        return true;
      }
      void analyticsService.recordEvent({ userId, userName: null, event: "vps.deploy", props: { provider: "tazcloud" }, ip: null });
      const tazToken = process.env.TAZCLOUD_API_TOKEN;
      const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
      if (!tazToken || !tazPrivateKey) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: tazProjectId, message: "TazCloud credentials not configured (TAZCLOUD_API_TOKEN and TAZCLOUD_SSH_PRIVATE_KEY env vars)." } });
        return true;
      }

      if (!tazProject.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie.\n`;
        const updatedFiles = { ...(tazProject.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(tazProjectId, { setupFiles: updatedFiles });
        tazProject.setupFiles = updatedFiles;
      }

      const newTazInstanceId = tazInstanceId || uuidv4();
      const abortController = new AbortController();
      activeTazAbortControllers.set(tazProjectId, abortController);

      const tazDb = getDb();
      const [tazLogRow] = await tazDb.insert(deployLogs).values({ projectId: tazProjectId }).returning({ id: deployLogs.id });
      const tazDeployLogId = tazLogRow.id;
      const tazProgressAcc: string[] = [];

      const tazFirstMsg = `Starting TazCloud auto-provision for "${tazProject.name}" (image: ${tazProject.vpsImage || "ubuntu-22"}, size: ${tazProject.vpsSize || "small"})...`;
      tazProgressAcc.push(tazFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId: tazProjectId, instanceId: newTazInstanceId, message: tazFirstMsg } });

      const gitlabKey = await settingsService.resolveGitlabDeployKey(tazProjectId);

      void tazcloudProvisionAndDeploy(
        {
          token: tazToken,
          privateKey: tazPrivateKey,
          projectName: tazProject.name,
          image: tazProject.vpsImage || undefined,
          size: tazProject.vpsSize || undefined,
          signal: abortController.signal,
          gitlabDeployKey: gitlabKey || undefined,
          envVars: tazProject.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>),
          setupFiles: tazProject.setupFiles,
        },
        (step) => {
          tazProgressAcc.push(step);
          send(ws, { type: "vps:deploy:progress", payload: { projectId: tazProjectId, instanceId: newTazInstanceId, message: step } });
        },
      ).then(async (result) => {
        activeTazAbortControllers.delete(tazProjectId);
        const tazKeyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
        const connection: VpsConnectionConfig = {
          host: result.ipv6,
          port: 22,
          username: VPS_SSH_USERNAME,
          privateKeyPath: tazKeyPath,
        };
        const instance: import("../types.js").VpsInstance = {
          id: newTazInstanceId,
          label: tazLabel || "production",
          connection,
          services: [],
          tazcloud: {
            vmId: result.vmId,
            ipv6: result.ipv6,
            image: result.image,
            size: result.size,
            sshUser: result.sshUser,
            ...(result.projectId ? { projectId: result.projectId } : {}),
          },
        };
        try {
          instance.services = await vpsStatus(tazProject.name, connection);
        } catch { /* keep empty */ }
        const existing = tazProject.vpsInstances.find(v => v.id === newTazInstanceId);
        if (existing) {
          await projectService.updateVpsInstance(tazProjectId, newTazInstanceId, instance);
        } else {
          await projectService.addVpsInstance(tazProjectId, instance);
        }
        await broadcastProjectList();
        await tazDb.update(deployLogs).set({ status: "success", progress: tazProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, tazDeployLogId));
        send(ws, { type: "vps:deploy:done", payload: { projectId: tazProjectId, instanceId: newTazInstanceId, services: instance.services, deployLogId: tazDeployLogId } });
      }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        activeTazAbortControllers.delete(tazProjectId);
        await tazDb.update(deployLogs).set({ status: "error", progress: tazProgressAcc, error: message, endedAt: new Date() }).where(eq(deployLogs.id, tazDeployLogId));
        const failedVmId = (err as Error & { vmId?: string }).vmId;
        if (failedVmId) {
          const failedInstance: import("../types.js").VpsInstance = {
            id: newTazInstanceId,
            label: tazLabel || "production",
            connection: {
              host: "unknown",
              port: 22,
              username: VPS_SSH_USERNAME,
              privateKeyPath: ensureTazcloudKeyOnDisk(tazPrivateKey),
            },
            services: [],
            tazcloud: {
              vmId: failedVmId,
              ipv6: "unknown",
              image: tazProject.vpsImage || "unknown",
              size: tazProject.vpsSize || "unknown",
              sshUser: VPS_SSH_USERNAME,
            },
            deployFailed: true,
            deployError: message,
          };
          await projectService.addVpsInstance(tazProjectId, failedInstance);
          await broadcastProjectList();
        }
        send(ws, {
          type: "vps:deploy:error",
          payload: {
            projectId: tazProjectId,
            instanceId: newTazInstanceId,
            message,
            deployLogId: tazDeployLogId,
            ...(failedVmId ? { failedVm: { vmId: failedVmId, provider: "tazcloud" } } : {}),
          },
        });
      });
      return true;
    }

    case "tazcloud:cancel": {
      const { projectId: cancelProjectId } = msg.payload;
      const controller = activeTazAbortControllers.get(cancelProjectId);
      if (controller) {
        controller.abort();
        activeTazAbortControllers.delete(cancelProjectId);
        send(ws, { type: "vps:deploy:progress", payload: { projectId: cancelProjectId, message: "Cancelling TazCloud deployment..." } });
      }
      return true;
    }

    case "tazcloud:destroy-failed-vm": {
      const { vmId: failedVmId, projectId: failedProjectId, instanceId: failedInstanceId } = msg.payload;
      try {
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        await tazcloudDestroyVm(tazToken, failedVmId, (step) => {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: failedProjectId, instanceId: failedInstanceId, message: step } });
        });
        if (failedProjectId && failedInstanceId) {
          try { await projectService.removeVpsInstance(failedProjectId, failedInstanceId); } catch { /* not-found is fine */ }
          await broadcastProjectList();
        }
        send(ws, { type: "tazcloud:destroy-failed-vm:done", payload: { vmId: failedVmId } });
      } catch (err: unknown) {
        send(ws, { type: "tazcloud:destroy-failed-vm:error", payload: { vmId: failedVmId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:list": {
      const tazToken = process.env.TAZCLOUD_API_TOKEN;
      if (!tazToken) {
        send(ws, { type: "admin:tazcloud:list", payload: { vms: [], error: "TAZCLOUD_API_TOKEN not configured on the manager." } });
        return true;
      }
      try {
        const tazClient = createTazClient(tazToken);
        const vms = await tazClient.listVms();
        const aliasMap = await cloudVmAliases.getAliasMap("tazcloud", vms.map((v) => v.id));
        const decoratedVms = vms.map((v) => aliasMap.has(v.id) ? { ...v, name: aliasMap.get(v.id)! } : v);
        const projects = await projectService.getAll();
        const projectMap: Record<string, { projectId: string; projectName: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.tazcloud?.vmId) {
              projectMap[v.tazcloud.vmId] = { projectId: p.id, projectName: p.name };
            }
          }
        }
        send(ws, { type: "admin:tazcloud:list", payload: { vms: decoratedVms, projectMap } });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:list", payload: { vms: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:stats": {
      if (!sshStatsProbeEnabled()) {
        send(ws, { type: "admin:tazcloud:stats", payload: { stats: {}, errors: {} } });
        return true;
      }
      const reply = (payload: { stats: Record<string, unknown>; errors: Record<string, string> }) => {
        send(ws, { type: "admin:tazcloud:stats", payload });
      };
      if (tazcloudStatsInflight) {
        void tazcloudStatsInflight.then(reply).catch(() => {
          reply({ stats: {}, errors: {} });
        });
        return true;
      }
      tazcloudStatsInflight = (async () => {
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
        if (!tazToken || !tazPrivateKey) {
          return { stats: {}, errors: {} };
        }
        const tazClient = createTazClient(tazToken);
        const vms = await tazClient.listVms();
        const keyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
        const projects = await projectService.getAll();
        const linked = new Set<string>();
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.tazcloud?.vmId) linked.add(v.tazcloud.vmId);
          }
        }
        const results: Record<string, unknown> = {};
        const errors: Record<string, string> = {};
        const targets = vms.filter((vm) => vm.status === "ACTIVE" && vm.ssh_host);
        const POOL = 4;
        let cursor = 0;
        const probe = async (): Promise<void> => {
          while (cursor < targets.length) {
            const vm = targets[cursor++];
            try {
              const username = linked.has(vm.id) || !vm.ipv6
                ? VPS_SSH_USERNAME
                : sshUserForImage(vm.image || "ubuntu-22");
              const stats = await vpsStats({
                host: vm.ssh_host,
                port: 22,
                username,
                privateKeyPath: keyPath,
              });
              results[vm.id] = stats;
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              errors[vm.id] = message;
              console.error(`[tazcloud:stats] probe failed for VM ${vm.id} (${vm.ssh_host}): ${message}`);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(POOL, targets.length) }, () => probe()));
        return { stats: results, errors };
      })().finally(() => {
        tazcloudStatsInflight = null;
      });
      try {
        reply(await tazcloudStatsInflight);
      } catch (err: unknown) {
        console.error(`[tazcloud:stats] handler failed: ${err instanceof Error ? err.message : String(err)}`);
        reply({ stats: {}, errors: {} });
      }
      return true;
    }

    case "admin:server:tunnel:ensure": {
      const payload = msg.payload as {
        provider?: "tazcloud" | "do" | "ssh";
        vmId?: string;
        host?: string;
        sshUser?: string;
        projectId?: string;
        instanceId?: string;
        dropletId?: number;
      };
      try {
        let sshConfig: SshConnectionConfig;
        if (payload.projectId && payload.instanceId) {
          if (!(await projectService.userCanSeeProject(userId, payload.projectId))) {
            throw new Error("Not authorized for this project");
          }
          sshConfig = await getVpsConnection(payload.projectId, payload.instanceId);
        } else if (payload.provider === "do" && payload.dropletId != null) {
          if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { dropletId: payload.dropletId }))) {
            throw new Error("Not authorized for this server");
          }
          const projects = await projectService.getAll();
          let conn: SshConnectionConfig | undefined;
          for (const p of projects) {
            for (const v of p.vpsInstances) {
              if (v.digitalocean?.dropletId === payload.dropletId && v.connection?.host) {
                conn = v.connection;
                break;
              }
            }
            if (conn) break;
          }
          if (!conn) throw new Error("Droplet not linked in Genie");
          sshConfig = { ...conn, username: payload.sshUser || "genie" };
        } else {
          const vmId = payload.vmId;
          if (!vmId) throw new Error("vmId required");
          if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { vmId }))) {
            throw new Error("Not authorized for this server");
          }
          const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
          if (!tazPrivateKey) throw new Error("TAZCLOUD_SSH_PRIVATE_KEY not configured on the manager");
          let host = payload.host;
          if (!host) {
            const tazToken = process.env.TAZCLOUD_API_TOKEN;
            if (tazToken) {
              const tazClient = createTazClient(tazToken);
              const vm = await tazClient.getVm(vmId);
              host = vm?.ssh_host;
            }
          }
          if (!host) throw new Error(`VM ${vmId} has no ssh_host`);
          sshConfig = {
            host,
            port: 22,
            username: payload.sshUser || "genie",
            privateKeyPath: ensureTazcloudKeyOnDisk(tazPrivateKey),
          };
        }
        await ensureServerTunnel(sshConfig);
        send(ws, {
          type: "admin:server:tunnel:ready",
          payload: {
            reqId: (payload as { reqId?: string }).reqId,
            key: serverTunnelKey(sshConfig),
            host: sshConfig.host,
            username: sshConfig.username,
          },
        });
      } catch (err: unknown) {
        send(ws, {
          type: "admin:server:tunnel:error",
          payload: {
            reqId: (payload as { reqId?: string }).reqId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return true;
    }

    case "admin:server:tunnel:release": {
      const payload = msg.payload as {
        provider?: "tazcloud" | "do" | "ssh";
        vmId?: string;
        host?: string;
        sshUser?: string;
        projectId?: string;
        instanceId?: string;
        dropletId?: number;
      };
      try {
        if (payload.projectId && payload.instanceId) {
          releaseServerTunnel(await getVpsConnection(payload.projectId, payload.instanceId));
        } else if (payload.provider === "do" && payload.dropletId != null) {
          const projects = await projectService.getAll();
          for (const p of projects) {
            for (const v of p.vpsInstances) {
              if (v.digitalocean?.dropletId === payload.dropletId && v.connection?.host) {
                releaseServerTunnel({ ...v.connection, username: payload.sshUser || "genie" });
                break;
              }
            }
          }
        } else if (payload.vmId && payload.host) {
          const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
          if (tazPrivateKey) {
            releaseServerTunnel({
              host: payload.host,
              port: 22,
              username: payload.sshUser || "genie",
              privateKeyPath: ensureTazcloudKeyOnDisk(tazPrivateKey),
            });
          }
        }
      } catch {
        /* best-effort release */
      }
      return true;
    }

    case "admin:tazcloud:exec": {
      const { vmId, sshUser, host: hostFromClient, command, execId } = msg.payload as {
        vmId: string; sshUser: string; host?: string; command: string; execId: string;
      };
      if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { vmId }))) {
        send(ws, { type: "admin:tazcloud:exec:result", payload: { execId, output: "Not authorized for this server", error: true } });
        return true;
      }
      try {
        const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
        if (!tazPrivateKey) throw new Error("TAZCLOUD_SSH_PRIVATE_KEY not configured on the manager");
        let host = hostFromClient;
        if (!host) {
          const tazToken = process.env.TAZCLOUD_API_TOKEN;
          if (tazToken) {
            const tazClient = createTazClient(tazToken);
            const vm = await tazClient.getVm(vmId);
            host = vm?.ssh_host;
          }
        }
        if (!host) throw new Error(`VM ${vmId} has no ssh_host`);
        const keyPath = ensureTazcloudKeyOnDisk(tazPrivateKey);
        const sshConfig: SshConnectionConfig = {
          host,
          port: 22,
          username: sshUser || "ubuntu",
          privateKeyPath: keyPath,
        };
        dbgSsh("ws-server.ts:admin:tazcloud:exec", "exec start", "H5", {
          execId,
          host,
          username: sshConfig.username,
          cmdLen: command.length,
          activeSsh: getActiveSshConnections(),
        });
        activeExecTargets.set(execId, sshConfig);
        const shQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
        try {
          await ensureServerTunnel(sshConfig);
          const output = await execCached(sshConfig, `bash -c ${shQuote(`${command} 2>&1`)}`, (chunk) => {
            send(ws, { type: "admin:tazcloud:exec:progress", payload: { execId, chunk } });
          }, { timeoutMs: 900_000, idleTimeoutMs: 600_000 });
          send(ws, { type: "admin:tazcloud:exec:result", payload: { execId, output } });
        } finally { activeExecTargets.delete(execId); }
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      return true;
    }

    case "admin:tazcloud:rename": {
      try {
        const { vmId, name } = msg.payload as { vmId: string; name: string };
        if (!vmId || typeof vmId !== "string") throw new Error("vmId is required");
        if (!name || typeof name !== "string") throw new Error("name is required");
        await cloudVmAliases.setAlias("tazcloud", vmId, name);
        send(ws, { type: "admin:tazcloud:renamed", payload: { vmId, name } });
        broadcast({ type: "admin:tazcloud:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:create": {
      try {
        const { name, image, size, snapshot_id, project_id } = msg.payload as {
          name: string; image?: string; size?: string; snapshot_id?: string; project_id?: string;
        };
        if (!name || typeof name !== "string") throw new Error("name is required");
        if (image && snapshot_id) throw new Error("`image` and `snapshot_id` are mutually exclusive");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        const tazPrivateKey = process.env.TAZCLOUD_SSH_PRIVATE_KEY;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        const vm = await tazClient.createVm({ name, image, size, snapshot_id, project_id });
        send(ws, { type: "admin:tazcloud:created", payload: { vm } });
        applyTazcloudFirewallPreset(vm, tazPrivateKey, "tazcloud");
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:create:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:delete": {
      try {
        const { vmId } = msg.payload;
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        await tazClient.deleteVm(vmId);
        await cleanupTazcloudVmReferences(vmId, broadcastProjectList);
        send(ws, { type: "admin:tazcloud:deleted", payload: { vmId } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:capabilities": {
      try {
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) {
          send(ws, { type: "admin:tazcloud:capabilities", payload: { images: [], sizes: [], error: "TAZCLOUD_API_TOKEN not configured" } });
          return true;
        }
        const caps = await createTazClient(tazToken).getCapabilities();
        send(ws, { type: "admin:tazcloud:capabilities", payload: { images: caps.images ?? [], sizes: caps.sizes ?? [] } });
      } catch (err: unknown) {
        send(ws, {
          type: "admin:tazcloud:capabilities",
          payload: { images: [], sizes: [], error: err instanceof Error ? err.message : String(err) },
        });
      }
      return true;
    }

    case "admin:tazcloud:snapshot:list": {
      try {
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) {
          send(ws, { type: "admin:tazcloud:snapshot:list", payload: { snapshots: [], error: "TAZCLOUD_API_TOKEN not configured" } });
          return true;
        }
        const tazClient = createTazClient(tazToken);
        const snapshots = await tazClient.listSnapshots();
        send(ws, { type: "admin:tazcloud:snapshot:list", payload: { snapshots } });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:snapshot:list", payload: { snapshots: [], error: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    case "admin:tazcloud:snapshot:create": {
      try {
        const { vmId, name, stopFirst } = msg.payload as { vmId: string; name: string; stopFirst?: boolean };
        if (!vmId || !name) throw new Error("vmId and name are required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        const snapshot = await tazClient.createSnapshot(vmId, { name, stop_first: stopFirst });
        send(ws, { type: "admin:tazcloud:snapshot:created", payload: { snapshot } });
        broadcast({ type: "admin:tazcloud:snapshot:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:snapshot:error", payload: { message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    case "admin:tazcloud:snapshot:delete": {
      try {
        const { snapshotId } = msg.payload as { snapshotId: string };
        if (!snapshotId) throw new Error("snapshotId is required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        await tazClient.deleteSnapshot(snapshotId);
        send(ws, { type: "admin:tazcloud:snapshot:deleted", payload: { snapshotId } });
        broadcast({ type: "admin:tazcloud:snapshot:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:snapshot:error", payload: { message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    case "admin:tazcloud:ingress:register": {
      try {
        const { vmId, domain, appPort } = msg.payload as {
          vmId: string; domain: string; appPort?: number;
        };
        if (!vmId || typeof vmId !== "string") throw new Error("vmId is required");
        if (!domain || typeof domain !== "string") throw new Error("domain is required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);

        try {
          await tazClient.getVm(vmId);
        } catch (probeErr: unknown) {
          const m = probeErr instanceof Error ? probeErr.message : String(probeErr);
          throw new Error(`VM ${vmId} is not visible to this TazCloud token (${m}). Re-check TAZCLOUD_API_TOKEN or refresh the VM list.`);
        }

        const ingress = await tazClient.registerIngress(vmId, {
          domain: domain.trim(),
          app_port: appPort,
        });
        send(ws, { type: "admin:tazcloud:ingress:registered", payload: { vmId, ingress } });
        broadcast({ type: "admin:tazcloud:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, {
          type: "admin:tazcloud:ingress:error",
          payload: {
            vmId: (msg.payload as { vmId?: string })?.vmId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return true;
    }

    case "admin:tazcloud:ingress:remove": {
      try {
        const { vmId } = msg.payload as { vmId: string };
        if (!vmId || typeof vmId !== "string") throw new Error("vmId is required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        await tazClient.removeIngress(vmId);
        send(ws, { type: "admin:tazcloud:ingress:removed", payload: { vmId } });
        broadcast({ type: "admin:tazcloud:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, {
          type: "admin:tazcloud:ingress:error",
          payload: {
            vmId: (msg.payload as { vmId?: string })?.vmId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return true;
    }

    case "admin:tazcloud:project:list": {
      const tazToken = process.env.TAZCLOUD_API_TOKEN;
      if (!tazToken) {
        send(ws, { type: "admin:tazcloud:project:list", payload: { projects: [], error: "TAZCLOUD_API_TOKEN not configured on the manager." } });
        return true;
      }
      try {
        const tazClient = createTazClient(tazToken);
        const projects = await tazClient.listProjects();
        send(ws, { type: "admin:tazcloud:project:list", payload: { projects } });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:project:list", payload: { projects: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:project:create": {
      try {
        const { name } = msg.payload as { name: string };
        if (!name || typeof name !== "string") throw new Error("name is required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        const project = await tazClient.createProject({ name: name.trim() });
        send(ws, { type: "admin:tazcloud:project:created", payload: { project } });
        broadcast({ type: "admin:tazcloud:project:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:project:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:tazcloud:project:delete": {
      try {
        const { projectId } = msg.payload as { projectId: string };
        if (!projectId || typeof projectId !== "string") throw new Error("projectId is required");
        const tazToken = process.env.TAZCLOUD_API_TOKEN;
        if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
        const tazClient = createTazClient(tazToken);
        await tazClient.deleteProject(projectId);
        send(ws, { type: "admin:tazcloud:project:deleted", payload: { projectId } });
        broadcast({ type: "admin:tazcloud:project:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:tazcloud:project:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
