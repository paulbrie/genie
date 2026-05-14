import "./load-env.js";
import { seedClaude } from "./db/seed.js";
import { createServer, shutdown } from "./ws-server.js";
import { startSlackBot, stopSlackBot } from "./slack-bot.js";

// One-shot egress probe at boot — logs the manager's public IPv4 and IPv6 (or "n/a")
// so you know what to put in MANAGER_PUBLIC_IP / MANAGER_PUBLIC_IP_V6 env vars.
// Especially useful on Railway where v6 egress availability isn't documented.
async function probeEgress(): Promise<void> {
  async function probe(url: string, label: string): Promise<string> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return `${label} probe: HTTP ${res.status}`;
      return `${label} egress: ${(await res.text()).trim()}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `${label} egress: n/a (${msg.slice(0, 60)})`;
    }
  }
  // ipify has separate v4-only and v6-only endpoints — DNS resolves to one family each.
  const [v4, v6] = await Promise.all([
    probe("https://api.ipify.org", "IPv4"),
    probe("https://api6.ipify.org", "IPv6"),
  ]);
  console.log(`[egress] ${v4}`);
  console.log(`[egress] ${v6}`);
}
void probeEgress();

// Seed the Claude agent user, then start the WS server
await seedClaude();
const wss = await createServer();

// Start Slack bot if configured
if (process.env.SLACK_BOT_TOKEN) {
  startSlackBot().catch((err) => console.error("[slack] Failed to start:", err));
}

function gracefulShutdown(): void {
  console.log("\nShutting down Genie manager...");
  stopSlackBot().catch(() => {});
  shutdown(wss);
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
