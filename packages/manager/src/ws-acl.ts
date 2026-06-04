// WebSocket access-control list.
//
// Single source of truth for which role may emit (send) and which role may
// receive each WS message type. Pure data + pure functions; no IO. Tested in
// ws-acl.test.ts and consulted by ws-server.ts.
//
// Hierarchy (numeric levels):
//   user (0) < tazcloud (1) < admin (2) < superadmin (3)
//
// A role passes a check iff its level is >= the required level. tazcloud sits
// just above user: it gets user-level access plus the cloud panels (do:*,
// tazcloud:*, admin:droplets:*, admin:tazcloud:*).
//
// Lookup precedence (first hit wins):
//   1. ACL_OVERRIDES[type]              — exact match
//   2. NAMESPACE_DEFAULTS[longest-prefix] — walks "a:b:c" → "a:b" → "a"
//   3. POLICY                            — "deny-unknown"

export type Role = "user" | "tazcloud" | "admin" | "superadmin";

export const ROLE_LEVEL: Record<Role, number> = {
  user: 0,
  tazcloud: 1,
  admin: 2,
  superadmin: 3,
};

/** True if `role` is tazcloud or higher — the level at which a caller may
 *  exec/manage any cloud VM regardless of project ownership. Handlers use
 *  this to short-circuit the per-VM `userCanAccessVm` lookup. */
export function isPrivilegedRole(role: Role | null): boolean {
  return role === "tazcloud" || role === "admin" || role === "superadmin";
}

export interface AclEntry {
  /** Minimum role required to emit this type from client → server. Omitted → not sendable from a client. */
  send?: Role;
  /** Minimum role required to receive this type from server → client. Omitted → not deliverable. */
  receive?: Role;
  /** Documentation only; actual scoping happens via sendToUser/broadcastToUsers in the handler. */
  scope?: "self" | "owner" | "team" | "global";
  /** Optional comment. */
  notes?: string;
}

export type Policy = "deny-unknown";

export const POLICY: Policy = "deny-unknown";

