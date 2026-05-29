// Mirrors packages/manager/src/claude-session-id.ts — must produce identical
// output for the same inputs. UUIDv5 = SHA-1(namespace || name), then v5 and
// RFC-4122-variant bits set. Computed via SubtleCrypto so we don't add a
// renderer dep; async, which is fine since this is only called at popup-open
// time.

const GENIE_CLAUDE_NS = "8a6f1e4e-6c2d-4d4e-8a23-c1a8de0000ff";

export async function claudeSessionId(ownerId: string, projectId: string, instanceId: string): Promise<string> {
  return uuidv5(`claude|${ownerId}|${projectId}|${instanceId}`, GENIE_CLAUDE_NS);
}

async function uuidv5(name: string, namespace: string): Promise<string> {
  const ns = parseUuid(namespace);
  const nm = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nm.length);
  input.set(ns, 0);
  input.set(nm, ns.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const out = digest.slice(0, 16);
  out[6] = (out[6] & 0x0f) | 0x50; // version 5
  out[8] = (out[8] & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(out);
}

function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
