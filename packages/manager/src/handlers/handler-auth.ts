// Per-resource authorization helpers shared across the WS handlers.
//
// The WS ACL (ws-acl.ts) only gates by role *tier* — it answers "may a `user`
// send this message type at all", not "may THIS user touch THIS project". Each
// handler that resolves a server/resource from a client-supplied id is
// responsible for the per-resource check; these helpers keep that check in one
// place so it can't drift between handlers.

import * as projectService from "../projects/project-service.js";
import { isPrivilegedRole, type Role } from "../auth/ws-acl.js";

/**
 * May this caller reach `projectId`? Privileged roles (tazcloud/admin/
 * superadmin) bypass the per-project membership check, matching the cloud/
 * deploy handlers. A null/undefined projectId is "nothing to gate" → allowed,
 * so a handler can call this unconditionally on `msg.payload?.projectId`.
 */
export async function canAccessProject(
  userId: string | null,
  role: Role | null,
  projectId: string | null | undefined,
): Promise<boolean> {
  if (!projectId) return true;
  if (isPrivilegedRole(role)) return true;
  return projectService.userCanSeeProject(userId, projectId);
}

/**
 * Role-tier gate (defense in depth behind the WS ACL) for handlers whose whole
 * namespace is privileged — e.g. db:* requires admin, recipes:* requires
 * superadmin. `superadmin` satisfies every tier.
 */
export function hasRole(role: Role | null, min: "admin" | "superadmin"): boolean {
  if (role === "superadmin") return true;
  return min === "admin" && role === "admin";
}
