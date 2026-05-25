import { $persistedTerminals, $terminal } from "../subjects/vps";
import type { PersistedTerminalSession, TerminalTab } from "../types/vps";
import { removeTerminalTab } from "../actions/terminal";
import type { HandlerMap } from "./types";

// --- Terminal messages ---

export const handlers: HandlerMap = {
  "terminal:data": (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("genie:terminal:data", { detail: payload })
      );
    }
  },

  "terminal:exit": (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("genie:terminal:exit", { detail: payload })
      );
    }
  },

  "terminal:error": (payload) => {
    console.warn("Terminal error:", payload.message);
    // Render the error into the terminal pane so the user actually sees it.
    const id = payload.id;
    const text = `\r\n\x1b[31m${payload.message}\x1b[0m\r\n`;
    if (id && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("genie:terminal:data", { detail: { id, data: text } }));
    }
  },

  "terminal:sessions:list": (payload) => {
    const { sessions } = payload as {
      sessions: Array<{
        id: string;
        ownerId: string;
        ownerName: string;
        collaboratorIds: string[];
        isOwner: boolean;
        viewerIds: string[];
      }>;
    };
    if (sessions.length > 0) {
      const t = $terminal.getValue();
      const existingIds = new Set(t.tabs.map((tab) => tab.id));
      // Update viewerIds on existing tabs immutably
      let updatedTabs = t.tabs.map((tab) => {
        const sess = sessions.find((s) => s.id === tab.id);
        return sess ? { ...tab, viewerIds: sess.viewerIds } : tab;
      });
      const newTabs: TerminalTab[] = [];
      for (const sess of sessions) {
        if (existingIds.has(sess.id)) continue;
        newTabs.push({
          id: sess.id,
          title: sess.isOwner ? "Terminal (restored)" : `${sess.ownerName}'s Terminal`,
          shared: !sess.isOwner,
          ownerId: sess.ownerId,
          ownerName: sess.ownerName,
          viewerIds: sess.viewerIds,
        });
      }
      if (newTabs.length > 0) {
        updatedTabs = [...updatedTabs, ...newTabs];
        $terminal.next({
          ...t,
          tabs: updatedTabs,
          activeTabId: t.activeTabId || newTabs[0].id,
          bottomPanelOpen: true,
        });
      } else if (updatedTabs !== t.tabs) {
        $terminal.next({ ...t, tabs: updatedTabs });
      }
    }
  },

  "terminal:share:invite": (payload) => {
    const { sessionId, ownerId, ownerName, conversationId } = payload;
    const t = $terminal.getValue();
    $terminal.nextAssign({
      shareInvites: [
        ...t.shareInvites,
        { sessionId, ownerId, ownerName, conversationId },
      ],
    });
  },

  "terminal:share:joined": (payload) => {
    // Write scrollback history to the terminal
    const { sessionId, scrollback } = payload;
    if (scrollback) {
      window.dispatchEvent(new CustomEvent("genie:terminal:scrollback", { detail: { sessionId, scrollback } }));
    }
  },

  "terminal:share:viewers": (payload) => {
    const { sessionId, viewerIds } = payload;
    const t = $terminal.getValue();
    $terminal.nextAssign({
      tabs: t.tabs.map((tab) =>
        tab.id === sessionId ? { ...tab, viewerIds } : tab
      ),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("genie:terminal:share:viewers", { detail: { sessionId, viewerIds } }));
    }
  },

  "terminal:share:revoked": (payload) => {
    const { sessionId } = payload;
    const t = $terminal.getValue();
    const newTabs = t.tabs.filter((tab) => tab.id !== sessionId);
    $terminal.next({
      ...t,
      tabs: newTabs,
      activeTabId: t.activeTabId === sessionId
        ? (newTabs.length > 0 ? newTabs[0].id : null)
        : t.activeTabId,
    });
  },

  "terminal:share:kicked": (payload) => {
    const { sessionId } = payload;
    // Remove the shared tab and dispatch event for extension to handle
    removeTerminalTab(sessionId);
    window.dispatchEvent(new CustomEvent("genie:terminal:share:kicked", { detail: { sessionId } }));
  },

  "terminal:share:error": (payload) => {
    const errMsg = payload.message || "Failed to share terminal";
    console.warn("Terminal share error:", errMsg);
    window.dispatchEvent(new CustomEvent("genie:terminal:share:error", { detail: { message: errMsg } }));
  },

  "terminal:share:sent": (payload) => {
    window.dispatchEvent(new CustomEvent("genie:terminal:share:sent", { detail: payload }));
  },

  // --- Persisted terminal sessions (Terminals tab in History) ---

  "terminal:list": (payload) => {
    const { sessions } = payload as { sessions: PersistedTerminalSession[] };
    $persistedTerminals.nextAssign({ sessions: sessions || [], loading: false });
  },

  "terminal:forgotten": (payload) => {
    const { id } = payload as { id: string };
    const state = $persistedTerminals.getValue();
    $persistedTerminals.nextAssign({ sessions: state.sessions.filter((s) => s.id !== id) });
  },
};