// Namespace-level defaults. The lookup walks from the longest prefix down, so
// "admin:droplets" wins over "admin" for any type starting with "admin:droplets:".
const NAMESPACE_DEFAULTS: Record<string, AclEntry> = {
  // User-facing namespaces — ownership/scope is enforced inside the handler
  // (e.g. chat sessions are filtered by userId in the query).
  auth: { send: "user", receive: "user", scope: "self" },
  chat: { send: "user", receive: "user", scope: "self" },
  assistant: { send: "user", receive: "user", scope: "self" },
  compose: { send: "user", receive: "user", scope: "self" },
  content_block_delta: { receive: "user", scope: "self" },
  content_block_start: { receive: "user", scope: "self" },
  content_block_stop: { receive: "user", scope: "self" },
  message_start: { receive: "user", scope: "self" },
  message_delta: { receive: "user", scope: "self" },
  message_stop: { receive: "user", scope: "self" },
  result: { receive: "user", scope: "self" },
  project: { send: "user", receive: "user", scope: "self" },
  "project-file": { send: "user", receive: "user", scope: "self" },
  "file-template": { send: "user", receive: "user", scope: "self" },
  fs: { send: "user", receive: "user", scope: "self" },
  git: { send: "user", receive: "user", scope: "self" },
  mcp: { send: "user", receive: "user", scope: "self" },
  docs: { send: "user", receive: "user", scope: "self" },
  terminal: { send: "user", receive: "user", scope: "owner" },
  "terminal-share": { send: "user", receive: "user", scope: "owner" },
  // VM connection popup stats/tmux probe responses (vps:stats:refresh → vm:conn:stats).
  vm: { send: "user", receive: "user", scope: "owner" },
  tracker: { send: "user", receive: "user", scope: "team" },
  settings: { send: "user", receive: "user", scope: "self" },
  feedback: { send: "user", receive: "user", scope: "self" },
  updates: { send: "user", receive: "user", scope: "self" },
  vps: { send: "user", receive: "user", scope: "self" },
  extension: { send: "user", receive: "user", scope: "self" },
  error: { receive: "user", scope: "self" },
  ping: { send: "user", receive: "user" },
  pong: { send: "user", receive: "user" },
  init: { send: "user", receive: "user" },
  // presence:nav is fine for any user; presence:detail is admin-only (see ACL_OVERRIDES).
  presence: { send: "user", receive: "user" },

  // Cloud namespaces — tazcloud role can also access these.
  do: { send: "tazcloud", receive: "tazcloud" },
  tazcloud: { send: "tazcloud", receive: "tazcloud" },
  hetzner: { send: "tazcloud", receive: "tazcloud" },

  // Admin namespaces.
  admin: { send: "admin", receive: "admin" },
  // Admin-scoped orgs management — handler-level checks gate by org-ownership
  // for non-superadmins.
  "admin:orgs": { send: "admin", receive: "admin" },
  // Org-admin-scoped operations: an org owner/admin (who may otherwise be a
  // plain "user" at the system role) manages members/teams + provisions Cloud
  // servers using the org's own stored credentials. Each handler re-checks
  // userCanManageOrg(callerId, orgId); the ACL just lets the message reach
  // the handler.
  org: { send: "user", receive: "user", scope: "team", notes: "handler enforces userCanManageOrg(callerId, orgId)" },
  // The Clouds panel uses admin:droplets:*, admin:tazcloud:* and admin:hetzner:* — exposed to tazcloud.
  "admin:droplets": { send: "tazcloud", receive: "tazcloud" },
  "admin:tazcloud": { send: "tazcloud", receive: "tazcloud" },
  "admin:hetzner": { send: "tazcloud", receive: "tazcloud" },
  // Communication panel — mass-emailing the user base is superadmin-only.
  "admin:email": { send: "superadmin", receive: "superadmin" },
  db: { send: "admin", receive: "admin" },
  security: { send: "admin", receive: "admin" },
  docker: { send: "admin", receive: "admin" },
  logs: { send: "admin", receive: "admin" },
  monitor: { send: "admin", receive: "admin" },
  stats: { send: "admin", receive: "admin" },
  system: { send: "admin", receive: "admin" },
  process: { send: "admin", receive: "admin" },
  ssh: { send: "admin", receive: "admin" },

  // Superadmin-only namespace.
  recipes: { send: "superadmin", receive: "superadmin" },
};

