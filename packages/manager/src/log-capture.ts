const MAX_BUFFER = 100_000;

let buffer = "";
let callback: ((data: string) => void) | null = null;
let origStdoutWrite: typeof process.stdout.write | null = null;
let origStderrWrite: typeof process.stderr.write | null = null;

export function startLogCapture(onData: (data: string) => void): void {
  callback = onData;

  origStdoutWrite = process.stdout.write.bind(process.stdout);
  origStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = function (chunk: any, ...args: any[]): boolean {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    appendBuffer(str);
    return origStdoutWrite!(chunk, ...args);
  } as typeof process.stdout.write;

  process.stderr.write = function (chunk: any, ...args: any[]): boolean {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    appendBuffer(str);
    return origStderrWrite!(chunk, ...args);
  } as typeof process.stderr.write;
}

function appendBuffer(data: string): void {
  buffer += data;
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(-MAX_BUFFER);
  }
  callback?.(data);
}

export function getLogBuffer(): string {
  return buffer;
}

export function clearLogBuffer(): void {
  buffer = "";
}
