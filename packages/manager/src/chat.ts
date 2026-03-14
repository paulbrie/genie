import { streamText, stepCountIs, tool, type LanguageModel, type Tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createFireworks } from "@ai-sdk/fireworks";
import { z } from "zod";
import * as store from "./store.js";
import { getCachedProcesses, getCachedDockerInfo } from "./monitor.js";
import { tools } from "./tools/index.js";
import type { DomAction, DomActionExecutor } from "./types.js";

export type ChatModelId = "claude-code" | "claude-opus" | "claude-sonnet" | "deepseek-v3" | "kimi-k2";

export const CHAT_MODELS: Record<ChatModelId, { label: string; provider: "anthropic" | "fireworks" | "claude-code"; modelId: string }> = {
  "claude-code": { label: "Claude Code", provider: "claude-code", modelId: "claude-code" },
  "claude-opus": { label: "Claude Opus", provider: "anthropic", modelId: "claude-opus-4-20250514" },
  "claude-sonnet": { label: "Claude Sonnet", provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  "deepseek-v3": { label: "DeepSeek V3", provider: "fireworks", modelId: "accounts/fireworks/models/deepseek-v3p2" },
  "kimi-k2": { label: "Kimi K2.5", provider: "fireworks", modelId: "accounts/fireworks/models/kimi-k2p5" },
};

// Price per million tokens (USD)
export const MODEL_PRICING: Record<ChatModelId, { input: number; output: number }> = {
  "claude-code": { input: 3, output: 15 }, // Uses Claude's pricing on the VPS
  "claude-opus": { input: 15, output: 75 },
  "claude-sonnet": { input: 3, output: 15 },
  "deepseek-v3": { input: 0.3, output: 0.9 },
  "kimi-k2": { input: 0.6, output: 2.4 },
};

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: ChatModelId;
  modelLabel: string;
  cost: number; // USD
}

const modelCache = new Map<string, LanguageModel>();