// Per-type overrides. These win over NAMESPACE_DEFAULTS. Use sparingly — the
// namespace default should be the right answer for most types.
const ACL_OVERRIDES: Record<string, AclEntry> = {
  // Audit HIGH: don't leak emails/IPs to standard users.
  "presence:detail": { send: "user", receive: "admin", notes: "client requests it; only admin clients receive the response" },

  // Audit MEDIUM: noisy ops data.
  "monitor:interval": { receive: "admin" },

  // Admin-only inside an otherwise-user namespace.
  "vps:attach-existing": { send: "admin", receive: "user", notes: "admin command; error/ok responses still readable by the originating user" },
  "vps:attach-existing:error": { receive: "user" },
  "vps:attach-existing:ok": { receive: "user" },

  // Impersonation lifecycle.
  // start: superadmin only — before impersonation begins, the active role IS the real superadmin.
  // stop: any authenticated role — once impersonating, the active role becomes the *impersonated*
  //       user's role (often "user"). The handler verifies state.impersonatedBy is set before doing
  //       anything, so this gate just lets the message reach the handler.
  "admin:impersonate:start": { send: "superadmin", receive: "superadmin" },
  "admin:impersonate:stop": { send: "user", receive: "user" },
  "admin:impersonate:started": { receive: "user" },
  "admin:impersonate:stopped": { receive: "user" },

  // VM deletion lock: anyone with cloud-panel access (tazcloud+) can SET a lock,
  // but only a superadmin can clear it. The delete handlers re-check the lock at
  // runtime so a lower role can't unlock-then-delete in one round-trip.
  "admin:droplets:unlock": { send: "superadmin", receive: "tazcloud" },
  "admin:tazcloud:unlock": { send: "superadmin", receive: "tazcloud" },
  "admin:hetzner:unlock": { send: "superadmin", receive: "tazcloud" },

  // Recipe catalog reads inside an otherwise superadmin-only namespace. Any
  // authenticated user may LIST recipes so the Add-ons panel populates for the
  // project VMs they can manage — the list carries install scripts + metadata
  // but no secret VALUES (those are never persisted), and these users already
  // have shell access to those VMs. Mutations (recipes:create/update/delete and
  // their responses) stay superadmin via the namespace default: recipe install
  // scripts run as root on every VM, so a non-admin editing them would be a
  // privilege-escalation / supply-chain risk.
  "recipes:list": { send: "user", receive: "user", notes: "read-only catalog access for the Add-ons panel" },
  "recipes:list:stale": { receive: "user", notes: "cache-invalidation broadcast; clients refetch recipes:list" },

  // Per-VM exec inside the otherwise tazcloud+ admin:droplets / admin:tazcloud
  // namespaces. Lowered to "user" so a normal user can drive the Manage popup
  // (stats, services, recipes) for their OWN project servers. This only lets the
  // message reach the handler — the handler enforces ownership: a non-admin may
  // exec only on a droplet/VM attached to a project they can access (tazcloud+
  // bypass that check). All other admin:droplets:* / admin:tazcloud:* ops (create,
  // delete, rename, snapshot, …) stay tazcloud+ via the namespace default.
  "admin:droplets:exec": { send: "user", notes: "handler enforces project ownership for non-admins" },
  "admin:droplets:exec:result": { receive: "user" },
  "admin:droplets:exec:progress": { receive: "user" },
  "admin:tazcloud:exec": { send: "user", notes: "handler enforces project ownership for non-admins" },
  "admin:tazcloud:exec:result": { receive: "user" },
  "admin:tazcloud:exec:progress": { receive: "user" },
  "admin:hetzner:exec": { send: "user", notes: "handler enforces project ownership for non-admins" },
  "admin:hetzner:exec:result": { receive: "user" },
  "admin:hetzner:exec:progress": { receive: "user" },

  // Cloud VM *visibility* (Clouds panel, now in the left nav for everyone).
  // Lowered to "user" so org owners and plain users can list/poll the VMs they
  // have access to — the list/stats handlers filter to the caller's accessible
  // projects (privileged roles see the whole account), and resolve-ssh-user
  // re-checks per-VM ownership. All mutating ops (create/delete/rename/lock/
  // reboot/resize/domain/snapshot) stay tazcloud+ via the namespace default.
  "admin:droplets:list": { send: "user", receive: "user", notes: "handler scopes droplets to the caller's accessible projects" },
  "admin:droplets:list:stale": { receive: "user", notes: "cache-invalidation broadcast; clients refetch the scoped list" },
  "admin:droplets:stats": { send: "user", receive: "user", notes: "handler probes only the caller's accessible droplets" },
  "admin:droplets:resolve-ssh-user": { send: "user", receive: "user", notes: "handler enforces per-VM ownership for non-admins" },
  "admin:hetzner:list": { send: "user", receive: "user", notes: "handler scopes servers to the caller's accessible projects" },
  "admin:hetzner:list:stale": { receive: "user" },
  "admin:hetzner:stats": { send: "user", receive: "user", notes: "handler probes only the caller's accessible servers" },
  "admin:hetzner:resolve-ssh-user": { send: "user", receive: "user", notes: "handler enforces per-VM ownership for non-admins" },

  // Deploy (create) is available to org owners/admins too, not just tazcloud+.
  // The create handlers re-check: caller must be privileged OR manage ≥1 org.
  // Other mutations (delete/rename/reboot/…) stay tazcloud+ via the default.
  "admin:droplets:create": { send: "user", notes: "handler requires privileged role or org-admin" },
  "admin:droplets:created": { receive: "user" },
  "admin:droplets:create:error": { receive: "user" },
  "admin:hetzner:create": { send: "user", notes: "handler requires privileged role or org-admin" },
  "admin:hetzner:created": { receive: "user" },
  "admin:hetzner:create:error": { receive: "user" },

  // Deploy-and-attach-to-project from the Clouds modal: any user may deploy to a
  // project they can access (the deploy handlers re-check userCanSeeProject).
  // Progress/done/error come back over the vps:* namespace (already user-level).
  "do:deploy": { send: "user", notes: "handler enforces project access" },
  "do:cancel": { send: "user" },
  "hetzner:deploy": { send: "user", notes: "handler enforces project access" },
  "hetzner:cancel": { send: "user" },
  "admin:server:tunnel:ensure": { send: "user", notes: "open one SSH tunnel per server (handler enforces access)" },
  "admin:server:tunnel:ready": { receive: "user" },
  "admin:server:tunnel:error": { receive: "user" },
  "admin:server:tunnel:release": { send: "user" },
  // Cancel an in-flight exec by execId (a random uuid only the initiator knows),
  // so the recipes Stop button works for any role.
  "admin:exec:cancel": { send: "user" },

  // Per-project membership management. The handler enforces userCanManageProject
  // (org owner/admin of the project's org, project-level owner, or superadmin),
  // so reaching the handler is enough — admin gate at the ACL level keeps casual
  // user clients from probing the endpoint.
  "project:members:list": { send: "user", receive: "user", notes: "handler enforces userCanSeeProject" },
  "project:members:add": { send: "user", receive: "user", notes: "handler enforces userCanManageProject" },
  "project:members:remove": { send: "user", receive: "user", notes: "handler enforces userCanManageProject" },
  "project:members:set-role": { send: "user", receive: "user", notes: "handler enforces userCanManageProject" },
  "project:members:updated": { receive: "user" },

  // Dedicated error stream in /logs. The combined "manager" log source stays
  // admin (logs namespace default), but these carry a stderr-only copy that can
  // include stack traces and internal failure detail, so they're locked to
  // superadmin. Server→client only (no `send`); the client subscribes via the
  // existing logs:subscribe with { source: "errors" }.
  "logs:errors:data": { receive: "superadmin", notes: "stderr error stream broadcast; superadmin-only" },
  "logs:errors:backlog": { receive: "superadmin", notes: "stderr error backlog on subscribe; superadmin-only" },
};

/** Look up the effective ACL entry for a message type. Returns null when nothing matches and policy is deny-unknown. */
export function getEntry(type: string): AclEntry | null {
  const override = ACL_OVERRIDES[type];
  if (override) return override;
  const parts = type.split(":");
  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(":");
    const ns = NAMESPACE_DEFAULTS[prefix];
    if (ns) return ns;
  }
  return null;
}

/** True iff `role` may emit `type` from client → server. Unauthenticated (null role) is always false. */
export function canSend(role: Role | null, type: string): boolean {
  if (!role) return false;
  const entry = getEntry(type);
  if (!entry || entry.send === undefined) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[entry.send];
}

/** True iff `role` may receive `type` from server → client. */
export function canReceive(role: Role | null, type: string): boolean {
  if (!role) return false;
  const entry = getEntry(type);
  if (!entry || entry.receive === undefined) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[entry.receive];
}

// Test-only escape hatches so the unit tests can introspect the registry
// without us exporting mutable internals.
export const __internal = { NAMESPACE_DEFAULTS, ACL_OVERRIDES };
