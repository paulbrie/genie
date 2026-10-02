#!/usr/bin/env node
/** Free the Genie manager port before dev restart (avoids EADDRINUSE). */
import { execSync } from "node:child_process";

const PORT = process.env.PORT || "9876";
try {
  const out = execSync(`lsof -t -iTCP:${PORT} 2>/dev/null`, { encoding: "utf8" }).trim();
  if (!out) process.exit(0);
  for (const pid of out.split("\n").filter(Boolean)) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      /* already gone */
    }
  }
} catch {
  /* nothing listening */
}
