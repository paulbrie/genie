import { tool } from "ai";
import { z } from "zod";
import { executeShellExec } from "./shell-exec.js";
import { readFile, writeFile, listFiles, searchFiles } from "./file-ops.js";

export function createTools(projectDir: string) {
  return {
    shell_exec: tool({
      description:
        "Run a shell command on this server. Use this for installing packages, restarting services, checking logs, running tests, etc. The command runs in bash. For long-running tasks (>10 min), use nohup or screen/tmux.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute"),
        timeoutSeconds: z
          .number()
          .optional()
          .describe("Command timeout in seconds (default 120, max 600)"),
      }),
      execute: async ({ command, timeoutSeconds }) => {
        const timeoutMs = timeoutSeconds ? timeoutSeconds * 1000 : undefined;
        return executeShellExec(command, projectDir, timeoutMs);
      },
    }),

    read_file: tool({
      description:
        "Read a file from the project directory. Returns the file contents. Use this to inspect source code, configs, logs, etc.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the project directory"),
      }),
      execute: async ({ path }) => readFile(path, projectDir),
    }),

    write_file: tool({
      description:
        "Create or overwrite a file in the project directory. Always read the file first to avoid losing content. Creates parent directories automatically.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the project directory"),
        content: z.string().describe("The full file content to write"),
      }),
      execute: async ({ path, content }) => writeFile(path, content, projectDir),
    }),

    list_files: tool({
      description:
        "List files in the project directory tree. Skips node_modules, .git, .next. Max depth 5, max 500 entries.",
      inputSchema: z.object({
        directory: z
          .string()
          .optional()
          .describe("Subdirectory to list (default: project root)"),
        pattern: z
          .string()
          .optional()
          .describe('Glob filter pattern (e.g. "*.ts", "**/*.json")'),
      }),
      execute: async ({ directory, pattern }) =>
        listFiles(directory || ".", projectDir, pattern),
    }),

    search_files: tool({
      description:
        "Search for a pattern in project files using grep. Returns matching lines with file paths and line numbers. Max 50 matches.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern (regex supported)"),
        fileFilter: z
          .string()
          .optional()
          .describe('File glob filter (e.g. "*.ts", "*.py")'),
      }),
      execute: async ({ pattern, fileFilter }) =>
        searchFiles(pattern, projectDir, fileFilter),
    }),
  };
}
