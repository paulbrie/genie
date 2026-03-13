#!/usr/bin/env node

import { createInterface } from "node:readline";
import { runAgentChat, type ChatMessage } from "./agent-chat.js";

// --- JSON line protocol over stdin/stdout ---

interface InitMessage {
  type: "init";
  apiKey: string;
  projectDir: string;
  maxToolRounds?: number;
}

interface ChatInputMessage {
  type: "chat";
  messages: ChatMessage[];
  context?: string;
  domSnapshot?: string;
}

interface StopMessage {
  type: "stop";
}

interface BrowserResultMessage {
  type: "browser:result";
  requestId: string;
  success: boolean;
  result: string;
}

type IncomingMessage = InitMessage | ChatInputMessage | StopMessage | BrowserResultMessage;

// --- State ---

let config: { apiKey: string; projectDir: string; maxToolRounds: number } | null = null;
let currentAbortController: AbortController | null = null;

// Pending browser action results (requestId → resolve)
const pendingBrowserResults = new Map<
  string,
  { resolve: (value: { success: boolean; result: string }) => void; timer: ReturnType<typeof setTimeout> }
>();

// --- Helpers ---

function sendMessage(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendError(message: string): void {
  sendMessage({ type: "error", message });
}

// --- Message handlers ---

function handleInit(msg: InitMessage): void {
  config = {
    apiKey: msg.apiKey,
    projectDir: msg.projectDir,
    maxToolRounds: msg.maxToolRounds ?? 40,
  };
  sendMessage({ type: "ready" });
}

async function handleChat(msg: ChatInputMessage): Promise<void> {
  if (!config) {
    sendError("Not initialized — send init message first");
    return;
  }

  // Abort any previous in-flight chat
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  await runAgentChat({
    apiKey: config.apiKey,
    projectDir: config.projectDir,
    maxToolRounds: config.maxToolRounds,
    messages: msg.messages,
    context: msg.context,
    domSnapshot: msg.domSnapshot,
    onToken: (token) => sendMessage({ type: "token", token }),
    onTool: (name, input, result) => sendMessage({ type: "tool", name, input, result }),
    onDone: (fullContent) => {
      currentAbortController = null;
      sendMessage({ type: "done", fullContent });
    },
    onError: (message) => {
      currentAbortController = null;
      sendError(message);
    },
    onBrowserRequest: (requestId, action, params) => {
      sendMessage({ type: "browser:request", requestId, action, params });
    },
    resolveBrowserResult: (requestId) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingBrowserResults.delete(requestId);
          resolve({ success: false, result: "Browser action timed out (15s)" });
        }, 15_000);
        pendingBrowserResults.set(requestId, { resolve, timer });
      });
    },
    abortSignal: currentAbortController.signal,
  });
}

function handleStop(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  sendMessage({ type: "stopped" });
}

function handleBrowserResult(msg: BrowserResultMessage): void {
  const pending = pendingBrowserResults.get(msg.requestId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingBrowserResults.delete(msg.requestId);
    pending.resolve({ success: msg.success, result: msg.result });
  }
}

// --- Main loop ---

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    sendError(`Invalid JSON: ${line.slice(0, 200)}`);
    return;
  }

  switch (msg.type) {
    case "init":
      handleInit(msg);
      break;
    case "chat":
      void handleChat(msg);
      break;
    case "stop":
      handleStop();
      break;
    case "browser:result":
      handleBrowserResult(msg);
      break;
    default:
      sendError(`Unknown message type: ${(msg as any).type}`);
  }
});

rl.on("close", () => {
  // stdin closed — parent process disconnected, exit gracefully
  if (currentAbortController) currentAbortController.abort();
  process.exit(0);
});

// Suppress unhandled rejections from crashing the agent
process.on("unhandledRejection", (err: any) => {
  sendError(`Unhandled error: ${err?.message || String(err)}`);
});
