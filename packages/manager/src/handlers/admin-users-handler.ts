import { type WebSocket } from "ws";
import { eq, ilike, or, sql } from "drizzle-orm";
import type { WsMessage } from "../types.js";
import { getDb } from "../db/index.js";
import { users, teams, teamMembers } from "../db/schema.js";
import { getUserById, createToken } from "../auth/auth.js";
import * as orgService from "../org-service.js";
import type { Role } from "../auth/ws-acl.js";
import {
  type ClientState,
  buildAuthPayload,
  disconnectUser,
  sendInitialData,
  broadcastPresence,
} from "../ws-server.js";


/** Handle every admin user/team/org management message:
 *  `admin:users:*`, `admin:teams:*`, `admin:orgs:*`, `admin:impersonate:*`.
 *  Returns true if handled.
 *
 *  Takes `state` (not just `userId`) because the impersonate cases mutate
 *  per-connection identity directly. */
export async function handleAdminUsersMessage(
  ws: WebSocket,
  msg: WsMessage,
  send: (ws: WebSocket, message: WsMessage) => void,
  state: ClientState,
): Promise<boolean> {
  switch (msg.type) {
    case "admin:users:list": {
      try {
        const db = getDb();
        const allUsers = await db.select().from(users).orderBy(users.createdAt);
        send(ws, { type: "admin:users:list", payload: { users: allUsers } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:users:list:paged": {
      try {
        const db = getDb();
        const { page: rawPage, pageSize: rawPageSize, search: rawSearch } = (msg.payload || {}) as {
          page?: number;
          pageSize?: number;
          search?: string;
        };
        const page = Math.max(1, Math.floor(Number(rawPage) || 1));
        const pageSize = Math.min(200, Math.max(1, Math.floor(Number(rawPageSize) || 25)));
        const search = (typeof rawSearch === "string" ? rawSearch : "").trim();
        // ilike pattern — drizzle's `ilike` already does case-insensitive match
        // on Postgres; we escape `%` / `_` so a search like "a%b" doesn't widen.
        const escaped = search.replace(/[\\%_]/g, (c) => "\\" + c);
        const where = search
          ? or(ilike(users.name, `%${escaped}%`), ilike(users.email, `%${escaped}%`))
          : undefined;
        const rows = await db
          .select()
          .from(users)
          .where(where)
          .orderBy(users.createdAt)
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(where);
        send(ws, { type: "admin:users:list:paged", payload: { users: rows, total: count, page, pageSize, search } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:users:validate": {
      try {
        const db = getDb();
        const { userId, validated } = msg.payload;
        const [updated] = await db.update(users).set({ validated }).where(eq(users.id, userId)).returning();
        send(ws, { type: "admin:users:updated", payload: { user: updated } });
        if (!validated) disconnectUser(userId);
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:users:update": {
      try {
        const db = getDb();
        const { userId, data } = msg.payload;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allowedFields: Record<string, any> = {};
        if (data.name !== undefined) allowedFields.name = data.name;
        if (data.validated !== undefined) allowedFields.validated = data.validated;
        if (data.defaultEditor !== undefined) allowedFields.defaultEditor = data.defaultEditor;
        if (data.role !== undefined) allowedFields.role = data.role;
        const [updated] = await db.update(users).set(allowedFields).where(eq(users.id, userId)).returning();
        send(ws, { type: "admin:users:updated", payload: { user: updated } });
        if (data.validated === false) disconnectUser(userId);
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:users:delete": {
      try {
        const db = getDb();
        const { userId } = msg.payload;
        await db.delete(users).where(eq(users.id, userId));
        send(ws, { type: "admin:users:deleted", payload: { userId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:impersonate:start": {
      try {
        const callerId = state.userId;
        if (!callerId) {
          send(ws, { type: "admin:error", payload: { message: "Not authenticated" } });
          return true;
        }
        const realCallerId = state.impersonatedBy ?? callerId;
        const caller = await getUserById(realCallerId);
        if (caller?.role !== "superadmin") {
          send(ws, { type: "admin:error", payload: { message: "Only superadmins can impersonate" } });
          return true;
        }
        const { userId: targetId } = msg.payload as { userId: string };
        if (!targetId || targetId === realCallerId) {
          send(ws, { type: "admin:error", payload: { message: "Invalid impersonation target" } });
          return true;
        }
        const target = await getUserById(targetId);
        if (!target || target.isAgent) {
          send(ws, { type: "admin:error", payload: { message: "Target user not found" } });
          return true;
        }
        const newToken = createToken(target.id, realCallerId);
        state.userId = target.id;
        state.user = { id: target.id, name: target.name, email: target.email, avatarUrl: target.avatarUrl };
        // Without this, ACL checks and isPrivilegedRole() keep using the
        // superadmin's role — so the impersonated org owner would still see
        // every droplet/VM in the account.
        state.role = target.role as Role;
        state.impersonatedBy = realCallerId;
        const authPayload = await buildAuthPayload(target, newToken, { id: caller.id, name: caller.name, email: caller.email });
        send(ws, { type: "auth:success", payload: authPayload });
        await sendInitialData(ws, target.id);
        broadcastPresence();
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:impersonate:stop": {
      try {
        const realCallerId = state.impersonatedBy;
        if (!realCallerId) {
          send(ws, { type: "admin:error", payload: { message: "Not currently impersonating" } });
          return true;
        }
        const caller = await getUserById(realCallerId);
        if (!caller) {
          send(ws, { type: "admin:error", payload: { message: "Original user no longer exists" } });
          return true;
        }
        const newToken = createToken(caller.id);
        state.userId = caller.id;
        state.user = { id: caller.id, name: caller.name, email: caller.email, avatarUrl: caller.avatarUrl };
        state.role = caller.role as Role;
        state.impersonatedBy = null;
        const authPayload = await buildAuthPayload(caller, newToken, null);
        send(ws, { type: "auth:success", payload: authPayload });
        await sendInitialData(ws, caller.id);
        broadcastPresence();
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:list": {
      try {
        const db = getDb();
        const allTeams = await db.select().from(teams).orderBy(teams.createdAt);
        const allMembers = await db.select().from(teamMembers);
        send(ws, { type: "admin:teams:list", payload: { teams: allTeams, members: allMembers } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:create": {
      try {
        const db = getDb();
        const { name } = msg.payload;
        const [team] = await db.insert(teams).values({ name }).returning();
        send(ws, { type: "admin:teams:created", payload: { team } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:update": {
      try {
        const db = getDb();
        const { teamId, name } = msg.payload;
        const [team] = await db.update(teams).set({ name }).where(eq(teams.id, teamId)).returning();
        send(ws, { type: "admin:teams:updated", payload: { team } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:delete": {
      try {
        const db = getDb();
        const { teamId } = msg.payload;
        await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
        await db.delete(teams).where(eq(teams.id, teamId));
        send(ws, { type: "admin:teams:deleted", payload: { teamId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:add-member": {
      try {
        const db = getDb();
        const { teamId, userId, role } = msg.payload;
        const [member] = await db.insert(teamMembers).values({ teamId, userId, role: role || "member" }).returning();
        send(ws, { type: "admin:teams:member-added", payload: { member } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:remove-member": {
      try {
        const db = getDb();
        const { memberId } = msg.payload;
        await db.delete(teamMembers).where(eq(teamMembers.id, memberId));
        send(ws, { type: "admin:teams:member-removed", payload: { memberId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:teams:set-role": {
      try {
        const db = getDb();
        const { memberId, role } = msg.payload;
        const [updated] = await db.update(teamMembers).set({ role }).where(eq(teamMembers.id, memberId)).returning();
        send(ws, { type: "admin:teams:role-updated", payload: { member: updated } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:list": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const orgs = await orgService.listManageable(callerId);
        const members: Record<string, Awaited<ReturnType<typeof orgService.getMembers>>> = {};
        for (const o of orgs) {
          members[o.id] = await orgService.getMembers(o.id);
        }
        send(ws, { type: "admin:orgs:list", payload: { orgs, members } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:create": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { name } = msg.payload as { name: string };
        if (!name?.trim()) { send(ws, { type: "admin:error", payload: { message: "Name required" } }); return true; }
        const org = await orgService.createOrg({ name: name.trim(), ownerUserId: callerId });
        const members = await orgService.getMembers(org.id);
        send(ws, { type: "admin:orgs:created", payload: { org, members } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:update": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { orgId, name } = msg.payload as { orgId: string; name: string };
        if (!(await orgService.userCanManageOrg(callerId, orgId))) {
          send(ws, { type: "admin:error", payload: { message: "Not authorized to manage this org" } });
          return true;
        }
        const org = await orgService.updateOrg(orgId, { name });
        send(ws, { type: "admin:orgs:updated", payload: { org } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:delete": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { orgId } = msg.payload as { orgId: string };
        if (!(await orgService.userCanManageOrg(callerId, orgId))) {
          send(ws, { type: "admin:error", payload: { message: "Not authorized to delete this org" } });
          return true;
        }
        await orgService.deleteOrg(orgId);
        send(ws, { type: "admin:orgs:deleted", payload: { orgId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:members:add": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { orgId, userId, role } = msg.payload as { orgId: string; userId: string; role?: orgService.OrgRole };
        if (!(await orgService.userCanManageOrg(callerId, orgId))) {
          send(ws, { type: "admin:error", payload: { message: "Not authorized to manage this org" } });
          return true;
        }
        const member = await orgService.addMember(orgId, userId, role || "member");
        send(ws, { type: "admin:orgs:member-added", payload: { orgId, member } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:members:remove": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { orgId, userId } = msg.payload as { orgId: string; userId: string };
        if (!(await orgService.userCanManageOrg(callerId, orgId))) {
          send(ws, { type: "admin:error", payload: { message: "Not authorized to manage this org" } });
          return true;
        }
        await orgService.removeMember(orgId, userId);
        send(ws, { type: "admin:orgs:member-removed", payload: { orgId, userId } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:orgs:members:set-role": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { orgId, userId, role } = msg.payload as { orgId: string; userId: string; role: orgService.OrgRole };
        if (!(await orgService.userCanManageOrg(callerId, orgId))) {
          send(ws, { type: "admin:error", payload: { message: "Not authorized to manage this org" } });
          return true;
        }
        const member = await orgService.setMemberRole(orgId, userId, role);
        send(ws, { type: "admin:orgs:member-role-updated", payload: { orgId, member } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    case "admin:users:invite": {
      try {
        const callerId = state.userId;
        if (!callerId) { send(ws, { type: "admin:error", payload: { message: "Not authenticated" } }); return true; }
        const { email, name, role, orgIds } = msg.payload as { email: string; name?: string; role?: "user" | "tazcloud" | "admin" | "superadmin"; orgIds: string[] };
        if (!email?.trim()) { send(ws, { type: "admin:error", payload: { message: "Email required" } }); return true; }
        const manageable = await orgService.manageableOrgIds(callerId);
        const manageableSet = new Set(manageable);
        for (const oid of orgIds || []) {
          if (!manageableSet.has(oid)) {
            send(ws, { type: "admin:error", payload: { message: `Not authorized to assign to org ${oid}` } });
            return true;
          }
        }
        let finalRole: "user" | "tazcloud" | "admin" | "superadmin" = role || "user";
        if ((finalRole === "admin" || finalRole === "superadmin") && state.role !== "superadmin") {
          finalRole = "user";
        }
        const { user, created } = await orgService.inviteUser({
          email: email.trim(),
          name,
          role: finalRole,
          orgIds: orgIds || [],
          addedByUserId: callerId,
        });
        send(ws, { type: "admin:users:invited", payload: { user, created, orgIds } });
      } catch (err) {
        send(ws, { type: "admin:error", payload: { message: (err instanceof Error ? err.message : String(err)) } });
      }
      return true;
    }

    default:
      return false;
  }
}
