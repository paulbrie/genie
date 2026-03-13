import { streamText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createTools } from "./tools/index.js";

// Cache the Anthropic client + model across chat turns (apiKey is set once at init)
let cachedApiKey: string | null = null;
let cachedModel: ReturnType<ReturnType<typeof createAnthropic>> | null = null;

function getModel(apiKey: string) {
  if (cachedModel && cachedApiKey === apiKey) return cachedModel;
  cachedApiKey = apiKey;
  const anthropic = createAnthropic({ apiKey });
  cachedModel = anthropic("claude-sonnet-4-20250514");
  return cachedModel;
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
  onToken: (token: string) => void;
  onTool: (name: string, input: Record<string, unknown>, result: string) => void;
  onDone: (fullContent: string) => void;
  onError: (message: string) => void;
  onBrowserRequest: (requestId: string, action: string, params: Record<string, unknown>) => void;
  resolveBrowserResult: (requestId: string) => Promise<{ success: boolean; result: string }>;
  abortSignal?: AbortSignal;
}

function buildSystemPrompt(context?: string): string {
  const lines = [
    "You are Genie, a helpful AI assistant with direct access to this server's filesystem and shell.",
    "You can read/write files, run shell commands, search code, and list directories — all locally and instantly.",
    "Use read_file before write_file to avoid losing existing content.",
    "For long-running tasks (>10 min), suggest using nohup or screen/tmux.",
    "Always warn the user before running destructive commands (rm -rf, DROP TABLE, reboot, etc.).",
    "Use view_page to see what the user sees in their browser. Use dom_action to interact with page elements.",
    "Answer concisely and helpfully.",
  ];

  if (context) {
    lines.push("", "=== Assistant Context ===", context);
  }

  return lines.join("\n");
}

export async function runAgentChat(opts: AgentChatOptions): Promise<void> {
  const {
    apiKey,
    projectDir,
    maxToolRounds,
    messages,
    context,
    domSnapshot,
    onToken,
    onTool,
    onDone,
    onError,
    onBrowserRequest,
    resolveBrowserResult,
    abortSignal,
  } = opts;

  try {
    const model = getModel(apiKey);
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

    const result = streamText({
      model,
      system: buildSystemPrompt(context),
      messages: messages
        .filter((m) => m.content.length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
      tools: allTools,
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
