import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 bytes";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export interface ParsedPort {
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findBySlug<T extends { name: string }>(
  items: T[],
  slug: string
): T | undefined {
  return items.find((item) => slugify(item.name) === slug);
}

export function parseDockerPorts(ports: string): ParsedPort[] {
  if (!ports) return [];
  const seen = new Set<number>();
  const result: ParsedPort[] = [];
  const mappings = ports.split(",").map((s) => s.trim());
  for (const m of mappings) {
    const match = m.match(/:(\d+)->(\d+)\/(\w+)/);
    if (!match) continue;
    const hostPort = parseInt(match[1], 10);
    const containerPort = parseInt(match[2], 10);
    const protocol = match[3];
    if (seen.has(hostPort)) continue;
    seen.add(hostPort);
    result.push({ hostPort, containerPort, protocol });
  }
  return result;
}
