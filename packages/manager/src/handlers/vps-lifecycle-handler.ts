import { type WebSocket } from "ws";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { WsMessage, VpsConnectionConfig } from "../types.js";
import { VPS_SSH_USERNAME } from "../types.js";
import * as projectService from "../project-service.js";
import * as settingsService from "../settings-service.js";
import { connectSsh, isBlockedSshHost, pickWorkingSshUser } from "../vps/ssh-client.js";
import { vpsDeploy, vpsStatus, vpsTeardown, remoteDir } from "../vps/deploy-service.js";
import { getDb } from "../db/index.js";
import { deployLogs } from "../db/schema.js";
import { createDoClient } from "../vps/do-api-client.js";
import { doDestroyDroplet, ensureGenieKeyPair, sshKeyFingerprint, getGenieKeyPath, buildUfwRules } from "../vps/do-provision.js";
import { hetznerDestroyServer } from "../vps/hetzner-provision.js";
import { createHetznerClient, getServerPublicIp } from "../vps/hetzner-api-client.js";
import { createTazClient, sshUserForImage } from "../vps/tazcloud-api-client.js";
import { ensureBootstrapped } from "../vps/vps-bootstrap.js";
import { provisionMcpRestConfig } from "../vps/mcp-config-merge.js";
import { execCached } from "../vps/ssh-session-cache.js";
import { storeServerCredential, deleteServerCredential, ensureServerKeyOnDisk } from "../vps/server-credential-service.js";
import { isPasteKeyEnabled } from "../vps/credential-crypto.js";
import { notifySuperadmin } from "../email-service.js";
import {
  type ClientState,
  broadcastProjectList,
} from "../ws-server.js";


/** Handle vps:* lifecycle ops — test-connection, connect, attach-existing,
 *  deploy, teardown, hibernate, reboot, wake, disconnect. Returns true if
 *  handled. */
