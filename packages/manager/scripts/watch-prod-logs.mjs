// READ-ONLY live tail of the prod manager's in-memory log buffer.
// Polls /api/debug/server-logs every 3s, dedupes, prints NEW lines.
// Usage: node scripts/watch-prod-logs.mjs [seconds=150]
const BASE = "https://api.genie.teleporthq.ai";
const KEY = "genie is the best";
const windowSec = Number(process.argv[2] || 150);

const seen = new Set();
const HOT = /ssh-event|keepalive|handshake|wireproxy|GENIE_TAZ_SOCKS|SOCKS|10\.128\.|Connection lost|stream-end|stream error|Keepalive|reconnect|tunnel/i;

async function poll() {
  try {
    const res = await fetch(`${BASE}/api/debug/server-logs?source=all&tail=100000`, {
      headers: { "X-Genie-Debug-Key": KEY },
    });
    if (!res.ok) { console.log(`  [poll] HTTP ${res.status}`); return; }
    const j = await res.json();
    const lines = ((j.manager?.data || "") + "\n" + (j.errors?.data || "")).split("\n");
    for (const l of lines) {
      const t = l.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      // Only print lines we haven't seen; star the hot ones.
      const hot = HOT.test(t);
      console.log(`${hot ? "★" : " "} ${t}`);
    }
  } catch (e) {
    console.log(`  [poll] error: ${e.message}`);
  }
}

const start = Date.now();
console.log(`Watching ${BASE} for ${windowSec}s — reproduce the drop now. (★ = ssh/tunnel-relevant)\n`);
// Prime: mark everything currently in the buffer as seen-but-printed once so we
// have a baseline, then only new lines show.
await poll();
console.log("\n--- baseline captured; now watching for NEW lines ---\n");
const timer = setInterval(async () => {
  await poll();
  if (Date.now() - start > windowSec * 1000) {
    clearInterval(timer);
    console.log(`\n--- done (${windowSec}s elapsed) ---`);
  }
}, 3000);
