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
import * as analyticsService from "../analytics-service.js";
import * as cloudVmAliases from "../cloud-vm-alias-service.js";
import * as settingsService from "../settings-service.js";
import * as orgService from "../org-service.js";
import { createDoClient } from "../vps/do-api-client.js";
import { doProvisionAndDeploy, doDestroyDroplet, ensureGenieKeyOnDisk, ensureGenieKeyPair, sshKeyFingerprint } from "../vps/do-provision.js";
import { attachDoDomain, detachDoDomain, loadNamecheapConfig, assertNamecheapConfig, getDropletDomain, setDropletDomain, removeDropletDomain, getDropletDomainMap } from "../vps/do-domain.js";
import { connectSsh, pickWorkingSshUser, type SshConnectionConfig } from "../vps/ssh-client.js";
import { vpsStatus, vpsStats, remoteDir } from "../vps/deploy-service.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { resetSnapshotMcpState } from "../vps/mcp-config-merge.js";
import { sshStatsProbeEnabled } from "../vps/ssh-stats-disabled.js";
import { getDb } from "../db/index.js";
import { deployLogs } from "../db/schema.js";
import {
  activeDoAbortControllers,
  activeExecTargets,
  dropletExecUserCache,
  DROPLET_EXEC_USER_TTL_MS,
  broadcastProjectList,
} from "../ws-server.js";


