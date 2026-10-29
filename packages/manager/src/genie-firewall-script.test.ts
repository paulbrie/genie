// The genie egress firewall script (GENIE_FIREWALL_SETUP_SCRIPT's genie-firewall), run for real by bash against stub
// iptables / ipset / getent / curl / id / flock that record what they're asked, plus the allowlist entry check.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GENIE_FIREWALL_SETUP_SCRIPT } from "./default-recipes.js";
import { validEntry } from "./handlers/firewall-handler.js";

const MARK = "<< 'GENIE_FW_SCRIPT'\n";
const start = GENIE_FIREWALL_SETUP_SCRIPT.indexOf(MARK) + MARK.length;
const SCRIPT = GENIE_FIREWALL_SETUP_SCRIPT.slice(start, GENIE_FIREWALL_SETUP_SCRIPT.indexOf("\nGENIE_FW_SCRIPT", start)) + "\n";

// ipset kept in files: <dir>/sets/<name> holds its members, <name>.type its type.
const STUBS: Record<string, string> = {
  id: `echo 1001`,
  flock: `exit 0`,
  iptables: `echo "iptables $*" >> "$STUB_LOG"; [ "$1" = "-C" ] && exit 1; exit 0`,
  ip6tables: `echo "ip6tables $*" >> "$STUB_LOG"; [ "$1" = "-C" ] && exit 1; exit 0`,
  ipset: String.raw`echo "ipset $*" >> "$STUB_LOG"
d="$STUB_DIR/sets"; mkdir -p "$d"
case "$1" in
  create) [ -f "$d/$2" ] || { : > "$d/$2"; echo "$3" > "$d/$2.type"; } ;;
  add) grep -qxF "$3" "$d/$2" 2>/dev/null || echo "$3" >> "$d/$2" ;;
  flush) : > "$d/$2" ;;
  list) [ -f "$d/$2" ] || exit 1; echo "Name: $2"; echo "Type: $(cat "$d/$2.type")"; echo "Members:"; cat "$d/$2" ;;
  swap) mv "$d/$2" "$d/tmp"; mv "$d/$3" "$d/$2"; mv "$d/tmp" "$d/$3"; mv "$d/$2.type" "$d/tmpt"; mv "$d/$3.type" "$d/$2.type"; mv "$d/tmpt" "$d/$3.type" ;;
  destroy) [ -f "$d/$2" ] || exit 1; rm -f "$d/$2" "$d/$2.type" ;;
esac`,
  // a name answers ONE address per lookup, rotating through its list (as GitHub does)
  getent: String.raw`host="$2"; f="$STUB_DIR/dns/$host"; [ -f "$f" ] || exit 2
n=$(cat "$f.n" 2>/dev/null || echo 0); total=$(wc -l < "$f"); i=$(( n % total + 1 ))
echo $(( n + 1 )) > "$f.n"; ip=$(sed -n "$i p" "$f"); echo "$ip STREAM $host"`,
  curl: String.raw`echo "curl $*" >> "$STUB_LOG"
[ -f "$STUB_DIR/meta.json" ] || exit 7
out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out="$2"; shift; }; shift; done
cp "$STUB_DIR/meta.json" "$out"`,
};

