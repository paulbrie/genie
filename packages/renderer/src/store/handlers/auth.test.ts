import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the WS layer — auth handlers call into it (sendAuthToken on retry,
// setStoredToken on success, disconnectWs on revoke, wsSend via the
// broadcastWindows resync on auth:success). Tests assert these were invoked
// correctly without opening a real socket.
vi.mock("@/lib/ws", () => ({
  disconnectWs: vi.fn(),
  getStoredToken: vi.fn(),
  sendAuthToken: vi.fn(),
  setStoredToken: vi.fn(),
  wsSend: vi.fn(),
}));

vi.mock("../actions/window-manager", () => ({
  broadcastWindows: vi.fn(),
}));

vi.mock("../actions/vm-connection", () => ({
  reconnectOpenVmConnections: vi.fn(),
}));

import { reconnectOpenVmConnections } from "../actions/vm-connection";
import { broadcastWindows } from "../actions/window-manager";

import { handlers } from "./auth";
import { $auth } from "../subjects/auth";
import { disconnectWs, getStoredToken, sendAuthToken, setStoredToken } from "@/lib/ws";
import type { AuthState } from "../types/auth";

const RESET: AuthState = { status: "loading", user: null, token: null, impersonatedBy: null };

const sampleUser = {
  id: "u-1",
  email: "alice@example.com",
  name: "Alice",
  avatarUrl: null,
  role: "superadmin" as const,
};

beforeEach(() => {
  $auth.next({ ...RESET });
  vi.clearAllMocks();
});

describe("auth:required", () => {
  it("re-auths with stored token when present", () => {
    vi.mocked(getStoredToken).mockReturnValue("stored-jwt");
    handlers["auth:required"]({});
    expect($auth.getValue().status).toBe("loading");
    expect(sendAuthToken).toHaveBeenCalledWith("stored-jwt");
  });

  it("falls back to unauthenticated when no token is stored", () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    handlers["auth:required"]({});
    expect($auth.getValue().status).toBe("unauthenticated");
    expect(sendAuthToken).not.toHaveBeenCalled();
  });
});

describe("auth:success", () => {
  it("stores user + token and persists the token", () => {
    handlers["auth:success"]({ token: "jwt-abc", user: sampleUser });

    const v = $auth.getValue();
    expect(v.status).toBe("authenticated");
    expect(v.user).toEqual(sampleUser);
    expect(v.token).toBe("jwt-abc");
    expect(v.impersonatedBy).toBeNull();
    expect(setStoredToken).toHaveBeenCalledWith("jwt-abc");
    expect(broadcastWindows).toHaveBeenCalled();
    expect(reconnectOpenVmConnections).toHaveBeenCalled();
  });

  it("propagates impersonatedBy when present", () => {
    const impersonatedBy = { id: "admin-1", email: "admin@x", name: "Admin" };
    handlers["auth:success"]({ token: "jwt", user: sampleUser, impersonatedBy });
    expect($auth.getValue().impersonatedBy).toEqual(impersonatedBy);
  });
});

describe("auth:failed / auth:error / auth:logged-out", () => {
  it("auth:failed clears the auth state and stored token", () => {
    $auth.next({ status: "authenticated", user: sampleUser, token: "jwt", impersonatedBy: null });
    handlers["auth:failed"]({});
    expect($auth.getValue()).toEqual({
      status: "unauthenticated", user: null, token: null, impersonatedBy: null,
    });
    expect(setStoredToken).toHaveBeenCalledWith(null);
  });

  it("auth:error clears auth and logs the message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers["auth:error"]({ message: "token expired" });
    expect(warn).toHaveBeenCalledWith("[auth]", "token expired");
    expect($auth.getValue().status).toBe("unauthenticated");
    warn.mockRestore();
  });

  it("auth:logged-out clears auth but does NOT touch stored token", () => {
    // (the user explicitly logged out — token clearing is the action's job)
    handlers["auth:logged-out"]({});
    expect($auth.getValue().status).toBe("unauthenticated");
    expect(setStoredToken).not.toHaveBeenCalled();
  });
});

describe("auth:revoked", () => {
  it("clears auth, drops the socket, and alerts the user", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    handlers["auth:revoked"]({ message: "Access revoked by admin" });

    expect($auth.getValue().status).toBe("unauthenticated");
    expect(setStoredToken).toHaveBeenCalledWith(null);
    expect(disconnectWs).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("Access revoked by admin");
    alertSpy.mockRestore();
  });

  it("uses a default alert when message is missing", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    handlers["auth:revoked"]({});
    expect(alertSpy).toHaveBeenCalledWith("Your access has been revoked.");
    alertSpy.mockRestore();
  });
});

describe("auth:google:url", () => {
  it("opens the OAuth URL in a new tab", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    handlers["auth:google:url"]({ url: "https://accounts.google.com/o/oauth2/..." });
    expect(openSpy).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/...",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
