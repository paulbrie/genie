import { type WebSocket } from "ws";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { WsMessage, VpsConnectionConfig } from "../types.js";
import { VPS_SSH_USERNAME } from "../types.js";
import type { Role } from "../ws-acl.js";
import { isPrivilegedRole } from "../ws-acl.js";
import * as projectService from "../project-service.js";
import * as settingsService from "../settings-service.js";
import * as cloudVmAliases from "../cloud-vm-alias-service.js";
import * as cloudVmLocks from "../cloud-vm-lock-service.js";
import * as orgService from "../org-service.js";
import { createHetznerClient, getServerPublicIp } from "../vps/hetzner-api-client.js";
import { hetznerProvisionAndDeploy, hetznerDestroyServer } from "../vps/hetzner-provision.js";
import { ensureGenieKeyOnDisk, ensureGenieKeyPair, sshKeyFingerprint } from "../vps/do-provision.js";
import { connectSsh, pickWorkingSshUser, type SshConnectionConfig } from "../vps/ssh-client.js";
import { vpsStatus, vpsStats, remoteDir } from "../vps/deploy-service.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { sshStatsProbeEnabled } from "../vps/ssh-stats-disabled.js";
import { getDb } from "../db/index.js";
import { deployLogs } from "../db/schema.js";
import { activeExecTargets, broadcastProjectList } from "../ws-server.js";

/** Resolved SSH user cache for admin exec, keyed by server IP. Mirrors the
 *  droplet cache in ws-server but kept local so the two providers don't collide. */
const hetznerExecUserCache = new Map<string, { username: string; resolvedAt: number }>();
const HETZNER_EXEC_USER_TTL_MS = 5 * 60_000;

/** Track active Hetzner deploy AbortControllers by projectId. */
const activeHetznerAbortControllers = new Map<string, AbortController>();