export async function handleVpsLifecycleMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  broadcast: (message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  const userId = state.userId;
  switch (msg.type) {
    case "vps:test-connection": {
      const p = msg.payload as { host: string; port?: number; username: string; authMethod?: "genie-key" | "stored-key"; privateKey?: string; privateKeyPath?: string };
      try {
        let conn: VpsConnectionConfig & { privateKey?: string };
        if (p.authMethod === "stored-key") {
          if (!isPasteKeyEnabled()) throw new Error("Pasted-key auth is disabled on this manager — set GENIE_SECRET to enable it.");
          if (!p.privateKey?.trim()) throw new Error("No private key provided.");
          conn = { host: p.host, port: p.port || 22, username: p.username, privateKeyPath: "", privateKey: p.privateKey };
        } else {
          conn = { host: p.host, port: p.port || 22, username: p.username, privateKeyPath: p.authMethod === "genie-key" ? getGenieKeyPath() : (p.privateKeyPath || getGenieKeyPath()) };
        }
        const session = await connectSsh(conn);
        const hostname = await session.exec("hostname");
        session.close();
        send(ws, { type: "vps:test-connection:ok", payload: { hostname: hostname.trim() } });
      } catch (err: unknown) {
        send(ws, { type: "vps:test-connection:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:connect": {
      // Register a generic ("bring-your-own") SSH server on a project — no
      // provisioning/bootstrap, just validate the connection and persist it.
      // genie-key: reuse the shared Genie keypair (user authorized its pubkey).
      // stored-key: encrypt + store the pasted private key, materialize on disk.
      const p = msg.payload as { projectId: string; host: string; port?: number; username: string; label?: string; authMethod: "genie-key" | "stored-key"; privateKey?: string };
      try {
        if (!userId) return true;
        // Connecting a server provisions project infrastructure — owner-level,
        // not something a plain project member may do.
        if (!(await projectService.userCanManageProject(userId, p.projectId))) {
          send(ws, { type: "vps:connect:error", payload: { message: "Not authorized for this project" } });
          return true;
        }
        const host = (p.host || "").trim();
        if (isBlockedSshHost(host)) {
          send(ws, { type: "vps:connect:error", payload: { message: "That host is not allowed (loopback / link-local / metadata addresses are blocked)." } });
          return true;
        }
        const port = p.port || 22;
        const username = (p.username || "").trim() || "root";
        const instanceId = uuidv4();
        let connection: VpsConnectionConfig;
        let ssh: import("../types.js").SshServerInfo;
        if (p.authMethod === "stored-key") {
          if (!isPasteKeyEnabled()) { send(ws, { type: "vps:connect:error", payload: { message: "Pasted-key auth is disabled — set GENIE_SECRET on the manager." } }); return true; }
          if (!p.privateKey?.trim()) { send(ws, { type: "vps:connect:error", payload: { message: "No private key provided." } }); return true; }
          const credentialId = await storeServerCredential({ projectId: p.projectId, instanceId, privateKey: p.privateKey, createdBy: userId });
          const keyPath = await ensureServerKeyOnDisk(credentialId);
          connection = { host, port, username, privateKeyPath: keyPath };
          ssh = { authMethod: "stored-key", credentialId };
        } else {
          connection = { host, port, username, privateKeyPath: getGenieKeyPath() };
          ssh = { authMethod: "genie-key" };
        }
        try {
          const session = await connectSsh(connection);
          await session.exec("hostname");
          session.close();
        } catch (err: unknown) {
          if (ssh.credentialId) await deleteServerCredential(ssh.credentialId).catch(() => { /* best-effort */ });
          send(ws, { type: "vps:connect:error", payload: { message: `SSH connection failed: ${(err instanceof Error ? err.message : String(err))}` } });
          return true;
        }
        const instance: import("../types.js").VpsInstance = {
          id: instanceId,
          label: (p.label || host).slice(0, 64),
          connection,
          services: [],
          ssh,
        };
        await projectService.addVpsInstance(p.projectId, instance);
        await broadcastProjectList();
        void notifySuperadmin("Generic SSH server connected", `${state.user?.email || userId} connected ${username}@${host}:${port} to project ${p.projectId} (auth: ${ssh.authMethod}).`);
        send(ws, { type: "vps:connect:ok", payload: { projectId: p.projectId, instanceId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:connect:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:attach-existing": {
      // Attach an already-existing cloud VM (DO droplet or TazCloud VM) to a
      // project without re-provisioning. Admin-only because the source lists
      // are admin-scoped.
      const { projectId, provider, vmId, label, detachFrom } = msg.payload as {
        projectId: string; provider: "digitalocean" | "tazcloud" | "hetzner"; vmId: string | number; label?: string;
        // Set when *moving* a VM to a different project — the existing link is
        // removed first so the "already attached" guard below doesn't trip.
        detachFrom?: { projectId: string; instanceId: string };
      };
      try {
        const realCallerId = state.impersonatedBy ?? state.userId ?? null;
        const { isAdmin } = await import("../auth.js");
        if (!realCallerId || !(await isAdmin(realCallerId))) {
          send(ws, { type: "vps:attach-existing:error", payload: { message: "Admins only" } });
          return true;
        }
        const project = await projectService.getById(projectId);
        if (!project) {
          send(ws, { type: "vps:attach-existing:error", payload: { message: "Project not found" } });
          return true;
        }
        // Moving to a different project: drop the old link first (idempotent).
        if (detachFrom?.projectId && detachFrom?.instanceId) {
          try { await projectService.removeVpsInstance(detachFrom.projectId, detachFrom.instanceId); } catch { /* already gone */ }
        }

        const allProjects = await projectService.getAll();
        for (const pp of allProjects) {
          for (const v of pp.vpsInstances) {
            const matchDo = provider === "digitalocean" && v.digitalocean?.dropletId === Number(vmId);
            const matchTaz = provider === "tazcloud" && v.tazcloud?.vmId === String(vmId);
            const matchHz = provider === "hetzner" && v.hetzner?.serverId === Number(vmId);
            if (matchDo || matchTaz || matchHz) {
              send(ws, { type: "vps:attach-existing:error", payload: { message: `Already attached to project "${pp.name}"` } });
              return true;
            }
          }
        }

        const onAttachProgress = (m: string) =>
          send(ws, { type: "vps:attach-existing:progress", payload: { projectId, provider, vmId, message: m } });

        let initialConnection: VpsConnectionConfig;
        let providerMeta: Pick<import("../types.js").VpsInstance, "digitalocean" | "tazcloud" | "hetzner">;
        let resolvedLabel: string;
        const newInstanceId = uuidv4();

        if (provider === "hetzner") {
          const hzToken = await settingsService.getGlobalHetznerToken();
          if (!hzToken) throw new Error("Hetzner API token not configured");
          const hzClient = createHetznerClient(hzToken);
          const server = await hzClient.getServer(Number(vmId));
          const publicV4 = getServerPublicIp(server);
          if (!publicV4) throw new Error("Server has no public IPv4 yet");
          const probed = await pickWorkingSshUser(
            { host: publicV4, port: 22, privateKeyPath: "~/.genie/ssh/genie_ed25519" },
            [VPS_SSH_USERNAME, "root"],
          );
          if (!probed) {
            throw new Error(`Cannot SSH into server ${publicV4} as 'genie' or 'root' with the Genie key`);
          }
          initialConnection = {
            host: publicV4,
            port: 22,
            username: probed,
            privateKeyPath: "~/.genie/ssh/genie_ed25519",
          };
          providerMeta = {
            hetzner: {
              serverId: server.id,
              ipAddress: publicV4,
              location: server.datacenter?.location?.name || "",
              serverType: server.server_type?.name || "",
            },
          };
          resolvedLabel = (label || server.name).slice(0, 64);
        } else if (provider === "digitalocean") {
          const doToken = await settingsService.getGlobalDoToken();
          if (!doToken) throw new Error("DigitalOcean API token not configured");
          const doClient = createDoClient(doToken);
          const droplet = await doClient.getDroplet(Number(vmId));
          const publicV4 = droplet.networks.v4.find((n) => n.type === "public")?.ip_address;
          if (!publicV4) throw new Error("Droplet has no public IPv4 yet");
          const probed = await pickWorkingSshUser(
            { host: publicV4, port: 22, privateKeyPath: "~/.genie/ssh/genie_ed25519" },
            [VPS_SSH_USERNAME, "root"],
          );
          if (!probed) {
            throw new Error(`Cannot SSH into droplet ${publicV4} as 'genie' or 'root' with the Genie key`);
          }
          initialConnection = {
            host: publicV4,
            port: 22,
            username: probed,
            privateKeyPath: "~/.genie/ssh/genie_ed25519",
          };
          providerMeta = {
            digitalocean: {
              dropletId: droplet.id,
              ipAddress: publicV4,
              region: droplet.region.slug,
              size: droplet.size_slug,
            },
          };
          resolvedLabel = (label || droplet.name).slice(0, 64);
        } else {
          const tazToken = process.env.TAZCLOUD_API_TOKEN;
          if (!tazToken) throw new Error("TAZCLOUD_API_TOKEN not configured");
          const tazClient = createTazClient(tazToken);
          const vm = await tazClient.getVm(String(vmId));
          // v2.0.0 vxlan-bastion VMs have null ipv6 and only ssh_host (private IP
          // reached via WireGuard); legacy v6 tenants still have ipv6. Trust
          // ssh_host as the authoritative address since the API resolves it
          // correctly for both modes.
          const tazHost = vm.ssh_host || vm.ipv6;
          if (!tazHost) throw new Error("VM has no ssh_host yet");
          const imageDefault = vm.image ? sshUserForImage(vm.image) : "ubuntu";
          const probed = await pickWorkingSshUser(
            {
              host: tazHost,
              port: vm.ssh_port || 22,
              privateKeyPath: "~/.genie/ssh/tazcloud_ed25519",
            },
            [VPS_SSH_USERNAME, imageDefault],
          );
          if (!probed) {
            throw new Error(`Cannot SSH into VM ${tazHost} as 'genie' or '${imageDefault}' with the TazCloud key`);
          }
          initialConnection = {
            host: tazHost,
            port: vm.ssh_port || 22,
            username: probed,
            privateKeyPath: "~/.genie/ssh/tazcloud_ed25519",
          };
          providerMeta = {
            tazcloud: {
              vmId: vm.id,
              ipv6: vm.ipv6 || tazHost,
              image: vm.image || "ubuntu-22",
              size: vm.size || "small",
              sshUser: VPS_SSH_USERNAME,
              ...(vm.project_id ? { projectId: vm.project_id } : {}),
            },
          };
          resolvedLabel = (label || vm.name).slice(0, 64);
        }

        // Ensure the `genie` user exists and owns /opt/project regardless of how
        // this VM was originally created. Idempotent — instant no-op for VMs
        // already bootstrapped by Genie.
        const effectiveConnection = await ensureBootstrapped(
          initialConnection,
          { gitlabDeployKey: project.gitlabDeployKey ?? undefined },
          onAttachProgress,
        );

        const instance: import("../types.js").VpsInstance = {
          id: newInstanceId,
          label: resolvedLabel,
          connection: effectiveConnection,
          services: [],
          ...providerMeta,
        };

        await projectService.addVpsInstance(projectId, instance);
        // Rewrite the VM's .mcp.json with THIS project's bearer token. Without
        // this, a server moved/attached from another project keeps the old
        // project's token on disk and every genie-* MCP call (tracker tickets,
        // storage, …) resolves to the wrong project. Best-effort — the attach
        // itself already succeeded.
        try {
          await provisionMcpRestConfig(
            (cmd) => execCached(effectiveConnection, cmd),
            remoteDir(project.name),
            projectId,
            instance.id,
          );
        } catch (mcpErr) {
          console.error(`[mcp-rest] post-attach config refresh failed for ${project.name}:`, mcpErr instanceof Error ? mcpErr.message : mcpErr);
        }
        await broadcastProjectList();
        // Refresh the cloud panels so the "Project" column updates.
        broadcast({ type: "admin:droplets:list:stale", payload: {} });
        broadcast({ type: "admin:tazcloud:list:stale", payload: {} });
        broadcast({ type: "admin:hetzner:list:stale", payload: {} });
        send(ws, { type: "vps:attach-existing:ok", payload: { projectId, provider, vmId, instanceId: instance.id } });
      } catch (err: unknown) {
        send(ws, { type: "vps:attach-existing:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:deploy": {
      const { projectId, connection, instanceId: sshInstanceId, label: sshLabel } = msg.payload as { projectId: string; connection: VpsConnectionConfig; instanceId?: string; label?: string };
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "vps:deploy:error", payload: { projectId, message: "Project not found" } });
        return true;
      }
      // Provisioning onto a server is owner-level — plain project members can't.
      if (!(await projectService.userCanManageProject(userId, projectId))) {
        send(ws, { type: "vps:deploy:error", payload: { projectId, message: "Not authorized to deploy to this project" } });
        return true;
      }

      let vpsAgentMemoryCreated = false;
      if (!project.setupFiles?.["AGENT.md"]) {
        const defaultAgentMd = `# Agent Memory\n\nThis file is automatically maintained by Genie. It stores knowledge about the project's codebase, architecture, and deployment so the agent doesn't need to rediscover things each session.\n\n## Codebase Overview\n<!-- The agent will fill this in after exploring the codebase -->\n\n## Architecture & Tech Stack\n<!-- Key technologies, frameworks, patterns -->\n\n## Important Files & Paths\n<!-- Critical files the agent has discovered -->\n\n## Deployment Notes\n<!-- Instance-specific deployment knowledge -->\n`;
        const updatedFiles = { ...(project.setupFiles || {}), "AGENT.md": defaultAgentMd };
        await projectService.patchProject(projectId, { setupFiles: updatedFiles });
        project.setupFiles = updatedFiles;
        vpsAgentMemoryCreated = true;
      }

      const newSshInstanceId = sshInstanceId || uuidv4();

      const vpsDb = getDb();
      const [vpsLogRow] = await vpsDb.insert(deployLogs).values({ projectId }).returning({ id: deployLogs.id });
      const vpsDeployLogId = vpsLogRow.id;
      const vpsProgressAcc: string[] = [];

      const vpsFirstMsg = `Starting VPS deploy for "${project.name}"...`;
      vpsProgressAcc.push(vpsFirstMsg);
      send(ws, { type: "vps:deploy:progress", payload: { projectId, instanceId: newSshInstanceId, message: vpsFirstMsg } });

      const secretEnvVars = project.secrets?.reduce((acc, s) => { if (s.key) acc[s.key] = s.value; return acc; }, {} as Record<string, string>);

      const onProgress = (step: string) => {
        vpsProgressAcc.push(step);
        send(ws, { type: "vps:deploy:progress", payload: { projectId, instanceId: newSshInstanceId, message: step } });
      };

      void (async () => {
        try {
          const effectiveConnection = await ensureBootstrapped(
            connection,
            { gitlabDeployKey: project.gitlabDeployKey },
            onProgress,
          );

          await vpsDeploy(
            project.name,
            effectiveConnection,
            onProgress,
            secretEnvVars,
            project.setupFiles,
          );

          const instance: import("../types.js").VpsInstance = {
            id: newSshInstanceId,
            label: sshLabel || "default",
            connection: effectiveConnection,
            services: [],
          };
          try {
            const sshTmp = await connectSsh(effectiveConnection, { timeoutMs: 15_000 });
            const claudeMdPath = `${remoteDir(project.name)}/CLAUDE.md`;
            const ip = effectiveConnection.host;
            const serverBlock = [
              `Server public IP: ${ip}`,
              ``,
              `## Browser & MCP Tools`,
              `This server runs in the cloud at ${ip}. When using browser tools:`,
              `- The app is accessible at http://${ip}:3000 (or whichever port). NEVER use localhost or 127.0.0.1 URLs.`,
              `- genie-browser: Always use the public IP (http://${ip}:PORT) for navigation. Never pass localhost URLs.`,
              `- chrome-devtools: Runs Puppeteer on the VPS with no display server — always use headless mode. Navigate to http://${ip}:PORT, never localhost.`,
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
          } catch { /* CLAUDE.md prelude best-effort */ }
          try {
            instance.services = await vpsStatus(project.name, effectiveConnection);
          } catch { /* keep empty services */ }
          const existing = project.vpsInstances.find(v => v.id === newSshInstanceId);
          if (existing) {
            await projectService.updateVpsInstance(projectId, newSshInstanceId, instance);
          } else {
            await projectService.addVpsInstance(projectId, instance);
          }
          await broadcastProjectList();
          await vpsDb.update(deployLogs).set({ status: "success", progress: vpsProgressAcc, endedAt: new Date() }).where(eq(deployLogs.id, vpsDeployLogId));
          if (vpsAgentMemoryCreated) {
            send(ws, { type: "vps:deploy:progress", payload: { projectId, instanceId: newSshInstanceId, message: "Created AGENT.md — ask Genie to explore your codebase to build memory." } });
          }
          send(ws, { type: "vps:deploy:done", payload: { projectId, instanceId: newSshInstanceId, services: instance.services, deployLogId: vpsDeployLogId } });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await vpsDb.update(deployLogs).set({ status: "error", progress: vpsProgressAcc, error: message, endedAt: new Date() }).where(eq(deployLogs.id, vpsDeployLogId));
          send(ws, { type: "vps:deploy:error", payload: { projectId, instanceId: newSshInstanceId, message, deployLogId: vpsDeployLogId } });
        }
      })();
      return true;
    }

    case "vps:teardown": {
      const { projectId, instanceId } = msg.payload;
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "error", payload: { message: "No VPS deployment for this project/instance" } });
        return true;
      }
      try {
        try {
          await vpsTeardown(project!.name, vpsInst.connection, (step) => {
            send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: step } });
          });
        } catch (sshErr: unknown) {
          send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: `SSH cleanup skipped: ${sshErr instanceof Error ? sshErr.message : String(sshErr)}` } });
        }
        if (vpsInst.digitalocean) {
          const doToken = await settingsService.getGlobalDoToken();
          if (doToken) {
            await doDestroyDroplet(doToken, vpsInst.digitalocean.dropletId, (step) => {
              send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: step } });
            });
          }
        }
        if (vpsInst.hetzner) {
          const hzToken = await settingsService.getGlobalHetznerToken();
          if (hzToken) {
            await hetznerDestroyServer(hzToken, vpsInst.hetzner.serverId, (step) => {
              send(ws, { type: "vps:teardown:progress", payload: { projectId, instanceId, message: step } });
            });
          }
        }
        await projectService.removeVpsInstance(projectId, instanceId);
        await broadcastProjectList();
        send(ws, { type: "vps:teardown:done", payload: { projectId, instanceId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:teardown:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:hibernate": {
      const { projectId, instanceId } = msg.payload;
      const hProject = await projectService.getById(projectId);
      const hInst = hProject?.vpsInstances.find(v => v.id === instanceId);
      if (!hInst?.digitalocean) {
        send(ws, { type: "vps:hibernate:error", payload: { projectId, instanceId, message: "No DigitalOcean droplet to hibernate" } });
        return true;
      }
      const hToken = await settingsService.resolveDoToken(projectId);
      if (!hToken) {
        send(ws, { type: "vps:hibernate:error", payload: { projectId, instanceId, message: "No DO token configured" } });
        return true;
      }
      void (async () => {
        const progress = (m: string) => send(ws, { type: "vps:hibernate:progress", payload: { projectId, instanceId, message: m } });
        try {
          const client = createDoClient(hToken);
          const dropletId = hInst.digitalocean!.dropletId;
          const snapshotName = `genie-hibernate-${hInst.label}-${Date.now()}`;

          progress("Creating snapshot (this may take several minutes)...");
          const action = await client.snapshotDroplet(dropletId, snapshotName);

          const maxWait = 15 * 60 * 1000;
          const pollInterval = 10_000;
          const start = Date.now();
          let completed = false;
          while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, pollInterval));
            const status = await client.getAction(action.id);
            const elapsed = Math.round((Date.now() - start) / 1000);
            progress(`Snapshot in progress... (${elapsed}s)`);
            if (status.status === "completed") { completed = true; break; }
            if (status.status === "errored") throw new Error("Snapshot failed at DigitalOcean");
          }
          if (!completed) throw new Error("Snapshot timed out after 15 minutes");

          const snapshots = await client.listDropletSnapshots(dropletId);
          const snap = snapshots.find(s => s.name === snapshotName);
          if (!snap) throw new Error("Snapshot created but not found in droplet snapshots");

          progress("Snapshot complete. Destroying droplet...");
          await client.deleteDroplet(dropletId);

          await projectService.updateVpsInstance(projectId, instanceId, {
            digitalocean: undefined,
            services: [],
            connection: { ...hInst.connection, host: "" },
            hibernate: {
              snapshotId: snap.id,
              snapshotName,
              region: hInst.digitalocean!.region,
              size: hInst.digitalocean!.size,
              hibernatedAt: new Date().toISOString(),
            },
          });

          await broadcastProjectList();
          progress("Droplet destroyed. Instance hibernated.");
          send(ws, { type: "vps:hibernate:done", payload: { projectId, instanceId } });
        } catch (err: unknown) {
          send(ws, { type: "vps:hibernate:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
        }
      })();
      return true;
    }

    case "vps:reboot": {
      // Soft reboot of a DigitalOcean droplet — `dropletAction(id, "reboot")`
      // triggers an OS-level shutdown + start. Pure DO action, no SSH involved.
      const { projectId, instanceId } = msg.payload as { projectId: string; instanceId: string };
      const rProject = await projectService.getById(projectId);
      const rInst = rProject?.vpsInstances.find((v) => v.id === instanceId);
      if (!rInst?.digitalocean) {
        send(ws, { type: "vps:reboot:error", payload: { projectId, instanceId, message: "Not a DigitalOcean droplet" } });
        return true;
      }
      const rToken = await settingsService.resolveDoToken(projectId);
      if (!rToken) {
        send(ws, { type: "vps:reboot:error", payload: { projectId, instanceId, message: "No DO token configured" } });
        return true;
      }
      void (async () => {
        const progress = (m: string) =>
          send(ws, { type: "vps:reboot:progress", payload: { projectId, instanceId, message: m } });
        try {
          const client = createDoClient(rToken);
          const dropletId = rInst.digitalocean!.dropletId;
          progress("Issuing reboot to DigitalOcean…");
          const action = await client.dropletAction(dropletId, "reboot");

          const maxWait = 3 * 60_000;
          const interval = 4_000;
          const start = Date.now();
          let completed = false;
          while (Date.now() - start < maxWait) {
            await new Promise((r) => setTimeout(r, interval));
            const status = await client.getAction(action.id);
            const elapsed = Math.round((Date.now() - start) / 1000);
            progress(`Reboot in progress… (${elapsed}s)`);
            if (status.status === "completed") { completed = true; break; }
            if (status.status === "errored") throw new Error("Reboot action errored at DigitalOcean");
          }
          if (!completed) throw new Error("Reboot timed out after 3 minutes");

          progress("Droplet rebooted.");
          send(ws, { type: "vps:reboot:done", payload: { projectId, instanceId } });
        } catch (err: unknown) {
          send(ws, {
            type: "vps:reboot:error",
            payload: { projectId, instanceId, message: err instanceof Error ? err.message : String(err) },
          });
        }
      })();
      return true;
    }

    case "vps:wake": {
      const { projectId, instanceId } = msg.payload;
      const wProject = await projectService.getById(projectId);
      const wInst = wProject?.vpsInstances.find(v => v.id === instanceId);
      if (!wInst?.hibernate) {
        send(ws, { type: "vps:wake:error", payload: { projectId, instanceId, message: "Instance is not hibernated" } });
        return true;
      }
      const wToken = await settingsService.resolveDoToken(projectId);
      if (!wToken) {
        send(ws, { type: "vps:wake:error", payload: { projectId, instanceId, message: "No DO token configured" } });
        return true;
      }
      void (async () => {
        const progress = (m: string) => send(ws, { type: "vps:wake:progress", payload: { projectId, instanceId, message: m } });
        try {
          const client = createDoClient(wToken);
          const hib = wInst.hibernate!;

          progress("Preparing SSH keys...");
          const keyPair = await ensureGenieKeyPair();
          const fingerprint = sshKeyFingerprint(keyPair.publicKey);
          const existingKeys = await client.listSshKeys();
          let sshKeyId = existingKeys.find(k => k.fingerprint === fingerprint)?.id;
          if (!sshKeyId) {
            const newKey = await client.createSshKey(`genie-${Date.now()}`, keyPair.publicKey);
            sshKeyId = newKey.id;
          }

          const dropletName = `genie-${wInst.label}-${Date.now()}`;
          progress(`Creating droplet from snapshot in ${hib.region} (${hib.size})...`);
          const droplet = await client.createDroplet({
            name: dropletName,
            region: hib.region,
            size: hib.size,
            image: hib.snapshotId,
            sshKeyIds: [sshKeyId],
            tags: ["genie"],
          });

          const maxWait = 180_000;
          const start = Date.now();
          let ip: string | null = null;
          while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, 5000));
            const d = await client.getDroplet(droplet.id);
            const elapsed = Math.round((Date.now() - start) / 1000);
            if (d.status === "active") {
              const v4 = d.networks?.v4 || [];
              const pub = v4.find(n => n.type === "public");
              if (pub?.ip_address) { ip = pub.ip_address; break; }
            }
            progress(`Waiting for droplet... (${elapsed}s)`);
          }
          if (!ip) throw new Error("Droplet did not become active within 3 minutes");

          progress(`Droplet active at ${ip}. Waiting for SSH...`);

          const connConfig: VpsConnectionConfig = {
            host: ip,
            port: 22,
            username: VPS_SSH_USERNAME,
            privateKeyPath: path.join(os.homedir(), ".genie", "ssh", "genie_ed25519"),
          };
          const sshStart = Date.now();
          const sshTimeout = 120_000;
          let sshReady = false;
          while (Date.now() - sshStart < sshTimeout) {
            try {
              const session = await connectSsh(connConfig);
              await session.exec("echo ok");
              session.close();
              sshReady = true;
              break;
            } catch {
              await new Promise(r => setTimeout(r, 5000));
            }
          }
          if (!sshReady) throw new Error("SSH did not become available within 2 minutes");

          progress("Configuring firewall...");
          try {
            const fwSession = await connectSsh({ ...connConfig, username: "root" });
            await fwSession.exec(buildUfwRules(process.env.MANAGER_PUBLIC_IP, process.env.MANAGER_PUBLIC_IP_DEV, process.env.MANAGER_PUBLIC_IP_V6, process.env.MANAGER_PUBLIC_IP_V6_DEV).join(" && "));
            fwSession.close();
          } catch (fwErr: unknown) {
            progress(`Warning: Firewall config failed: ${fwErr instanceof Error ? fwErr.message : String(fwErr)}`);
          }

          progress("Starting Docker containers...");
          try {
            const dkSession = await connectSsh(connConfig);
            await dkSession.exec(`cd /opt/project && docker compose up -d 2>&1 || true`);
            dkSession.close();
          } catch {
            progress("Warning: Could not restart Docker containers");
          }

          progress("Cleaning up snapshot...");
          try {
            await client.deleteSnapshot(hib.snapshotId);
          } catch {
            progress("Warning: Could not delete snapshot — clean up manually");
          }

          await projectService.updateVpsInstance(projectId, instanceId, {
            connection: connConfig,
            digitalocean: {
              dropletId: droplet.id,
              ipAddress: ip,
              region: hib.region,
              size: hib.size,
            },
            hibernate: undefined,
          });

          await broadcastProjectList();
          progress(`Instance woken up at ${ip}`);
          send(ws, { type: "vps:wake:done", payload: { projectId, instanceId } });
        } catch (err: unknown) {
          send(ws, { type: "vps:wake:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
        }
      })();
      return true;
    }

    case "vps:disconnect": {
      const { projectId, instanceId } = msg.payload;
      if (!userId) return true;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "error", payload: { message: "Not authorized for this project" } });
        return true;
      }
      const dProject = await projectService.getById(projectId);
      const dInst = dProject?.vpsInstances.find(v => v.id === instanceId);
      await projectService.removeVpsInstance(projectId, instanceId);
      if (dInst?.ssh?.credentialId) await deleteServerCredential(dInst.ssh.credentialId).catch(() => { /* best-effort */ });
      await broadcastProjectList();
      return true;
    }

    default:
      return false;
  }
}
