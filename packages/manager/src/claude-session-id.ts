import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for Genie-derived Claude session ids. Changing this
// orphans every existing dtach socket, so don't.
const GENIE_CLAUDE_NS = "8a6f1e4e-6c2d-4d4e-8a23-c1a8de0000ff";

/**
 * Deterministic session id for "the Claude popup for project X under VM Y owned
 * by user Z". Used as both the PTY session key AND the dtach socket name on the
 * VM, so reopening the popup with the same triple lands on the same live
 * process. Mirrored in packages/renderer/src/lib/claude-session-id.ts — keep
 * the namespace and the input format byte-for-byte identical.
 */
export function claudeSessionId(ownerId: string, projectId: string, instanceId: string): string {
  return uuidv5(`claude|${ownerId}|${projectId}|${instanceId}`, GENIE_CLAUDE_NS);
}
