---
type: Architecture Concept
title: Claude Hardening (Egress Firewall + Managed Settings)
description: How Genie constrains the always-bypass Claude sessions on a VM — managed settings that deny credential reads, plus a genie-UID egress allowlist firewall managed from the UI over vps:firewall:*.
resource: https://github.com/paulbrie/genie/blob/main/packages/manager/src/handlers/firewall-handler.ts
tags: [security, claude, firewall, egress, iptables, ipset, managed-settings, vps, prompt-injection]
timestamp: 2026-07-31T00:00:00Z
---

Every Claude session Genie launches on a VM runs as the `genie` user with
`--dangerously-skip-permissions` (`chat/vps-agent-router.ts`,
`ssh/claude-stream/session.ts`), relying on the VM boundary instead of
per-tool prompts. **Claude Hardening** is the pair of controls that bound
what such a session can do — modeled on the recommendations in Anthropic's
devcontainer reference, adapted to Genie's VM-per-project world. Both are
applied by the [Genie Standard Setup](../recipes/genie-standard.md) recipe;
the firewall is additionally manageable per-VM from the UI.

The threat this addresses: with bypass on, a prompt-injected session can
read anything the `genie` user can — including the on-VM Claude OAuth
credentials (auth is deliberately local per VM) — and POST it anywhere.
Hardening cuts both halves: the deny rules make the credential files
invisible to Claude's tools, and the egress allowlist removes the
"anywhere" (a curl to an unlisted host is rejected in the OUTPUT chain).

# Layer 1 — managed settings (policy)

The recipe writes `/etc/claude-code/managed-settings.json`, which sits at
the **top of Claude Code's settings precedence** and applies even under
bypass-permissions:

* `permissions.deny` — blocks Claude's Read/Write tools from
  `/home/genie/.claude/**`, `/home/genie/.claude.json*` (OAuth
  credentials, session history) and `/home/genie/.ssh/**`.
* `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` — kills telemetry /
  Sentry / Statsig, so those hosts need no firewall exceptions.

Deny rules gate Claude's *tools*, not the CLI's own file access — the CLI
still reads its credentials internally, so per-VM interactive login keeps
working.

# Layer 2 — egress allowlist firewall (network)

`/usr/local/sbin/genie-firewall` (installed with a oneshot
`genie-firewall.service` + 10-minute `genie-firewall.timer`) confines the
**`genie` UID's** outbound traffic via an iptables `owner`-match chain
(`GENIE_EGRESS` in OUTPUT) backed by an ipset:

* Allowed: loopback, established/related (covers Manager-initiated SSH),
  DNS, all RFC1918 ranges (Manager REST, WireGuard nets), and every IP
  resolved from `/etc/genie/firewall-allow.txt`. Everything else is
  logged (`genie-egress-block:` kernel prefix, rate-limited) and rejected.
  IPv6 is rejected outright for genie (Taz v6 is broken anyway — see
  taz-ipv6-quirk) so it can't become the bypass path.
* Root and other users are untouched — apt, recipe installs, and the
  Manager's flows keep working.
* The allowlist (one domain or IPv4 per line, `#` comments) is seeded only
  if absent, so per-VM additions survive recipe re-applies. Defaults cover
  Anthropic (inference + OAuth), npm/NuGet/PyPI/GitHub, every host recipes
  download from *as genie* on Re-apply (nodesource, code-server.dev,
  dot.net, playwright CDN, dl.google.com), and the Google Fonts hosts the
  default Next.js template fetches. The Manager's own IP is auto-added
  from `$SSH_CONNECTION` at install time so REST MCP calls keep working.
* Hardening choices learned the hard way: applies are serialized with
  `flock` (a concurrent timer-fire + manual apply raced the shared temp
  ipset to *empty* on first enable), and an empty DNS resolution is never
  swapped in when the file has entries (protects against DNS-not-up at
  boot; the timer retries).

The recipe gates this layer behind the `CLAUDE_EGRESS` option
(`enforce`, the default, or `off`).

# Management surface (vps:firewall:*)

`handlers/firewall-handler.ts` exposes four WS verbs, replying on
`vps:firewall:result`, gated by `userCanSeeProject` plus an explicit
`vps:firewall` [ACL entry](./access-control.md):

* `status` — one SSH exec: enforcement state + allowed-IP count, the
  parsed allowlist (with protected flags), and 24 h of kernel-log blocks
  grouped by destination, PTR-resolved manager-side.
* `add` / `remove` — validate a bare domain/IPv4, append with a
  provenance comment or awk-filter the line out, then re-apply — but only
  when enforcement is currently on (a bare apply would silently re-enable
  a firewall the user just switched off). `api.anthropic.com` and the
  auto-added manager IP are removal-protected.
* `toggle` — off runs `genie-firewall off` + disables the units; on
  **always re-runs the full `GENIE_FIREWALL_SETUP_SCRIPT`** (exported from
  `default-recipes.ts`, so recipe and handler share one script by
  construction — the code-server pattern). Idempotent, and it self-heals
  script drift on VMs installed by older versions.

The renderer card (`components/project/vps-egress-firewall.tsx`, shown in
the Manage popup's Firewall tab and the project VM card) renders the
allowlist as removable chips, an add input, and the recent-blocks list
with one-click **+ Allow** — which is how missing domains are discovered
in practice.

**The write path is deliberately UI-only.** Never expose these verbs (or
equivalent shell) as an agent/MCP tool: a prompt-injected session could
otherwise allowlist its own exfiltration host, defeating the firewall.

# Honest limits

This raises the bar; it is not a jail. `genie` has passwordless sudo, so a
session that *chooses* to can disable the firewall; Docker container
traffic (FORWARD chain — the agents sandbox) is not filtered; DNS is open
(tunneling). A real jail requires dropping NOPASSWD sudo — a larger
redesign. Also note WebFetch from a VM session only reaches allowlisted
hosts (WebSearch is server-side and unaffected).

# Citations

[1] [firewall-handler.ts — vps:firewall:* verbs](https://github.com/paulbrie/genie/blob/main/packages/manager/src/handlers/firewall-handler.ts)
[2] [GENIE_FIREWALL_SETUP_SCRIPT + managed settings — default-recipes.ts](https://github.com/paulbrie/genie/blob/main/packages/manager/src/default-recipes.ts)
[3] [vps-egress-firewall.tsx — the Claude egress card](https://github.com/paulbrie/genie/blob/main/packages/renderer/src/components/project/vps-egress-firewall.tsx)
[4] [Anthropic devcontainer reference (init-firewall.sh)](https://code.claude.com/docs/en/devcontainer)
