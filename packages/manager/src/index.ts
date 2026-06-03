import "./load-env.js";
import { seedClaude } from "./db/seed.js";
import { runBootMigrations } from "./db/migrate.js";
import { startVpsMetricFlusher, stopVpsMetricFlusher } from "./vps/vps-metric-service.js";
import { startSshEventFlusher, stopSshEventFlusher } from "./vps/ssh-events.js";
import { seedDefaultRecipes } from "./recipes-service.js";
import { DEFAULT_RECIPES } from "./default-recipes.js";
import { createServer, shutdown } from "./ws-server.js";
import { startSlackBot, stopSlackBot } from "./slack-bot.js";
import { startWireproxyIfConfigured, stopWireproxy } from "./wireproxy-launcher.js";

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

// Start wireproxy if configured — must run BEFORE createServer so the first
// SSH attempts (recipe checks, stats, etc.) see GENIE_TAZ_SOCKS in the env.
// No-op on hosts with kernel WireGuard (local dev with the macOS app).
try {
  await startWireproxyIfConfigured();
} catch (err) {
  console.error("[wireproxy] startup failed:", err);
  // Fail fast — running the manager with no path to Taz VMs just produces a
  // wall of opaque "SSH connection failed" errors. Better to surface the
  // wireproxy/config problem immediately.
  process.exit(1);
}

// Seed the Claude agent user + upsert built-in recipes into the DB. The
// renderer's Add-ons panel reads only from the DB, so this is what makes the
// built-ins visible to the UI on every boot (also picks up any edits to
// default-recipes.ts).
await seedClaude();
try {
  await runBootMigrations();
} catch (err) {
  console.error("[migrate] Boot migrations failed:", err);
}
startVpsMetricFlusher();
try {
  const { inserted, updated } = await seedDefaultRecipes(DEFAULT_RECIPES);
  console.log(`[recipes] Seeded ${DEFAULT_RECIPES.length} built-in recipes (inserted=${inserted}, updated=${updated}).`);
} catch (err) {
  console.error("[recipes] Seed failed:", err);
}
const wss = await createServer();

// Start Slack bot if configured
if (process.env.SLACK_BOT_TOKEN) {
  startSlackBot().catch((err) => console.error("[slack] Failed to start:", err));
}

function gracefulShutdown(): void {
  console.log("\nShutting down Genie manager...");
  stopSlackBot().catch(() => {});
  stopWireproxy();
  shutdown(wss);
  void Promise.allSettled([stopVpsMetricFlusher(), stopSshEventFlusher()]).finally(() => process.exit(0));
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
