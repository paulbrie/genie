import "dotenv/config";
import { seedClaude } from "./db/seed.js";
import { createServer, shutdown } from "./ws-server.js";
import { startSlackBot, stopSlackBot } from "./slack-bot.js";

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
