// Dump the DB `knowledge_docs` table (the live "Concepts" source of truth) back
// to the repo `knowledge/` folder so the version-controlled bundle mirrors what
// editors changed in the UI. Run via `npm run knowledge:export`. Requires the
// manager's DB to be reachable (same env as the manager).

import "../load-env.js";
import { exportKnowledgeToDisk } from "../knowledge-service.js";

try {
  const { written, dir } = await exportKnowledgeToDisk();
  console.log(`[knowledge] Exported ${written} doc(s) to ${dir}`);
  process.exit(0);
} catch (err) {
  console.error("[knowledge] Export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
