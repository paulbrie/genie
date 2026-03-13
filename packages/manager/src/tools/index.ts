import { tool } from "ai";
import { z } from "zod";
import { executeWebSearch } from "./web-search.js";
import { executeBrowseUrl } from "./web-browse.js";
import { executeSshExec } from "./ssh-exec.js";
import * as projectService from "../project-service.js";
import * as docsService from "../docs-service.js";

export const tools = {
  web_search: tool({
    description:
      "Search the web for current information. Use this when the user asks about recent events, latest versions, current status of services, or anything that requires up-to-date information beyond your training data.",
    inputSchema: z.object({
      query: z.string().describe("The search query to look up on the web"),
    }),
    execute: async ({ query }) => executeWebSearch(query),
  }),
  browse_url: tool({
    description:
      "Open a specific URL and retrieve its content. Use this when the user provides a URL to read, summarize, or extract information from a specific web page.",
    inputSchema: z.object({
      url: z.string().describe("The URL to open and read"),
    }),
    execute: async ({ url }) => executeBrowseUrl(url),
  }),
  read_project_file: tool({
    description:
      "Read a project config/setup file (Dockerfile, docker-compose.yml, .env, etc.). Returns the file content. Use this when the user asks to review, explain, or debug a project file.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
      fileName: z.string().describe("The file name to read (e.g. 'Dockerfile', 'docker-compose.yml', '.env')"),
    }),
    execute: async ({ projectId, fileName }) => {
      const project = await projectService.getById(projectId);
      if (!project) return `Error: Project not found (id: ${projectId})`;
      const files = project.setupFiles || {};
      if (!(fileName in files)) {
        const available = Object.keys(files);
        return available.length > 0
          ? `File "${fileName}" not found. Available files: ${available.join(", ")}`
          : `No setup files exist for this project yet.`;
      }
      return files[fileName] || "(empty file)";
    },
  }),
  write_project_file: tool({
    description:
      "Create or update a project config/setup file (Dockerfile, docker-compose.yml, .env, etc.). Use this when the user asks you to create, modify, or fix a project file. Always read the file first before writing to avoid losing content.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
      fileName: z.string().describe("The file name to write (e.g. 'Dockerfile', 'docker-compose.yml', '.env')"),
      content: z.string().describe("The full file content to write"),
    }),
    execute: async ({ projectId, fileName, content }) => {
      const project = await projectService.getById(projectId);
      if (!project) return `Error: Project not found (id: ${projectId})`;
      const setupFiles = { ...(project.setupFiles || {}), [fileName]: content };
      await projectService.patchProject(projectId, { setupFiles });
      return `Successfully wrote "${fileName}" (${content.length} chars)`;
    },
  }),
  list_project_files: tool({
    description:
      "List all config/setup files in a project. Use this to discover which files exist before reading or writing.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
    }),
    execute: async ({ projectId }) => {
      const project = await projectService.getById(projectId);
      if (!project) return `Error: Project not found (id: ${projectId})`;
      const files = Object.keys(project.setupFiles || {});
      return files.length > 0
        ? `Files: ${files.join(", ")}`
        : "No setup files exist for this project yet.";
    },
  }),
  ssh_exec: tool({
    description:
      "Run a shell command on a remote VPS instance via SSH. Use this when the user asks to execute commands, check logs, manage services, or do anything on their remote server. The command runs in a non-interactive shell. For long-running tasks (>10 min), suggest using nohup or screen/tmux.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
      instance: z.string().describe("The VPS instance label or ID. If the project has only one instance, any value works."),
      command: z.string().describe("The shell command to execute on the remote server"),
      timeoutSeconds: z.number().optional().describe("Command timeout in seconds (default 120, max 600)"),
    }),
    execute: async ({ projectId, instance, command, timeoutSeconds }) => {
      const timeout = Math.min(Math.max((timeoutSeconds ?? 120), 5), 600) * 1000;
      return executeSshExec(projectId, instance, command, timeout);
    },
  }),
  list_project_docs: tool({
    description:
      "List all documentation pages associated with a project. Returns doc titles and IDs. Use this to discover available project documentation before reading specific docs.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
    }),
    execute: async ({ projectId }) => {
      const docs = await docsService.listDocsByProject(projectId);
      if (docs.length === 0) return "No documentation found for this project.";
      return docs
        .map((d) => `- ${d.title} (id: ${d.id}, by ${d.ownerName}, updated ${d.updatedAt.toISOString()})`)
        .join("\n");
    },
  }),
  save_agent_memory: tool({
    description:
      "Save important discoveries about the project's codebase to persistent memory (AGENT.md). Use this after exploring the codebase to record: tech stack, key file paths, architecture patterns, deployment details. This memory persists across sessions so you don't need to rediscover things. Always read AGENT.md first (via read_project_file) before writing to preserve existing content.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
      content: z.string().describe("The full updated AGENT.md content (markdown). Include all existing sections plus your new findings."),
    }),
    execute: async ({ projectId, content }) => {
      const project = await projectService.getById(projectId);
      if (!project) return `Error: Project not found (id: ${projectId})`;
      const setupFiles = { ...(project.setupFiles || {}), "AGENT.md": content };
      await projectService.patchProject(projectId, { setupFiles });
      return `Agent memory saved (${content.length} chars)`;
    },
  }),
  read_project_doc: tool({
    description:
      "Read a project documentation page by its ID. Returns the full markdown content. Use list_project_docs first to find available docs and their IDs.",
    inputSchema: z.object({
      docId: z.string().describe("The doc ID to read (from list_project_docs)"),
    }),
    execute: async ({ docId }) => {
      const doc = await docsService.getDocById(docId);
      if (!doc) return `Error: Doc not found (id: ${docId})`;
      return `# ${doc.title}\n\n${doc.content}`;
    },
  }),
};
