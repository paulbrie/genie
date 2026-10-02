// Inbound manager-pty:* handlers — the local shell on the manager host.
// The xterm bridge and the addTerminalTab/removeTerminalTab actions are
// mocked, so each handler's contract is asserted at the call-boundary:
// what frames decode where, when xterm/tab cleanup fires, and that error
// frames with no terminalId are tolerated.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/terminal-bridge", () => ({
  writeToTerminal: vi.fn(),
  refitTerminal: vi.fn(),
  disposeTerminal: vi.fn(),
}));
vi.mock("../actions/terminal", () => ({
  removeTerminalTab: vi.fn(),
}));

import { handlers } from "./manager-pty";
import { disposeTerminal, refitTerminal, writeToTerminal } from "@/lib/terminal-bridge";
import { removeTerminalTab } from "../actions/terminal";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manager-pty:ready", () => {
  it("refits the xterm so the post-mount geometry reaches the PTY", () => {
    handlers["manager-pty:ready"]({ terminalId: "tab-1" });
    expect(refitTerminal).toHaveBeenCalledWith("tab-1");
  });
});

describe("manager-pty:output", () => {
  it("forwards the base64 frame straight to the xterm bridge", () => {
    handlers["manager-pty:output"]({ terminalId: "tab-1", dataB64: "aGk=" });
    expect(writeToTerminal).toHaveBeenCalledWith("tab-1", "aGk=");
  });

  it("does not throw on an empty payload", () => {
    expect(() =>
      handlers["manager-pty:output"]({ terminalId: "tab-1", dataB64: "" }),
    ).not.toThrow();
    expect(writeToTerminal).toHaveBeenCalledWith("tab-1", "");
  });
});

describe("manager-pty:closed", () => {
  it("disposes the xterm and removes the tab when the PTY exits", () => {
    handlers["manager-pty:closed"]({ terminalId: "tab-1", exitCode: 0 });
    expect(disposeTerminal).toHaveBeenCalledWith("tab-1");
    expect(removeTerminalTab).toHaveBeenCalledWith("tab-1");
  });

  it("also fires when exitCode is missing or null", () => {
    handlers["manager-pty:closed"]({ terminalId: "tab-2" });
    expect(disposeTerminal).toHaveBeenCalledWith("tab-2");
    expect(removeTerminalTab).toHaveBeenCalledWith("tab-2");
  });
});

describe("manager-pty:error", () => {
  it("surfaces the error inline in the xterm when a terminalId is present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers["manager-pty:error"]({ terminalId: "tab-1", message: "spawn failed" });

    expect(writeToTerminal).toHaveBeenCalledTimes(1);
    const [terminalId, encoded] = (writeToTerminal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(terminalId).toBe("tab-1");
    // Decode the base64 payload and assert the human-readable message survives.
    const decoded = atob(encoded);
    expect(decoded).toContain("spawn failed");
    expect(decoded).toContain("[manager-pty]");

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("tolerates a null terminalId without touching the xterm bridge", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      handlers["manager-pty:error"]({ terminalId: null, message: "boom" }),
    ).not.toThrow();
    expect(writeToTerminal).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
