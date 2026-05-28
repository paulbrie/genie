import { disconnectWs, getStoredToken, sendAuthToken, setStoredToken } from "@/lib/ws";
import { $auth } from "../subjects/auth";
import { broadcastWindows } from "../actions/window-manager";
import type { HandlerMap } from "./types";

// --- Auth messages ---

export const handlers: HandlerMap = {
  "auth:required": (_payload) => {
    // Server asks for auth — try stored token or show login
    const token = getStoredToken();
    if (token) {
      $auth.nextAssign({ status: "loading" });
      sendAuthToken(token);
    } else {
      $auth.nextAssign({ status: "unauthenticated" });
    }
  },

  "auth:success": (payload) => {
    const { token, user, impersonatedBy, pasteKeyEnabled, geniePublicKey } = payload;
    $auth.next({ status: "authenticated", user, token, impersonatedBy: impersonatedBy ?? null, pasteKeyEnabled: !!pasteKeyEnabled, geniePublicKey: geniePublicKey ?? null });
    setStoredToken(token);
    // Re-broadcast any windows that are still open: on a reconnect the manager
    // rebuilds this session with an empty openWindows list, and broadcastWindows
    // only fires on visibility changes — so without this the admin Connected
    // Users panel would show no popups until the user next toggles one.
    broadcastWindows();
  },

  "auth:failed": (_payload) => {
    $auth.next({ status: "unauthenticated", user: null, token: null, impersonatedBy: null });
    setStoredToken(null);
  },

  "auth:error": (payload) => {
    console.warn("[auth]", payload.message);
    $auth.next({ status: "unauthenticated", user: null, token: null, impersonatedBy: null });
    setStoredToken(null);
  },

  "auth:logged-out": (_payload) => {
    $auth.next({ status: "unauthenticated", user: null, token: null, impersonatedBy: null });
  },

  "auth:revoked": (payload) => {
    setStoredToken(null);
    $auth.next({ status: "unauthenticated", user: null, token: null, impersonatedBy: null });
    disconnectWs();
    if (typeof window !== "undefined") {
      alert(payload.message || "Your access has been revoked.");
    }
  },

  "auth:google:url": (payload) => {
    const { url } = payload;
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
};
