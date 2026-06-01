#!/usr/bin/env node

import fs from "node:fs";
import { collectStats } from "./collect.js";
import type { StatsOutboundMessage } from "./types.js";

/** NDJSON log written by the on-VM systemd unit (Genie Standard Setup). */
export const DEFAULT_STATS_JSONL_PATH = "/run/genie/stats.jsonl";

function parseArgv(argv: string[]): { intervalMs: number; outputPath: string | null } {
  let intervalMs = 5000;
  let outputPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--interval" && argv[i + 1]) {
      const sec = parseFloat(argv[i + 1]);
      if (!Number.isNaN(sec) && sec > 0) intervalMs = Math.round(sec * 1000);
    }
    if (argv[i] === "--output" && argv[i + 1]) {
      outputPath = argv[i + 1];
    }
  }
  return { intervalMs, outputPath };
}

function emit(msg: StatsOutboundMessage, outputPath: string | null): void {
  const line = JSON.stringify(msg) + "\n";
  process.stdout.write(line);
  if (outputPath) {
    fs.appendFileSync(outputPath, line);
  }
}

/**
 * Optional HTTPS postback: when the manager injects GENIE_MANAGER_URL +
 * GENIE_STATS_TOKEN (via the genie-stats systemd drop-in), POST each sample
 * to the manager instead of relying on it to tail us over SSH. Best-effort —
 * failures are logged and swallowed so the collection loop never dies.
 */
interface PostbackConfig {
  url: string;
  token: string;
  projectId: string;
  instanceId: string;
}

function readPostbackConfig(): PostbackConfig | null {
  const base = process.env.GENIE_MANAGER_URL?.trim();
  const token = process.env.GENIE_STATS_TOKEN?.trim();
  const projectId = process.env.GENIE_PROJECT_ID?.trim();
  const instanceId = process.env.GENIE_INSTANCE_ID?.trim();
  if (!base || !token || !projectId || !instanceId) return null;
  return { url: `${base.replace(/\/+$/, "")}/api/vps/stats`, token, projectId, instanceId };
}

async function postback(cfg: PostbackConfig, msg: StatsOutboundMessage): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({
        projectId: cfg.projectId,
        instanceId: cfg.instanceId,
        ts: msg.ts,
        stats: msg.stats,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      process.stderr.write(`[genie-stats-daemon] postback HTTP ${res.status}\n`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[genie-stats-daemon] postback failed: ${message}\n`);
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const { intervalMs, outputPath } = parseArgv(process.argv.slice(2));
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, "");
    } catch {
      // RuntimeDirectory may not exist yet; append will fail loudly if so.
    }
  }

  const postbackCfg = readPostbackConfig();
  if (postbackCfg) {
    process.stderr.write(`[genie-stats-daemon] postback enabled → ${postbackCfg.url}\n`);
  }

  let prevCpu: { total: number; idle: number } | null = null;
  let first = true;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { stats, cpuSample } = await collectStats({
      prevCpu: prevCpu,
      warmCpu: first,
    });
    first = false;
    prevCpu = cpuSample;

    const msg: StatsOutboundMessage = { type: "stats", ts: Date.now(), stats };
    emit(msg, outputPath);
    if (postbackCfg) await postback(postbackCfg, msg);

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[genie-stats-daemon] fatal: ${message}\n`);
  process.exit(1);
});
