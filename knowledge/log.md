# Genie Knowledge Bundle — Update Log

## 2026-07-31
* **Creation**: Added [Claude Hardening](/security/claude-hardening.md) — managed settings denying credential reads + the genie-UID egress allowlist firewall (`genie-firewall`, `vps:firewall:*` UI management), and its honest limits.

## 2026-07-29
* **Creation**: Added [Browser→VM Code Proxy](/vps/code-server-proxy.md) — the "Open in VS Code" flow: the code-server recipe, the `vps:code` state machine with detached installs, and the Manager's SSH-tunneled HTTP/WebSocket proxy with HMAC-token access.

## 2026-06-14
* **Initialization**: Created the bundle root and the `recipes/` section.
* **Creation**: Established the [Recipe](/recipes/recipe.md) concept document.
* **Creation**: Added [Genie Standard Setup](/recipes/genie-standard.md) as a worked Recipe instance.
* **Creation**: Added [Access Control Layers](/security/access-control.md) — the four-layer role-gating pattern.
* **Creation**: Added [Agents](/agents/architecture.md) — the user-defined AI agent subsystem (sandboxed runs on a project VPS).
