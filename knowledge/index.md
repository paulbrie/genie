---
okf_version: "0.1"
---

# Genie Knowledge Bundle

A small [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle that describes concepts from the Genie codebase in a human- and
agent-friendly form. Each `.md` file (other than `index.md` / `log.md`) is a
single concept with YAML frontmatter and a markdown body.

# Concepts

* [Recipes](recipes/) - how Genie checks, installs, and uninstalls a piece of software on a VPS over SSH.
* [Agents](agents/architecture.md) - user-defined AI agents that run in a Docker sandbox on a project's VPS.
* [Access Control Layers](security/access-control.md) - the four-layer defense-in-depth pattern that gates a feature to a role.
* [Claude Hardening](security/claude-hardening.md) - managed settings + the genie-UID egress allowlist firewall that bound what a bypass-permissions Claude session on a VM can read and reach.
* [Browser→VM Code Proxy](vps/code-server-proxy.md) - how "Open in VS Code" serves code-server on a VPS through the Manager over SSH, with token-gated access and no per-VM domain configuration.

# Log

See [log.md](log.md) for the bundle's change history.
