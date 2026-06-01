import { streamText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createTools } from "./tools/index.js";

/** Anthropic model ids the agent runtime knows how to load. Keep in sync with
 *  the manager's CHAT_MODELS so a user picking "claude-opus" in the agent
 *  editor resolves to the same actual model. Non-Anthropic providers
 *  (Fireworks etc.) will be plugged in here when added. */
const ANTHROPIC_MODELS: Record<string, string> = {
  "claude-sonnet": "claude-sonnet-4-20250514",
  "claude-opus": "claude-opus-4-20250514",
};
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

// Cache models per (apiKey, modelId) so per-turn calls don't rebuild the client.
const modelCache = new Map<string, ReturnType<ReturnType<typeof createAnthropic>>>();

function getModel(apiKey: string, modelId?: string) {
  // Accept either the friendly id ("claude-sonnet") or a raw Anthropic model id.
  const anthropicModel = modelId
    ? (ANTHROPIC_MODELS[modelId] ?? modelId)
    : DEFAULT_ANTHROPIC_MODEL;
  const cacheKey = `${apiKey}::${anthropicModel}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;
  const model = createAnthropic({ apiKey })(anthropicModel);
  modelCache.set(cacheKey, model);
  return model;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatOptions {
  apiKey: string;
  projectDir: string;
  maxToolRounds: number;
  messages: ChatMessage[];
  context?: string;
  domSnapshot?: string;
  /** Optional model id (e.g. "claude-sonnet", "claude-opus"). Default: claude-sonnet. */
  modelId?: string;
  /** Optional override for the system prompt. Default: the built-in Genie prompt. */
  systemPrompt?: string;
  /** Optional allowlist of tool names. Empty/undefined = expose all built-in tools.
   *  Names: shell_exec, read_file, write_file, list_files, search_files, view_page, dom_action. */
  allowedTools?: string[];
  onToken: (token: string) => void;
  onTool: (name: string, input: Record<string, unknown>, result: string) => void;
  onDone: (fullContent: string) => void;
  onError: (message: string) => void;
  onBrowserRequest: (requestId: string, action: string, params: Record<string, unknown>) => void;
  resolveBrowserResult: (requestId: string) => Promise<{ success: boolean; result: string }>;
  abortSignal?: AbortSignal;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are Genie, a helpful AI assistant with direct access to this server's filesystem and shell.",
  "You can read/write files, run shell commands, search code, and list directories — all locally and instantly.",
  "Use read_file before write_file to avoid losing existing content.",
  "For long-running tasks (>10 min), suggest using nohup or screen/tmux.",
  "Always warn the user before running destructive commands (rm -rf, DROP TABLE, reboot, etc.).",
  "Use view_page to see what the user sees in their browser. Use dom_action to interact with page elements.",
  "Answer concisely and helpfully.",
].join("\n");

function buildSystemPrompt(systemPrompt: string | undefined, context: string | undefined): string {
  const base = systemPrompt && systemPrompt.length > 0 ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
  return context ? `${base}\n\n=== Assistant Context ===\n${context}` : base;
}

export async function runAgentChat(opts: AgentChatOptions): Promise<void> {
  const {
    apiKey,
    projectDir,
    maxToolRounds,
    messages,
    context,
    domSnapshot,
    modelId,
    systemPrompt,
    allowedTools,
    onToken,
    onTool,
    onDone,
    onError,
    onBrowserRequest,
    resolveBrowserResult,
    abortSignal,
  } = opts;

  try {
    const model = getModel(apiKey, modelId);
    const localTools = createTools(projectDir);

    // Build the full tool set
    const allTools: Record<string, any> = {
      ...localTools,
      view_page: tool({
        description:
          "See the exact UI content currently visible to the user in their browser. Returns the text/DOM content of the page.",
        inputSchema: z.object({}),
        execute: async () => {
          if (!domSnapshot) {
            // Request a fresh snapshot from the browser
            const requestId = crypto.randomUUID();
            onBrowserRequest(requestId, "get_snapshot", {});
            try {
              const result = await resolveBrowserResult(requestId);
              if (result.success) return result.result;
              return "No page content available.";
            } catch {
              return "No page content available.";
            }
          }
          const maxLen = 8000;
          return domSnapshot.length > maxLen
            ? domSnapshot.slice(0, maxLen) + "\n... (truncated)"
            : domSnapshot;
        },
      }),
      dom_action: tool({
        description:
          "Interact with elements on the web page the user is viewing in their browser. " +
          "Use this to click buttons, fill inputs, select options, scroll, read text, navigate, or wait for elements. " +
          "Always use view_page first to understand the page structure before taking actions.",
        inputSchema: z.object({
          action: z
            .enum([
              "click", "type", "select", "scroll",
              "read_text", "read_attr", "get_snapshot",
              "navigate", "wait_for",
            ])
            .describe("The DOM action to perform"),
          selector: z.string().optional().describe("CSS selector for the target element"),
          value: z.string().optional().describe("Value to type or select"),
          url: z.string().optional().describe("URL to navigate to (for 'navigate' action)"),
          attribute: z.string().optional().describe("Attribute name to read (for 'read_attr' action)"),
          direction: z.enum(["up", "down"]).optional().describe("Scroll direction"),
          amount: z.number().optional().describe("Scroll amount in pixels"),
          timeout: z.number().optional().describe("Timeout in ms for wait_for (default 5000)"),
        }),
        execute: async ({ action, selector, value, url, attribute, direction, amount, timeout }) => {
          const requestId = crypto.randomUUID();
          onBrowserRequest(requestId, action, {
            selector, value, url, attribute, direction, amount, timeout,
          });
          try {
            const result = await resolveBrowserResult(requestId);
            return result.success ? result.result : `Action failed: ${result.result}`;
          } catch (err: any) {
            return `Action failed: ${err.message}`;
          }
        },
      }),
    };

    // Apply the per-agent tool allowlist. Empty array or undefined = expose
    // every built-in tool (today's default behaviour). A non-empty list filters
    // the union of local tools + view_page/dom_action down to just the named
    // tools; unknown names are silently ignored so a typo can't gate the run.
    const exposedTools: Record<string, any> =
      allowedTools && allowedTools.length > 0
        ? Object.fromEntries(
            Object.entries(allTools).filter(([name]) => allowedTools.includes(name)),
          )
        : allTools;

    const result = streamText({
      model,
      system: buildSystemPrompt(systemPrompt, context),
      messages: messages
        .filter((m) => m.content.length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
      tools: exposedTools,
      stopWhen: stepCountIs(maxToolRounds),
      abortSignal,
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
          case "tool-result":
            onTool(
              chunk.toolName,
              chunk.input as Record<string, unknown>,
              typeof chunk.output === "string"
                ? chunk.output
                : JSON.stringify(chunk.output),
            );
            break;
        }
      }
    } catch (streamErr: any) {
      if (!abortSignal?.aborted) throw streamErr;
    }

    onDone(fullContent);
  } catch (err: any) {
    onError(err.message || "Agent chat failed");
  }
}
