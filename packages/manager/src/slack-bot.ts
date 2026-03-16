import { App, type SlackCommandMiddlewareArgs, type AllMiddlewareArgs } from "@slack/bolt";
import * as projectService from "./project-service.js";
import { vpsStats, vpsStatus, vpsLogs, vpsTeardown } from "./vps/deploy-service.js";
import { connectSsh } from "./vps/ssh-client.js";
import type { ProjectDef, VpsInstance } from "./types.js";
import {
  formatStats,
  formatContainers,
  formatProcesses,
  formatProjectList,
  formatFirewallRules,
  formatCodeBlock,
  formatError,
  formatSuccess,
} from "./slack-formatters.js";

let app: App | null = null;

// --- Helpers ---

async function resolveProject(name?: string): Promise<{ project: ProjectDef; instance: VpsInstance } | { error: string }> {
  const projects = await projectService.getAll();
  if (projects.length === 0) return { error: "No projects found." };

  let project: ProjectDef | undefined;
  if (name) {
    project = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!project) {
      const available = projects.map((p) => p.name).join(", ");
      return { error: `Project "${name}" not found. Available: ${available}` };
    }
  } else if (projects.length === 1) {
    project = projects[0];
  } else {
    const available = projects.map((p) => p.name).join(", ");
    return { error: `Multiple projects found. Specify one: ${available}` };
  }

  if (project.vpsInstances.length === 0) {
    return { error: `Project "${project.name}" has no VPS instances deployed.` };
  }

  // Use first instance (could extend with --instance flag)
  return { project, instance: project.vpsInstances[0] };
}

function parseArgs(text: string): { subcommand: string; projectName?: string; rest: string } {
  const parts = text.trim().split(/\s+/);
  const subcommand = (parts[0] || "help").toLowerCase();

  // Check if second part is a known subcommand modifier or a project name
  let projectName: string | undefined;
  let restParts = parts.slice(1);

  // If there's a quoted project name or a simple word before the rest
  if (restParts.length > 0 && !restParts[0].startsWith("-")) {
    // Heuristic: if the rest doesn't look like a command argument, treat it as project name
    const knownFlags = ["--tail", "--service"];
    if (!knownFlags.includes(restParts[0])) {
      // Strip Slack auto-link brackets: [Medical] → Medical, <url|Medical> → Medical
      projectName = restParts[0].replace(/^\[(.+)\]$/, "$1").replace(/^<[^|]*\|(.+)>$/, "$1");
      restParts = restParts.slice(1);
    }
  }

  return { subcommand, projectName, rest: restParts.join(" ") };
}

type CmdArgs = SlackCommandMiddlewareArgs & AllMiddlewareArgs;

// --- Command handlers ---

async function handleProjects({ ack, respond }: CmdArgs) {
  await ack();
  const projects = await projectService.getAll();
  await respond({ blocks: formatProjectList(projects), response_type: "ephemeral" });
}