let dir: string;
const write = (rel: string, body: string) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
const run = (arg = "apply") =>
  execFileSync("bash", [path.join(dir, "genie-firewall"), arg], {
    encoding: "utf8",
    env: {
      PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`,
      STUB_DIR: dir,
      STUB_LOG: path.join(dir, "log"),
      GENIE_FW_ALLOW_FILE: path.join(dir, "allow.txt"),
      GENIE_FW_CACHE_DIR: path.join(dir, "cache"),
      GENIE_FW_LOCK_FILE: path.join(dir, "lock"),
    },
  });
const members = (set = "genie-egress-net") => fs.readFileSync(path.join(dir, "sets", set), "utf8").split("\n").filter(Boolean).sort();
const log = () => fs.readFileSync(path.join(dir, "log"), "utf8");

const META = { web: ["140.82.112.0/20", "2a0a:a440::/29"], api: ["140.82.112.0/20", "143.55.64.0/20"], git: ["192.30.252.0/22"], actions: ["4.0.0.0/8"] };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "genie-fw-"));
  write("genie-firewall", SCRIPT);
  for (const [name, body] of Object.entries(STUBS)) fs.chmodSync(write(`bin/${name}`, `#!/bin/bash\n${body}\n`), 0o755);
  write("dns/github.com", "140.82.121.3\n140.82.121.4\n");
  write("dns/registry.npmjs.org", "104.16.1.34\n104.16.2.34\n104.16.3.34\n");
  write("meta.json", JSON.stringify(META));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("genie-firewall apply", () => {
  it("adds addresses and ranges as written, and every address a few rotating lookups return", () => {
    write("allow.txt", "# comment\nregistry.npmjs.org\n203.0.113.7  # a box\n198.51.100.0/24\n");
    const out = run();
    expect(members()).toEqual(["104.16.1.34", "104.16.2.34", "104.16.3.34", "198.51.100.0/24", "203.0.113.7"]);
    expect(fs.readFileSync(path.join(dir, "sets", "genie-egress-net.type"), "utf8").trim()).toBe("hash:net");
    expect(log()).not.toContain("curl"); // no GitHub host listed: nothing fetched
    expect(out).toContain("on (5 allowed IPs and ranges)");
  });

  it("a GitHub host brings GitHub's published web/api/git IPv4 ranges (not the rest, not IPv6)", () => {
    write("allow.txt", "github.com\n");
    run();
    expect(members()).toEqual(["140.82.112.0/20", "140.82.121.3", "140.82.121.4", "143.55.64.0/20", "192.30.252.0/22"]);
    expect(log()).toContain("https://api.github.com/meta");
  });

  it("keeps the last GitHub ranges when the fetch fails", () => {
    write("allow.txt", "api.github.com  # api\n");
    write("dns/api.github.com", "140.82.121.6\n");
    run();
    fs.rmSync(path.join(dir, "meta.json")); // GitHub unreachable from now on
    run();
    expect(members()).toEqual(["140.82.112.0/20", "140.82.121.6", "143.55.64.0/20", "192.30.252.0/22"]);
  });

  it("replaces the older hash:ip set, and points the chain at the new one", () => {
    write("allow.txt", "203.0.113.7\n");
    fs.mkdirSync(path.join(dir, "sets"));
    write("sets/genie-egress", "198.51.100.1\n");
    write("sets/genie-egress.type", "hash:ip\n");
    run();
    expect(fs.existsSync(path.join(dir, "sets", "genie-egress"))).toBe(false);
    expect(log()).toContain("iptables -A GENIE_EGRESS -m set --match-set genie-egress-net dst -j RETURN");
    expect(log()).toContain("iptables -A GENIE_EGRESS -j REJECT");
  });

  it("keeps the previous set when nothing resolves (DNS not up)", () => {
    write("allow.txt", "203.0.113.7\n");
    run();
    write("allow.txt", "nowhere.invalid\n");
    const out = run();
    expect(out).toContain("keeping previous set");
    expect(members()).toEqual(["203.0.113.7"]);
  });
});

describe("validEntry", () => {
  it("domains, addresses, and ranges no wider than /16", () => {
    for (const ok of ["github.com", "203.0.113.7", "140.82.112.0/20", "10.1.0.0/16", "1.2.3.4/32"]) expect(validEntry(ok), ok).toBe(true);
    for (const bad of ["4.0.0.0/8", "1.2.3.4/15", "1.2.3.4/33", "300.1.1.1", "1.2.3.4/", "x", "1.2.3.4; rm -rf /"]) expect(validEntry(bad), bad).toBe(false);
  });
});
