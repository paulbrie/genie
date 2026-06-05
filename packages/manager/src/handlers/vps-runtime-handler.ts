import { type WebSocket } from "ws";
import type { WsMessage, VpsConnectionConfig } from "../types.js";
import { VPS_SSH_USERNAME } from "../types.js";
import type { Role } from "../ws-acl.js";
import { isPrivilegedRole } from "../ws-acl.js";
import * as projectService from "../project-service.js";
import { connectSsh, pickWorkingSshUser } from "../vps/ssh-client.js";
import { vpsStatus, vpsLogs, vpsStats } from "../vps/deploy-service.js";
import { watchVpsStats, unwatchVpsStats, getCachedVpsStats } from "../vps/stats-stream.js";
import { dropletSync, syncDropletStatuses } from "../vps/droplet-sync.js";
import { execCached, evictSession } from "../vps/ssh-session-cache.js";
import { sshStatsPostbackEnabled, sshStatsProbeEnabled, sshTmuxProbeEnabled } from "../vps/ssh-stats-disabled.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import { getVpsMetricHistory, getBulkVpsMetricHistory } from "../vps/vps-metric-service.js";
import { GENIE_STANDARD_RECIPE_SLUG, syncGenieStatsOnVm } from "../vps/ensure-vps-stats.js";
import { pollVpsStats } from "../ssh/index.js";
import { broadcastProjectList } from "../ws-server.js";
/** Handle runtime `vps:*` ops — status, stats (except `vps:stats` itself which
 *  touches mutable droplet-sync state in ws-server.ts), monitor, process, exec,
 *  recipes, logs, docker logs, MCP ensure. Returns true if handled. */
