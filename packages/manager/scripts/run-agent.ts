#!/usr/bin/env tsx
// V0 end-to-end smoke test for the new agent runtime. Bypasses the WS layer
// (and its auth) and drives the runner directly against a real project VPS.
//
// PREREQUISITE: at least one chat must have run against the target project so
// `ensureVpsAgent` has uploaded the vps-agent bundle to /usr/lib/node_modules/
// @genie/vps-agent on the VPS. The sandbox mounts that path into the container
// read-only.
//
// Usage:
//   tsx packages/manager/scripts/run-agent.ts \
//     --project <project-uuid> \
//     --instance <vps-instance-id> \
//     --message "Say hi and list /workspace"
//
// Optional:
//   --slug    Agent slug to upsert/use (default "echo-smoke")
//   --prompt  System prompt (default: a tiny echo persona)
//   --model   Model id (default "claude-sonnet")
//   --tools   Comma-separated tool allowlist (default: all)
//   --timeout Run timeout in seconds (default 180)

import "../src/load-env.js";
import { closeDb } from "../src/db/index.js";
import { migrateAgents } from "../src/db/migrate.js";
import { upsertAgentBySlug } from "../src/agents/registry.js";
import { runAgent } from "../src/agents/runner.js";

interface Args {
  project: string;
  instance: string;
  message: string;
  slug: string;
  prompt: string;
  model: string;
  tools: string[];
  timeoutSec: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const project = get("--project");
  const instance = get("--instance");
  const message = get("--message");
  if (!project || !instance || !message) {
    console.error("Usage: run-agent.ts --project <uuid> --instance <id> --message <text> [--slug echo-smoke] [--prompt ...] [--model claude-sonnet] [--tools shell_exec,read_file] [--timeout 180]");
    process.exit(2);
  }
  return {
    project,
    instance,
    message,
    slug: get("--slug") ?? "echo-smoke",
    prompt: get("--prompt") ??
      "You are a smoke-test agent. Reply with a short greeting and, if asked, list the workspace contents using your tools. Be concise.",
    model: get("--model") ?? "claude-sonnet",
    tools: (get("--tools") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    timeoutSec: Number(get("--timeout") ?? "180"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Make sure the agents tables exist — in case this script is the first thing
  // to talk to the DB on a freshly-pulled branch.
  await migrateAgents();

  const agent = await upsertAgentBySlug(
    {
      slug: args.slug,
      label: "Smoke-test echo agent",
      description: "Created by scripts/run-agent.ts for v0 verification.",
      systemPrompt: args.prompt,
      modelId: args.model,
      maxToolRounds: 5,
      tools: args.tools,
      sandbox: {
        kind: "project-docker",
        projectId: args.project,
        instanceId: args.instance,
        timeoutSec: args.timeoutSec,
      },
    },
    null,
  );
  console.log(`[smoke] Using agent ${agent.slug} (id=${agent.id})`);

  let tokens = "";
  const result = await runAgent(
    {
      agentId: agent.id,
      userMessage: args.message,
    },
    (ev) => {
      switch (ev.type) {
        case "ready":
          console.log("[smoke] ← ready");
          break;
        case "token":
          process.stdout.write(ev.token);
          tokens += ev.token;
          break;
        case "tool":
          console.log(`\n[smoke] ← tool ${ev.name}(${JSON.stringify(ev.input)}) → ${ev.result.slice(0, 200)}`);
          break;
        case "done":
          console.log("\n[smoke] ← done");
          break;
        case "error":
          console.error(`\n[smoke] ← error: ${ev.message}`);
          break;
      }
    },
  );

  console.log("\n[smoke] Result:", {
    runId: result.runId,
    status: result.status,
    outputLen: result.output.length,
    tools: result.toolEvents.length,
    error: result.error,
  });

  await closeDb();
  process.exit(result.status === "succeeded" ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[smoke] Fatal:", err);
  try { await closeDb(); } catch {}
  process.exit(1);
});
