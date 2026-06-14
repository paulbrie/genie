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

# Log

See [log.md](log.md) for the bundle's change history.