export async function handleVpsRuntimeMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  role: Role | null,
): Promise<boolean> {
  switch (msg.type) {
    case "vps:status": {
      const { projectId, instanceId } = msg.payload;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "error", payload: { message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "error", payload: { message: "No VPS deployment for this project/instance" } });
        return true;
      }
      try {
        const containers = await vpsStatus(project!.name, await getVpsConnection(projectId, instanceId));
        await projectService.updateVpsInstance(projectId, instanceId, { services: containers });
        send(ws, { type: "vps:status:update", payload: { projectId, instanceId, services: containers } });
        await broadcastProjectList();
      } catch (err: unknown) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:stats": {
      if (!sshStatsProbeEnabled()) {
        const { projectId, instanceId } = msg.payload as { projectId: string; instanceId: string };
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: "SSH stats probe disabled" } });
        return true;
      }
      const { projectId, instanceId } = msg.payload;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: "No VPS deployment for this project/instance" } });
        return true;
      }
      const dropletId = vpsInst.digitalocean?.dropletId;
      if (dropletId && dropletSync.lastSync > 0 && !dropletSync.knownIds.has(dropletId)) {
        void syncDropletStatuses(broadcastProjectList);
      }
      const cached = getCachedVpsStats(projectId, instanceId);
      if (cached) {
        send(ws, { type: "vps:stats:result", payload: { projectId, instanceId, stats: cached } });
        return true;
      }
      try {
        const stats = await vpsStats(await getVpsConnection(projectId, instanceId));
        send(ws, { type: "vps:stats:result", payload: { projectId, instanceId, stats } });
      } catch (err: unknown) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:stats:watch": {
      if (!sshStatsPostbackEnabled()) return true;
      const { projectId, instanceId } = msg.payload;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find((v) => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:stats:error", payload: { projectId, instanceId, message: "No VPS deployment for this project/instance" } });
        return true;
      }
      // Stats now arrive via the VM's HTTPS postback (POST /api/vps/stats);
      // this just subscribes the socket and replays the cached value.
      watchVpsStats(ws, projectId, instanceId, send);
      return true;
    }

    case "vps:stats:unwatch": {
      const { projectId, instanceId } = msg.payload;
      unwatchVpsStats(ws, projectId, instanceId);
      return true;
    }

    case "vps:stats:sync": {
      const { projectId, instanceId } = msg.payload as { projectId: string; instanceId: string };
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:stats:sync:error", payload: { projectId, instanceId, message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      if (!project?.vpsInstances.some((v) => v.id === instanceId)) {
        send(ws, { type: "vps:stats:sync:error", payload: { projectId, instanceId, message: "No VPS deployment for this project/instance" } });
        return true;
      }
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        await syncGenieStatsOnVm(conn, projectId, instanceId, (message) => {
          send(ws, { type: "vps:stats:sync:progress", payload: { projectId, instanceId, message } });
        });
        send(ws, { type: "vps:stats:sync:done", payload: { projectId, instanceId } });
      } catch (err: unknown) {
        send(ws, {
          type: "vps:stats:sync:error",
          payload: { projectId, instanceId, message: err instanceof Error ? err.message : String(err) },
        });
      }
      return true;
    }

    case "vps:stats:history": {
      const { projectId, instanceId, hours = 1 } = msg.payload;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, {
          type: "vps:stats:history:result",
          payload: { projectId, instanceId, samples: [], error: "Not authorized for this project" },
        });
        return true;
      }
      const project = await projectService.getById(projectId);
      if (!project?.vpsInstances.some((v) => v.id === instanceId)) {
        send(ws, {
          type: "vps:stats:history:result",
          payload: { projectId, instanceId, samples: [], error: "No VPS instance" },
        });
        return true;
      }
      try {
        const h = typeof hours === "number" && hours > 0 ? Math.min(hours, 168) : 1;
        const samples = await getVpsMetricHistory(projectId, instanceId, h);
        send(ws, { type: "vps:stats:history:result", payload: { projectId, instanceId, samples } });
      } catch (err: unknown) {
        send(ws, {
          type: "vps:stats:history:result",
          payload: {
            projectId,
            instanceId,
            samples: [],
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return true;
    }

    case "vps:monitor:load": {
      const hoursRaw = msg.payload?.hours;
      const hours = typeof hoursRaw === "number" && hoursRaw > 0 ? Math.min(hoursRaw, 168) : 1;
      try {
        const projects = await projectService.getAllForUser(userId);
        const instances = projects.flatMap((p) =>
          p.vpsInstances.map((v) => ({ projectId: p.id, instanceId: v.id })),
        );
        const history = await getBulkVpsMetricHistory(instances, hours);
        send(ws, { type: "vps:monitor:load:result", payload: { history, hours } });
      } catch (err: unknown) {
        send(ws, {
          type: "vps:monitor:load:result",
          payload: { history: {}, hours, error: err instanceof Error ? err.message : String(err) },
        });
      }
      return true;
    }

    case "vps:process:kill": {
      const { projectId, instanceId, pid } = msg.payload;
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: false, error: "Not authorized for this project" } });
        return true;
      }
      let killConn: VpsConnectionConfig;
      try {
        killConn = await getVpsConnection(projectId, instanceId);
      } catch {
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: false, error: "No VPS deployment" } });
        return true;
      }
      try {
        const session = await connectSsh(killConn);
        try {
          await session.exec(`kill -9 ${Number(pid)}`);
        } finally {
          session.close();
        }
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: true } });
      } catch (err: unknown) {
        send(ws, { type: "vps:process:kill:result", payload: { projectId, instanceId, pid, ok: false, error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:exec": {
      const { projectId, instanceId, command, execId } = msg.payload as {
        projectId: string; instanceId: string; command: string; execId: string;
      };
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:exec:result", payload: { execId, output: "Not authorized for this project", error: true } });
        return true;
      }
      let execConn: VpsConnectionConfig;
      try {
        execConn = await getVpsConnection(projectId, instanceId);
      } catch {
        send(ws, { type: "vps:exec:result", payload: { execId, output: "No VPS deployment found", error: true } });
        return true;
      }
      try {
        const output = await execCached(execConn, `${command} 2>&1`, undefined, { timeoutMs: 30_000 });
        send(ws, { type: "vps:exec:result", payload: { execId, output } });
      } catch (err: unknown) {
        send(ws, { type: "vps:exec:result", payload: { execId, output: (err instanceof Error ? err.message : String(err)), error: true } });
      }
      return true;
    }

    case "vps:recipe:check": {
      const { projectId, instanceId, recipeId, script } = msg.payload as {
        projectId: string; instanceId: string; recipeId: string; script: string;
      };
      if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:recipe:check:result", payload: { projectId, instanceId, recipeId, installed: false } });
        return true;
      }
      try {
        const output = await execCached(
          vpsInst.connection,
          `cat << 'GENIE_RECIPE_EOF' | bash 2>&1\n${script}\nGENIE_RECIPE_EOF`,
          undefined,
          { timeoutMs: 15_000 },
        );
        const lastLine = output.trim().split("\n").pop()?.trim();
        const installed = lastLine === "INSTALLED";
        send(ws, { type: "vps:recipe:check:result", payload: { projectId, instanceId, recipeId, installed } });
      } catch {
        send(ws, { type: "vps:recipe:check:result", payload: { projectId, instanceId, recipeId, installed: false } });
      }
      return true;
    }

    case "vps:recipe:uninstall": {
      const { projectId, instanceId, recipeId, script } = msg.payload as {
        projectId: string; instanceId: string; recipeId: string; script: string;
      };
      if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "No VPS deployment" } });
        return true;
      }
      try {
        await execCached(
          vpsInst.connection,
          `cat << 'GENIE_RECIPE_EOF' | bash 2>&1\n${script}\nGENIE_RECIPE_EOF`,
          (chunk) => {
            const line = chunk.trimEnd();
            if (line) send(ws, { type: "vps:recipe:progress", payload: { projectId, instanceId, recipeId, message: line } });
          },
          { timeoutMs: 300_000, idleTimeoutMs: 60_000 },
        );
        send(ws, { type: "vps:recipe:uninstall:done", payload: { projectId, instanceId, recipeId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:recipe:run": {
      const { projectId, instanceId, recipeId, script } = msg.payload as {
        projectId: string; instanceId: string; recipeId: string; script: string;
      };
      if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: "No VPS deployment" } });
        return true;
      }
      try {
        await execCached(
          vpsInst.connection,
          `cat << 'GENIE_RECIPE_EOF' | bash 2>&1\n${script}\nGENIE_RECIPE_EOF`,
          (chunk) => {
            const line = chunk.trimEnd();
            if (line) send(ws, { type: "vps:recipe:progress", payload: { projectId, instanceId, recipeId, message: line } });
          },
          { timeoutMs: 600_000, idleTimeoutMs: 120_000 },
        );

        // Defensive: a recipe (notably Genie Standard Setup) may have just
        // created the `genie` user and chowned /opt/project to it. If the stored
        // connection is still using the image-default user, subsequent SFTP
        // writes to /opt/project will hit Permission denied. Re-probe and
        // promote to `genie` when it now works.
        if (vpsInst.connection.username !== VPS_SSH_USERNAME) {
          try {
            const probed = await pickWorkingSshUser(
              {
                host: vpsInst.connection.host,
                port: vpsInst.connection.port,
                privateKeyPath: vpsInst.connection.privateKeyPath,
              },
              [VPS_SSH_USERNAME],
            );
            if (probed === VPS_SSH_USERNAME) {
              evictSession(vpsInst.connection);
              await projectService.updateVpsInstance(projectId, instanceId, {
                connection: { ...vpsInst.connection, username: VPS_SSH_USERNAME },
              });
              await broadcastProjectList();
              send(ws, { type: "vps:recipe:progress", payload: { projectId, instanceId, recipeId, message: `Switched SSH user to '${VPS_SSH_USERNAME}'` } });
            }
          } catch { /* probe failure is non-fatal */ }
        }

        if (recipeId === GENIE_STANDARD_RECIPE_SLUG) {
          try {
            const conn = await getVpsConnection(projectId, instanceId);
            await syncGenieStatsOnVm(conn, projectId, instanceId, (message) => {
              send(ws, { type: "vps:recipe:progress", payload: { projectId, instanceId, recipeId, message } });
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            send(ws, {
              type: "vps:recipe:progress",
              payload: { projectId, instanceId, recipeId, message: `Warning: genie-stats sync failed: ${message}` },
            });
          }
        }

        send(ws, { type: "vps:recipe:done", payload: { projectId, instanceId, recipeId } });
      } catch (err: unknown) {
        send(ws, { type: "vps:recipe:error", payload: { projectId, instanceId, recipeId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:logs": {
      const { projectId, instanceId, serviceName, tail } = msg.payload;
      if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "error", payload: { message: "Not authorized for this project" } });
        return true;
      }
      const project = await projectService.getById(projectId);
      const vpsInst = project?.vpsInstances.find(v => v.id === instanceId);
      if (!vpsInst) {
        send(ws, { type: "error", payload: { message: "No VPS deployment for this project/instance" } });
        return true;
      }
      try {
        const logs = await vpsLogs(project!.name, vpsInst.connection, serviceName, tail);
        send(ws, { type: "vps:logs:data", payload: { projectId, instanceId, serviceName, logs } });
      } catch (err: unknown) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "vps:docker:logs": {
      const { projectId, instanceId, reqId } = msg.payload;
      if (!isPrivilegedRole(role) && !(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, { type: "vps:docker:logs:result", payload: { ok: false, error: "Not authorized for this project", reqId } });
        return true;
      }
      try {
        const conn = await getVpsConnection(projectId, instanceId);
        const session = await connectSsh(conn);
        try {
          const containersOut = await session.exec(`docker ps -a --format '{{.Names}}\\t{{.Status}}' 2>/dev/null`);
          const containers = containersOut.trim().split("\n").filter(Boolean).map((line: string) => {
            const [name, ...statusParts] = line.split("\t");
            return { name, status: statusParts.join("\t") };
          });
          const logs: { name: string; status: string; logs: string }[] = [];
          for (const c of containers) {
            try {
              const logOut = await session.exec(`docker logs --tail 200 '${c.name.replace(/'/g, "'\\''")}' 2>&1`);
              logs.push({ name: c.name, status: c.status, logs: logOut });
            } catch {
              logs.push({ name: c.name, status: c.status, logs: "(failed to fetch logs)" });
            }
          }
          send(ws, { type: "vps:docker:logs:result", payload: { ok: true, containers: logs, reqId } });
        } finally { session.close(); }
      } catch (err: unknown) {
        send(ws, { type: "vps:docker:logs:result", payload: { ok: false, error: (err instanceof Error ? err.message : String(err)), reqId } });
      }
      return true;
    }

    case "vps:mcp:ensure": {
      const { host } = msg.payload as { host?: string };
      if (!host || typeof host !== "string") {
        send(ws, { type: "vps:mcp:ensure:result", payload: { host: host ?? null, ok: false, error: "host is required" } });
        return true;
      }
      try {
        if (!isPrivilegedRole(role)) {
          const accessible = await projectService.getAllForUser(userId);
          const owns = accessible.some((p) => p.vpsInstances.some((v) => !v.deployFailed && v.connection.host === host));
          if (!owns) {
            send(ws, { type: "vps:mcp:ensure:result", payload: { host, ok: false, error: "Not permitted" } });
            return true;
          }
        }
        // genie-* MCPs run over REST and are written into .mcp.json at chat
        // launch — there's nothing host-scoped to ensure. Ack so the existing
        // UI control resolves.
        send(ws, { type: "vps:mcp:ensure:result", payload: { host, ok: true } });
      } catch (err: unknown) {
        send(ws, { type: "vps:mcp:ensure:result", payload: { host, ok: false, error: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    case "vps:stats:refresh": {
      const { projectId, instanceId, force } = msg.payload as {
        projectId?: string;
        instanceId?: string;
        force?: boolean;
      };
      if (!projectId || !instanceId) return true;
      if (!sshTmuxProbeEnabled()) {
        send(ws, {
          type: "vm:conn:stats",
          payload: {
            projectId,
            instanceId,
            stats: null,
            tmux: [],
            error: "SSH tmux probe disabled",
            tmuxProbePath: "exec",
          },
        });
        return true;
      }
      if (!(await projectService.userCanSeeProject(userId, projectId))) {
        send(ws, {
          type: "vm:conn:stats",
          payload: {
            projectId,
            instanceId,
            stats: null,
            tmux: [],
            error: "Not authorized for this project",
            tmuxProbePath: "exec",
          },
        });
        return true;
      }
      try {
        const result = await pollVpsStats(projectId, instanceId, { force: !!force });
        send(ws, { type: "vm:conn:stats", payload: result });
      } catch (err) {
        send(ws, {
          type: "vm:conn:stats",
          payload: {
            projectId, instanceId, stats: null, tmux: [],
            error: err instanceof Error ? err.message : "stats failed",
            tmuxProbePath: "exec",
          },
        });
      }
      return true;
    }

    default:
      return false;
  }
}

