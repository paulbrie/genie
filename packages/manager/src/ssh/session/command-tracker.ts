// Detects "a command was sent" from raw terminal keystroke chunks. A command is
// credited on each Enter (CR/LF) that had non-empty input typed since the
// previous Enter — so bare Enters on an empty prompt don't inflate the numbers.
// State is per-terminal; callers MUST clearCommandTracking(terminalId) on close.

const inputDirty = new Map<string, boolean>();

/** Max commands credited from a single data chunk — guards against a pasted
 *  multi-line script flooding the analytics table with one row per line. */
const MAX_COMMANDS_PER_CHUNK = 25;

/** Count completed, non-empty command lines in one keystroke chunk and advance
 *  the per-terminal "did the user type anything since the last Enter" flag. */
export function countCommandsInChunk(terminalId: string, data: string): number {
  let dirty = inputDirty.get(terminalId) ?? false;
  let commands = 0;
  for (const ch of data) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 13 || code === 10) {
      // Enter (CR or LF). \r\n counts once: the CR fires, the following LF
      // sees a clean line.
      if (dirty) {
        commands++;
        dirty = false;
      }
    } else if (code >= 32 && code !== 127) {
      // A printable character means the current line is non-empty.
      dirty = true;
    }
  }
  inputDirty.set(terminalId, dirty);
  return Math.min(commands, MAX_COMMANDS_PER_CHUNK);
}

export function clearCommandTracking(terminalId: string): void {
  inputDirty.delete(terminalId);
}
