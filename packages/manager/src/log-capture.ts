const MAX_BUFFER = 100_000;

/** Log streams surfaced to the /logs panel. "manager" is the stdout feed
 *  (admin-visible); "errors" is the stderr feed (superadmin-only via ws-acl)
 *  — stack traces, SSH failures, ACL warnings, and unhandled rejections land
 *  here so they don't leak to the admin-tier "manager" stream. */
export type LogSource = "manager" | "errors";

let buffer = ""; // manager: stdout only — admin-visible
let errBuffer = ""; // errors: stderr only — superadmin-only via ws-acl
let callback: ((source: LogSource, data: string) => void) | null = null;
let origStdoutWrite: typeof process.stdout.write | null = null;
let origStderrWrite: typeof process.stderr.write | null = null;

export function startLogCapture(onData: (source: LogSource, data: string) => void): void {
  // Idempotent: a second call (tests, hot-reload) just rebinds the broadcast
  // callback. Without this guard the second call would bind origStdoutWrite to
  // our OWN wrapper, and the next write would recurse through the chain.
  if (origStdoutWrite) {
    callback = onData;
    return;
  }
  callback = onData;

  origStdoutWrite = process.stdout.write.bind(process.stdout);
  origStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = function (chunk: string | Uint8Array, ...args: unknown[]): boolean {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    appendManager(str);
    return (origStdoutWrite as Function).call(process.stdout, chunk, ...args);
  } as typeof process.stdout.write;

  // stderr feeds ONLY the dedicated errors stream — keeping it out of the
  // admin-visible "manager" buffer is what makes the superadmin-only ACL on
  // logs:errors:* meaningful. console.error / console.warn, ssh failures,
  // ACL warnings, and the stack trace Node prints for an uncaught exception
  // all land on stderr, so this captures "all server errors" without a hook
  // at every call site.
  process.stderr.write = function (chunk: string | Uint8Array, ...args: unknown[]): boolean {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    appendErrors(str);
    return (origStderrWrite as Function).call(process.stderr, chunk, ...args);
  } as typeof process.stderr.write;

  // Unhandled promise rejections don't reliably print to stderr on their own
  // (Node may only warn). Route them through console.error so they land in the
  // errors stream with a clear tag. Uncaught exceptions already print their
  // stack to stderr before the process exits, so they're captured above.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason instanceof Error ? (reason.stack || reason.message) : reason);
  });
}

function appendManager(data: string): void {
  buffer += data;
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(-MAX_BUFFER);
  }
  callback?.("manager", data);
}

function appendErrors(data: string): void {
  errBuffer += data;
  if (errBuffer.length > MAX_BUFFER) {
    errBuffer = errBuffer.slice(-MAX_BUFFER);
  }
  callback?.("errors", data);
}

export function getLogBuffer(): string {
  return buffer;
}

export function getErrorBuffer(): string {
  return errBuffer;
}

export function clearLogBuffer(): void {
  buffer = "";
}

export function clearErrorBuffer(): void {
  errBuffer = "";
}
