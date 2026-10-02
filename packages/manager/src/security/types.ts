// Shared types for the security scanner. Pulled out so individual check
// modules can `import type` from here without dragging in the orchestrator.

export type ScanStatus = "idle" | "running" | "stopping" | "completed" | "error";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface PortResult {
  port: number;
  state: "open" | "closed" | "filtered";
  service: string;
  banner?: string;
}

export interface WebFinding {
  id: string;
  category: "header" | "directory" | "ssl" | "disclosure" | "sqli" | "xss" | "redirect" | "cors" | "cookie" | "method" | "host" | "ssti" | "other";
  severity: Severity;
  title: string;
  description: string;
  url: string;
  evidence?: string;
}

export interface SecurityScan {
  id: string;
  target: string;
  status: ScanStatus;
  startedAt: number;
  completedAt?: number;
  progress: number;
  phase: string;
  ports: PortResult[];
  findings: WebFinding[];
  operations: string[];
  error?: string;
}

export interface ScanCallbacks {
  onProgress: (update: Partial<SecurityScan>) => void;
  signal: AbortSignal;
}
