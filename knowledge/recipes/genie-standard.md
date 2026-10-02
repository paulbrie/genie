---
type: VPS Recipe
title: Genie Standard Setup
description: The baseline software Genie expects on every VPS — deploy user, Docker, Node 20, Claude Code, and the genie-stats service.
resource: https://github.com/paulbrie/genie/blob/main/packages/manager/src/default-recipes.ts#L59
slug: genie-standard
icon: Sparkles
tags: [recipe, bootstrap, vps, baseline]
timestamp: 2026-06-14T00:00:00Z
---

`genie-standard` is the foundational [Recipe](./recipe.md) that makes a bare VM
into a Genie-ready VPS. The Manager applies it as root over SSH; once it reports
`INSTALLED`, the per-VM "Genie" button goes active.

# Provisions

* The **`genie`** deploy user — passwordless sudo, same SSH key as the admin.
* **Docker** + the compose plugin (`docker compose`).
* **Node.js 20** + `npm`.
* **Claude Code** (`claude`) and **`dtach`** (used to persist terminal sessions).
* **`/opt/project`**, owned by `genie`.
* A **`genie-stats`** systemd service (the Manager syncs the stats bundle after install).

# Schema

This is one row of the `recipes` table; see the [Recipe](./recipe.md#schema)
concept for the full field list. Notable values for this instance:

| Field    | Value                                                              |
|----------|-------------------------------------------------------------------|
| `slug`   | `genie-standard`                                                  |
| `label`  | `Genie Standard Setup`                                            |
| `icon`   | `Sparkles`                                                        |
| `port`   | `null` (provisions no single network service)                    |

# Check contract

The `checkScript` is a single idempotent expression that prints `INSTALLED` only
when **every** baseline artifact is present, else `NOT_INSTALLED`:

```bash
if id genie >/dev/null 2>&1 \
  && sudo -n test -s /home/genie/.ssh/authorized_keys \
  && command -v docker > /dev/null 2>&1 \
  && docker compose version > /dev/null 2>&1 \
  && command -v node > /dev/null 2>&1 \
  && command -v npm > /dev/null 2>&1 \
  && command -v claude > /dev/null 2>&1 \
  && command -v dtach > /dev/null 2>&1 \
  && [ -d /opt/project ] \
  && [ "$(stat -c %U /opt/project 2>/dev/null || stat -f %Su /opt/project)" = "genie" ] \
  && systemctl list-unit-files --type=service 2>/dev/null | grep -q '^genie-stats.service'; \
then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi
```

## Two non-obvious decisions

These were bug fixes worth remembering when editing the check:

* **Docker group membership is deliberately *not* checked.** `usermod -aG docker`
  only takes effect on the user's next login, and even a fresh SSH session can
  hold a stale group list (NSS cache, logind, sshd PAM session reuse). Checking it
  made the button report `NOT_INSTALLED` right after a successful install. The
  docker group is a UX nicety, not a marker of "installed".
* **`authorized_keys` is read with `sudo -n test`**, not a bare `[ -s ... ]`.
  `/home/genie/.ssh` is mode `700` and owned by `genie`; when the saved SSH user
  is the image default (`ubuntu`/`debian`/`almalinux`) the unprivileged test
  silently fails on the unreadable parent dir and reports `NOT_INSTALLED` on every
  refresh. `sudo -n` is safe here because the install itself relies on passwordless
  sudo — if install succeeded, `sudo -n` works.

# Install notes

The `installScript` calls `force_ipv4_dns` (a [`${BASH_HELPERS}`](./recipe.md#shared-bash-helpers)
helper) before fetching the NodeSource `setup_20.x` script: that script runs its
own `apt-get update` against a Cloudflare-fronted host, which stalls over IPv6 on
TazCloud VMs. Patching `/etc/gai.conf` makes all subsequent DNS prefer IPv4.

# Citations

[1] [genie-standard recipe — default-recipes.ts](https://github.com/paulbrie/genie/blob/main/packages/manager/src/default-recipes.ts#L59)
[2] [Recipe concept](./recipe.md)
