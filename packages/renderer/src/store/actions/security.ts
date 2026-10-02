import { wsSend } from "@/lib/ws";
import { $security } from "../subjects/admin";

// --- Security actions ---

export function loadSecurityScans(): void {
  wsSend("security:scans:list", {});
}

export function startSecurityScan(target: string): void {
  const v = $security.getValue();
  v.target = target;
  wsSend("security:scan:start", { target });
}

export function stopSecurityScan(scanId: string): void {
  wsSend("security:scan:stop", { scanId });
}

export function deleteSecurityScan(scanId: string): void {
  wsSend("security:scan:delete", { scanId });
}