function getModel(modelId?: ChatModelId) {
  const id = modelId ?? "claude-sonnet";
  if (id === "claude-code") throw new Error("claude-code model is handled via VPS SSH, not locally");
  const spec = CHAT_MODELS[id];
  if (!spec) throw new Error(`Unknown model: ${id}`);

  const cacheKey = `${spec.provider}:${spec.modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  let model: LanguageModel;
  if (spec.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    model = createAnthropic({ apiKey })(spec.modelId);
  } else {
    const apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) throw new Error("FIREWORKS_API_KEY is not set");
    model = createFireworks({ apiKey })(spec.modelId);
  }

  modelCache.set(cacheKey, model);
  return model;
}

function buildSystemContext(): string {
  const apps = store.getAll();
  const processes = getCachedProcesses();
  const docker = getCachedDockerInfo();

  const lines: string[] = [
    "You are Genie, a helpful assistant embedded in a desktop system-monitoring app.",
    "You help users understand their system — processes, apps, Docker containers, memory usage, etc.",
    "The assistant context will tell you which client you are running in (web desktop app or Chrome browser extension). Adapt your behavior accordingly — in the Chrome extension, you are looking at the user's browser page; in the desktop app, you are looking at the Genie system monitor.",
    "Answer concisely. Use the live system state below to give contextual answers.",
    "",
    "You have access to tools for searching the web, browsing URLs, and managing project config files.",
    "Use the web_search tool when users ask about current events, latest versions, or anything requiring up-to-date information.",
    "Use the browse_url tool when users provide a URL they want you to read or summarize.",
    "Use read_project_file / write_project_file / list_project_files to read, create, or update project setup files (Dockerfiles, docker-compose, .env, etc.).",
    "When modifying a file, always read it first with read_project_file to avoid losing content. Use the project ID from the assistant context.",
    "Use the ssh_exec tool to run shell commands on the user's remote VPS instances. The instance label or ID and project ID are available in the assistant context.",
    "For long-running tasks (>10 min), suggest using `nohup cmd > /tmp/out.log 2>&1 &` and then check with `tail -f /tmp/out.log`.",
    "Always warn the user before running destructive commands (rm -rf, DROP TABLE, reboot, etc.) on remote servers.",
    "You have access to AGENT.md — a persistent memory file for each project. When the assistant context includes 'Agent Memory (AGENT.md)', use that knowledge to avoid re-exploring things you already know.",
    "After exploring a new codebase or discovering important details, use the save_agent_memory tool to update AGENT.md with your findings. This helps you be efficient in future sessions.",
    "Use list_project_docs and read_project_doc to access project documentation written by the team.",
    "Use the view_page tool to see the exact UI content the user is looking at. Call it when you need to understand what the user sees on screen.",
    "",
    "=== Managed Apps ===",
  ];

  if (apps.length === 0) {
    lines.push("No apps registered.");
  } else {
    for (const app of apps) {
      lines.push(`- ${app.name} [${app.status}] cmd="${app.command}"${app.cwd ? ` cwd=${app.cwd}` : ""}`);
    }
  }

  lines.push("", "=== Top Processes (by CPU) ===");
  const topProcs = processes.slice(0, 20);
  if (topProcs.length === 0) {
    lines.push("No process data available.");
  } else {
    for (const p of topProcs) {
      lines.push(`- PID ${p.pid} ${p.name} CPU=${p.cpu}% MEM=${p.mem}MB user=${p.user}${p.port ? ` port=${p.port}` : ""}`);
    }
    if (processes.length > 20) {
      lines.push(`  ... and ${processes.length - 20} more processes`);
    }
  }

  lines.push("", "=== Docker ===");
  if (!docker.daemonRunning) {
    lines.push("Docker daemon is not running.");
  } else if (docker.containers.length === 0) {
    lines.push("Docker is running but no containers found.");
  } else {
    for (const c of docker.containers) {
      lines.push(`- ${c.name} [${c.state}] image=${c.image} CPU=${c.cpu}% MEM=${c.mem}MB${c.ports ? ` ports=${c.ports}` : ""}`);
    }
  }

  return lines.join("\n");
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_MAX_TOOL_ROUNDS = 10;

export interface ChatOptions {
  messages: ChatMessage[];
  onToken: (token: string) => void;
  onDone: (fullContent: string, usage?: ChatUsage) => void | Promise<void>;
  onError: (message: string) => void;
  onTool?: (name: string, input: Record<string, unknown>, result: string) => void;
  context?: string;
  domSnapshot?: string;
  abortSignal?: AbortSignal;
  domActionExecutor?: DomActionExecutor;
  modelId?: ChatModelId;
  maxToolRounds?: number;
}

export async function handleChat(
  messages: ChatMessage[],
  onToken: (token: string) => void,
  onDone: (fullContent: string, usage?: ChatUsage) => void | Promise<void>,
  onError: (message: string) => void,
  onTool?: (name: string, input: Record<string, unknown>, result: string) => void,
  context?: string,
  domSnapshot?: string,
  abortSignal?: AbortSignal,
  domActionExecutor?: DomActionExecutor,
  modelId?: ChatModelId,
  maxToolRounds?: number,
): Promise<void> {
  try {
    const model = getModel(modelId);
    const systemPrompt = context
      ? `${buildSystemContext()}\n\n${context}`
      : buildSystemContext();

    // Merge static tools with the dynamic view_page tool
    const allTools: Record<string, Tool> = {
      ...tools,
      view_page: tool({
        description: "See the exact UI content currently visible to the user. Returns the text content of the page. Use this when you need to understand what the user is looking at on screen.",
        inputSchema: z.object({}),
        execute: async () => {
          if (!domSnapshot) return "No page content available.";
          // Truncate to avoid token explosion
          const maxLen = 8000;
          return domSnapshot.length > maxLen
            ? domSnapshot.slice(0, maxLen) + "\n... (truncated)"
            : domSnapshot;
        },
      }),
    };

    // Add dom_action tool when a Chrome extension is connected
    if (domActionExecutor) {
      allTools.dom_action = tool({
        description:
          "Interact with elements on the web page the user is viewing in their browser. " +
          "Use this to click buttons, fill inputs, select options, scroll, read text, navigate, or wait for elements. " +
          "Always use view_page first to understand the page structure before taking actions.",
        inputSchema: z.object({
          action: z.enum([
            "click", "type", "select", "scroll",
            "read_text", "read_attr", "get_snapshot",
            "navigate", "wait_for",
          ]).describe("The DOM action to perform"),
          selector: z.string().optional().describe("CSS selector for the target element"),
          value: z.string().optional().describe("Value to type or select"),
          url: z.string().optional().describe("URL to navigate to (for 'navigate' action)"),
          attribute: z.string().optional().describe("Attribute name to read (for 'read_attr' action)"),
          direction: z.enum(["up", "down"]).optional().describe("Scroll direction"),
          amount: z.number().optional().describe("Scroll amount in pixels"),
          timeout: z.number().optional().describe("Timeout in ms for wait_for (default 5000)"),
        }),
        execute: async ({ action, selector, value, url, attribute, direction, amount, timeout }) => {
          const result = await domActionExecutor(action as DomAction, {
            selector, value, url, attribute, direction, amount, timeout,
          });
          return result.success
            ? result.result
            : `Action failed: ${result.result}`;
        },
      });
    }

    const result = streamText({
      model,
      system: systemPrompt,
      messages: messages
        .filter((m) => m.content.length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
      tools: allTools,
      stopWhen: stepCountIs(maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS),
      abortSignal,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
      },
    });

    let fullContent = "";

    try {
      for await (const chunk of result.fullStream) {
        if (abortSignal?.aborted) break;
        switch (chunk.type) {
          case "text-delta":
            fullContent += chunk.text;
            onToken(chunk.text);
            break;
          case "tool-call":
            // Tool is about to execute — we'll report the result when it arrives
            break;
          case "tool-result":
            onTool?.(
              chunk.toolName,
              chunk.input as Record<string, unknown>,
              typeof chunk.output === "string" ? chunk.output : JSON.stringify(chunk.output),
            );
            break;
        }
      }
    } catch (streamErr: unknown) {
      // If aborted, that's expected — fall through to onDone with partial content
      if (!abortSignal?.aborted) throw streamErr;
    }

    // Extract token usage
    const id = modelId ?? "claude-sonnet";
    const spec = CHAT_MODELS[id];
    const pricing = MODEL_PRICING[id];
    let usage: ChatUsage | undefined;
    try {
      const u = await result.totalUsage;
      if (u) {
        const inputTokens = u.inputTokens ?? 0;
        const outputTokens = u.outputTokens ?? 0;
        const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
        usage = { inputTokens, outputTokens, modelId: id, modelLabel: spec.label, cost };
      }
    } catch { /* usage not available */ }

    await onDone(fullContent, usage);
  } catch (err: unknown) {
    const spec = CHAT_MODELS[modelId ?? "claude-sonnet"];
    const label = spec?.label ?? modelId ?? "unknown";
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Chat error (${label}):`, message);
    onError(`[${label}] ${message || "Failed to start chat"}`);
  }
}
