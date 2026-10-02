import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_FILE_SIZE = 1_024_000; // 1MB

export async function readFile(filePath: string, projectDir: string): Promise<string> {
  const resolved = path.resolve(projectDir, filePath);
  if (!resolved.startsWith(projectDir)) {
    return "Error: Path escapes project directory";
  }

  try {
    const fh = await fs.open(resolved, "r");
    try {
      const stat = await fh.stat();
      if (stat.size > MAX_FILE_SIZE) {
        return `Error: File too large (${stat.size} bytes, max ${MAX_FILE_SIZE})`;
      }
      const content = await fh.readFile("utf-8");
      return content;
    } finally {
      await fh.close();
    }
  } catch (err: any) {
    if (err.code === "ENOENT") return `Error: File not found: ${filePath}`;
    return `Error: ${err.message}`;
  }
}

export async function writeFile(
  filePath: string,
  content: string,
  projectDir: string,
): Promise<string> {
  const resolved = path.resolve(projectDir, filePath);
  if (!resolved.startsWith(projectDir)) {
    return "Error: Path escapes project directory";
  }

  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    return `Successfully wrote ${filePath} (${content.length} chars)`;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

export async function listFiles(
  dir: string,
  projectDir: string,
  globPattern?: string,
): Promise<string> {
  const resolved = path.resolve(projectDir, dir || ".");
  if (!resolved.startsWith(projectDir)) {
    return "Error: Path escapes project directory";
  }

  try {
    const results: string[] = [];
    const filter = globPattern ? globToRegex(globPattern) : null;
    await walkDir(resolved, projectDir, results, 0, 5, filter);

    if (results.length === 0) {
      return globPattern
        ? `No files matching "${globPattern}"`
        : "Empty directory";
    }
    return results.join("\n");
  } catch (err: any) {
    if (err.code === "ENOENT") return `Error: Directory not found: ${dir || "."}`;
    return `Error: ${err.message}`;
  }
}

async function walkDir(
  dir: string,
  projectDir: string,
  results: string[],
  depth: number,
  maxDepth: number,
  filter: RegExp | null,
): Promise<void> {
  if (depth > maxDepth || results.length > 500) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip common noise directories
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(projectDir, fullPath);

    if (entry.isDirectory()) {
      if (!filter) results.push(relPath + "/");
      await walkDir(fullPath, projectDir, results, depth + 1, maxDepth, filter);
    } else {
      if (!filter || filter.test(relPath)) {
        results.push(relPath);
      }
    }
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export async function searchFiles(
  pattern: string,
  projectDir: string,
  fileFilter?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const args = ["-rn", "--color=never", "-m", "50"];

    if (fileFilter) {
      args.push("--include", fileFilter);
    }

    // Skip common noise directories
    args.push(
      "--exclude-dir=node_modules",
      "--exclude-dir=.git",
      "--exclude-dir=.next",
      "--exclude-dir=__pycache__",
      "--exclude-dir=.venv",
    );

    args.push(pattern, ".");

    const proc = spawn("grep", args, {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, 30_000);

    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", () => {
      clearTimeout(timer);
      resolve(output.trim() || "No matches found");
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Error: ${err.message}`);
    });
  });
}
