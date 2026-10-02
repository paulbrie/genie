---
type: Architecture Concept
title: Browser→VM Code Proxy (Open in VS Code)
description: How the Files tab's "Open in VS Code" serves code-server running on a project VPS through the Manager itself — HTTP + WebSockets tunneled over SSH — with token-gated access and no per-VM domain or proxy configuration.
resource: https://github.com/paulbrie/genie/blob/main/packages/manager/src/vps/code-server-proxy.ts
tags: [vps, code-server, vscode, proxy, ssh, websocket, files-tab]
timestamp: 2026-07-29T00:00:00Z
---

The Files tab of the Manage-VM popup has an **"Open in VS Code"** strip that
launches [code-server](https://github.com/coder/code-server) (VS Code in the
browser) on the project's VPS and opens it in a new tab at

```
https://<manager>/code/<projectId>/<instanceId>/?folder=/opt/project
```

The Manager **reverse-proxies both HTTP and WebSockets to
`127.0.0.1:13337` on the VM over SSH** — a direct-TCP (`forwardOut`) channel
multiplexed on the same cached SSH session every other VM feature uses. This is
Genie's first (and so far only) **browser→VM data path**; everything else is
request/response over the app WebSocket.

# Why proxy through the Manager

The alternative — exposing code-server on the VM's own public domain — was
implemented first and abandoned because it required per-VM, per-provider
configuration that could drift:

* **TazCloud allows exactly one ingress per VM** (`ingress` is a singular
  object; `DELETE /v1/vm/{id}/ingress` takes no domain), so code-server either
  consumed the app's only domain slot or needed a local path-splitting Caddy
  the ingress had to be repointed at.
* DigitalOcean needed a different mechanism (Caddy site drop-ins), Hetzner and
  generic SSH servers had none.
* The Taz edge's WebSocket support was unverified, and on-VM proxy state could
  be silently broken by later domain changes.

Routing through the Manager deletes all of that: **any SSH-reachable server
works identically**, nothing is configured on the VM beyond code-server itself,
and the transport is the SSH path the product already depends on. Trade-offs
accepted: the Manager sits in the editor's data path (run a single replica —
it is stateful anyway), and a Manager redeploy drops live editor connections
(code-server's client auto-reconnects).

# Components

| Piece | Where | Role |
| --- | --- | --- |
| `code-server` recipe | `default-recipes.ts` | Installs code-server bound to `127.0.0.1:13337`, generates a per-VM password into `/home/genie/.config/code-server/config.yaml` (kept across re-installs), own systemd unit logging to `/var/log/code-server.log`. Also appears in the Add-ons panel. |
| `vps:code:*` handler | `handlers/code-server-handler.ts` | `status` / `ensure` state machine; replies on `vps:code:result`. Gates every call with `userCanSeeProject` (same pattern as `vps:fs:*`). |
| Proxy | `vps/code-server-proxy.ts` | Parses `/code/<p>/<i>/…`, authorizes, opens `forwardOut` to 13337, streams. WS upgrades are replayed to the backend and the byte streams spliced raw. |
| `SshSession.forwardOut` | `vps/ssh-client.ts` | Direct-TCP channel to a port as seen from the VM. |
| HTTP wiring | `ws-server.ts` | `/code/` requests are handled **before** the CORS stamp (proxied responses pass through untouched); the app `WebSocketServer` runs in `noServer` mode with manual `upgrade` routing — `/code/` upgrades go to the proxy, everything else handshakes into the app WS. |
| Renderer strip | `components/project/open-in-vscode-button.tsx` | Mounted under the FileExplorer breadcrumb. States: Set up → install progress (log tail, 3 s polling) → Open + password copy. Builds the URL from `getManagerHttpUrl()` (ws(s)→http(s)) + the relative path returned by the handler. |

# Access model

Proxy requests are plain HTTP with no WebSocket identity attached, so access is
gated by an **HMAC token bound to `(projectId, instanceId, expiry)`**:

1. The `vps:code` handler mints the token **only after** its
   `userCanSeeProject` check and returns a relative path containing it
   (`?gtoken=…`, 12 h TTL). The HMAC secret is generated once and persisted in
   the `codeProxySecret` global setting.
2. The proxy exchanges a valid `gtoken` for an `HttpOnly; Secure; SameSite=Lax`
   cookie scoped to `Path=/code/<p>/<i>` (7 d TTL) via a redirect that strips
   the token from the URL.
3. The upstream is **pinned to port 13337** — the proxy cannot be steered at
   other ports or hosts.
4. code-server's own password login sits behind all of this; the password lives
   only on the VM (the probe reads it back with `awk`; the Manager never
   stores it) and the UI copies it to the clipboard on Open.

# Install flow (detached + polled)

`ensure` never blocks on the multi-minute install. It writes the recipe's
install script to the VM and launches it with `nohup` + a pidfile, appending an
`INSTALL_OK` / `INSTALL_FAIL` sentinel to `/var/log/code-server-install.log`.
The renderer polls `vps:code:status` every 3 s and shows the log tail. This
survives popup closes, WS reconnects, and Manager restarts — and re-clicks are
idempotent (pid-alive check). Streaming progress on the request id is not
possible because the renderer's `wsRequest` resolves-and-swallows any message
carrying a known `reqId`.

# Known quirks

* code-server sets its session cookie at path `/` on the Manager origin, so
  switching between two VMs' editors in one browser re-prompts for the
  password.
* Hosted on Railway, WebSocket upgrades are exempt from request timeouts (they
  may idle indefinitely); plain HTTP streams are not — another reason the
  editor runs over WS.

# Citations

[1] [code-server-proxy.ts — token auth, HTTP proxying, WS splicing](https://github.com/paulbrie/genie/blob/main/packages/manager/src/vps/code-server-proxy.ts)
[2] [code-server-handler.ts — vps:code state machine + detached install](https://github.com/paulbrie/genie/blob/main/packages/manager/src/handlers/code-server-handler.ts)
[3] [default-recipes.ts — the code-server recipe](https://github.com/paulbrie/genie/blob/main/packages/manager/src/default-recipes.ts)
[4] [ssh-client.ts — SshSession.forwardOut](https://github.com/paulbrie/genie/blob/main/packages/manager/src/vps/ssh-client.ts)
[5] [open-in-vscode-button.tsx — the Files-tab strip](https://github.com/paulbrie/genie/blob/main/packages/renderer/src/components/project/open-in-vscode-button.tsx)
