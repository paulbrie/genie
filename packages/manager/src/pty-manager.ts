import * as pty from "node-pty";

interface PtySession {
  proc: pty.IPty;
  id: string;
}

const sessions = new Map<string, PtySession>();
let eventCallback: ((event: { type: string; payload: any }) => void) | null = null;

export function setPtyEventCallback(cb: (event: { type: string; payload: any }) => void): void {
  eventCallback = cb;
}

export function spawnPty(id: string, cols: number, rows: number): void {
  if (sessions.has(id)) return;

  const shell = process.env.SHELL || "/bin/zsh";
  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || "/",
    env: process.env as Record<string, string>,
  });

  const session: PtySession = { proc, id };
  sessions.set(id, session);

  proc.onData((data: string) => {
    eventCallback?.({ type: "terminal:data", payload: { id, data } });
  });

  proc.onExit(({ exitCode }: { exitCode: number }) => {
    sessions.delete(id);
    eventCallback?.({ type: "terminal:exit", payload: { id, code: exitCode } });
  });
}

export function writePty(id: string, data: string): void {
  sessions.get(id)?.proc.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session) {
    try {
      session.proc.resize(cols, rows);
    } catch {
      // ignore resize errors on exited pty
    }
  }
}

export function closePty(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.proc.kill();
    sessions.delete(id);
  }
}

export function closeAllPtys(): void {
  for (const [id, session] of sessions) {
    session.proc.kill();
    sessions.delete(id);
  }
}
