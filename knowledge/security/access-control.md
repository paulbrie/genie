---
type: Architecture Concept
title: Access Control Layers
description: Genie's defense-in-depth pattern for gating a feature to a role — two client layers for UX, two server layers for real enforcement — using the superadmin-only Concepts panel as the worked example.
resource: https://github.com/paulbrie/genie/blob/main/packages/manager/src/auth/ws-acl.ts
tags: [security, auth, roles, superadmin, defense-in-depth]
timestamp: 2026-06-14T00:00:00Z
---

Genie gates role-restricted features with **four independent checks** so no
single layer is load-bearing. The first two run in the renderer (client) and are
about UX; the last two run in the manager (server) and are the real security
boundary — the server never trusts the client. The **Concepts** panel itself is
the canonical example: it is superadmin-only at all four layers.

# The four layers

1. **Sidebar visibility** (client, cosmetic) — `sidebar-nav.tsx`. The nav item is
   filtered out unless `role === "superadmin"`, so non-superadmins never see the
   entry point. Hiding only; not security on its own.
2. **Route guard** (client, navigation) — `routes.ts` → `navAllowedForRole`.
   Typing the URL directly (e.g. `/knowledge`) is bounced for anyone the guard
   doesn't allow. The nav key is absent from `ADMIN_NAVS` / `STANDARD_USER_NAVS`
   / `TAZCLOUD_EXTRA_NAVS`, so only superadmin passes.
3. **WebSocket ACL** (server, transport) — `auth/ws-acl.ts`. The first real
   enforcement: each message is checked before dispatch. A namespace entry like
   `knowledge: { send: "superadmin", receive: "superadmin" }` rejects every
   `knowledge:*` message from a non-superadmin and makes replies undeliverable to
   them. Subtypes inherit via longest-prefix match.
4. **Handler check** (server, business logic) — the handler re-checks with
   `hasRole(role, "superadmin")` at the point the DB / disk work happens, so a
   future loosening of the ACL still can't open a hole.

# Request flow

| Role | Sidebar | Route guard | WS ACL | Handler | Result |
| --- | --- | --- | --- | --- | --- |
| superadmin | sees item | allowed | allowed | `hasRole` ✓ | data / mutation |
| admin / user | hidden | redirected | rejected | (never reached) | blocked |

# Why split client vs. server

- **Layers 1–2 (client)** are convenience — don't show or route to something the
  user can't use. Easy to bypass, so never trusted for security.
- **Layers 3–4 (server)** are the boundary — role is enforced at the transport
  and re-checked at the handler. Either alone would secure the data; both means a
  single mistake doesn't expose it.

# Scope

This pattern gates **who** (a role), not **which rows** — it is not per-tenant
scoping. Every superadmin sees the entire Concepts bundle. For per-record access,
add ownership/visibility checks in the handler on top of these layers.
