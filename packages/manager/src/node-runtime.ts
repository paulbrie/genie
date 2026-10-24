// The Node.js runtime Genie installs on the VMs it manages, and the patched
// floor every supported release line must be at. One place to bump on the next
// Node.js security release: the recipes, the VPS/TazCloud bootstraps, the DO
// base image and the sandbox image all read from here.

/** NodeSource major installed on VMs (Active LTS). */
export const VM_NODE_MAJOR = 24;

/**
 * First patched release per supported line, from the Node.js October 2026
 * security releases (CVE-2026-111497 Brotli RCE, TLS hostname bypasses, …):
 * https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
 * Lines not listed here (20.x, odd majors) are EOL and never patched.
 */
export const NODE_PATCHED_FLOOR: Record<number, string> = {
  22: "22.23.4",
  24: "24.22.1",
  26: "26.12.1",
};

const NEWEST_PATCHED_LINE = Math.max(...Object.keys(NODE_PATCHED_FLOOR).map(Number));

export const NODESOURCE_DEB_SETUP_URL = `https://deb.nodesource.com/setup_${VM_NODE_MAJOR}.x`;
export const NODESOURCE_RPM_SETUP_URL = `https://rpm.nodesource.com/setup_${VM_NODE_MAJOR}.x`;

/** Docker image for the project-docker agent sandbox. */
export const SANDBOX_NODE_IMAGE = `node:${VM_NODE_MAJOR}-slim`;

/**
 * Bash: `node_is_patched` succeeds when node and npm are on PATH and node is at
 * or above its line's patched floor. Lines released after the advisory (a
 * major newer than the newest listed) already carry the fixes.
 */
export const NODE_BASH_HELPERS = [
  "node_is_patched() {",
  "  command -v node > /dev/null 2>&1 && command -v npm > /dev/null 2>&1 || return 1",
  "  local v floor",
  "  v=$(node --version 2>/dev/null | sed 's/^v//')",
  '  case "${v%%.*}" in',
  ...Object.entries(NODE_PATCHED_FLOOR).map(([major, floor]) => `    ${major}) floor=${floor} ;;`),
  `    *) [ "\${v%%.*}" -gt ${NEWEST_PATCHED_LINE} ] 2>/dev/null; return ;;`,
  "  esac",
  `  [ "$(printf '%s\\n%s\\n' "$floor" "$v" | sort -V | head -n1)" = "$floor" ]`,
  "}",
].join("\n");

/** Same check as `node_is_patched`, for the manager's own process. */
export function isNodePatched(version: string = process.versions.node): boolean {
  const [major, minor, patch] = version.replace(/^v/, "").split(".").map(Number);
  const floor = NODE_PATCHED_FLOOR[major];
  if (!floor) return major > NEWEST_PATCHED_LINE;
  const [, fMinor, fPatch] = floor.split(".").map(Number);
  return minor > fMinor || (minor === fMinor && patch >= fPatch);
}
