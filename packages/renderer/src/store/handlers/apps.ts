import { stripAnsi } from "@/lib/utils";
import {
  $apps,
  $logBuffers,
  $pendingRestoreAppId,
  $selectedAppId,
  $viewingLogsFor,
} from "../subjects/common";
import type { AppDef } from "../types/common";
import { selectApp } from "../actions/apps";
import type { HandlerMap } from "./types";

const MAX_LOG_BUFFER = 50000;

export const handlers: HandlerMap = {
  "app:list": (payload) => {
    const newApps: AppDef[] = payload.apps;
    $apps.next(newApps);

    // Restore saved app selection on first load
    const pending = $pendingRestoreAppId.getValue();
    if (pending) {
      const restoreApp = newApps.find((a) => a.id === pending);
      $pendingRestoreAppId.next(null);
      if (restoreApp) {
        selectApp(restoreApp.id);
        return;
      }
    }
    // If selected app was removed, deselect
    const selId = $selectedAppId.getValue();
    if (selId && !newApps.find((a) => a.id === selId)) {
      $selectedAppId.next(null);
      $viewingLogsFor.next(null);
    }
  },

  "app:status": (payload) => {
    const currentApps = $apps.getValue();
    $apps.next(currentApps.map((a) =>
      a.id === payload.id ? { ...a, status: payload.status } : a
    ));
    if (payload.status === "crashed") {
      selectApp(payload.id);
    }
  },

  "app:log": (payload) => {
    const logId = payload.id;
    const clean = stripAnsi(payload.data);
    const bufs = $logBuffers.getValue();
    let buf = (bufs[logId] || "") + clean;
    if (buf.length > MAX_LOG_BUFFER) {
      buf = buf.slice(-MAX_LOG_BUFFER);
    }
    $logBuffers.next({ ...bufs, [logId]: buf });
  },
};
