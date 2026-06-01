// READ-ONLY: freshness + raw ssh_events dump to disambiguate "recorder stopped"
// vs "manager not writing here" vs "pty path never fires".
import { readFileSync } from "node:fs";
import postgres from "postgres";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.split("\n").find((l) => l.startsWith("DB=")) || "").slice(3).replace(/^["']|["']$/g, "");
const certLine = env.split("\n").find((l) => l.startsWith("DB_CERT="));
const ssl = certLine ? { ca: certLine.slice(8).replace(/^["']|["']$/g, "") } : undefined;
const sql = postgres(url, { ssl, max: 1, idle_timeout: 5 });

const ago = (d) => d ? `${Math.round((Date.now() - new Date(d).getTime()) / 1000)}s ago` : "—";

try {
  const now = (await sql`SELECT now() AS n`)[0].n;
  console.log(`DB now (UTC): ${now.toISOString()}\n`);

  console.log("== Freshness (is the manager writing to THIS db right now?) ==");
  for (const [t, col] of [
    ["vps_metric_samples", "sampled_at"],
    ["audit_log", "created_at"],
    ["pty_sessions", "last_activity"],
    ["ssh_events", "occurred_at"],
  ]) {
    const r = await sql.unsafe(`SELECT count(*)::int n, max(${col}) last FROM ${t}`);
    console.log(`  ${t.padEnd(20)} rows=${String(r[0].n).padStart(7)}  newest=${r[0].last ? new Date(r[0].last).toISOString() : "—"}  (${ago(r[0].last)})`);
  }

  console.log("\n== ALL ssh_events (every row, newest first) ==");
  const rows = await sql`SELECT occurred_at, host, kind, event, cause, lifetime_ms, last_data_age_ms FROM ssh_events ORDER BY occurred_at DESC`;
  for (const r of rows) {
    const sec = (ms) => ms == null ? "—" : `${Math.round(ms/1000)}s`;
    console.log(`  ${new Date(r.occurred_at).toISOString()}  ${r.kind.padEnd(9)} ${String(r.cause ?? r.event).padEnd(18)} idle=${sec(r.last_data_age_ms).padStart(5)}  ${r.host}`);
  }
  console.log(`\n  kinds present: ${[...new Set(rows.map(r => r.kind))].join(", ") || "(none)"}`);
} finally {
  await sql.end({ timeout: 5 });
}
