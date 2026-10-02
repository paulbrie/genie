import { describe, it, expect, beforeEach, vi } from "vitest";
import { batch } from "subjecto";

vi.mock("@/lib/ws", () => ({
  wsSend: vi.fn(),
  onWsClose: vi.fn(),
}));

vi.mock("@/lib/terminal-bridge", () => ({
  clearTerminal: vi.fn(),
  disposeTerminal: vi.fn(),
  getTerminalSize: vi.fn(() => ({ cols: 100, rows: 30 })),
}));

vi.mock("./vps", () => ({
  ensureInstanceState: vi.fn(),
  watchVpsStats: vi.fn(),
  unwatchVpsStats: vi.fn(),
  resubscribeVpsStatsWatches: vi.fn(),
  refreshVmTmuxSessions: vi.fn(),
}));

import { wsSend } from "@/lib/ws";
import { $vmConnections } from "../subjects/vps";
import { reconnectOpenVmConnections } from "./vm-connection";

function seedConnection(
  key: string,
  status: "connecting" | "connected" | "closed" | "error",
): void {
  batch(() => {
    $vmConnections.getValue().connections[key] = {
      key,
      projectId: "p1",
      instanceId: "i1",
      host: "10.0.0.1",
      port: 22,
      username: "root",
      vmLabel: "vm",
      terminalId: `term-${key}`,
      status,
      errorMessage: status === "closed" ? "WebSocket disconnected" : null,
      bytesIn: 0,
      bytesOut: 0,
      stats: null,
      statsError: null,
      sshSessions: null,
      sshEstablished: null,
      sshClientAliveInterval: null,
      tmuxSessions: [],
      lastStatsAt: null,
      lastTmuxAt: null,
      openedAt: Date.now(),
      tmuxSessionName: "genie-1",
      tmuxIntent: "new",
    };
  });
}

beforeEach(() => {
  $vmConnections.next({ connections: {} });
  vi.clearAllMocks();
});

describe("reconnectOpenVmConnections", () => {
  it("re-dials closed and connected popups but skips error slots", () => {
    seedConnection("closed-one", "closed");
    seedConnection("live-one", "connected");
    seedConnection("bad-one", "error");

    reconnectOpenVmConnections();

    const sends = vi.mocked(wsSend).mock.calls.map((c) => c[0]);
    expect(sends.filter((t) => t === "terminal:start")).toHaveLength(2);
    // Soft reconnect: same terminalId, no terminal:close — the manager reattaches
    // the surviving PTY (or dials fresh if the grace window lapsed).
    expect(sends).not.toContain("terminal:close");
    expect($vmConnections.getValue().connections["closed-one"].status).toBe("reconnecting");
    expect($vmConnections.getValue().connections["live-one"].status).toBe("reconnecting");
    expect($vmConnections.getValue().connections["bad-one"].status).toBe("error");
  });
});
