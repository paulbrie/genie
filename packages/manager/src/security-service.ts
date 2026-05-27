// Thin barrel — the real implementation lives in `./security/`. Kept so the
// existing call sites (`./security-service.js` imports in ws-server.ts and
// vps/mcp-security-server.ts) keep working without touching them.

export type { ScanStatus, Severity, PortResult, WebFinding, SecurityScan, ScanCallbacks } from "./security/types.js";
export { runSecurityScan } from "./security/core.js";
export { saveScan, listScans, deleteScan } from "./security/db.js";