async function handleStats({ ack, respond }: CmdArgs, projectName?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;
  try {
    const stats = await vpsStats(instance.connection);
    await respond({ blocks: formatStats(stats, `${project.name} — ${instance.label || instance.connection.host}`), response_type: "ephemeral" });
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Failed to get stats: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleContainers({ ack, respond }: CmdArgs, projectName?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;
  try {
    const containers = await vpsStatus(project.name, instance.connection);
    await respond({
      blocks: [
        { type: "header", text: { type: "plain_text", text: `🐳 Containers — ${project.name}` } },
        ...formatContainers(containers),
      ],
      response_type: "ephemeral",
    });
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Failed to get containers: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleProcesses({ ack, respond }: CmdArgs, projectName?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;
  try {
    const stats = await vpsStats(instance.connection);
    await respond({
      blocks: [
        { type: "header", text: { type: "plain_text", text: `⚙️ Processes — ${project.name}` } },
        ...formatProcesses(stats.processes),
      ],
      response_type: "ephemeral",
    });
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Failed to get processes: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleLogs({ ack, respond }: CmdArgs, projectName?: string, rest?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;

  // Parse --service and --tail from rest
  let service: string | undefined;
  let tail = 50;
  const parts = (rest || "").split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--service" && parts[i + 1]) { service = parts[++i]; }
    else if (parts[i] === "--tail" && parts[i + 1]) { tail = parseInt(parts[++i]) || 50; }
    else if (parts[i] && !parts[i].startsWith("-")) { service = parts[i]; }
  }

  try {
    const logs = await vpsLogs(project.name, instance.connection, service, tail);
    await respond({ blocks: formatCodeBlock(logs, `Logs — ${project.name}${service ? ` / ${service}` : ""}`), response_type: "ephemeral" });
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Failed to get logs: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleExec({ ack, respond }: CmdArgs, projectName?: string, rest?: string) {
  await ack();
  if (!rest?.trim()) { await respond({ blocks: formatError("Usage: `/genie exec [project] <command>`") }); return; }
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;

  try {
    const session = await connectSsh(instance.connection, { timeoutMs: 30_000 });
    try {
      const output = await session.exec(`cd /opt/project 2>/dev/null || true; ${rest}`, undefined, { timeoutMs: 30_000 });
      await respond({ blocks: formatCodeBlock(output || "(no output)", `exec on ${project.name}`), response_type: "ephemeral" });
    } finally {
      session.close();
    }
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Exec failed: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleKill({ ack, respond }: CmdArgs, projectName?: string, rest?: string) {
  await ack();
  const pid = parseInt(rest || "");
  if (!pid) { await respond({ blocks: formatError("Usage: `/genie kill [project] <pid>`") }); return; }
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { instance } = resolved;

  try {
    const session = await connectSsh(instance.connection);
    try {
      await session.exec(`kill -9 ${pid}`);
    } finally {
      session.close();
    }
    await respond({ blocks: formatSuccess(`Process ${pid} killed.`) });
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Kill failed: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleFirewall({ ack, respond }: CmdArgs, projectName?: string, rest?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;

  const parts = (rest || "").trim().split(/\s+/);
  const action = parts[0]?.toLowerCase() || "list";

  try {
    const session = await connectSsh(instance.connection);
    try {
      let cmd: string;
      switch (action) {
        case "list":
        case "status":
          cmd = "ufw status numbered";
          break;
        case "allow":
          if (!parts[1]) { await respond({ blocks: formatError("Usage: `/genie firewall [project] allow <port>`") }); return; }
          cmd = `ufw allow ${parts[1]}/tcp && ufw status numbered`;
          break;
        case "deny":
          if (!parts[1]) { await respond({ blocks: formatError("Usage: `/genie firewall [project] deny <port>`") }); return; }
          cmd = `ufw deny ${parts[1]}/tcp && ufw status numbered`;
          break;
        case "enable":
          cmd = "ufw default deny incoming && ufw default allow outgoing && ufw --force enable && ufw status numbered";
          break;
        case "disable":
          cmd = "ufw --force disable && echo 'Firewall disabled'";
          break;
        default:
          await respond({ blocks: formatError(`Unknown firewall action: ${action}. Use: list, allow, deny, enable, disable`) });
          return;
      }
      const output = await session.exec(cmd);
      await respond({
        blocks: [
          { type: "header", text: { type: "plain_text", text: `🛡️ Firewall — ${project.name}` } },
          ...formatFirewallRules(output),
        ],
        response_type: "ephemeral",
      });
    } finally {
      session.close();
    }
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Firewall command failed: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleSshUrl({ ack, respond }: CmdArgs, projectName?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;
  const { host, port, username } = instance.connection;
  await respond({
    blocks: formatCodeBlock(`ssh ${username}@${host} -p ${port}`, `SSH — ${project.name}`),
    response_type: "ephemeral",
  });
}

async function handleRun({ ack, respond }: CmdArgs, projectName?: string, rest?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;

  if (!rest?.trim()) {
    // List available commands
    if (project.commands.length === 0) {
      await respond({ blocks: formatError(`No commands defined for ${project.name}.`) });
      return;
    }
    const lines = project.commands.map((c) => `• *${c.name}* — \`${c.command}\``);
    await respond({
      blocks: [
        { type: "header", text: { type: "plain_text", text: `📋 Commands — ${project.name}` } },
        { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
        { type: "context", elements: [{ type: "mrkdwn", text: "Run with: `/genie run [project] <command-name>`" }] },
      ],
      response_type: "ephemeral",
    });
    return;
  }

  const cmdName = rest.trim();
  const cmd = project.commands.find((c) => c.name.toLowerCase() === cmdName.toLowerCase());
  if (!cmd) {
    const available = project.commands.map((c) => c.name).join(", ");
    await respond({ blocks: formatError(`Command "${cmdName}" not found. Available: ${available || "none"}`) });
    return;
  }

  try {
    const session = await connectSsh(instance.connection, { timeoutMs: 30_000 });
    try {
      let shellCmd = cmd.command;
      if (shellCmd.includes("nohup ")) {
        const clean = shellCmd.replace(/\s*&\s*$/, "");
        shellCmd = `bash -c '${clean.replace(/'/g, "'\\''")} & disown'`;
      }
      const output = await session.exec(`cd /opt/project 2>/dev/null || true; ${shellCmd}`, undefined, { timeoutMs: 30_000 });
      await respond({ blocks: formatCodeBlock(output || "(started)", `▶️ ${cmd.name}`), response_type: "ephemeral" });
    } finally {
      session.close();
    }
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Run failed: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleTeardown({ ack, respond, command }: CmdArgs, projectName?: string) {
  await ack();
  const resolved = await resolveProject(projectName);
  if ("error" in resolved) { await respond({ blocks: formatError(resolved.error) }); return; }
  const { project, instance } = resolved;

  // Require confirmation: user must type "confirm" as the rest
  const parts = command.text.trim().split(/\s+/);
  const lastWord = parts[parts.length - 1]?.toLowerCase();
  if (lastWord !== "confirm") {
    await respond({
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `⚠️ This will destroy *${project.name}* (${instance.connection.host}). To confirm, run:\n\`/genie teardown ${project.name} confirm\`` } },
      ],
      response_type: "ephemeral",
    });
    return;
  }

  await respond({ blocks: formatSuccess(`Tearing down ${project.name}...`), response_type: "ephemeral" });
  try {
    const progress: string[] = [];
    await vpsTeardown(project.name, instance.connection, (msg) => { progress.push(msg); });
    await respond({ blocks: formatCodeBlock(progress.join("\n"), `Teardown complete — ${project.name}`), response_type: "ephemeral" });
  } catch (err: unknown) {
    await respond({ blocks: formatError(`Teardown failed: ${err instanceof Error ? err.message : String(err)}`) });
  }
}

async function handleHelp({ ack, respond }: CmdArgs) {
  await ack();
  await respond({
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🧞 Genie — Slash Commands" } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            "`/genie projects` — List all projects",
            "`/genie stats [project]` — CPU, memory, disk, processes",
            "`/genie containers [project]` — Docker container status",
            "`/genie processes [project]` — Top processes",
            "`/genie logs [project] [service]` — Container logs",
            "`/genie exec [project] <command>` — Run SSH command",
            "`/genie run [project] [command-name]` — Run or list project commands",
            "`/genie kill [project] <pid>` — Kill a process",
            "`/genie firewall [project] <list|allow|deny|enable|disable> [port]` — Manage UFW",
            "`/genie ssh-url [project]` — Show SSH connection string",
            "`/genie teardown [project] confirm` — Destroy deployment",
            "`/genie help` — This message",
          ].join("\n"),
        },
      },
      { type: "context", elements: [{ type: "mrkdwn", text: "_If there's only one project, the `[project]` argument is optional._" }] },
    ],
    response_type: "ephemeral",
  });
}

// --- Router ---

const HANDLERS: Record<string, (args: CmdArgs, projectName?: string, rest?: string) => Promise<void>> = {
  projects: handleProjects,
  stats: handleStats,
  status: handleStats,
  containers: handleContainers,
  processes: handleProcesses,
  logs: handleLogs,
  exec: handleExec,
  run: handleRun,
  kill: handleKill,
  firewall: handleFirewall,
  fw: handleFirewall,
  "ssh-url": handleSshUrl,
  ssh: handleSshUrl,
  teardown: handleTeardown,
  help: handleHelp,
};

// --- Start / Stop ---

export async function startSlackBot(): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!token || !signingSecret || !appToken) {
    console.log("[slack] Missing SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, or SLACK_APP_TOKEN — Slack bot not started");
    return;
  }

  app = new App({
    token,
    signingSecret,
    socketMode: true,
    appToken,
  });

  app.command("/genie", async (args) => {
    const { subcommand, projectName, rest } = parseArgs(args.command.text);
    const handler = HANDLERS[subcommand];
    if (handler) {
      await handler(args as CmdArgs, projectName, rest);
    } else {
      await handleHelp(args as CmdArgs);
    }
  });

  await app.start();
  console.log("[slack] Genie Slack bot started (Socket Mode)");
}

export async function stopSlackBot(): Promise<void> {
  if (app) {
    await app.stop();
    app = null;
    console.log("[slack] Genie Slack bot stopped");
  }
}
