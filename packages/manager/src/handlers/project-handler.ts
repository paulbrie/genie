import { type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import * as projectService from "../project-service.js";
import * as projectManager from "../project-manager.js";
import * as orgService from "../org-service.js";
import * as analyticsService from "../analytics-service.js";
import { isAdmin } from "../auth.js";
import { getDb } from "../db/index.js";
import { teams, teamMembers } from "../db/schema.js";
import { connectSsh, type SshSession } from "../vps/ssh-client.js";
import { getVpsConnection } from "../vps/connection-resolver.js";
import {
  type ClientState,
  broadcastProjectList,
  broadcastToUsers,
  sendProjectListTo,
} from "../ws-server.js";


/** Active SSH sessions for inline project commands (key: `projectId:commandId`). */
const activeCommandSessions = new Map<string, SshSession>();

/** Handle every `project:*` message. Returns true if handled. */
export async function handleProjectMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  switch (msg.type) {
    case "project:add": {
      const { name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken, gitlabDeployKey: projDeployKey, dbUrl: projDbUrl, teamId: projTeamId } = msg.payload;
      if (!name) {
        send(ws, { type: "error", payload: { message: "name is required" } });
        return true;
      }
      // Creating a project is owner-level: system admins/superadmins, or anyone
      // who owns/admins at least one org (the project lands in one of their
      // teams). Plain members can't — the UI hides "+ Add Project" for them too.
      const adderId = state.userId;
      const adderIsAdmin = adderId ? await isAdmin(adderId) : false;
      if (!adderIsAdmin && (!adderId || (await orgService.manageableOrgIds(adderId)).length === 0)) {
        send(ws, { type: "error", payload: { message: "You don't have permission to create projects" } });
        return true;
      }
      // Auto-assign creator's first team if none provided and creator is a normal user —
      // otherwise the project would be invisible to them under the team-visibility rule.
      let resolvedTeamId: string | null = projTeamId ?? null;
      const creatorId = state.userId;
      if (!resolvedTeamId && creatorId && !(await isAdmin(creatorId))) {
        const [firstTeam] = await getDb().select({ teamId: teamMembers.teamId })
          .from(teamMembers)
          .where(eq(teamMembers.userId, creatorId))
          .limit(1);
        resolvedTeamId = firstTeam?.teamId ?? null;
      }
      await projectService.add({ name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken, gitlabDeployKey: projDeployKey, dbUrl: projDbUrl, teamId: resolvedTeamId, createdByUserId: creatorId });
      void analyticsService.recordEvent({
        userId: state.userId, userName: state.user?.name ?? null, event: "project.created", props: {}, ip: state.ip,
      });
      await broadcastProjectList();
      return true;
    }

    case "project:update": {
      const { id, name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken2, gitlabDeployKey: projDeployKey2, dbUrl: projDbUrl2, gitFolders, teamId: projTeamIdUpdate } = msg.payload;
      // teamId is settable by:
      //   - system admins / superadmins (any value, including null = "no team");
      //   - org admins, but only when the *target* team belongs to one of their
      //     manageable orgs, and never to null (clearing a team strips access
      //     for every member, so that stays admin-only).
      const updaterRealId = state.impersonatedBy ?? state.userId ?? null;
      const updaterIsAdmin = updaterRealId ? await isAdmin(updaterRealId) : false;
      let teamIdFieldAllowed: string | null | undefined = undefined;
      if (projTeamIdUpdate !== undefined) {
        if (updaterIsAdmin) {
          teamIdFieldAllowed = projTeamIdUpdate;
        } else if (updaterRealId && projTeamIdUpdate !== null) {
          const manageable = await orgService.manageableOrgIds(updaterRealId);
          if (manageable.length > 0) {
            const [teamRow] = await getDb()
              .select({ orgId: teams.orgId })
              .from(teams)
              .where(eq(teams.id, projTeamIdUpdate))
              .limit(1);
            if (teamRow?.orgId && manageable.includes(teamRow.orgId)) {
              teamIdFieldAllowed = projTeamIdUpdate;
            }
          }
        }
      }
      await projectManager.stopAll(id);
      const updated = await projectService.update(id, { name, commands, vpsProvider, vpsRegion, vpsSize, vpsImage, vpsBaseImageId, vpsBaseImageConfigName, secrets, doToken: projDoToken2, gitlabDeployKey: projDeployKey2, dbUrl: projDbUrl2, gitFolders, teamId: teamIdFieldAllowed });
      if (!updated) {
        send(ws, { type: "error", payload: { message: `Project ${id} not found` } });
        return true;
      }
      await broadcastProjectList();
      return true;
    }

    case "project:dbUrl:set": {
      const { id, dbUrl: newDbUrl } = msg.payload as { id: string; dbUrl: string };
      const updated = await projectService.update(id, { dbUrl: newDbUrl });
      if (!updated) {
        send(ws, { type: "error", payload: { message: `Project ${id} not found` } });
        return true;
      }
      await broadcastProjectList();
      return true;
    }

    case "project:remove": {
      const { id } = msg.payload;
      // Destructive + owner-level: only project owners, org owners/admins of the
      // owning team's org, and superadmins may delete. (The UI hides the Remove
      // button for everyone else, but the socket must enforce it too.)
      if (!(await projectService.userCanManageProject(state.userId, id))) {
        send(ws, { type: "error", payload: { message: "You don't have permission to remove this project" } });
        return true;
      }
      await projectManager.stopAll(id);
      const removed = await projectService.remove(id);
      if (!removed) {
        send(ws, { type: "error", payload: { message: `Project ${id} not found` } });
        return true;
      }
      void analyticsService.recordEvent({ userId: state.userId, userName: state.user?.name ?? null, event: "project.removed", projectId: id, props: {}, ip: state.ip });
      await broadcastProjectList();
      return true;
    }

    case "project:setup-snippet:add": {
      const { projectId, recipeId, snippet } = msg.payload as { projectId: string; recipeId: string; snippet: string };
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "error", payload: { message: "Project not found" } });
        return true;
      }
      const files = (project.setupFiles || {}) as Record<string, string>;
      const setupSh = files["setup.sh"] || "#!/bin/bash\nset -e\n";
      const marker = `# [recipe:${recipeId}]`;
      if (setupSh.includes(marker)) {
        send(ws, { type: "project:setup-snippet:result", payload: { projectId, recipeId, added: false, reason: "already in setup.sh" } });
        return true;
      }
      const updatedSetup = setupSh.trimEnd() + `\n\n${marker}\n${snippet}\n`;
      const setupFiles = { ...files, "setup.sh": updatedSetup };
      await projectService.patchProject(projectId, { setupFiles });
      await broadcastProjectList();
      send(ws, { type: "project:setup-snippet:result", payload: { projectId, recipeId, added: true } });
      return true;
    }

    case "project:list": {
      await sendProjectListTo(ws);
      return true;
    }

    case "project:start": {
      const { projectId, commandId } = msg.payload;
      const started = await projectManager.startCommand(projectId, commandId);
      if (!started) {
        send(ws, { type: "error", payload: { message: `Cannot start command ${commandId} in project ${projectId}` } });
      }
      return true;
    }

    case "project:stop": {
      const { projectId, commandId } = msg.payload;
      const stopped = projectManager.stopCommand(projectId, commandId);
      if (!stopped) {
        send(ws, { type: "error", payload: { message: `Cannot stop command ${commandId} in project ${projectId}` } });
      }
      return true;
    }

    case "project:start-all": {
      const { projectId } = msg.payload;
      await projectManager.startAll(projectId);
      return true;
    }

    case "project:stop-all": {
      const { projectId } = msg.payload;
      await projectManager.stopAll(projectId);
      return true;
    }

    case "project:command:run": {
      const { projectId, commandId, instanceId } = msg.payload;
      const project = await projectService.getById(projectId);
      if (!project) {
        send(ws, { type: "error", payload: { message: "Project not found" } });
        return true;
      }
      const cmd = project.commands.find((c) => c.id === commandId);
      if (!cmd) {
        send(ws, { type: "error", payload: { message: "Command not found" } });
        return true;
      }

      let conn;
      try {
        conn = await getVpsConnection(projectId, instanceId);
      } catch {
        send(ws, { type: "error", payload: { message: "VPS instance not found" } });
        return true;
      }

      if (cmd.mode === "terminal") {
        let termCmd = cmd.command;
        if (termCmd.includes("nohup ")) {
          const clean = termCmd.replace(/\s*&\s*$/, "");
          termCmd = `setsid ${clean} &`;
        }
        send(ws, { type: "project:command:terminal", payload: { projectId, commandId, instanceId, commandName: cmd.name, command: termCmd } });
      } else {
        const cmdKey = `${projectId}:${commandId}`;
        const prev = activeCommandSessions.get(cmdKey);
        if (prev) { try { prev.close(); } catch { /* already closed */ } activeCommandSessions.delete(cmdKey); }

        send(ws, { type: "project:command:started", payload: { projectId, commandId } });
        let session: SshSession;
        try {
          session = await connectSsh(conn, { timeoutMs: 30_000 });
        } catch (err: unknown) {
          send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: 1, error: `SSH connection failed: ${(err instanceof Error ? err.message : String(err))}` } });
          return true;
        }
        activeCommandSessions.set(cmdKey, session);
        try {
          let shellCmd = cmd.command;
          if (shellCmd.includes("nohup ")) {
            const cleanCmd = shellCmd.replace(/\s*&\s*$/, "");
            shellCmd = `bash -c '${cleanCmd.replace(/'/g, "'\\''")} & disown'`;
          }
          await session.exec(`cd /opt/project 2>/dev/null || true; ${shellCmd}`, (chunk) => {
            send(ws, { type: "project:command:output", payload: { projectId, commandId, data: chunk } });
          });
          send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: 0 } });
        } catch (err: unknown) {
          send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: 1, error: (err instanceof Error ? err.message : String(err)) } });
        } finally {
          session.close();
          activeCommandSessions.delete(cmdKey);
        }
      }
      return true;
    }

    case "project:command:stop": {
      const { projectId, commandId } = msg.payload;
      const cmdKey = `${projectId}:${commandId}`;
      const session = activeCommandSessions.get(cmdKey);
      if (session) {
        session.close();
        activeCommandSessions.delete(cmdKey);
        send(ws, { type: "project:command:done", payload: { projectId, commandId, exitCode: -1, error: "Stopped by user" } });
      }
      return true;
    }

    case "project:members:list": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId } = msg.payload as { projectId: string };
        if (!(await projectService.userCanSeeProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized" } });
          return true;
        }
        const members = await projectService.getProjectMembers(projectId);
        send(ws, { type: "project:members:list", payload: { projectId, members } });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "project:members:add": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId, userId, role } = msg.payload as { projectId: string; userId: string; role?: "owner" | "member" };
        if (!(await projectService.userCanManageProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized to manage this project" } });
          return true;
        }
        const member = await projectService.addProjectMember(projectId, userId, callerId, role || "member");
        send(ws, { type: "project:members:updated", payload: { projectId, member, action: "added" } });
        broadcastToUsers([userId], { type: "project:list:stale", payload: {} });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "project:members:remove": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId, userId } = msg.payload as { projectId: string; userId: string };
        if (!(await projectService.userCanManageProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized to manage this project" } });
          return true;
        }
        await projectService.removeProjectMember(projectId, userId);
        send(ws, { type: "project:members:updated", payload: { projectId, userId, action: "removed" } });
        broadcastToUsers([userId], { type: "project:list:stale", payload: {} });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "project:teams:list": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId } = msg.payload as { projectId: string };
        if (!(await projectService.userCanSeeProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized" } });
          return true;
        }
        const projectTeams = await projectService.getProjectTeams(projectId);
        send(ws, { type: "project:teams:list", payload: { projectId, teams: projectTeams } });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "project:teams:add": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId, teamId } = msg.payload as { projectId: string; teamId: string };
        if (!(await projectService.userCanManageProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized to manage this project" } });
          return true;
        }
        const team = await projectService.addProjectTeam(projectId, teamId, callerId);
        send(ws, { type: "project:teams:updated", payload: { projectId, team, action: "added" } });
        // The newly-granted team's members can now see this project.
        broadcastToUsers(await projectService.getTeamMemberIds(teamId), { type: "project:list:stale", payload: {} });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "project:teams:remove": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId, teamId } = msg.payload as { projectId: string; teamId: string };
        if (!(await projectService.userCanManageProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized to manage this project" } });
          return true;
        }
        // Capture members before removal so we can tell them to refresh.
        const affected = await projectService.getTeamMemberIds(teamId);
        await projectService.removeProjectTeam(projectId, teamId);
        send(ws, { type: "project:teams:updated", payload: { projectId, teamId, action: "removed" } });
        broadcastToUsers(affected, { type: "project:list:stale", payload: {} });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "project:members:set-role": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "error", payload: { message: "Not authenticated" } }); return true; }
        const { projectId, userId, role } = msg.payload as { projectId: string; userId: string; role: "owner" | "member" };
        if (!(await projectService.userCanManageProject(callerId, projectId))) {
          send(ws, { type: "error", payload: { message: "Not authorized to manage this project" } });
          return true;
        }
        const member = await projectService.setProjectMemberRole(projectId, userId, role);
        send(ws, { type: "project:members:updated", payload: { projectId, member, action: "role-updated" } });
      } catch (err) {
        send(ws, { type: "error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
