import { streamText, stepCountIs, tool, type LanguageModel, type Tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createFireworks } from "@ai-sdk/fireworks";
import { z } from "zod";
import { getCachedProcesses, getCachedDockerInfo } from "../logging/monitor.js";
import { createTools, type ToolAuthContext } from "../tools/index.js";
import { executeSshExec, executeBareTazSshExec } from "../tools/ssh-exec.js";
import { isPrivilegedRole } from "../auth/ws-acl.js";
import type { DomAction, DomActionExecutor } from "../types.js";

/** Set by the renderer's pin selector. When present, all assistant ssh_exec
 *  calls are forced onto this VM — the LLM cannot pick a different VM, and
 *  the tool description hides the instance/project args entirely so it never
 *  even tries. `projectId === null` means a bare cloud VM (TazCloud admin pin):
 *  ssh_exec is routed via TAZCLOUD_SSH_PRIVATE_KEY instead of project lookup. */
export interface PinnedAssistantVm {
  projectId: string | null;
  projectName: string | null;
  instanceId: string;
  label: string;
  host: string;
  provider: "digitalocean" | "tazcloud" | "other";
  /** SSH user for bare pins (ignored when projectId is set). */
  sshUser?: string;
}

export type ChatModelId = "claude-code" | "claude-opus" | "claude-sonnet" | "deepseek-v3" | "deepseek-v4-pro" | "kimi-k2.6" | "qwen-3.6-plus";

