import { type WebSocket } from "ws";
import type { WsMessage } from "../types.js";
import * as projectService from "../projects/project-service.js";
import * as assistantLogService from "./assistant-log-service.js";
import { getResumeState, saveResumeSessionId } from "./assistant-session-state-service.js";
import { connectSsh, type SshSession } from "../vps/ssh-client.js";
import { remoteDir } from "../vps/deploy-service.js";
import { provisionMcpRestConfig } from "../vps/mcp-config-merge.js";
import { activeChatAbortControllers } from "../ws-server.js";
// `send` is private to ws-server, so the caller passes it in.
type Send = (ws: WebSocket, message: WsMessage) => void;

/** Route a chat to Claude Code on VPS. Returns true if handled, false if a
 *  fallback (local in-process chat) is needed.
 *
 *  Moved here verbatim from ws-server.ts to keep that file focused on the
 *  dispatcher + lifecycle plumbing. All deps it relies on are either re-exported
 *  from ws-server.ts (MCP tunnel pool, abort-controller registry, broker
 *  registration) or imported directly from upstream services. */
export async function routeChatToVpsAgent(
  ws: WebSocket,
  send: Send,
  userId: string,
  messages: { role: "user" | "assistant"; content: string }[],
  chatContext: string | undefined,
  domSnapshot: string | undefined,
  abortSignal: AbortSignal,
  onComplete?: (fullContent: string, toolUses: { name: string; input: unknown; result: string }[]) => void,
  projectIdHint?: string | null,
  assistantSessionId?: string | null,
): Promise<boolean> {
  void domSnapshot; // accepted for signature parity with the chat:send caller
  let projectId: string | null = projectIdHint || null;

  if (!projectId && chatContext) {
    const projectIdMatch = chatContext.match(/Project ID:\s*([a-f0-9-]+)/i)
      || chatContext.match(/projectId[=:]\s*["']?([a-f0-9-]+)/i)
      || chatContext.match(/\(id:\s+([a-f0-9-]+)\)/);
    projectId = projectIdMatch?.[1] || null;
  }

  // No fallback to a random project: previously, when the user was on a non-
  // project view (e.g. Clouds) with no `Project ID:` in context, we silently
  // picked the first project that had a VPS and SSH'd into it. That made the
  // chat appear to hang against the wrong host. Refuse early instead — the
  // outer handler converts `false` into a clear `chat:error` to the user.
  if (!projectId) {
    console.log(`[claude-code] No project in context; refusing to route. Context: ${chatContext?.slice(0, 200) || "(none)"}`);
    return false;
  }

  const project = await projectService.getById(projectId);
  if (!project || project.vpsInstances.length === 0) {
    console.log(`[claude-code] Project ${projectId} not found or has no VPS instances`);
    return false;
  }

  const instance = project.vpsInstances[0];
  const sessionKey = `${project.id}:${instance.id}`;
  const resumeState = await getResumeState(sessionKey);
  const existingSessionId = resumeState?.sessionId ?? null;
  if (resumeState) {
    send(ws, { type: "chat:resumed", payload: {
      sessionId: resumeState.sessionId,
      lastActivity: resumeState.lastActivity.toISOString(),
    }});
  }

  const lastUserMsg = messages[messages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== "user") return false;

  let sshSession: SshSession;
  try {
    send(ws, { type: "chat:status", payload: { status: "Connecting to VPS..." } });
    sshSession = await connectSsh(instance.connection, { timeoutMs: 30_000 });
  } catch (err: unknown) {
    console.error(`SSH connect failed for Claude Code: ${(err instanceof Error ? err.message : String(err))}`);
    return false;
  }

  const dest = remoteDir(project.name);

  // Point the project's .mcp.json at the manager's MCP REST endpoints
  // (genie-tracker/security/notify/storage). No tunnels — the VM reaches the
  // manager over HTTPS with its per-instance bearer token. This is idempotent,
  // so doing it on every launch keeps the config fresh after a token rotation.
  try {
    const wrote = await provisionMcpRestConfig(
      (cmd) => sshSession.exec(cmd),
      dest,
      project.id,
      instance.id,
    );
    console.log(
      wrote
        ? `[claude-code] MCP REST config written for ${project.name}`
        : `[claude-code] MANAGER_URL unset — skipped MCP REST config for ${project.name}`,
    );
  } catch (err: unknown) {
    console.error(`[claude-code] Failed to write MCP REST config: ${(err instanceof Error ? err.message : String(err))}`);
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";

    send(ws, { type: "chat:status", payload: { status: "Connecting to Claude Code..." } });

    const [claudePathRaw, agentMd] = await Promise.all([
      sshSession.exec(
        `bash -lc "which claude 2>/dev/null" || command -v claude 2>/dev/null || ` +
        `for p in /usr/local/bin/claude /usr/bin/claude /root/.npm-global/bin/claude "$(npm bin -g 2>/dev/null)/claude"; do ` +
        `  [ -x "$p" ] && echo "$p" && exit 0; done; echo ""`,
        undefined, { timeoutMs: 10_000 },
      ).then(s => s.trim()),
      sshSession.exec(`cat ${dest}/AGENT.md 2>/dev/null || echo ""`, undefined, { timeoutMs: 5_000 }).then(s => s.trim()),
    ]);

    let claudePath = claudePathRaw;

    if (!claudePath) {
      console.log(`[claude-code] claude binary not found on VPS, installing...`);
      send(ws, { type: "chat:status", payload: { status: "Installing Claude Code CLI on VPS..." } });
      try {
        await sshSession.exec(`npm install -g @anthropic-ai/claude-code`, undefined, { timeoutMs: 120_000 });
        claudePath = (await sshSession.exec(
          `bash -lc "which claude 2>/dev/null" || command -v claude 2>/dev/null || ` +
          `for p in /usr/local/bin/claude /usr/bin/claude "$(npm bin -g 2>/dev/null)/claude"; do ` +
          `  [ -x "$p" ] && echo "$p" && exit 0; done; echo ""`,
          undefined, { timeoutMs: 10_000 },
        )).trim();
      } catch (installErr: unknown) {
        console.error(`[claude-code] Failed to install Claude Code CLI:`, installErr instanceof Error ? installErr.message : String(installErr));
      }
    }

    if (!claudePath) {
      console.error(`[claude-code] claude binary not found on VPS even after install attempt`);
      send(ws, { type: "chat:error", payload: { message: "Could not find or install Claude Code CLI on VPS. SSH into the VPS and run: npm install -g @anthropic-ai/claude-code" } });
      activeChatAbortControllers.delete(ws);
      return true;
    }
    console.log(`[claude-code] Found claude at: ${claudePath}`);

    let systemContext = chatContext || "";
    const serverIp = instance.connection.host;
    systemContext += `\n\nServer public IP: ${serverIp}`;
    systemContext += `\n\n=== Browser Notes ===`;
    systemContext += `\nThis server runs in the cloud at ${serverIp}. To test or interact with the app in a browser, use chrome-devtools (Puppeteer) in headless mode (the VPS has no display server). The app is accessible at http://${serverIp}:3000 (or whichever port it runs on). NEVER use localhost or 127.0.0.1 URLs — those refer to the VPS loopback, not your app.`;

    // The genie-* MCP services reach the manager over HTTPS, so they're always
    // available to Claude on the VM (no tunnel to be up or down).
    systemContext += `\n\n=== Tracker ===\nYou have access to the project's issue tracker via MCP tools (genie-tracker server). Use tracker_list_issues to see all tickets, tracker_get_issue to read a specific ticket by its number, tracker_update_issue to change status/priority, and tracker_comment_on_issue to leave notes.\n\nWorkflow: set status to in_progress when you start working on a ticket. When you finish, leave a concise summary comment (bullet list of changes) using tracker_comment_on_issue, then set status to in_review (NEVER set to done — a human reviews and marks done).`;
    systemContext += `\n\n=== Security Scanner ===\nYou have access to a security scanner via MCP tools (genie-security server). Use security_scan to run a full security scan on a target URL (port scan + web vulnerability checks — takes a few minutes). Use security_list_scans to see previous scan results. Use security_get_scan to retrieve full details of a specific scan by ID.`;
    systemContext += `\n\n=== Notifications ===\nYou can contact the admin via MCP tools (genie-notify server). Use notify_send_email to send an email to the admin (for important alerts, completed tasks, errors). Use notify_send_chat_message to send a message in the admin's Genie chat (appears as a DM from Claude — good for progress updates, questions, or results).`;
    systemContext += `\n\n=== Cloud Storage ===\nYou have access to cloud storage via MCP tools (genie-storage server). Use storage_screenshot to take a screenshot of a URL (runs Puppeteer on the VPS, uploads the PNG to cloud storage, returns a presigned URL). Use storage_upload to upload any file from the VPS to cloud storage. Use storage_list to browse stored files, storage_get_url to get a fresh presigned URL, and storage_delete to remove files. All files are scoped to this project.`;

    if (agentMd) {
      systemContext += `\n\n=== Agent Memory (AGENT.md) ===\n${agentMd}`;
    }

    const safePrompt = lastUserMsg.content.replace(/GENIEEOF/g, "GENIE-EOF");
    const safeContext = systemContext.replace(/GENIEEOF/g, "GENIE-EOF");

    await sshSession.exec(`cat > /tmp/_genie_prompt << 'GENIEEOF'\n${safePrompt}\nGENIEEOF`);
    await sshSession.exec(`cat > /tmp/_genie_ctx << 'GENIEEOF'\n${safeContext}\nGENIEEOF`);

    let hasSubscription = false;
    let authEmail = "";
    let authPlan = "";
    try {
      const authOut = await sshSession.exec(`${claudePath} auth status 2>&1`, undefined, { timeoutMs: 10_000 });
      hasSubscription = authOut.includes('"loggedIn": true') || authOut.includes('"loggedIn":true');
      try {
        const authJson = JSON.parse(authOut.trim());
        authEmail = authJson.email || authJson.account || "";
        authPlan = authJson.plan || authJson.accountType || (hasSubscription ? "Max" : "");
      } catch {
        const emailMatch = authOut.match(/"email"\s*:\s*"([^"]+)"/);
        if (emailMatch) authEmail = emailMatch[1];
        if (hasSubscription && !authPlan) authPlan = "Max";
      }
    } catch { /* auth probe best-effort */ }

    const claudeSettingsDir = `${dest}/.claude`;
    const claudeSettingsPath = `${claudeSettingsDir}/settings.local.json`;
    try {
      await sshSession.exec(`mkdir -p ${claudeSettingsDir}`, undefined, { timeoutMs: 5_000 });
      const existingRaw = await sshSession.exec(`cat ${claudeSettingsPath} 2>/dev/null || echo "{}"`, undefined, { timeoutMs: 5_000 });
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse(existingRaw.trim()); } catch { /* keep empty */ }
      const perms = (settings.permissions as Record<string, unknown>) || {};
      perms.allow = ["*"];
      settings.permissions = perms;
      const settingsJson = JSON.stringify(settings, null, 2);
      await sshSession.exec(`cat > ${claudeSettingsPath} << 'GENIEEOF'\n${settingsJson}\nGENIEEOF`, undefined, { timeoutMs: 5_000 });
    } catch (err) {
      console.error(`[claude-code] Failed to write settings.local.json:`, err instanceof Error ? err.message : String(err));
    }

    const resumeFlag = existingSessionId ? ` --resume "${existingSessionId}"` : "";
    const scriptLines = [`#!/bin/bash`];
    if (!hasSubscription && apiKey) {
      scriptLines.push(`export ANTHROPIC_API_KEY="${apiKey}"`);
    }
    scriptLines.push(
      `cd ${dest}`,
      `PROMPT=$(cat /tmp/_genie_prompt)`,
      `CTX=$(cat /tmp/_genie_ctx)`,
      `exec ${claudePath} -p "$PROMPT" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "$CTX"${resumeFlag}`,
    );
    const script = scriptLines.join("\n");
    await sshSession.exec(`cat > /tmp/_genie_run.sh << 'GENIEEOF'\n${script}\nGENIEEOF`);

    send(ws, { type: "chat:claude-info", payload: {
      model: "",
      email: authEmail,
      plan: authPlan || (hasSubscription ? "Max" : apiKey ? "API Key" : ""),
      version: "",
    }});

    send(ws, { type: "chat:status", payload: { status: "Claude is thinking..." } });

    const cmd = `bash -l /tmp/_genie_run.sh`;
    console.log(`[claude-code] Running: ${cmd}`);
    const channel = await sshSession.execStreaming(cmd, { pty: true });

    let fullContent = "";
    const toolUses: { name: string; input: unknown; result: string }[] = [];
    let lineBuffer = "";
    let sessionId: string | null = null;

    let currentToolName = "";
    let currentToolInput = "";

    function processStreamEvent(event: {
      type?: string;
      subtype?: string;
      session_id?: string;
      content_block?: { type?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      message?: { content?: Array<{ type: string; text?: string; name: string; input?: unknown }> };
      model?: string;
      claude_code_version?: string;
      result?: string;
      [key: string]: unknown;
    }) {
      if (event.session_id) sessionId = event.session_id;

      console.log(`[claude-code] event type=${event.type} subtype=${event.subtype || ""} keys=${Object.keys(event).join(",")}`);

      switch (event.type) {
        case "content_block_start":
          if (event.content_block?.type === "tool_use") {
            currentToolName = event.content_block.name || "";
            currentToolInput = "";
          }
          break;

        case "content_block_delta":
          if (event.delta?.type === "text_delta") {
            const text = event.delta.text || "";
            fullContent += text;
            send(ws, { type: "chat:token", payload: { token: text } });
          } else if (event.delta?.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json || "";
          }
          break;

        case "content_block_stop":
          if (currentToolName) {
            let parsedInput: Record<string, unknown> = {};
            try { parsedInput = JSON.parse(currentToolInput); } catch { /* keep empty input on parse failure */ }
            toolUses.push({ name: currentToolName, input: parsedInput, result: "" });
            send(ws, { type: "chat:tool", payload: { name: currentToolName, input: parsedInput, result: "" } });
            currentToolName = "";
            currentToolInput = "";
          }
          break;

        case "message_start":
        case "message_delta":
        case "message_stop":
        case "ping":
          break;

        case "assistant":
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                fullContent += block.text;
                send(ws, { type: "chat:token", payload: { token: block.text } });
              } else if (block.type === "tool_use") {
                toolUses.push({ name: block.name, input: block.input, result: "" });
                send(ws, { type: "chat:tool", payload: { name: block.name, input: block.input, result: "" } });
              }
            }
          }
          break;

        case "system":
          console.log(`[claude-code] system event: ${JSON.stringify(event).slice(0, 1000)}`);
          send(ws, { type: "chat:claude-info", payload: {
            model: event.model || "",
            email: authEmail,
            plan: authPlan || (hasSubscription ? "Max" : apiKey ? "API Key" : ""),
            version: event.claude_code_version || "",
          }});
          break;

        case "result":
          if (event.session_id) sessionId = event.session_id;
          if (event.result && !fullContent) fullContent = event.result;
          break;

        default:
          console.log(`[claude-code] UNHANDLED event: ${JSON.stringify(event).slice(0, 500)}`);
          break;
      }
    }

    channel.stdout.on("data", (chunk: Buffer) => {
      const raw = chunk.toString();
      console.log(`[claude-code:stdout] ${raw.slice(0, 500)}`);
      lineBuffer += raw;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          processStreamEvent(event);
        } catch {
          console.log(`[claude-code:non-json] ${line.slice(0, 300)}`);
        }
      }
    });

    channel.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[claude-code:stderr:${instance.label}] ${text}`);
    });

    console.log(`[claude-code] Command: ${cmd.replace(apiKey, "***")}`);

    abortSignal.addEventListener("abort", () => {
      try { channel.close(); } catch { /* already closed */ }
    }, { once: true });

    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      channel.stdout.on("end", () => {
        console.log(`[claude-code] stdout ended, fullContent length=${fullContent.length}, sessionId=${sessionId}`);
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer);
            processStreamEvent(event);
          } catch { /* trailing non-JSON */ }
        }
        done();
      });
      channel.stdout.on("close", () => {
        console.log(`[claude-code] stdout closed`);
        done();
      });
    });

    if (sessionId) {
      try {
        await saveResumeSessionId(sessionKey, sessionId, project.id, instance.id);
        if (assistantSessionId) {
          await assistantLogService.saveSessionResumeMeta(assistantSessionId, {
            claudeCodeSessionId: sessionId,
            projectId: project.id,
            instanceId: instance.id,
          });
        }
      } catch (err) {
        console.error(`[claude-code] Failed to persist session id:`, err instanceof Error ? err.message : String(err));
      }
    }

    activeChatAbortControllers.delete(ws);
    send(ws, { type: "chat:status", payload: { status: "" } });
    send(ws, { type: "chat:done", payload: {} });
    onComplete?.(fullContent, toolUses);
  } catch (err: unknown) {
    activeChatAbortControllers.delete(ws);
    send(ws, { type: "chat:error", payload: { message: (err instanceof Error ? err.message : String(err)) || "Claude Code failed" } });
  } finally {
    sshSession.close();
  }

  return true;
}
