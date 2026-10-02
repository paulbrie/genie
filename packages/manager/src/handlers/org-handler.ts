import { type WebSocket } from "ws";
import { eq, inArray } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import * as orgService from "../org-service.js";
import { getDb } from "../db/index.js";
import { teams } from "../db/schema.js";
import { generateEd25519KeyPair, sshKeyFingerprint } from "../vps/do-provision.js";
import { applyTazcloudFirewallPreset, cleanupTazcloudVmReferences } from "../vps/tazcloud-provision.js";
import { broadcastProjectList } from "../ws-server.js";


/** Handle every `org:*` message. Returns true if handled. The "org" namespace
 *  is open to "user" — each handler re-checks `orgService.userCanManageOrg`
 *  before acting on a specific org. */
export async function handleOrgMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  userId: string,
  impersonatedBy: string | null,
): Promise<boolean> {
  switch (msg.type) {
    case "org:list-mine": {
      try {
        const orgs = await orgService.listManageable(userId);
        let myTeams: Array<{ id: string; name: string; orgId: string; orgName: string }> = [];
        if (orgs.length > 0) {
          const orgIdToName = new Map(orgs.map((o) => [o.id, o.name]));
          const rows = await getDb()
            .select({ id: teams.id, name: teams.name, orgId: teams.orgId })
            .from(teams)
            .where(inArray(teams.orgId, orgs.map((o) => o.id)));
          myTeams = rows
            .filter((r): r is { id: string; name: string; orgId: string } => r.orgId !== null)
            .map((r) => ({ id: r.id, name: r.name, orgId: r.orgId, orgName: orgIdToName.get(r.orgId) ?? "" }));
        }
        console.log(`[org:list-mine] caller=${userId} (impersonatedBy=${impersonatedBy ?? "—"}) → ${orgs.length} org(s), ${myTeams.length} team(s)`);
        send(ws, { type: "org:list-mine", payload: { orgs, teams: myTeams } });
      } catch (err) {
        console.error("[org:list-mine] failed:", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:get": {
      try {
        const { orgId } = msg.payload as { orgId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized to manage this org" } });
          return true;
        }
        const org = await orgService.getOrg(orgId);
        if (!org) { send(ws, { type: "org:error", payload: { orgId, message: "Org not found" } }); return true; }
        const members = await orgService.getMembers(orgId);
        const credentials = await orgService.getCredentialStatus(orgId);
        const orgTeams = await getDb().select().from(teams).where(eq(teams.orgId, orgId));
        const teamMembersList = await orgService.getTeamMembersForOrg(orgId);
        const invites = await orgService.listTeamInvites(orgId);
        send(ws, {
          type: "org:get",
          payload: { org, members, teams: orgTeams, teamMembers: teamMembersList, invites, credentials },
        });
      } catch (err) {
        console.error("[org:get]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:teams:create": {
      try {
        const { orgId, name } = msg.payload as { orgId: string; name: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const team = await orgService.createTeamForOrg(orgId, name);
        send(ws, { type: "org:teams:created", payload: { orgId, team } });
      } catch (err) {
        console.error("[org:teams:create]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:teams:update": {
      try {
        const { orgId, teamId, name } = msg.payload as { orgId: string; teamId: string; name: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const team = await orgService.updateTeamForOrg(orgId, teamId, name);
        if (!team) { send(ws, { type: "org:error", payload: { orgId, message: "Team not found" } }); return true; }
        send(ws, { type: "org:teams:updated", payload: { orgId, team } });
      } catch (err) {
        console.error("[org:teams:update]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:teams:delete": {
      try {
        const { orgId, teamId } = msg.payload as { orgId: string; teamId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        await orgService.deleteTeamForOrg(orgId, teamId);
        send(ws, { type: "org:teams:deleted", payload: { orgId, teamId } });
      } catch (err) {
        console.error("[org:teams:delete]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:teams:remove-member": {
      try {
        const { orgId, memberId } = msg.payload as { orgId: string; memberId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        await orgService.removeTeamMemberForOrg(orgId, memberId);
        send(ws, { type: "org:teams:member-removed", payload: { orgId, memberId } });
      } catch (err) {
        console.error("[org:teams:remove-member]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:invite:create": {
      try {
        const { orgId, teamId } = msg.payload as { orgId: string; teamId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const invite = await orgService.createTeamInvite(orgId, teamId, userId);
        send(ws, { type: "org:invite:created", payload: { orgId, invite } });
      } catch (err) {
        console.error("[org:invite:create]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:invite:revoke": {
      try {
        const { orgId, inviteId } = msg.payload as { orgId: string; inviteId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        await orgService.revokeTeamInvite(orgId, inviteId);
        send(ws, { type: "org:invite:revoked", payload: { orgId, inviteId } });
      } catch (err) {
        console.error("[org:invite:revoke]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:invite:accept": {
      try {
        const { token } = msg.payload as { token: string };
        const result = await orgService.acceptTeamInvite(token, userId);
        if (!result) {
          send(ws, { type: "org:invite:accept:error", payload: { message: "Invite link is invalid, expired, or revoked" } });
          return true;
        }
        send(ws, { type: "org:invite:accepted", payload: result });
      } catch (err) {
        console.error("[org:invite:accept]", err);
        send(ws, { type: "org:invite:accept:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:members:remove": {
      try {
        const { orgId, userId: targetUserId } = msg.payload as { orgId: string; userId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        await orgService.removeMember(orgId, targetUserId);
        send(ws, { type: "org:members:removed", payload: { orgId, userId: targetUserId } });
      } catch (err) {
        console.error("[org:members:remove]", err);
        send(ws, { type: "org:error", payload: { orgId: (msg.payload as { orgId?: string }).orgId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:members:set-role": {
      try {
        const { orgId, userId: targetUserId, role } = msg.payload as { orgId: string; userId: string; role: orgService.OrgRole };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const member = await orgService.setMemberRole(orgId, targetUserId, role);
        if (!member) { send(ws, { type: "org:error", payload: { orgId, message: "Member not found" } }); return true; }
        send(ws, { type: "org:members:role-updated", payload: { orgId, member } });
      } catch (err) {
        console.error("[org:members:set-role]", err);
        send(ws, { type: "org:error", payload: { orgId: (msg.payload as { orgId?: string }).orgId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:cloud:taz:credentials:set": {
      try {
        const { orgId, token, sshPrivateKey } = msg.payload as { orgId: string; token?: string; sshPrivateKey?: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const items: Array<{ kind: "tazcloud-token" | "tazcloud-ssh-key"; plaintext: string }> = [];
        if (token && token.trim()) items.push({ kind: "tazcloud-token", plaintext: token.trim() });
        if (sshPrivateKey && sshPrivateKey.trim()) items.push({ kind: "tazcloud-ssh-key", plaintext: sshPrivateKey.trim() });
        if (items.length === 0) {
          send(ws, { type: "org:error", payload: { orgId, message: "Provide a TazCloud token or SSH private key." } });
          return true;
        }
        await orgService.setCredentials(orgId, items, userId);
        const credentials = await orgService.getCredentialStatus(orgId);
        send(ws, { type: "org:cloud:taz:credentials:status", payload: { orgId, credentials } });
      } catch (err) {
        console.error("[org:cloud:taz:credentials:set]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:cloud:taz:credentials:clear": {
      try {
        const { orgId } = msg.payload as { orgId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        await orgService.clearCredential(orgId, "tazcloud-token");
        await orgService.clearCredential(orgId, "tazcloud-ssh-key");
        const credentials = await orgService.getCredentialStatus(orgId);
        send(ws, { type: "org:cloud:taz:credentials:status", payload: { orgId, credentials } });
      } catch (err) {
        console.error("[org:cloud:taz:credentials:clear]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:ssh-key:generate": {
      try {
        const { orgId } = msg.payload as { orgId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const { privateKey, publicKey } = await generateEd25519KeyPair("genie-org-taz");
        const fingerprint = sshKeyFingerprint(publicKey);
        send(ws, {
          type: "org:ssh-key:generated",
          payload: { orgId, privateKey, publicKey: publicKey.trim(), fingerprint },
        });
      } catch (err) {
        console.error("[org:ssh-key:generate]", err);
        send(ws, { type: "org:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:cloud:taz:vms:list": {
      try {
        const { orgId } = msg.payload as { orgId: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const client = await orgService.getTazClientForOrg(orgId);
        if (!client) {
          send(ws, { type: "org:cloud:taz:vms:list", payload: { orgId, vms: [], error: "No TazCloud token set for this org. Set credentials first." } });
          return true;
        }
        const vms = await client.listVms();
        send(ws, { type: "org:cloud:taz:vms:list", payload: { orgId, vms } });
      } catch (err) {
        console.error("[org:cloud:taz:vms:list]", err);
        const { orgId } = (msg.payload || {}) as { orgId?: string };
        send(ws, { type: "org:cloud:taz:vms:list", payload: { orgId, vms: [], error: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:cloud:taz:vms:create": {
      try {
        const { orgId, name, image, size, snapshot_id, project_id } = msg.payload as { orgId: string; name: string; image?: string; size?: string; snapshot_id?: string; project_id?: string };
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const client = await orgService.getTazClientForOrg(orgId);
        if (!client) {
          send(ws, { type: "org:cloud:taz:vms:create:error", payload: { orgId, message: "No TazCloud token set for this org." } });
          return true;
        }
        const vm = await client.createVm({ name, image, size, snapshot_id, project_id });
        send(ws, { type: "org:cloud:taz:vms:created", payload: { orgId, vm } });
        const orgSshKey = await orgService.getTazSshKeyForOrg(orgId);
        applyTazcloudFirewallPreset(vm, orgSshKey, `org:${orgId}`);
      } catch (err) {
        console.error("[org:cloud:taz:vms:create]", err);
        const { orgId } = (msg.payload || {}) as { orgId?: string };
        send(ws, { type: "org:cloud:taz:vms:create:error", payload: { orgId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "org:cloud:taz:vms:delete": {
      const { orgId, vmId } = (msg.payload || {}) as { orgId?: string; vmId?: string };
      try {
        if (!orgId || !vmId) { send(ws, { type: "org:error", payload: { orgId, message: "orgId and vmId are required" } }); return true; }
        if (!(await orgService.userCanManageOrg(userId, orgId))) {
          send(ws, { type: "org:error", payload: { orgId, message: "Not authorized" } });
          return true;
        }
        const client = await orgService.getTazClientForOrg(orgId);
        if (!client) {
          send(ws, { type: "org:cloud:taz:vms:delete:error", payload: { orgId, vmId, message: "No TazCloud token set for this org." } });
          return true;
        }
        await client.deleteVm(vmId);
        await cleanupTazcloudVmReferences(vmId, broadcastProjectList);
        send(ws, { type: "org:cloud:taz:vms:deleted", payload: { orgId, vmId } });
      } catch (err) {
        console.error("[org:cloud:taz:vms:delete]", err);
        send(ws, { type: "org:cloud:taz:vms:delete:error", payload: { orgId, vmId, message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