/** Handle every `do:*` and `admin:droplets:*` message. Returns true if handled. */
export async function handleDoMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  role: Role | null,
  broadcast: (message: WsMessage) => void,
): Promise<boolean> {
  switch (msg.type) {
    case "do:validate-token": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "do:token-valid", payload: { valid: false } });
        return true;
      }
      try {
        const doClient = createDoClient(doToken);
        const account = await doClient.getAccount();
        send(ws, { type: "do:token-valid", payload: { valid: true, email: account.email } });
      } catch {
        send(ws, { type: "do:token-valid", payload: { valid: false } });
      }
      return true;
    }

    case "do:snapshots:list": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "do:snapshots:list", payload: { snapshots: [] } });
        return true;
      }
      try {
        const doClient = createDoClient(doToken);
        const snapshots = await doClient.listAccountSnapshots();
        send(ws, { type: "do:snapshots:list", payload: { snapshots: snapshots.map(s => ({ id: s.id, name: s.name, regions: s.regions, sizeGb: s.size_gigabytes, createdAt: s.created_at, minDiskSize: s.min_disk_size })) } });
      } catch {
        send(ws, { type: "do:snapshots:list", payload: { snapshots: [] } });
      }
      return true;
    }

    case "do:snapshot:delete": {
      const { snapshotId } = msg.payload;
      const snapDoToken = await settingsService.getGlobalDoToken();
      if (!snapDoToken) { send(ws, { type: "do:snapshot:delete:result", payload: { ok: false, error: "No DO token" } }); return true; }
      try {
        const snapClient = createDoClient(snapDoToken);
        await snapClient.deleteSnapshot(snapshotId);
        const updatedSnaps = await snapClient.listAccountSnapshots();
        send(ws, { type: "do:snapshots:list", payload: { snapshots: updatedSnaps.map(s => ({ id: s.id, name: s.name, regions: s.regions, sizeGb: s.size_gigabytes, createdAt: s.created_at, minDiskSize: s.min_disk_size })) } });
        send(ws, { type: "do:snapshot:delete:result", payload: { ok: true } });
      } catch (err: unknown) {
        send(ws, { type: "do:snapshot:delete:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "do:deploy": {
      const { projectId: doProjectId, instanceId: doInstanceId, label: doLabel,
        region: doRegionOverride, size: doSizeOverride } = msg.payload;
      const doProject = await projectService.getById(doProjectId);
      if (!doProject) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, message: "Project not found" } });
        return true;
      }
      // Provisioning a VM is an owner-level action: only project owners, org
      // owners/admins of the owning team's org, and privileged roles. Plain
      // project members can see the project but can't create servers on it.
      if (!isPrivilegedRole(role) && !(await projectService.userCanManageProject(userId, doProjectId))) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, message: "Not authorized to deploy to this project" } });
        return true;
      }
      void analyticsService.recordEvent({ userId, userName: null, event: "vps.deploy", projectId: doProjectId, props: { provider: "do" }, ip: null });
      const doRegion = doRegionOverride || doProject.vpsRegion || undefined;
      const doSize = doSizeOverride || doProject.vpsSize || undefined;
      const doToken = await settingsService.resolveDoToken(doProjectId);
      if (!doToken) {
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, message: "DigitalOcean API token not configured. Add it in Settings." } });
        return true;
      }

      let doAgentMemoryCreated = false;
      if (!doProject.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie. It stores knowledge about the project's codebase, architecture, and deployment so the agent doesn't need to rediscover things each session.\n\n## Codebase Overview\n<!-- The agent will fill this in after exploring the codebase -->\n\n## Architecture & Tech Stack\n<!-- Key technologies, frameworks, patterns -->\n\n## Important Files & Paths\n<!-- Critical files the agent has discovered -->\n\n## Deployment Notes\n<!-- Instance-specific deployment knowledge -->\n`;
        const updatedFiles = { ...(doProject.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(doProjectId, { setupFiles: updatedFiles });
        doProject.setupFiles = updatedFiles;
        doAgentMemoryCreated = true;
      }

      const newDoInstanceId = doInstanceId || uuidv4();
      const abortController = new AbortController();
      activeDoAbortControllers.set(doProjectId, abortController);

      const doDb = getDb();
      const [doLogRow] = await doDb.insert(deployLogs).values({ projectId: doProjectId }).returning({ id: deployLogs.id });
      const doDeployLogId = doLogRow.id;
      const doProgressAcc: string[] = [];

      const doTemplateName = doProject.vpsBaseImageConfigName || "default";
      const doFirstMsg = `Starting DigitalOcean auto-provision for "${doProject.name}" (template: ${doTemplateName})...`;
      doProgressAcc.push(doFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: doFirstMsg } });

      const gitlabKey = await settingsService.resolveGitlabDeployKey(doProjectId);

      void doProvisionAndDeploy(
        {
          token: doToken,
          projectName: doProject.name,
          region: doRegion,
          size: doSize,
          signal: abortController.signal,
          gitlabDeployKey: gitlabKey || undefined,
          envVars: doProject.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>),
          baseImageId: await settingsService.resolveBaseImageId(doProject),
          setupFiles: doProject.setupFiles,
        },
        (step) => {
          doProgressAcc.push(step);
          send(ws, { type: "vps:deploy:progress", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: step } });
        },
      ).then(async (result) => {
        activeDoAbortControllers.delete(doProjectId);
        const connection: VpsConnectionConfig = {
          host: result.ipAddress,
          port: 22,
          username: VPS_SSH_USERNAME,
          privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
        };
        const instance: import("../types.js").VpsInstance = {
          id: newDoInstanceId,
          label: doLabel || "production",
          connection,
          services: [],
          digitalocean: {
            dropletId: result.dropletId,
            ipAddress: result.ipAddress,
            region: result.region,
            size: result.size,
          },
        };
        try {
          const sshTmp = await connectSsh(connection, { timeoutMs: 15_000 });
          const claudeMdPath = `${remoteDir(doProject.name)}/CLAUDE.md`;
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
          instance.services = await vpsStatus(doProject.name, connection);
        } catch { /* keep empty services */ }
        const existing = doProject.vpsInstances.find(v => v.id === newDoInstanceId);
        if (existing) {
          await projectService.updateVpsInstance(doProjectId, newDoInstanceId, instance);
        } else {
          await projectService.addVpsInstance(doProjectId, instance);
        }
        // A server cloned from a base image inherits the snapshot source
        // project's .mcp.json + live Claude sessions. Reset that so genie-* MCPs
        // resolve to THIS project, not whatever the image was built from.
        await resetSnapshotMcpState((cmd) => execCached(connection, cmd), remoteDir(doProject.name), doProjectId, newDoInstanceId);
        await broadcastProjectList();
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
        await doDb.update(deployLogs).set({ status: "success", progress: doProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, doDeployLogId));
        if (doAgentMemoryCreated) {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: "Created AGENT.md — ask Genie to explore your codebase to build memory." } });
        }
        send(ws, { type: "vps:deploy:done", payload: { projectId: doProjectId, instanceId: newDoInstanceId, services: instance.services, deployLogId: doDeployLogId } });
      }).catch(async (err: unknown) => {
        activeDoAbortControllers.delete(doProjectId);
        await doDb.update(deployLogs).set({ status: "error", progress: doProgressAcc, error: (err instanceof Error ? err.message : String(err)), endedAt: new Date() }).where(eq(deployLogs.id, doDeployLogId));
        if (((err as Error & { dropletId?: number }).dropletId)) {
          const failedInstance: import("../types.js").VpsInstance = {
            id: newDoInstanceId,
            label: doLabel || "production",
            connection: {
              host: ((err as Error & { dropletIp?: string }).dropletIp) || "unknown",
              port: 22,
              username: VPS_SSH_USERNAME,
              privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
            },
            services: [],
            digitalocean: {
              dropletId: ((err as Error & { dropletId?: number }).dropletId)!,
              ipAddress: ((err as Error & { dropletIp?: string }).dropletIp) || "unknown",
              region: doRegion || "unknown",
              size: doSize || "unknown",
            },
            deployFailed: true,
            deployError: (err instanceof Error ? err.message : String(err)),
          };
          await projectService.addVpsInstance(doProjectId, failedInstance);
          await broadcastProjectList();
        }
        send(ws, { type: "vps:deploy:error", payload: { projectId: doProjectId, instanceId: newDoInstanceId, message: (err instanceof Error ? err.message : String(err)), deployLogId: doDeployLogId, ...(((err as Error & { dropletId?: number }).dropletId) ? { failedDroplet: { dropletId: ((err as Error & { dropletId?: number }).dropletId), ipAddress: ((err as Error & { dropletIp?: string }).dropletIp) } } : {}) } });
      });
      return true;
    }

    case "do:cancel": {
      const { projectId: cancelProjectId } = msg.payload;
      const controller = activeDoAbortControllers.get(cancelProjectId);
      if (controller) {
        controller.abort();
        activeDoAbortControllers.delete(cancelProjectId);
        send(ws, { type: "vps:deploy:progress", payload: { projectId: cancelProjectId, message: "Cancelling deployment..." } });
      }
      return true;
    }

    case "do:destroy-failed-droplet": {
      const { dropletId: failedDropletId, projectId: failedProjectId, instanceId: failedInstanceId } = msg.payload;
      try {
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        await doDestroyDroplet(doToken, failedDropletId, (step) => {
          send(ws, { type: "vps:deploy:progress", payload: { projectId: failedProjectId, instanceId: failedInstanceId, message: step } });
        });
        if (failedProjectId && failedInstanceId) {
          try { await projectService.removeVpsInstance(failedProjectId, failedInstanceId); } catch { /* not-found is fine */ }
          await broadcastProjectList();
        }
        send(ws, { type: "do:destroy-failed-droplet:done", payload: { dropletId: failedDropletId } });
      } catch (err: unknown) {
        send(ws, { type: "do:destroy-failed-droplet:error", payload: { dropletId: failedDropletId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:rename": {
      try {
        const { dropletId, name } = msg.payload as { dropletId: number; name: string };
        if (!name || typeof name !== "string") throw new Error("name is required");
        await cloudVmAliases.setAlias("digitalocean", String(dropletId), name);
        try {
          const doToken = await settingsService.getGlobalDoToken();
          if (doToken) {
            const doClient = createDoClient(doToken);
            await doClient.renameDroplet(dropletId, name);
          }
        } catch (apiErr) {
          console.warn(`[droplets:rename] DO API rename failed for ${dropletId} (alias still saved):`, apiErr instanceof Error ? apiErr.message : apiErr);
        }
        send(ws, { type: "admin:droplets:renamed", payload: { dropletId, name } });
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:exec": {
      const { dropletId, command, execId } = msg.payload as {
        dropletId: number; command: string; execId: string;
      };
      if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { dropletId }))) {
        send(ws, { type: "admin:droplets:exec:result", payload: { execId, output: "Not authorized for this server", error: true } });
        return true;
      }
      try {
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        const droplet = await doClient.getDroplet(dropletId);
        const pub = droplet.networks?.v4?.find((n) => n.type === "public");
        if (!pub?.ip_address) throw new Error(`Droplet ${dropletId} has no public IPv4`);
        const keyPath = await ensureGenieKeyOnDisk();
        const cacheKey = pub.ip_address;
        const cached = dropletExecUserCache.get(cacheKey);
        const cachedValid = !!cached && (Date.now() - cached.resolvedAt) < DROPLET_EXEC_USER_TTL_MS;
        const sshUser = cachedValid && cached
          ? cached.username
          : await pickWorkingSshUser(
            { host: pub.ip_address, port: 22, privateKeyPath: keyPath },
            [VPS_SSH_USERNAME, "root"],
          );
        if (!sshUser) throw new Error(`Cannot SSH into droplet ${pub.ip_address} as '${VPS_SSH_USERNAME}' or 'root' with the Genie key`);
        if (!cachedValid) {
          dropletExecUserCache.set(cacheKey, { username: sshUser, resolvedAt: Date.now() });
        }
        const sshConfig: SshConnectionConfig = {
          host: pub.ip_address,
          port: 22,
          username: sshUser,
          privateKeyPath: keyPath,
        };
        activeExecTargets.set(execId, sshConfig);
        const shQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
        try {
          const output = await execCached(sshConfig, `bash -c ${shQuote(`${command} 2>&1`)}`, (chunk) => {
            send(ws, { type: "admin:droplets:exec:progress", payload: { execId, chunk } });
          }, { timeoutMs: 900_000, idleTimeoutMs: 600_000 });
          send(ws, { type: "admin:droplets:exec:result", payload: { execId, output } });
        } finally { activeExecTargets.delete(execId); }
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      return true;
    }

    case "admin:droplets:list": {
      const doToken = await settingsService.getGlobalDoToken();
      if (!doToken) {
        send(ws, { type: "admin:droplets:list", payload: { droplets: [], error: "DigitalOcean API token not configured. Configure it in Settings." } });
        return true;
      }
      try {
        const doClient = createDoClient(doToken);
        const droplets = await doClient.listDroplets("genie");
        // Privileged roles (tazcloud/admin/superadmin) see every droplet in the
        // account. Everyone else — org owners and plain users — sees only the
        // droplets attached to a project they can access (getAllForUser already
        // resolves org-ownership, team membership and direct project membership).
        const privileged = isPrivilegedRole(role);
        const scopeProjects = privileged ? await projectService.getAll() : await projectService.getAllForUser(userId);
        const projectMap: Record<number, { projectId: string; projectName: string }> = {};
        const accessibleIds = new Set<number>();
        for (const p of scopeProjects) {
          for (const v of p.vpsInstances) {
            if (v.digitalocean?.dropletId) {
              projectMap[v.digitalocean.dropletId] = { projectId: p.id, projectName: p.name };
              accessibleIds.add(v.digitalocean.dropletId);
            }
          }
        }
        const visibleDroplets = privileged ? droplets : droplets.filter((d) => accessibleIds.has(d.id));
        const aliasMap = await cloudVmAliases.getAliasMap("digitalocean", visibleDroplets.map((d) => String(d.id)));
        const domainMap = await getDropletDomainMap();
        const decoratedDroplets = visibleDroplets.map((d) => {
          const alias = aliasMap.get(String(d.id));
          const dom = domainMap[String(d.id)];
          const base = alias ? { ...d, name: alias } : { ...d };
          if (dom) {
            (base as typeof base & { domain?: unknown }).domain = {
              fqdn: dom.fqdn,
              url: `https://${dom.fqdn}`,
              appPort: dom.appPort,
            };
          }
          return base;
        });
        send(ws, { type: "admin:droplets:list", payload: { droplets: decoratedDroplets, projectMap } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:list", payload: { droplets: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:create": {
      try {
        // Deploy is open to org owners/admins too (not just tazcloud+). The ACL
        // lets the message through at "user"; we re-check the real capability here.
        if (!isPrivilegedRole(role) && (await orgService.manageableOrgIds(userId)).length === 0) {
          throw new Error("Only admins and org owners can deploy servers");
        }
        const { name, region, size, image } = msg.payload as {
          name: string; region: string; size: string; image: string;
        };
        if (!name || typeof name !== "string") throw new Error("name is required");
        if (!region) throw new Error("region is required");
        if (!size) throw new Error("size is required");
        if (!image) throw new Error("image is required");
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const client = createDoClient(doToken);
        const keyPair = await ensureGenieKeyPair();
        const fingerprint = sshKeyFingerprint(keyPair.publicKey);
        const existingKeys = await client.listSshKeys();
        let sshKeyId = existingKeys.find((k) => k.fingerprint === fingerprint)?.id;
        if (!sshKeyId) {
          const newKey = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey);
          sshKeyId = newKey.id;
        }
        const droplet = await client.createDroplet({
          name, region, size, image,
          sshKeyIds: [sshKeyId],
          tags: ["genie"],
        });
        send(ws, { type: "admin:droplets:created", payload: { droplet } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:create:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:resolve-ssh-user": {
      const { dropletId, reqId } = msg.payload as { dropletId: number; reqId?: string };
      try {
        if (!isPrivilegedRole(role) && !(await projectService.userCanAccessVm(userId, { dropletId }))) {
          throw new Error("Not authorized for this droplet");
        }
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        const droplet = await doClient.getDroplet(dropletId);
        const pub = droplet.networks?.v4?.find((n) => n.type === "public");
        if (!pub?.ip_address) throw new Error(`Droplet ${dropletId} has no public IPv4 yet`);
        const keyPath = await ensureGenieKeyOnDisk();
        const username = await pickWorkingSshUser(
          { host: pub.ip_address, port: 22, privateKeyPath: keyPath },
          [VPS_SSH_USERNAME, "root"],
        );
        send(ws, { type: "admin:droplets:resolve-ssh-user", payload: { reqId, dropletId, ip: pub.ip_address, username } });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:resolve-ssh-user", payload: { reqId, dropletId, ip: null, username: null, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:delete": {
      try {
        const { dropletId } = msg.payload;
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        await doClient.deleteDroplet(dropletId);
        await cloudVmAliases.clearAlias("digitalocean", String(dropletId));
        const projects = await projectService.getAll();
        for (const p of projects) {
          const inst = p.vpsInstances.find(v => v.digitalocean?.dropletId === dropletId);
          if (inst) {
            await projectService.removeVpsInstance(p.id, inst.id);
            await broadcastProjectList();
            break;
          }
        }
        send(ws, { type: "admin:droplets:deleted", payload: { dropletId } });
      } catch (err: unknown) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:reboot": {
      const { dropletId } = msg.payload as { dropletId: number };
      try {
        if (!dropletId || typeof dropletId !== "number") throw new Error("dropletId is required");
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const doClient = createDoClient(doToken);
        const progress = (m: string) =>
          send(ws, { type: "admin:droplets:reboot:progress", payload: { dropletId, message: m } });
        void (async () => {
          try {
            progress("Issuing reboot to DigitalOcean…");
            const action = await doClient.dropletAction(dropletId, "reboot");
            const maxWait = 3 * 60_000;
            const interval = 4_000;
            const start = Date.now();
            let completed = false;
            while (Date.now() - start < maxWait) {
              await new Promise((r) => setTimeout(r, interval));
              const status = await doClient.getAction(action.id);
              const elapsed = Math.round((Date.now() - start) / 1000);
              progress(`Reboot in progress… (${elapsed}s)`);
              if (status.status === "completed") { completed = true; break; }
              if (status.status === "errored") throw new Error("Reboot action errored at DigitalOcean");
            }
            if (!completed) throw new Error("Reboot timed out after 3 minutes");
            progress("Droplet rebooted.");
            send(ws, { type: "admin:droplets:reboot:done", payload: { dropletId } });
          } catch (err: unknown) {
            send(ws, { type: "admin:droplets:reboot:error", payload: { dropletId, message: err instanceof Error ? err.message : String(err) } });
          }
        })();
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:reboot:error", payload: { dropletId, message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    case "admin:droplets:domain:attach": {
      const { dropletId, fqdn, appPort } = msg.payload as { dropletId: number; fqdn: string; appPort?: number };
      try {
        if (!dropletId || typeof dropletId !== "number") throw new Error("dropletId is required");
        if (!fqdn || typeof fqdn !== "string") throw new Error("fqdn is required");
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const namecheap = await loadNamecheapConfig();
        assertNamecheapConfig(namecheap);
        const result = await attachDoDomain(
          { doToken, dropletId, fqdn, appPort, namecheap },
          (m) => send(ws, { type: "admin:droplets:domain:progress", payload: { dropletId, chunk: m } }),
        );
        await setDropletDomain(dropletId, {
          fqdn: result.fqdn, host: result.host, appPort: result.appPort, ip: result.ip,
          createdAt: new Date().toISOString(),
        });
        send(ws, { type: "admin:droplets:domain:attached", payload: { dropletId, domain: result.fqdn, url: result.url, ip: result.ip, status: result.status } });
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:domain:error", payload: { dropletId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:domain:detach": {
      const { dropletId } = msg.payload as { dropletId: number };
      try {
        if (!dropletId || typeof dropletId !== "number") throw new Error("dropletId is required");
        const existing = await getDropletDomain(dropletId);
        if (!existing) throw new Error("No domain attached to this droplet");
        const doToken = await settingsService.getGlobalDoToken();
        if (!doToken) throw new Error("DigitalOcean API token not configured");
        const namecheap = await loadNamecheapConfig();
        assertNamecheapConfig(namecheap);
        await detachDoDomain(
          { doToken, dropletId, fqdn: existing.fqdn, namecheap },
          (m) => send(ws, { type: "admin:droplets:domain:progress", payload: { dropletId, chunk: m } }),
        );
        await removeDropletDomain(dropletId);
        send(ws, { type: "admin:droplets:domain:detached", payload: { dropletId } });
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
      } catch (err: unknown) {
        send(ws, { type: "admin:droplets:domain:error", payload: { dropletId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:droplets:stats": {
      if (!sshStatsProbeEnabled()) {
        send(ws, { type: "admin:droplets:stats", payload: { stats: {} } });
        return true;
      }
      try {
        const projects = isPrivilegedRole(role) ? await projectService.getAll() : await projectService.getAllForUser(userId);
        const connMap: Record<number, { host: string; port: number; username: string; privateKeyPath: string }> = {};
        for (const p of projects) {
          for (const v of p.vpsInstances) {
            if (v.digitalocean?.dropletId && v.connection?.host) {
              connMap[v.digitalocean.dropletId] = v.connection;
            }
          }
        }
        const ids = Object.keys(connMap).map(Number);
        if (ids.length === 0) {
          send(ws, { type: "admin:droplets:stats", payload: { stats: {} } });
          return true;
        }
        const results: Record<number, unknown> = {};
        await Promise.allSettled(
          ids.map(async (id) => {
            try {
              const stats = await vpsStats(connMap[id]);
              results[id] = stats;
            } catch { /* skip unreachable droplets */ }
          })
        );
        send(ws, { type: "admin:droplets:stats", payload: { stats: results } });
      } catch {
        send(ws, { type: "admin:droplets:stats", payload: { stats: {} } });
      }
      return true;
    }

    default:
      return false;
  }
}
