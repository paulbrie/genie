// Lightweight, opt-in SSH breadcrumb trace.
//
// Previously this POSTed every call to http://127.0.0.1:7268/... — an agent
// debugging harness (session 114075) that does not exist in prod, so every call
// was a silent no-op that made it *look* like prod had SSH logging when it had
// none. It now emits a structured console line, gated by GENIE_SSH_DEBUG so it's
// quiet by default and can be flipped on in prod (Railway env var) to get
// verbose connection-lifecycle breadcrumbs while investigating.
//
// Durable, always-on attribution of *disconnects* lives in vps/ssh-events.ts
// (recordSshEvent → ring buffer + Postgres + one console line). This file is for
// high-frequency breadcrumbs (connectSsh called, registered/unregistered) that
// would be too noisy to keep on or persist.

const ENABLED = process.env.GENIE_SSH_DEBUG === "1" || process.env.GENIE_SSH_DEBUG === "true";

export function dbgSsh(
  location: string,
  message: string,
  hypothesisId: string,
  data: Record<string, unknown> = {},
): void {
  if (!ENABLED) return;
  try {
    console.log(`[ssh-trace] ${location} | ${message} | ${hypothesisId} | ${JSON.stringify(data)}`);
  } catch {
    // JSON.stringify can throw on circular data — never let a trace break a dial.
    console.log(`[ssh-trace] ${location} | ${message} | ${hypothesisId}`);
  }
}
