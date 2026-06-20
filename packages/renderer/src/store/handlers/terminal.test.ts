// Inbound terminal:* handlers for the SSH terminal layer. These route frames
// into $vmConnections + the xterm bridge (the real xterm writes are delegated
// to terminal-bridge, mocked here), so each handler's contract is "mutated the
// connection slot / called the bridge / fired the DOM event with the right
// payload".

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

vi.mock("@/lib/terminal-bridge", () => ({
  writeToTerminal: vi.fn(),
  refitTerminal: vi.fn(),
  getTerminalSize: vi.fn(() => null),
  clearTerminal: vi.fn(),
  disposeTerminal: vi.fn(),
}));
vi.mock("@/lib/ws", () => ({
  wsSend: vi.fn(),
  onWsClose: vi.fn(),
}));

import { handlers } from "./terminal";
import { $vmConnections } from "../subjects/vps";
import { writeToTerminal, refitTerminal, getTerminalSize, clearTerminal } from "@/lib/terminal-bridge";
import { wsSend } from "@/lib/ws";
import type { VmConnectionState } from "../types/vps";

function makeConn(overrides: Partial<VmConnectionState>): VmConnectionState {
  return {
    key: "k1",
    projectId: "p1",
    instanceId: "i1",
    host: "h",
    port: 22,
    username: "genie",
    vmLabel: "VM",
    terminalId: "term-1",
    status: "connecting",
    errorMessage: null,
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
    openedAt: 0,
    ...overrides,
  };
}

function seed(conns: VmConnectionState[]) {
  const c = $vmConnections.getValue().connections;
  for (const k of Object.keys(c)) delete c[k];
  for (const conn of conns) c[conn.key] = conn;
}

const slot = (key: string) => $vmConnections.getValue().connections[key];

beforeEach(() => {
  seed([]);
  vi.clearAllMocks();
});

describe("terminal:output", () => {
  it("decodes the frame to the xterm bridge", () => {
    handlers["terminal:output"]({ terminalId: "term-1", dataB64: "aGk=" });
    expect(writeToTerminal).toHaveBeenCalledWith("term-1", "aGk=");
  });
});

describe("terminal:ready", () => {
  it("marks the connection connected, clears the error, and reports its size", () => {
    seed([makeConn({ status: "connecting", errorMessage: "old" })]);
    (getTerminalSize as Mock).mockReturnValue({ cols: 80, rows: 24 });

    handlers["terminal:ready"]({ terminalId: "term-1" });

    expect(slot("k1").status).toBe("connected");
    expect(slot("k1").errorMessage).toBeNull();
    expect(refitTerminal).toHaveBeenCalledWith("term-1");
    expect(wsSend).toHaveBeenCalledWith("terminal:resize", { terminalId: "term-1", cols: 80, rows: 24 });
  });

  it("flips a first-launch tmux intent from new to attach", () => {
    seed([makeConn({ tmuxIntent: "new", tmuxSessionName: "claude-x" })]);
    handlers["terminal:ready"]({ terminalId: "term-1" });
    expect(slot("k1").tmuxIntent).toBe("attach");
  });

  it("stores a server-resolved tmux session name and flips intent to attach", () => {
    // Server generated the name (client launched with tmuxIntent:new, no name) —
    // round-tripping it is what makes the session reattachable after a restart.
    seed([makeConn({ tmuxIntent: "new", tmuxSessionName: undefined })]);
    handlers["terminal:ready"]({ terminalId: "term-1", tmuxSessionName: "tab-123-7" });
    expect(slot("k1").tmuxSessionName).toBe("tab-123-7");
    expect(slot("k1").tmuxIntent).toBe("attach");
  });

  it("leaves the tmux session name untouched when the ready frame omits it", () => {
    seed([makeConn({ tmuxSessionName: "claude-keep" })]);
    handlers["terminal:ready"]({ terminalId: "term-1", tmuxSessionName: null });
    expect(slot("k1").tmuxSessionName).toBe("claude-keep");
  });

  it("does not send a resize when the size is unknown", () => {
    seed([makeConn({})]);
    (getTerminalSize as Mock).mockReturnValue(null);
    handlers["terminal:ready"]({ terminalId: "term-1" });
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("clears the xterm on a fresh PTY (reattached: false)", () => {
    seed([makeConn({ status: "reconnecting" })]);
    handlers["terminal:ready"]({ terminalId: "term-1", reattached: false });
    expect(clearTerminal).toHaveBeenCalledWith("term-1");
    expect(slot("k1").status).toBe("connected");
  });

  it("keeps the scrollback on a grace-window reattach (reattached: true)", () => {
    seed([makeConn({ status: "reconnecting" })]);
    handlers["terminal:ready"]({ terminalId: "term-1", reattached: true });
    expect(clearTerminal).not.toHaveBeenCalled();
    expect(slot("k1").status).toBe("connected");
  });

  it("keeps the scrollback when no reattached flag is present (initial open)", () => {
    seed([makeConn({})]);
    handlers["terminal:ready"]({ terminalId: "term-1" });
    expect(clearTerminal).not.toHaveBeenCalled();
  });
});

describe("terminal:traffic", () => {
  it("records the byte counters on the slot", () => {
    seed([makeConn({})]);
    handlers["terminal:traffic"]({ terminalId: "term-1", bytesIn: 12, bytesOut: 34 });
    expect(slot("k1").bytesIn).toBe(12);
    expect(slot("k1").bytesOut).toBe(34);
  });
});

describe("terminal:error", () => {
  it("marks the connection errored with the message", () => {
    seed([makeConn({ status: "connected" })]);
    handlers["terminal:error"]({ terminalId: "term-1", message: "ssh refused" });
    expect(slot("k1").status).toBe("error");
    expect(slot("k1").errorMessage).toBe("ssh refused");
  });

  it("only warns when there is no terminalId", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers["terminal:error"]({ terminalId: null, message: "boom" });
    expect(warnSpy).toHaveBeenCalledWith("[terminal] error (no terminalId):", "boom");
    warnSpy.mockRestore();
  });
});

describe("terminal:closed", () => {
  it("marks the connection closed (kept for the UI to show disconnected)", () => {
    seed([makeConn({ status: "connected" })]);
    handlers["terminal:closed"]({ terminalId: "term-1" });
    expect(slot("k1").status).toBe("closed");
  });
});

describe("terminal:paste-image:result", () => {
  it("dispatches a DOM CustomEvent with the payload", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handlers["terminal:paste-image:result"]({ terminalId: "term-1", ok: true, remotePath: "/tmp/x.png" });

    const ev = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e.type === "genie:terminal:paste-image:result");

    expect(ev).toBeDefined();
    expect(ev!.detail).toEqual({ terminalId: "term-1", ok: true, remotePath: "/tmp/x.png", error: undefined });
    dispatchSpy.mockRestore();
  });
});

describe("unknown terminalId", () => {
  it("is a no-op for frames with no matching connection", () => {
    expect(() => handlers["terminal:error"]({ terminalId: "ghost", message: "x" })).not.toThrow();
    expect(() => handlers["terminal:closed"]({ terminalId: "ghost" })).not.toThrow();
    expect(() => handlers["terminal:ready"]({ terminalId: "ghost" })).not.toThrow();
  });
});
