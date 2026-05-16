import { $tracker } from "../subjects/tracker";
import type { HandlerMap } from "./types";

// --- Tracker WS handlers ---

export const handlers: HandlerMap = {
  "tracker:list": (payload) => {
    $tracker.nextAssign({ issues: payload.issues, labels: payload.labels, loading: false });
  },

  "tracker:issue:created": (_payload) => {
    $tracker.nextAssign({ showCreateForm: false });
  },

  "tracker:issue:updated": (payload) => {
    // Patch the local issue immediately for responsiveness
    const tr = $tracker.getValue();
    $tracker.nextAssign({
      issues: tr.issues.map((i) => i.id === payload.id ? payload : i),
    });
  },

  "tracker:issue:deleted": (payload) => {
    const { issueId } = payload;
    const tr = $tracker.getValue();
    $tracker.nextAssign({
      issues: tr.issues.filter((i) => i.id !== issueId),
      selectedIssueId: tr.selectedIssueId === issueId ? null : tr.selectedIssueId,
    });
  },

  "tracker:comments:list": (payload) => {
    const { issueId, comments } = payload;
    window.dispatchEvent(new CustomEvent("tracker:comments", { detail: { issueId, comments } }));
  },

  "tracker:comment:created": (payload) => {
    const { issueId, comment } = payload;
    window.dispatchEvent(new CustomEvent("tracker:comment:created", { detail: { issueId, comment } }));
  },

  "tracker:comment:deleted": (payload) => {
    const { commentId, issueId } = payload;
    window.dispatchEvent(new CustomEvent("tracker:comment:deleted", { detail: { commentId, issueId } }));
  },

  "tracker:error": (payload) => {
    console.error("Tracker error:", payload.message);
    $tracker.nextAssign({ loading: false });
  },
};
