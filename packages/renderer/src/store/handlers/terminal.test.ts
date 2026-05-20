// Terminal handlers — mix of $terminal Subject mutations and
// window.dispatchEvent side effects (the actual xterm.js writes are
// delegated to components listening on those events, so the handlers'
// contract is just "fired the event with the right detail").

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../actions/terminal", () => ({
  removeTerminalTab: vi.fn(),
}));

import { handlers } from "./terminal";
import { $terminal } from "../subjects/vps";
import { removeTerminalTab } from "../actions/terminal";

let dispatchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  $terminal.next({
    tabs: [],
    activeTabId: null,
    bottomPanelOpen: false,
    bottomPanelHeight: 200,
    shareInvites: [],
  });
  dispatchSpy = vi.spyOn(window, "dispatchEvent");
  vi.clearAllMocks();
});

function lastDispatchedEvent(name: string): CustomEvent | null {
  for (let i = dispatchSpy.mock.calls.length - 1; i >= 0; i--) {
    const ev = dispatchSpy.mock.calls[i][0] as Event;
    if (ev.type === name) return ev as CustomEvent;
  }
  return null;
}

describe("terminal:data / exit", () => {
  it("terminal:data dispatches a CustomEvent to the xterm component", () => {
    handlers["terminal:data"]({ id: "tab-1", data: "hello\n" });
    const ev = lastDispatchedEvent("genie:terminal:data");
    expect(ev).not.toBeNull();
    expect(ev!.detail).toEqual({ id: "tab-1", data: "hello\n" });
  });

  it("terminal:exit dispatches genie:terminal:exit with the payload", () => {
    handlers["terminal:exit"]({ id: "tab-1", exitCode: 0 });
    const ev = lastDispatchedEvent("genie:terminal:exit");
    expect(ev!.detail).toEqual({ id: "tab-1", exitCode: 0 });
  });
});

describe("terminal:error", () => {
  it("renders the error as red ANSI text into the terminal pane", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers["terminal:error"]({ id: "tab-1", message: "ssh refused" });

    expect(warnSpy).toHaveBeenCalledWith("Terminal error:", "ssh refused");
    const ev = lastDispatchedEvent("genie:terminal:data");
    // Wrapped in red ANSI escape codes — \x1b[31m … \x1b[0m
    expect(ev!.detail).toEqual({
      id: "tab-1",
      data: "\r\n\x1b[31mssh refused\x1b[0m\r\n",
    });
    warnSpy.mockRestore();
  });
});

describe("terminal:sessions:list (re-attachment after reload)", () => {
  it("creates tabs for sessions the user doesn't yet have open", () => {
    handlers["terminal:sessions:list"]({
      sessions: [
        {
          id: "sess-1",
          ownerId: "alice",
          ownerName: "Alice",
          collaboratorIds: [],
          isOwner: true,
          viewerIds: [],
        },
        {
          id: "sess-2",
          ownerId: "bob",
          ownerName: "Bob",
          collaboratorIds: ["alice"],
          isOwner: false,
          viewerIds: ["alice"],
        },
      ],
    });

    const tabs = $terminal.getValue().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toMatchObject({ id: "sess-1", shared: false, title: "Terminal (restored)" });
    expect(tabs[1]).toMatchObject({ id: "sess-2", shared: true, title: "Bob's Terminal" });
    expect($terminal.getValue().bottomPanelOpen).toBe(true);
  });

  it("updates viewerIds on already-open tabs without re-adding them", () => {
    $terminal.next({
      ...$terminal.getValue(),
      tabs: [{ id: "sess-1", title: "T", shared: false, ownerId: "alice", ownerName: "Alice", viewerIds: [] }],
    });

    handlers["terminal:sessions:list"]({
      sessions: [
        {
          id: "sess-1",
          ownerId: "alice",
          ownerName: "Alice",
          collaboratorIds: ["bob"],
          isOwner: true,
          viewerIds: ["bob", "charlie"],
        },
      ],
    });

    const tabs = $terminal.getValue().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].viewerIds).toEqual(["bob", "charlie"]);
  });
});

describe("terminal:share lifecycle", () => {
  it("share:invite appends to shareInvites", () => {
    handlers["terminal:share:invite"]({
      sessionId: "sess-1", ownerId: "alice", ownerName: "Alice", conversationId: "conv-1",
    });

    expect($terminal.getValue().shareInvites).toEqual([
      { sessionId: "sess-1", ownerId: "alice", ownerName: "Alice", conversationId: "conv-1" },
    ]);
  });

  it("share:joined dispatches scrollback as an event", () => {
    handlers["terminal:share:joined"]({ sessionId: "sess-1", scrollback: "previous output\n" });
    const ev = lastDispatchedEvent("genie:terminal:scrollback");
    expect(ev!.detail).toEqual({ sessionId: "sess-1", scrollback: "previous output\n" });
  });

  it("share:viewers updates the matching tab's viewerIds", () => {
    $terminal.next({
      ...$terminal.getValue(),
      tabs: [
        { id: "sess-1", title: "T", shared: false, ownerId: "a", ownerName: "A", viewerIds: [] },
        { id: "sess-2", title: "T2", shared: false, ownerId: "a", ownerName: "A", viewerIds: [] },
      ],
    });

    handlers["terminal:share:viewers"]({ sessionId: "sess-1", viewerIds: ["bob"] });

    expect($terminal.getValue().tabs[0].viewerIds).toEqual(["bob"]);
    expect($terminal.getValue().tabs[1].viewerIds).toEqual([]);
  });

  it("share:revoked drops the tab and falls back activeTabId", () => {
    $terminal.next({
      ...$terminal.getValue(),
      tabs: [
        { id: "sess-1", title: "T1", shared: true, ownerId: "a", ownerName: "A", viewerIds: [] },
        { id: "sess-2", title: "T2", shared: true, ownerId: "a", ownerName: "A", viewerIds: [] },
      ],
      activeTabId: "sess-1",
    });

    handlers["terminal:share:revoked"]({ sessionId: "sess-1" });

    expect($terminal.getValue().tabs.map((t) => t.id)).toEqual(["sess-2"]);
    expect($terminal.getValue().activeTabId).toBe("sess-2");
  });

  it("share:revoked sets activeTabId to null when no tabs remain", () => {
    $terminal.next({
      ...$terminal.getValue(),
      tabs: [{ id: "sess-1", title: "T1", shared: true, ownerId: "a", ownerName: "A", viewerIds: [] }],
      activeTabId: "sess-1",
    });

    handlers["terminal:share:revoked"]({ sessionId: "sess-1" });

    expect($terminal.getValue().tabs).toEqual([]);
    expect($terminal.getValue().activeTabId).toBeNull();
  });

  it("share:kicked calls removeTerminalTab and dispatches a kicked event", () => {
    handlers["terminal:share:kicked"]({ sessionId: "sess-1" });
    expect(removeTerminalTab).toHaveBeenCalledExactlyOnceWith("sess-1");
    expect(lastDispatchedEvent("genie:terminal:share:kicked")?.detail).toEqual({ sessionId: "sess-1" });
  });

  it("share:error logs to console and dispatches an error event", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers["terminal:share:error"]({ message: "permission denied" });
    expect(warnSpy).toHaveBeenCalled();
    expect(lastDispatchedEvent("genie:terminal:share:error")?.detail).toEqual({ message: "permission denied" });
    warnSpy.mockRestore();
  });
});
