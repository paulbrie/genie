import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 30_000;
const HEAD_BYTES = 8_000;
const TAIL_BYTES = 22_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_BYTES) return output;
  const head = output.slice(0, HEAD_BYTES);
  const tail = output.slice(-TAIL_BYTES);
  return `${head}\n\n[...truncated ${output.length - HEAD_BYTES - TAIL_BYTES} characters...]\n\n${tail}`;
}

export async function executeShellExec(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<string> {
  const timeout = Math.min(Math.max(timeoutMs ?? DEFAULT_TIMEOUT_MS, 5_000), MAX_TIMEOUT_MS);

  return new Promise((resolve) => {
    let output = "";
    let killed = false;

    const proc = spawn("bash", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeout);

    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve(
          truncateOutput(output) +
            `\n\n[Command timed out after ${Math.round(timeout / 1000)}s — output above is partial]`,
        );
      } else if (code !== 0) {
        resolve(
          truncateOutput(output) +
            (output ? `\n\n[Exit code: ${code}]` : `Error: Command exited with code ${code}`),
        );
      } else {
        resolve(truncateOutput(output) || "(no output)");
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Error: ${err.message}`);
    });
  });
}
