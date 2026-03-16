import type { KnownBlock } from "@slack/types";
import type { VpsStats, VpsProcessInfo, VpsContainerStatus } from "./vps/deploy-service.js";
import type { ProjectDef } from "./types.js";

function bar(pct: number, len = 10): string {
  const filled = Math.round((pct / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

export function formatStats(stats: VpsStats, label?: string): KnownBlock[] {
  const memPct = stats.memTotalBytes ? Math.round((stats.memUsedBytes / stats.memTotalBytes) * 100) : 0;
  const diskPct = stats.diskTotalBytes ? Math.round((stats.diskUsedBytes / stats.diskTotalBytes) * 100) : 0;
  const blocks: KnownBlock[] = [];

  if (label) {
    blocks.push({ type: "header", text: { type: "plain_text", text: `📊 ${label}` } });
  }

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*CPU*\n\`${bar(stats.cpuPercent)}\` ${stats.cpuPercent}%` },
      { type: "mrkdwn", text: `*Memory*\n\`${bar(memPct)}\` ${fmtBytes(stats.memUsedBytes)} / ${fmtBytes(stats.memTotalBytes)}` },
      { type: "mrkdwn", text: `*Disk*\n\`${bar(diskPct)}\` ${fmtBytes(stats.diskUsedBytes)} / ${fmtBytes(stats.diskTotalBytes)}` },
      { type: "mrkdwn", text: `*Open Ports*\n${stats.openPorts.length > 0 ? stats.openPorts.join(", ") : "none"}` },
    ],
  });

  if (stats.processes.length > 0) {
    const top = stats.processes.slice(0, 10);
    const lines = top.map((p) => `${String(p.pid).padStart(6)} ${String(p.cpu).padStart(5)}% ${String(p.mem).padStart(6)}MB  ${p.user.padEnd(8).slice(0, 8)}  ${p.name}`);
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Top Processes*\n\`\`\`${["   PID   CPU     MEM  USER      NAME", ...lines].join("\n")}\`\`\`` },
    });
  }

  return blocks;
}

export function formatContainers(containers: VpsContainerStatus[]): KnownBlock[] {
  if (containers.length === 0) {
    return [{ type: "section", text: { type: "mrkdwn", text: "_No containers found._" } }];
  }
  const lines = containers.map((c) => {
    const icon = c.state === "running" ? "🟢" : c.state === "exited" ? "🔴" : "⚪";
    return `${icon} *${c.service || c.name}* — ${c.state} ${c.ports ? `(\`${c.ports}\`)` : ""}`;
  });
  return [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }];
}

export function formatProcesses(processes: VpsProcessInfo[]): KnownBlock[] {
  if (processes.length === 0) {
    return [{ type: "section", text: { type: "mrkdwn", text: "_No processes._" } }];
  }
  const top = processes.slice(0, 20);
  const lines = top.map((p) => `${String(p.pid).padStart(6)} ${String(p.cpu).padStart(5)}% ${String(p.mem).padStart(6)}MB  ${p.user.padEnd(8).slice(0, 8)}  ${p.name}`);
  return [{
    type: "section",
    text: { type: "mrkdwn", text: `\`\`\`${["   PID   CPU     MEM  USER      NAME", ...lines].join("\n")}\`\`\`` },
  }];
}

export function formatProjectList(projects: ProjectDef[]): KnownBlock[] {
  if (projects.length === 0) {
    return [{ type: "section", text: { type: "mrkdwn", text: "_No projects found._" } }];
  }
  const lines = projects.map((p) => {
    const instances = p.vpsInstances.length;
    const hosts = p.vpsInstances.map((i) => i.connection.host).join(", ");
    return `• *${p.name}* — ${instances} instance${instances !== 1 ? "s" : ""}${hosts ? ` (${hosts})` : ""}`;
  });
  return [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }];
}

export function formatFirewallRules(output: string): KnownBlock[] {
  return [{
    type: "section",
    text: { type: "mrkdwn", text: `\`\`\`${output.slice(0, 2900)}\`\`\`` },
  }];
}

export function formatCodeBlock(text: string, title?: string): KnownBlock[] {
  const blocks: KnownBlock[] = [];
  if (title) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${title}*` } });
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `\`\`\`${text.slice(0, 2900)}\`\`\`` },
  });
  return blocks;
}

export function formatError(msg: string): KnownBlock[] {
  return [{ type: "section", text: { type: "mrkdwn", text: `❌ ${msg}` } }];
}

export function formatSuccess(msg: string): KnownBlock[] {
  return [{ type: "section", text: { type: "mrkdwn", text: `✅ ${msg}` } }];
}
