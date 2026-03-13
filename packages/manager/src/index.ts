import "dotenv/config";
import { seedClaude } from "./db/seed.js";
import { createServer, shutdown } from "./ws-server.js";

// Seed the Claude agent user, then start the WS server
await seedClaude();
const wss = await createServer();

function gracefulShutdown(): void {
  console.log("\nShutting down Genie manager...");
  shutdown(wss);
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
