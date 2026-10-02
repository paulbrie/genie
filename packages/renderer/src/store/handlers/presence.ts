import { $presenceSessions } from "../subjects/common";
import type { HandlerMap } from "./types";

// --- Presence messages ---

export const handlers: HandlerMap = {
  "presence:detail": (payload) => {
    $presenceSessions.next(payload.sessions || []);
  },
};
