import Anthropic from "@anthropic-ai/sdk";
import * as store from "./store.js";
import { getCachedProcesses, getCachedDockerInfo } from "./monitor.js";
import { toolDefinitions, executeTool } from "./tools/index.js";
let client = null;
function getClient() {
    if (!client) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY is not set");
        }
        client = new Anthropic({ apiKey });
    }
    return client;
}
function buildSystemContext() {
    const apps = store.getAll();
    const processes = getCachedProcesses();
    const docker = getCachedDockerInfo();
    const lines = [
        "You are Genie, a helpful assistant embedded in a desktop system-monitoring app.",
        "You help users understand their system — processes, apps, Docker containers, memory usage, etc.",
        "Answer concisely. Use the live system state below to give contextual answers.",
        "",
        "You have access to tools for searching the web and browsing URLs.",
        "Use the web_search tool when users ask about current events, latest versions, or anything requiring up-to-date information.",
        "Use the browse_url tool when users provide a URL they want you to read or summarize.",
        "",
        "=== Managed Apps ===",
    ];
    if (apps.length === 0) {
        lines.push("No apps registered.");
    }
    else {
        for (const app of apps) {
            lines.push(`- ${app.name} [${app.status}] cmd="${app.command}"${app.cwd ? ` cwd=${app.cwd}` : ""}`);
        }
    }
    lines.push("", "=== Top Processes (by CPU) ===");
    const topProcs = processes.slice(0, 20);
    if (topProcs.length === 0) {
        lines.push("No process data available.");
    }
    else {
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
    }
    else if (docker.containers.length === 0) {
        lines.push("Docker is running but no containers found.");
    }
    else {
        for (const c of docker.containers) {
            lines.push(`- ${c.name} [${c.state}] image=${c.image} CPU=${c.cpu}% MEM=${c.mem}MB${c.ports ? ` ports=${c.ports}` : ""}`);
        }
    }
    return lines.join("\n");
}
const MAX_TOOL_ROUNDS = 5;
export async function handleChat(messages, onToken, onDone, onError, onTool) {
    try {
        const anthropic = getClient();
        const systemPrompt = buildSystemContext();
        const apiMessages = messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const stream = anthropic.messages.stream({
                model: "claude-sonnet-4-20250514",
                max_tokens: 4096,
                system: systemPrompt,
                tools: toolDefinitions,
                messages: apiMessages,
            });
            stream.on("text", (text) => {
                onToken(text);
            });
            const finalMessage = await stream.finalMessage();
            if (finalMessage.stop_reason === "tool_use") {
                // Append assistant response (contains tool_use blocks)
                apiMessages.push({ role: "assistant", content: finalMessage.content });
                // Execute each tool and collect results
                const toolResults = [];
                for (const block of finalMessage.content) {
                    if (block.type === "tool_use") {
                        const result = await executeTool(block.name, block.input);
                        onTool?.(block.name, block.input, result);
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: result,
                        });
                    }
                }
                // Append tool results as user message
                apiMessages.push({ role: "user", content: toolResults });
                continue;
            }
            // stop_reason is "end_turn" or other — we're done
            break;
        }
        onDone();
    }
    catch (err) {
        onError(err.message || "Failed to start chat");
    }
}
//# sourceMappingURL=chat.js.map