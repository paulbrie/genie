import { batch } from "subjecto";
import { $security } from "../subjects/admin";
import type { SecurityScan } from "../types/admin";
import type { HandlerMap } from "./types";

// --- Security messages ---

export const handlers: HandlerMap = {
  "security:scan:progress": (payload) => {
    const { id: scanId, ...update } = payload;
    if (!scanId) return;
    batch(() => {
      const sec = $security.getValue();
      let existing = sec.scans.find((s: SecurityScan) => s.id === scanId);
      if (!existing) {
        existing = { id: scanId, target: sec.target, status: "running", startedAt: Date.now(), progress: 0, phase: "Starting", ports: [], findings: [], operations: [] } as SecurityScan;
        sec.scans.unshift(existing);
        sec.activeScanId = scanId;
      }
      Object.assign(existing, update);
      existing.id = scanId; // Prevent id from being overwritten by update
    });
  },

  "security:scan:complete": (payload) => {
    const sec = $security.getValue();
    const scanId = payload.scanId || payload.id;
    const scan = sec.scans.find((s: SecurityScan) => s.id === scanId);
    if (scan) {
      batch(() => {
        scan.status = "completed";
        scan.completedAt = payload.completedAt;
        scan.progress = 100;
        scan.phase = "Complete";
        if (sec.activeScanId === scanId) sec.activeScanId = null;
      });
    }
  },

  "security:scan:error": (payload) => {
    const sec = $security.getValue();
    const scanId = payload.scanId || payload.id;
    const scan = sec.scans.find((s: SecurityScan) => s.id === scanId);
    if (scan) {
      batch(() => {
        scan.status = "error";
        scan.error = payload.message;
        if (sec.activeScanId === scanId) sec.activeScanId = null;
      });
    }
  },

  "security:scans:list": (payload) => {
    const scans = payload.scans as SecurityScan[];
    batch(() => {
      const sec = $security.getValue();
      // Merge: keep any active in-progress scan, replace the rest with DB history
      const activeScan = sec.activeScanId ? sec.scans.find((s: SecurityScan) => s.id === sec.activeScanId) : null;
      const merged = activeScan
        ? [activeScan, ...scans.filter((s: SecurityScan) => s.id !== activeScan.id)]
        : scans;
      sec.scans = merged;
    });
  },

  "security:scan:deleted": (payload) => {
    batch(() => {
      const sec = $security.getValue();
      sec.scans = sec.scans.filter((s: SecurityScan) => s.id !== payload.scanId);
    });
  },
};