export const CHAT_MODELS: Record<ChatModelId, { label: string; provider: "anthropic" | "fireworks" | "claude-code"; modelId: string }> = {
  "claude-code": { label: "Claude Code", provider: "claude-code", modelId: "claude-code" },
  "claude-opus": { label: "Claude Opus", provider: "anthropic", modelId: "claude-opus-4-20250514" },
  "claude-sonnet": { label: "Claude Sonnet", provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  "deepseek-v3": { label: "DeepSeek V3", provider: "fireworks", modelId: "accounts/fireworks/models/deepseek-v3p2" },
  "deepseek-v4-pro": { label: "DeepSeek V4 Pro", provider: "fireworks", modelId: "accounts/fireworks/models/deepseek-v4-pro" },
  "kimi-k2.6": { label: "Kimi K2.6", provider: "fireworks", modelId: "accounts/fireworks/models/kimi-k2p6" },
  "qwen-3.6-plus": { label: "Qwen3.6 Plus", provider: "fireworks", modelId: "accounts/fireworks/models/qwen3p6-plus" },
};

// Price per million tokens (USD)
export const MODEL_PRICING: Record<ChatModelId, { input: number; output: number }> = {
  "claude-code": { input: 3, output: 15 }, // Uses Claude's pricing on the VPS
  "claude-opus": { input: 15, output: 75 },
  "claude-sonnet": { input: 3, output: 15 },
  "deepseek-v3": { input: 0.3, output: 0.9 },
  "deepseek-v4-pro": { input: 1.74, output: 3.48 },
  "kimi-k2.6": { input: 0.95, output: 4.0 },
  "qwen-3.6-plus": { input: 0.5, output: 3.0 },
};

export interface ChatUsage {
  inputTokens: number;
  /** Cache-read portion of `inputTokens` (already-cached context). */
  cachedInputTokens: number;
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
  const processes = getCachedProcesses();
  const docker = getCachedDockerInfo();

  const lines: string[] = [
    "You are Genie, a helpful assistant embedded in a desktop system-monitoring app.",
    "You help users understand their system — processes, Docker containers, memory usage, etc.",
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
    "Recipes (Add-ons): you can author and edit reusable bash scripts that install/check/remove software on Genie-managed VMs.",
    "Use list_recipes to discover existing user recipes, get_recipe to read one, create_recipe to author a new one, update_recipe to edit fields (full-replace per field), and delete_recipe to remove.",
    "A user recipe whose slug matches a built-in (chrome, postgres, genie-browser, navision, docker) OVERRIDES the built-in in the Add-ons panel. Deleting the override resets to the built-in.",
    "Install/uninstall scripts have `log \"msg\"` (timestamped echo) and `wait_apt` (blocks for apt/dpkg locks with heartbeat) auto-injected — call those in your scripts instead of bare echo and raw apt-get.",
    "When asked to 'improve' or 'fix' a recipe, read it with get_recipe first, modify only the fields that change, then call update_recipe.",
    "",
    "=== Top Processes (by CPU) ===",
  ];
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
  /** Pasted/attached images as data URLs (e.g. "data:image/png;base64,..."). User messages only. */
  images?: string[];
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
  onTool?: (name: string, input: Record<string, unknown>, result: string, id?: string, durationMs?: number) => void,
  context?: string,
  domSnapshot?: string,
  abortSignal?: AbortSignal,
  domActionExecutor?: DomActionExecutor,
  modelId?: ChatModelId,
  maxToolRounds?: number,
  pinnedVm?: PinnedAssistantVm | null,
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void,
  // Caller identity. Drives per-user tool authorization (which projects/servers
  // the assistant may touch). Defaults to an anonymous context with no
  // resource access, so a missing auth arg fails closed rather than open.
  auth: ToolAuthContext = { userId: null, role: null },
): Promise<void> {
  try {
    const model = getModel(modelId);
    const pinNote = pinnedVm
      ? `\n\n=== PINNED VM (ssh_exec target) ===\n`
        + `All ssh_exec calls run on "${pinnedVm.label}" (host: ${pinnedVm.host}, provider: ${pinnedVm.provider}, project: ${pinnedVm.projectName}).\n`
        + `The instance and project are pre-set — you only specify the command. Do NOT mention or attempt to target any other VM; the server will reject it.`
      : "";
    const systemPrompt = context
      ? `${buildSystemContext()}\n\n${context}${pinNote}`
      : `${buildSystemContext()}${pinNote}`;

    // Build the user-scoped toolset, then merge the dynamic view_page tool.
    const allTools: Record<string, Tool> = {
      ...createTools(auth),
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

    // When a VM is pinned, replace the generic ssh_exec tool with a locked-down
    // variant that takes only `command`. The pinned project/instance are baked
    // in here so the LLM cannot route to a different VM even if its context
    // suggests otherwise.
    if (pinnedVm) {
      const bare = pinnedVm.projectId === null;
      allTools.ssh_exec = tool({
        description:
          `Run a shell command on the pinned VPS instance "${pinnedVm.label}" `
          + `(host ${pinnedVm.host}${bare ? "" : `, project "${pinnedVm.projectName}"`}). `
          + `The target is fixed — you only choose the command. `
          + `For long-running tasks (>10 min), suggest nohup or screen/tmux.`,
        inputSchema: z.object({
          command: z.string().describe("The shell command to execute on the pinned remote VM"),
          timeoutSeconds: z.number().optional().describe("Command timeout in seconds (default 120, max 600)"),
        }),
        execute: async ({ command, timeoutSeconds }) => {
          const timeout = Math.min(Math.max((timeoutSeconds ?? 120), 5), 600) * 1000;
          if (bare) {
            // Project-less pin → a tazcloud admin pin routed via the shared
            // TAZCLOUD_SSH_PRIVATE_KEY. There's no project to scope it to, so
            // only privileged roles may run on a bare-pinned VM.
            if (!isPrivilegedRole(auth.role)) {
              return "Error: you don't have access to this server.";
            }
            if (pinnedVm.provider !== "tazcloud") {
              return `Error: bare ssh_exec pins are only supported for tazcloud VMs (got provider="${pinnedVm.provider}").`;
            }
            return executeBareTazSshExec(pinnedVm.host, pinnedVm.sshUser || "ubuntu", command, timeout);
          }
          // executeSshExec re-checks userCanSeeProject for the pinned project.
          return executeSshExec(pinnedVm.projectId!, pinnedVm.instanceId, command, timeout, auth);
        },
      });
    }

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
      // Expand user messages with images into the SDK's multi-part content shape so
      // multimodal models (Claude Opus/Sonnet) see the image alongside the prompt.
      // Non-vision models will error; the user can switch model in the selector.
      messages: messages
        .filter((m) => m.content.length > 0 || (m.images && m.images.length > 0))
        .map((m) => {
          if (m.role === "user" && m.images && m.images.length > 0) {
            const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];
            if (m.content) parts.push({ type: "text", text: m.content });
            for (const img of m.images) parts.push({ type: "image", image: img });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { role: m.role, content: parts as any };
          }
          return { role: m.role, content: m.content };
        }),
      tools: allTools,
      stopWhen: stepCountIs(maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS),
      abortSignal,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
      },
    });

    let fullContent = "";
    // Per-call start timestamps, keyed by toolCallId. Used to report duration on
    // tool-result so the UI can render an elapsed-time badge.
    const toolStarts = new Map<string, number>();

    try {
      for await (const chunk of result.fullStream) {
        if (abortSignal?.aborted) break;
        switch (chunk.type) {
          case "text-delta":
            fullContent += chunk.text;
            onToken(chunk.text);
            break;
          case "tool-call": {
            toolStarts.set(chunk.toolCallId, Date.now());
            onToolStart?.(chunk.toolCallId, chunk.toolName, chunk.input as Record<string, unknown>);
            break;
          }
          case "tool-result": {
            const started = toolStarts.get(chunk.toolCallId);
            const durationMs = started != null ? Date.now() - started : undefined;
            toolStarts.delete(chunk.toolCallId);
            onTool?.(
              chunk.toolName,
              chunk.input as Record<string, unknown>,
              typeof chunk.output === "string" ? chunk.output : JSON.stringify(chunk.output),
              chunk.toolCallId,
              durationMs,
            );
            break;
          }
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
        const cachedInputTokens = (u as { cachedInputTokens?: number }).cachedInputTokens ?? 0;
        const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
        usage = { inputTokens, cachedInputTokens, outputTokens, modelId: id, modelLabel: spec.label, cost };
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