/** Handle every `hetzner:*` and `admin:hetzner:*` message. Returns true if handled. */
export async function handleHetznerMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  role: Role | null,
  broadcast: (message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "hetzner:validate-token": {
      const token = await settingsService.getGlobalHetznerToken();
      if (!token) {
        send(ws, { type: "hetzner:token-valid", payload: { valid: false } });
        return true;
      }
      try {
        const client = createHetznerClient(token);
        await client.verifyToken();
        send(ws, { type: "hetzner:token-valid", payload: { valid: true } });
      } catch {
        send(ws, { type: "hetzner:token-valid", payload: { valid: false } });
      }
      return true;
    }

    case "hetzner:deploy": {
      const { projectId: hzProjectId, instanceId: hzInstanceId, label: hzLabel,
        region: hzRegionOverride, size: hzSizeOverride, image: hzImageOverride } = msg.payload;
      const hzProject = await projectService.getById(hzProjectId);
      if (!hzProject) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: hzProjectId, message: "Project not found" } });
        return true;
      }
      // Any user may deploy to a project they can access; privileged roles to any.
      if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, hzProjectId))) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: hzProjectId, message: "Not authorized to deploy to this project" } });
        return true;
      }
      const hzLocation = hzRegionOverride || hzProject.vpsRegion || undefined;
      const hzServerType = hzSizeOverride || hzProject.vpsSize || undefined;
      const hzImage = hzImageOverride || hzProject.vpsImage || undefined;
      const hzToken = await settingsService.resolveHetznerToken(hzProjectId);
      if (!hzToken) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: hzProjectId, message: "Hetzner API token not configured. Add it in Settings." } });
        return true;
      }

      if (!hzProject.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie.\n`;
        const updatedFiles = { ...(hzProject.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(hzProjectId, { setupFiles: updatedFiles });
        hzProject.setupFiles = updatedFiles;
      }

      const newHzInstanceId = hzInstanceId || uuidv4();
      const abortController = new AbortController();
      activeHetznerAbortControllers.set(hzProjectId, abortController);

      const hzDb = getDb();
      const [hzLogRow] = await hzDb.insert(deployLogs).values({ projectId: hzProjectId }).returning({ id: deployLogs.id });
      const hzDeployLogId = hzLogRow.id;
      const hzProgressAcc: string[] = [];

      const hzFirstMsg = `Starting Hetzner auto-provision for "${hzProject.name}" (type: ${hzServerType || "cpx22"}, location: ${hzLocation || "nbg1"})...`;
      hzProgressAcc.push(hzFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId: hzProjectId, instanceId: newHzInstanceId, message: hzFirstMsg } });

      const gitlabKey = await settingsService.resolveGitlabDeployKey(hzProjectId);

      void hetznerProvisionAndDeploy(
        {
          token: hzToken,
          projectName: hzProject.name,
          location: hzLocation,
          serverType: hzServerType,
          image: hzImage,
          signal: abortController.signal,
          gitlabDeployKey: gitlabKey || undefined,
          envVars: hzProject.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>),
          setupFiles: hzProject.setupFiles,
        },
        (step) => {
          hzProgressAcc.push(step);
          send(ws, { type: "vps:deploy:progress", payload: { projectId: hzProjectId, instanceId: newHzInstanceId, message: step } });
        },
      ).then(async (result) => {
        activeHetznerAbortControllers.delete(hzProjectId);
        const connection: VpsConnectionConfig = {
          host: result.ipAddress,
          port: 22,
          username: VPS_SSH_USERNAME,
          privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
        };
        const instance: import("../types.js").VpsInstance = {
          id: newHzInstanceId,
          label: hzLabel || "production",
          connection,
          services: [],
          hetzner: {
            serverId: result.serverId,
            ipAddress: result.ipAddress,
            location: result.location,
            serverType: result.serverType,
          },
        };
        // Record the public IP in CLAUDE.md so browser/MCP tools target the VM,
        // never localhost (matches the DigitalOcean path).
        try {
          const sshTmp = await connectSsh(connection, { timeoutMs: 15_000 });
          const claudeMdPath = `${remoteDir(hzProject.name)}/CLAUDE.md`;
          const serverBlock = [
            `Server public IP: ${result.ipAddress}`,
            ``,
            `## Browser & MCP Tools`,
            `This server runs in the cloud at ${result.ipAddress}. When using browser tools:`,
            `- The app is accessible at http://${result.ipAddress}:3000 (or whichever port). NEVER use localhost or 127.0.0.1 URLs.`,
            `- genie-browser: Always use the public IP (http://${result.ipAddress}:PORT) for navigation. Never pass localhost URLs.`,
            `- chrome-devtools: Runs Puppeteer on the VPS with no display server — always use headless mode. Navigate to http://${result.ipAddress}:PORT, never localhost.`,
          ].join('\\n');
          const script = `node -e "
            const fs = require('fs');
            const p = '${claudeMdPath}';
            let c = '';
            try { c = fs.readFileSync(p, 'utf8'); } catch {}
            if (c.includes('Server public IP:')) {
              c = c.replace(/Server public IP:[\\\\s\\\\S]*?(?=\\n##[^#]|\\n\\n[^#\\\\s]|$)/, '${serverBlock}');
            } else {
              const i = c.indexOf('\\n');
              c = i >= 0 ? c.slice(0, i + 1) + '\\n${serverBlock}\\n' + c.slice(i + 1) : '${serverBlock}\\n' + c;
            }
            fs.writeFileSync(p, c);
          "`;
          await sshTmp.exec(script, undefined, { timeoutMs: 10_000 });
          sshTmp.close();
        } catch {}
        try {
          instance.services = await vpsStatus(hzProject.name, connection);
        } catch { /* keep empty services */ }
        const existing = hzProject.vpsInstances.find(v => v.id === newHzInstanceId);
        if (existing) {
          await projectService.updateVpsInstance(hzProjectId, newHzInstanceId, instance);
        } else {
          await projectService.addVpsInstance(hzProjectId, instance);
        }
        await broadcastProjectList();
        broadcast({ type: "admin:hetzner:list:stale", payload: {} });
        await hzDb.update(deployLogs).set({ status: "success", progress: hzProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, hzDeployLogId));
        send(ws, { type: "vps:deploy:done", payload: { projectId: hzProjectId, instanceId: newHzInstanceId, services: instance.services, deployLogId: hzDeployLogId } });
      }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        activeHetznerAbortControllers.delete(hzProjectId);
        await hzDb.update(deployLogs).set({ status: "error", progress: hzProgressAcc, error: message, endedAt: new Date() }).where(eq(deployLogs.id, hzDeployLogId));
        const failedServerId = (err as Error & { serverId?: number }).serverId;
        const failedServerIp = (err as Error & { serverIp?: string }).serverIp;
        if (failedServerId) {
          const failedInstance: import("../types.js").VpsInstance = {
            id: newHzInstanceId,
            label: hzLabel || "production",
            connection: {
              host: failedServerIp || "unknown",
              port: 22,
              username: VPS_SSH_USERNAME,
              privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
            },
            services: [],
            hetzner: {
              serverId: failedServerId,
              ipAddress: failedServerIp || "unknown",
              location: hzLocation || "unknown",
              serverType: hzServerType || "unknown",
            },
            deployFailed: true,
            deployError: message,
          };
          await projectService.addVpsInstance(hzProjectId, failedInstance);
          await broadcastProjectList();
        }
        send(ws, {
          type: "vps:deploy:error",
          payload: {
            projectId: hzProjectId,
            instanceId: newHzInstanceId,
            message,
            deployLogId: hzDeployLogId,
            ...(failedServerId ? { failedServer: { serverId: failedServerId, ipAddress: failedServerIp, provider: "hetzner" } } : {}),
          },
        });
      });
      return true;
    }

    case "hetzner:cancel": {
      const { projectId: cancelProjectId } = msg.payload;
      const controller = activeHetznerAbortControllers.get(cancelProjectId);
      if (controller) {
        controller.abort();
        activeHetznerAbortControllers.delete(cancelProjectId);
        send(ws, { type: "vps:deploy:progress", payload: { projectId: cancelProjectId, message: "Cancelling Hetzner deployment..." } });
      }
      return true;
    }

    case "hetzner:destroy-failed-server": {
      const { serverId: failedServerId, projectId: failedProjectId, instanceId: failedInstanceId } = msg.payload;
      try {
        const token = await settingsService.getGlobalHetznerToken();
        if (!token) throw new Error("Hetzner API token not configured");
        await hetznerDestroyServer(token, failedServerId, (step) => {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: failedProjectId, instanceId: failedInstanceId, message: step } });
        });
        if (failedProjectId && failedInstanceId) {
          try { await projectService.removeVpsInstance(failedProjectId, failedInstanceId); } catch { /* not-found is fine */ }
          await broadcastProjectList();
        }
        send(ws, { type: "hetzner:destroy-failed-server:done", payload: { serverId: failedServerId } });
      } catch (err: unknown) {
        send(ws, { type: "hetzner:destroy-failed-server:error", payload: { serverId: failedServerId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    // ── Admin Clouds panel: admin:hetzner:* ──────────────────────────────────

    case "admin:hetzner:list": {
      const token = await settingsService.getGlobalHetznerToken();
      if (!token) {
        send(ws, { type: "admin:hetzner:list", payload: { servers: [], error: "Hetzner API token not configured. Configure it in Settings." } });
        return true;
      }
      try {
        const client = createHetznerClient(token);
        const servers = await client.listServers("genie");
        // Privileged roles see every server; org owners / plain users see only
        // servers attached to a project they can access (see admin:droplets:list).
        const privileged = isPrivilegedRole(role);
        const scopeProjects = privileged ? await projectService.getAll() : await projectService.getAllForUser(userId);
        const projectMap: Record<number, { projectId: string; projectName: string }> = {};
        const accessibleIds = new Set<number>();
        for (const p of scopeProjects) {
          for (const v of p.vpsInstances) {
            if (v.hetzner?.serverId) {
              projectMap[v.hetzner.serverId] = { projectId: p.id, projectName: p.name };
              accessibleIds.add(v.hetzner.serverId);
            }
          }
        }
        const visibleServers = privileged ? servers : servers.filter((s) => accessibleIds.has(s.id));
        const ids = visibleServers.map((s) => String(s.id));
        const aliasMap = await cloudVmAliases.getAliasMap("hetzner", ids);
        const lockedSet = await cloudVmLocks.getLockedSet("hetzner", ids);
        // Normalize to the shape the renderer expects — the panel never sees the raw Hetzner API.
        const decorated = visibleServers.map((s) => ({
          id: s.id,
          name: aliasMap.get(String(s.id)) || s.name,
          status: s.status === "running" ? "active" : s.status,
          ip: getServerPublicIp(s),
          region: s.datacenter?.location?.name || "",
          size: s.server_type?.name || "",
          vcpus: s.server_type?.cores || 0,
          memoryMb: s.server_type?.memory ? Math.round(s.server_type.memory * 1024) : 0,
          diskGb: s.server_type?.disk || 0,
          createdAt: s.created || null,
          locked: lockedSet.has(String(s.id)),
        }));
        send(ws, { type: "admin:hetzner:list", payload: { servers: decorated, projectMap } });
      } catch (err: unknown) {
        send(ws, { type: "admin:hetzner:list", payload: { servers: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:create": {
      try {
        // Deploy is open to org owners/admins too (not just tazcloud+); re-check here.
        if (!isPrivilegedRole(role) && (await orgService.manageableOrgIds(userId)).length === 0) {
          throw new Error("Only admins and org owners can deploy servers");
        }
        const { name, region, size, image } = msg.payload as {
          name: string; region: string; size: string; image: string;
        };
        if (!name || typeof name !== "string") throw new Error("name is required");
        if (!region) throw new Error("location is required");
        if (!size) throw new Error("server type is required");
        if (!image) throw new Error("image is required");
        const token = await settingsService.getGlobalHetznerToken();
        if (!token) throw new Error("Hetzner API token not configured");
        const client = createHetznerClient(token);
        const keyPair = await ensureGenieKeyPair();
        const fingerprint = sshKeyFingerprint(keyPair.publicKey);
        const existingKeys = await client.listSshKeys();
        let sshKeyId = existingKeys.find((k) => k.fingerprint === fingerprint)?.id;
        if (!sshKeyId) {
          const newKey = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey.trim());
          sshKeyId = newKey.id;
        }
        const server = await client.createServer({
          name, serverType: size, image, location: region,
          sshKeyIds: [sshKeyId],
          labels: { genie: "true" },
        });
        send(ws, { type: "admin:hetzner:created", payload: { server } });
        broadcast({ type: "admin:hetzner:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:hetzner:create:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:delete": {
      try {
        const { serverId } = msg.payload as { serverId: number };
        const token = await settingsService.getGlobalHetznerToken();
        if (!token) throw new Error("Hetzner API token not configured");
        if (await cloudVmLocks.isLocked("hetzner", String(serverId)) && !isPrivilegedRole(role)) {
          throw new Error("Server is locked — only a superadmin can delete it");
        }
        const client = createHetznerClient(token);
        await client.deleteServer(serverId);
        await cloudVmAliases.clearAlias("hetzner", String(serverId));
        await cloudVmLocks.clearLock("hetzner", String(serverId));
        const projects = await projectService.getAll();
        for (const p of projects) {
          const inst = p.vpsInstances.find(v => v.hetzner?.serverId === serverId);
          if (inst) {
            await projectService.removeVpsInstance(p.id, inst.id);
            await broadcastProjectList();
            break;
          }
        }
        send(ws, { type: "admin:hetzner:deleted", payload: { serverId } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:rename": {
      try {
        const { serverId, name } = msg.payload as { serverId: number; name: string };
        if (!name || typeof name !== "string") throw new Error("name is required");
        await cloudVmAliases.setAlias("hetzner", String(serverId), name);
        try {
          const token = await settingsService.getGlobalHetznerToken();
          if (token) {
            // Hetzner only accepts valid hostnames; sanitize and best-effort it.
            const apiName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
            if (apiName) await createHetznerClient(token).renameServer(serverId, apiName);
          }
        } catch (apiErr) {
          console.warn(`[hetzner:rename] API rename failed for ${serverId} (alias still saved):`, apiErr instanceof Error ? apiErr.message : apiErr);
        }
        send(ws, { type: "admin:hetzner:renamed", payload: { serverId, name } });
        broadcast({ type: "admin:hetzner:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:lock": {
      try {
        const { serverId } = msg.payload as { serverId: number };
        await cloudVmLocks.setLock("hetzner", String(serverId), userId || null);
        send(ws, { type: "admin:hetzner:locked", payload: { serverId, locked: true } });
        broadcast({ type: "admin:hetzner:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:unlock": {
      try {
        const { serverId } = msg.payload as { serverId: number };
        await cloudVmLocks.clearLock("hetzner", String(serverId));
        send(ws, { type: "admin:hetzner:locked", payload: { serverId, locked: false } });
        broadcast({ type: "admin:hetzner:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:reboot": {
      const { serverId } = msg.payload as { serverId: number };
      try {
        if (!serverId || typeof serverId !== "number") throw new Error("serverId is required");
        const token = await settingsService.getGlobalHetznerToken();
        if (!token) throw new Error("Hetzner API token not configured");
        const client = createHetznerClient(token);
        const progress = (m: string) =>
          send(ws, { type: "admin:hetzner:reboot:progress", payload: { serverId, message: m } });
        void (async () => {
          try {
            progress("Issuing reboot to Hetzner…");
            const action = await client.serverAction(serverId, "reboot");
            const maxWait = 3 * 60_000;
            const interval = 4_000;
            const start = Date.now();
            let completed = false;
            while (Date.now() - start < maxWait) {
              await new Promise((r) => setTimeout(r, interval));
              const status = await client.getAction(action.id);
              const elapsed = Math.round((Date.now() - start) / 1000);
              progress(`Reboot in progress… (${elapsed}s)`);
              if (status.status === "success") { completed = true; break; }
              if (status.status === "error") throw new Error("Reboot action errored at Hetzner");
            }
            if (!completed) throw new Error("Reboot timed out after 3 minutes");
            progress("Server rebooted.");
            send(ws, { type: "admin:hetzner:reboot:done", payload: { serverId } });
          } catch (err: unknown) {
            send(ws, { type: "admin:hetzner:reboot:error", payload: { serverId, message: err instanceof Error ? err.message : String(err) } });
          }
        })();
      } catch (err: unknown) {
        send(ws, { type: "admin:hetzner:reboot:error", payload: { serverId, message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    case "admin:hetzner:resolve-ssh-user": {
      const { serverId, reqId } = msg.payload as { serverId: number; reqId?: string };
      try {
        if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { serverId }))) {
          throw new Error("Not authorized for this server");
        }
        const token = await settingsService.getGlobalHetznerToken();
        if (!token) throw new Error("Hetzner API token not configured");
        const client = createHetznerClient(token);
        const server = await client.getServer(serverId);
        const ip = getServerPublicIp(server);
        if (!ip) throw new Error(`Server ${serverId} has no public IPv4 yet`);
        const keyPath = await ensureGenieKeyOnDisk();
        const username = await pickWorkingSshUser(
          { host: ip, port: 22, privateKeyPath: keyPath },
          [VPS_SSH_USERNAME, "root"],
        );
        send(ws, { type: "admin:hetzner:resolve-ssh-user", payload: { reqId, serverId, ip, username } });
      } catch (err: unknown) {
        send(ws, { type: "admin:hetzner:resolve-ssh-user", payload: { reqId, serverId, ip: null, username: null, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:hetzner:exec": {
      const { serverId, command, execId } = msg.payload as {
        serverId: number; command: string; execId: string;
      };
      if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { serverId }))) {
        send(ws, { type: "admin:hetzner:exec:result", payload: { execId, output: "Not authorized for this server", error: true } });
        return true;
      }
      try {
        const token = await settingsService.getGlobalHetznerToken();
        if (!token) throw new Error("Hetzner API token not configured");
        const client = createHetznerClient(token);
        const server = await client.getServer(serverId);
        const ip = getServerPublicIp(server);
        if (!ip) throw new Error(`Server ${serverId} has no public IPv4`);
        const keyPath = await ensureGenieKeyOnDisk();
        const cached = hetznerExecUserCache.get(ip);
        const cachedValid = !!cached && (Date.now() - cached.resolvedAt) < HETZNER_EXEC_USER_TTL_MS;
        const sshUser = cachedValid && cached
          ? cached.username
          : await pickWorkingSshUser({ host: ip, port: 22, privateKeyPath: keyPath }, [VPS_SSH_USERNAME, "root"]);
        if (!sshUser) throw new Error(`Cannot SSH into server ${ip} as '${VPS_SSH_USERNAME}' or 'root' with the Genie key`);
        if (!cachedValid) hetznerExecUserCache.set(ip, { username: sshUser, resolvedAt: Date.now() });
        const sshConfig: SshConnectionConfig = { host: ip, port: 22, username: sshUser, privateKeyPath: keyPath };
        activeExecTargets.set(execId, sshConfig);
        const shQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
        try {
          const output = await execCached(sshConfig, `bash -c ${shQuote(`${command} 2>&1`)}`, (chunk) => {
            send(ws, { type: "admin:hetzner:exec:progress", payload: { execId, chunk } });
          }, { timeoutMs: 900_000, idleTimeoutMs: 600_000 });
          send(ws, { type: "admin:hetzner:exec:result", payload: { execId, output } });
        } finally { activeExecTargets.delete(execId); }
      } catch (err: unknown) {
        send(ws, { type: "admin:hetzner:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      return true;
    }

    case "admin:hetzner:stats": {
      if (!sshStatsProbeEnabled()) {
        send(ws, { type: "admin:hetzner:stats", payload: { stats: {} } });
        return true;
      }
      try {
        const projects = isPrivilegedRole(role) ? await projectService.getAll() : await projectService.getAllForUser(userId);
        const connMap: Record<number, { host: string; port: number; username: string; privateKeyPath: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.hetzner?.serverId && v.connection?.host) {
              connMap[v.hetzner.serverId] = v.connection;
            }
          }
        }
        const ids = Object.keys(connMap).map(Number);
        if (ids.length === 0) {
          send(ws, { type: "admin:hetzner:stats", payload: { stats: {} } });
          return true;
        }
        const results: Record<number, unknown> = {};
        await Promise.allSettled(
          ids.map(async (id) => {
            try { results[id] = await vpsStats(connMap[id]); } catch { /* skip unreachable */ }
          })
        );
        send(ws, { type: "admin:hetzner:stats", payload: { stats: results } });
      } catch {
        send(ws, { type: "admin:hetzner:stats", payload: { stats: {} } });
      }
      return true;
    }

    default:
      return false;
  }
}
