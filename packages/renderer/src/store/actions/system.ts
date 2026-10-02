import { wsSend } from "@/lib/ws";
import { $logs } from "../subjects/common";

// --- Logs actions ---

export function switchLogSource(source: string): void {
  $logs.nextAssign({ activeSource: source });
}

export function clearManagerLogs(): void {
  const l = $logs.getValue();
  $logs.next({ ...l, buffers: { ...l.buffers, [l.activeSource]: "" } });
  wsSend("logs:clear", { source: l.activeSource });
}
