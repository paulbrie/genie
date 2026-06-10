// Built-in Claude Code plugins — seeded into the `claude_plugins` DB table on
// manager boot. Same lifecycle as `default-recipes.ts`: the DB is the runtime
// source of truth, this file is the boot seed, and superadmins refine the
// catalog from the UI afterwards.
//
// Each plugin's check/install/uninstall scripts run as the SSH-connected user
// on the target VM. For Genie VMs that's the `genie` user, so plugins land in
// /home/genie/.claude. All built-in entries install via the official Claude
// Code marketplace (`claude plugin install <slug>@claude-plugins-official`) —
// the plugin's manifest declares whether it ships an MCP server, slash
// commands, agents, or skills, and Claude wires them in. Scripts use
// BASH_HELPERS from default-recipes for the shared log/force_ipv4_dns/wait_apt
// helpers — Taz VMs have v6-routing quirks against Cloudflare/Fastly CDNs.
import type { ClaudePluginInput } from "./claude-plugins-service.js";
import { BASH_HELPERS } from "./default-recipes.js";

export const DEFAULT_CLAUDE_PLUGINS: ClaudePluginInput[] = [
  {
    slug: "chrome-devtools-mcp",
    label: "Chrome DevTools MCP",
    icon: "Chrome",
    description: "Browser automation & debugging — drive Chrome from Claude (click, evaluate, screenshot, network/console inspection, performance traces).",
    homepageUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    checkScript: `if command -v claude > /dev/null 2>&1 && command -v jq > /dev/null 2>&1 && claude plugin list --json 2>/dev/null | jq -e '.[] | select(.id == "chrome-devtools-mcp@claude-plugins-official")' > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}
force_ipv4_dns
log "Installing Chrome DevTools MCP plugin for Claude Code..."
if ! command -v claude > /dev/null 2>&1; then
  log "Claude Code CLI not found — install Genie Standard Setup first."; exit 1
fi
if ! command -v jq > /dev/null 2>&1; then
  log "Installing jq..."
  if command -v apt-get > /dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y jq;
  elif command -v dnf > /dev/null 2>&1; then sudo dnf install -y jq;
  else log "Cannot install jq automatically — install it and re-run."; exit 1; fi
fi
claude plugin install chrome-devtools-mcp@claude-plugins-official
log "Chrome DevTools MCP installed. Re-open any active Claude Code session for the plugin to be picked up."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing Chrome DevTools MCP plugin..."
claude plugin uninstall chrome-devtools-mcp@claude-plugins-official -y
log "Done. Re-open any active Claude Code session."`,
  },
  {
    slug: "playwright",
    label: "Playwright",
    icon: "TestTube",
    description: "Cross-browser automation via Playwright — drive Chromium/Firefox/WebKit from Claude for end-to-end testing and scripted browsing. Wraps the @playwright/mcp server via Claude's plugin manifest.",
    homepageUrl: "https://github.com/microsoft/playwright-mcp",
    checkScript: `if command -v claude > /dev/null 2>&1 && command -v jq > /dev/null 2>&1 && claude plugin list --json 2>/dev/null | jq -e '.[] | select(.id == "playwright@claude-plugins-official")' > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}
force_ipv4_dns
log "Installing Playwright plugin for Claude Code..."
if ! command -v claude > /dev/null 2>&1; then
  log "Claude Code CLI not found — install Genie Standard Setup first."; exit 1
fi
if ! command -v jq > /dev/null 2>&1; then
  log "Installing jq..."
  if command -v apt-get > /dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y jq;
  elif command -v dnf > /dev/null 2>&1; then sudo dnf install -y jq;
  else log "Cannot install jq automatically — install it and re-run."; exit 1; fi
fi
claude plugin install playwright@claude-plugins-official
log "Playwright installed. Re-open any active Claude Code session for the plugin to be picked up."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing Playwright plugin..."
claude plugin uninstall playwright@claude-plugins-official -y
log "Done. Re-open any active Claude Code session."`,
  },
  {
    slug: "frontend-design",
    label: "Frontend Design",
    icon: "Palette",
    description: "Create distinctive, production-grade frontend interfaces with high design quality. Generates creative, polished code that avoids generic AI aesthetics — useful when building web components, pages, or apps.",
    homepageUrl: "https://github.com/anthropics/claude-code",
    checkScript: `if command -v claude > /dev/null 2>&1 && command -v jq > /dev/null 2>&1 && claude plugin list --json 2>/dev/null | jq -e '.[] | select(.id == "frontend-design@claude-plugins-official")' > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}
force_ipv4_dns
log "Installing Frontend Design plugin for Claude Code..."
if ! command -v claude > /dev/null 2>&1; then
  log "Claude Code CLI not found — install Genie Standard Setup first."; exit 1
fi
if ! command -v jq > /dev/null 2>&1; then
  log "Installing jq..."
  if command -v apt-get > /dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y jq;
  elif command -v dnf > /dev/null 2>&1; then sudo dnf install -y jq;
  else log "Cannot install jq automatically — install it and re-run."; exit 1; fi
fi
claude plugin install frontend-design@claude-plugins-official
log "Frontend Design installed. Re-open any active Claude Code session for the skill to load."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing Frontend Design plugin..."
claude plugin uninstall frontend-design@claude-plugins-official -y
log "Done. Re-open any active Claude Code session."`,
  },
  {
    slug: "superpowers",
    label: "Superpowers",
    icon: "Sparkles",
    description: "Agentic skills framework — composable skills for TDD, debugging, planning, and code review that auto-trigger during the development workflow. By Jesse Vincent (obra).",
    homepageUrl: "https://github.com/obra/superpowers",
    // Installed via Claude Code's official marketplace plugin system (NOT an
    // MCP-server-as-config). \`claude plugin list --json\` returns rows keyed by
    // "<slug>@<marketplace>" — grep for the id to detect installation. jq is
    // installed first because the install script needs it too on some images.
    checkScript: `if command -v claude > /dev/null 2>&1 && command -v jq > /dev/null 2>&1 && claude plugin list --json 2>/dev/null | jq -e '.[] | select(.id == "superpowers@claude-plugins-official")' > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}
force_ipv4_dns
log "Installing Superpowers plugin for Claude Code..."
if ! command -v claude > /dev/null 2>&1; then
  log "Claude Code CLI not found — install Genie Standard Setup first."; exit 1
fi
if ! command -v jq > /dev/null 2>&1; then
  log "Installing jq..."
  if command -v apt-get > /dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y jq;
  elif command -v dnf > /dev/null 2>&1; then sudo dnf install -y jq;
  else log "Cannot install jq automatically — install it and re-run."; exit 1; fi
fi
# Idempotent: \`claude plugin install\` is a no-op when the plugin is already
# present at the same version (it just reports the existing install).
claude plugin install superpowers@claude-plugins-official
log "Superpowers installed. Re-open any active Claude Code session for the skills to load."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing Superpowers plugin..."
# \`-y\` skips the prune confirmation prompt (required when stdin/stdout is not a
# TTY, which is always the case under our SSH exec).
claude plugin uninstall superpowers@claude-plugins-official -y
log "Done. Re-open any active Claude Code session."`,
  },
];
