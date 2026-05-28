import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpBrowserServer } from "./mcp-browser-server.js";
import type { DomActionRequestContext } from "../types.js";

interface RunningServer {
  close(): void;
}

const runningServers: RunningServer[] = [];

afterEach(() => {
  while (runningServers.length > 0) {
    runningServers.pop()?.close();
  }
});

describe("mcp-browser-server", () => {
  it("passes broker headers into dom executor context", async () => {
    const contexts: DomActionRequestContext[] = [];
    const exec = vi.fn(async (_action, _params, context?: DomActionRequestContext) => {
      contexts.push(context ?? {});
      return { success: true, result: "ok" };
    });
    const server = await createMcpBrowserServer(exec);
    runningServers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-genie-user-id": "user-1",
        "x-genie-session-id": "sess-1",
        "x-genie-host": "10.0.0.1",
        "x-genie-project-id": "proj-1",
        "x-genie-instance-id": "inst-1",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-1",
        method: "tools/call",
        params: { name: "browser_get_snapshot", arguments: {} },
      }),
    });

    expect(response.status).toBe(200);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(contexts[0]).toEqual({
      userId: "user-1",
      sessionId: "sess-1",
      host: "10.0.0.1",
      projectId: "proj-1",
      instanceId: "inst-1",
    });
  });

  it("supplies undefined broker fields when headers are absent", async () => {
    let seenContext: DomActionRequestContext | undefined;
    const exec = vi.fn(async (_action, _params, context?: DomActionRequestContext) => {
      seenContext = context;
      return { success: true, result: "ok" };
    });
    const server = await createMcpBrowserServer(exec);
    runningServers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-2",
        method: "tools/call",
        params: { name: "browser_get_snapshot", arguments: {} },
      }),
    });

    expect(response.status).toBe(200);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(seenContext).toEqual({
      userId: undefined,
      sessionId: undefined,
      host: undefined,
      projectId: undefined,
      instanceId: undefined,
    });
  });
});
