import "dotenv/config";
import { createServer, shutdown } from "./ws-server.js";
const wss = createServer();
function gracefulShutdown() {
    console.log("\nShutting down Genie manager...");
    shutdown(wss);
    process.exit(0);
}
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
//# sourceMappingURL=index.js.map