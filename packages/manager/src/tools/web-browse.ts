import { execFile } from "node:child_process";

function execBrowser(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile("agent-browser", args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout || stderr || "");
      }
    });
  });
}

const MAX_OUTPUT = 30_000;

export async function executeBrowseUrl(url: string): Promise<string> {
  try {
    await execBrowser(["open", url], 15_000);
    const snapshot = await execBrowser(["snapshot"], 10_000);
    if (snapshot.length > MAX_OUTPUT) {
      return snapshot.slice(0, MAX_OUTPUT) + "\n\n[Output truncated]";
    }
    return snapshot || "(No content retrieved)";
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return "Error: agent-browser is not installed. Install it with: npm install -g agent-browser && agent-browser install";
    }
    return `Browse error: ${err.message || "Unknown error"}`;
  }
}
