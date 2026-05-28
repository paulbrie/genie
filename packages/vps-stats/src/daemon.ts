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

async function main(): Promise<void> {
  const { intervalMs, outputPath } = parseArgv(process.argv.slice(2));
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, "");
    } catch {
      // RuntimeDirectory may not exist yet; append will fail loudly if so.
    }
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

    emit({ type: "stats", ts: Date.now(), stats }, outputPath);

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[genie-stats-daemon] fatal: ${message}\n`);
  process.exit(1);
});
