// Push the repo `knowledge/` folder into the DB `knowledge_docs` table (upsert
// by path) — the file → DB authoring path. Edit the markdown, then run
// `npm run knowledge:import`. Requires the manager's DB to be reachable.

import "../load-env.js";
import { importKnowledgeFromDisk } from "../knowledge-service.js";

try {
  const { upserted, dir } = await importKnowledgeFromDisk();
  console.log(`[knowledge] Imported ${upserted} doc(s) from ${dir} into the DB`);
  process.exit(0);
} catch (err) {
  console.error("[knowledge] Import failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
