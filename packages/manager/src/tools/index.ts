import { tool } from "ai";
import { z } from "zod";
import { executeWebSearch } from "./web-search.js";
import { executeBrowseUrl } from "./web-browse.js";
import { executeSshExec } from "./ssh-exec.js";
import {
  executeTazListVms,
  executeTazGetVm,
  executeTazCreateVm,
  executeTazDeleteVm,
  executeTazListSnapshots,
  executeTazGetSnapshot,
  executeTazCreateSnapshot,
  executeTazDeleteSnapshot,
  executeTazRegisterIngress,
  executeTazRemoveIngress,
  executeTazGetCapabilities,
} from "./tazcloud.js";
import * as projectService from "../project-service.js";
import * as docsService from "../docs-service.js";
import * as recipesService from "../recipes-service.js";
import * as trackerService from "../tracker-service.js";

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
      "Run a shell command on a remote VPS instance via SSH. Use this for quick " +
      "commands (status checks, logs, single-line operations). The tool aborts if " +
      "the command goes silent for 90s, and the chat panel can't show progress while " +
      "the command runs, so the user is left in the dark for long operations.\n\n" +
      "For RECIPE INSTALLS or anything that takes >30s, do NOT call this tool with " +
      "the full install script. Instead, tell the user to click the recipe's " +
      "Install button in the Add-ons panel — that path streams output live, " +
      "shows progress, and survives the chat being closed. Reserve ssh_exec for " +
      "diagnostics (`ps aux`, `journalctl`, `cat /var/log/...`).\n\n" +
      "For long-running tasks like apt installs, suggest nohup + tail -f or screen/tmux.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID (from context)"),
      instance: z.string().describe("The VPS instance label or ID. If the project has only one instance, any value works."),
      command: z.string().describe("The shell command to execute on the remote server"),
      timeoutSeconds: z.number().optional().describe("Command timeout in seconds (default 120, max 600). The tool also aborts on 90s of silent output."),
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
  tazcloud_list_vms: tool({
    description:
      "List all TazCloud VMs on the configured account. Read-only. Returns each VM's id, name, status, public IPv6, image, size, and — when a custom domain has been attached via ingress — the public domain and HTTPS URL.",
    inputSchema: z.object({}),
    execute: async () => executeTazListVms(),
  }),
  tazcloud_get_vm: tool({
    description:
      "Get full details for one TazCloud VM by id, including SSH endpoint and (if attached) the custom domain, public HTTPS URL, ingress status, and DNS action. Use this when you need to know the public domain associated with a VM.",
    inputSchema: z.object({
      vmId: z.string().describe("The TazCloud VM id (from tazcloud_list_vms)"),
    }),
    execute: async ({ vmId }) => executeTazGetVm(vmId),
  }),
  tazcloud_create_vm: tool({
    description:
      "Create a new TazCloud VM. DESTRUCTIVE: incurs cost on the TazCloud account. Confirm intent with the user before calling. The VM is bare — it does NOT include Docker/Node or a `genie` user; for a full Genie-managed VPS, use the project deploy flow instead. Pass `snapshot_id` to boot from an existing active snapshot instead of a base image (mutually exclusive with `image`).",
    inputSchema: z.object({
      name: z.string().describe("VM name (lowercase letters, digits, hyphens; ≤63 chars)"),
      image: z.string().optional().describe("Image slug. One of: ubuntu-22, ubuntu-24, debian-12, almalinux-9. Default: almalinux-9. Ignored if snapshot_id is provided."),
      size: z.string().optional().describe("Size slug. One of: small, medium, large, xlarge. Default: small. Must be ≥ the snapshot's recorded disk size when booting from a snapshot."),
      snapshot_id: z.string().optional().describe("Boot from this active snapshot id instead of a base image. Mutually exclusive with `image`."),
    }),
    execute: async ({ name, image, size, snapshot_id }) => executeTazCreateVm({ name, image, size, snapshot_id }),
  }),
  tazcloud_delete_vm: tool({
    description:
      "Delete a TazCloud VM by id. DESTRUCTIVE and irreversible — the VM and its data are gone. Also removes any registered ingress for that VM. Confirm intent with the user before calling. Use tazcloud_list_vms first to look up the id.",
    inputSchema: z.object({
      vmId: z.string().describe("The TazCloud VM id (from tazcloud_list_vms)"),
    }),
    execute: async ({ vmId }) => executeTazDeleteVm(vmId),
  }),
  tazcloud_get_capabilities: tool({
    description:
      "Get TazCloud deployment capabilities: available images, sizes, IPv6 prefix, and whether the ingress (HTTPS-via-domain) feature is available on this deployment.",
    inputSchema: z.object({}),
    execute: async () => executeTazGetCapabilities(),
  }),
  tazcloud_list_snapshots: tool({
    description:
      "List all TazCloud snapshots on the configured account. Snapshot lifecycle is `pending` → `active` | `error`; only `active` snapshots can be booted from.",
    inputSchema: z.object({}),
    execute: async () => executeTazListSnapshots(),
  }),
  tazcloud_get_snapshot: tool({
    description:
      "Get a single TazCloud snapshot by id. Use this to poll until `status` is `active` after calling tazcloud_create_snapshot (typically 1–5 min).",
    inputSchema: z.object({
      snapshotId: z.string().describe("The TazCloud snapshot id"),
    }),
    execute: async ({ snapshotId }) => executeTazGetSnapshot(snapshotId),
  }),
  tazcloud_create_snapshot: tool({
    description:
      "Snapshot a TazCloud VM's disk to create a reusable image. Returns immediately with `status=pending` — poll tazcloud_get_snapshot until `active`. DESTRUCTIVE-ish: incurs storage cost. Confirm intent with the user before calling. Set `stop_first` to true for a consistent-disk snapshot (VM restarts automatically after).",
    inputSchema: z.object({
      vmId: z.string().describe("The source TazCloud VM id"),
      name: z.string().describe("Snapshot name (lowercase letters, digits, hyphens; 3–63 chars)"),
      stop_first: z.boolean().optional().describe("Stop the VM before snapshotting for disk consistency. Adds ~30–90s. Default: false."),
    }),
    execute: async ({ vmId, name, stop_first }) => executeTazCreateSnapshot({ vmId, name, stop_first }),
  }),
  tazcloud_delete_snapshot: tool({
    description:
      "Delete a TazCloud snapshot by id. DESTRUCTIVE and irreversible. VMs already booted from this snapshot are unaffected. Confirm intent with the user before calling.",
    inputSchema: z.object({
      snapshotId: z.string().describe("The TazCloud snapshot id (from tazcloud_list_snapshots)"),
    }),
    execute: async ({ snapshotId }) => executeTazDeleteSnapshot(snapshotId),
  }),
  tazcloud_register_ingress: tool({
    description:
      "Expose a TazCloud VM's web app over HTTPS at a custom domain. TLS is handled automatically via Let's Encrypt at the ingress layer; the VM serves plain HTTP on app_port internally. Returns a `dns_action` instructing the user to add an A record to their DNS provider pointing the domain to TazCloud's shared ingress IP (188.213.48.229). HTTPS goes live ~60s after DNS propagates.",
    inputSchema: z.object({
      vmId: z.string().describe("The TazCloud VM id"),
      domain: z.string().describe("The FQDN to expose, e.g. 'myapp.example.com'"),
      app_port: z.number().optional().describe("Port your app listens on inside the VM. Default: 80. Range: 1–65535."),
    }),
    execute: async ({ vmId, domain, app_port }) => executeTazRegisterIngress({ vmId, domain, app_port }),
  }),
  tazcloud_remove_ingress: tool({
    description:
      "Remove the ingress (custom-domain HTTPS routing) from a TazCloud VM without deleting the VM. Use this to detach or swap a domain.",
    inputSchema: z.object({
      vmId: z.string().describe("The TazCloud VM id"),
    }),
    execute: async ({ vmId }) => executeTazRemoveIngress(vmId),
  }),

  // --- Recipes (Add-ons authoring) ---
  list_recipes: tool({
    description:
      "List all user-created recipes (Add-ons scripts) stored in Genie's DB. " +
      "Returns slug, label, description, port for each. Built-in recipes (Chrome, " +
      "Postgres, Genie Browser, Navision, Docker) live in code and are NOT returned " +
      "here — use get_builtin_recipe for those.",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = await recipesService.listRecipes();
      if (rows.length === 0) return "No user recipes yet.";
      return rows
        .map((r) => `- ${r.slug} (id: ${r.id}) — "${r.label}" port=${r.port ?? "none"} — ${r.description || "(no description)"}`)
        .join("\n");
    },
  }),
  get_recipe: tool({
    description:
      "Read a single user recipe by slug. Returns label, description, icon, port, " +
      "checkScript, installScript, uninstallScript, setupShSnippet, commands, options. " +
      "Use list_recipes first to discover slugs. Slugs matching a built-in recipe " +
      "(e.g. 'chrome') mean the user has overridden the built-in.",
    inputSchema: z.object({
      slug: z.string().describe("The recipe slug (e.g. 'redis', 'chrome')"),
    }),
    execute: async ({ slug }) => {
      const rows = await recipesService.listRecipes();
      const r = rows.find((x) => x.slug === slug);
      if (!r) return `No user recipe with slug "${slug}". Did you mean to call get_builtin_recipe instead?`;
      return JSON.stringify({
        id: r.id, slug: r.slug, label: r.label, description: r.description,
        icon: r.icon, port: r.port,
        checkScript: r.checkScript, installScript: r.installScript,
        uninstallScript: r.uninstallScript, setupShSnippet: r.setupShSnippet,
        commands: r.commands, options: r.options,
      }, null, 2);
    },
  }),
  create_recipe: tool({
    description:
      "Create a new user recipe. Use this when the user asks Genie to author a new " +
      "Add-on (e.g. 'add a Redis recipe'). The slug must be URL-safe (lowercase, " +
      "hyphens) and unique. Scripts get `log` and `wait_apt` helpers injected at runtime.",
    inputSchema: z.object({
      slug: z.string().describe("URL-safe identifier, e.g. 'redis-7'"),
      label: z.string().describe("Display name, e.g. 'Redis 7'"),
      description: z.string().optional().describe("Short blurb shown in the tile tooltip"),
      icon: z.string().optional().describe("Lucide icon name, e.g. 'Database' (default: Package)"),
      port: z.number().optional().describe("Default port the service listens on, e.g. 6379"),
      checkScript: z.string().describe("Bash that echoes INSTALLED or NOT_INSTALLED"),
      installScript: z.string().describe("Bash install script (apt/dnf etc.)"),
      uninstallScript: z.string().optional().describe("Bash to undo the install"),
      setupShSnippet: z.string().optional().describe("Inlined snippet for project deploy setup.sh"),
    }),
    execute: async (input) => {
      const created = await recipesService.createRecipe(input, null);
      return `Created recipe "${created.slug}" (id: ${created.id}). It now appears in the Add-ons panel for all VMs.`;
    },
  }),
  update_recipe: tool({
    description:
      "Update an existing user recipe by id. Pass only the fields you want to change. " +
      "Use list_recipes / get_recipe to find the id and current values first — and " +
      "include the EXISTING content of any field you're partially modifying, since " +
      "this is a full replace per field.",
    inputSchema: z.object({
      id: z.string().describe("Recipe row id (UUID) from list_recipes"),
      slug: z.string().optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      icon: z.string().optional(),
      port: z.number().nullable().optional(),
      checkScript: z.string().optional(),
      installScript: z.string().optional(),
      uninstallScript: z.string().optional(),
      setupShSnippet: z.string().optional(),
    }),
    execute: async (input) => {
      const { id, ...patch } = input;
      const updated = await recipesService.updateRecipe(id, patch);
      if (!updated) return `Error: recipe ${id} not found.`;
      return `Updated recipe "${updated.slug}". Changes are live in the Add-ons panel.`;
    },
  }),
  delete_recipe: tool({
    description:
      "Delete a user recipe by id. If the slug matches a built-in (e.g. 'chrome'), " +
      "this 'resets' the override and the built-in returns. Confirm intent with " +
      "the user before calling.",
    inputSchema: z.object({
      id: z.string().describe("Recipe row id (UUID) from list_recipes"),
    }),
    execute: async ({ id }) => {
      await recipesService.deleteRecipe(id);
      return `Deleted recipe ${id}.`;
    },
  }),
  tracker_create_issue: tool({
    description:
      "File a new tracker ticket (issue) in a project. Use this when the user asks to capture a bug, a TODO, or a follow-up they want tracked. Mirrors the MCP tracker_create_issue tool so the in-app chat can write tickets without going through Claude Code on the VPS. Defaults: status='todo', priority='none'. Returns the assigned identifier (e.g. #42).",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID to file the ticket against (from assistant context)"),
      title: z.string().describe("Short imperative-form summary, e.g. 'Fix login redirect on Safari'"),
      description: z.string().optional().describe("Body of the ticket — context, repro steps, links. Markdown supported. Optional but recommended for non-trivial items."),
      status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]).optional().describe("Initial status. Defaults to 'todo'."),
      priority: z.enum(["none", "urgent", "high", "medium", "low"]).optional().describe("Initial priority. Defaults to 'none' — only set when the user signals urgency."),
    }),
    execute: async ({ projectId, title, description, status, priority }) => {
      const project = await projectService.getById(projectId);
      if (!project) return `Error: Project not found (id: ${projectId})`;
      const trimmed = (title ?? "").trim();
      if (!trimmed) return "Error: 'title' is required and must be a non-empty string.";
      // "system" mirrors the userId convention used by the MCP tracker server's
      // create / update / comment branches when the agent (not a human) is the author.
      const created = await trackerService.createIssue("system", {
        projectId,
        title: trimmed,
        description,
        status,
        priority,
      });
      return created
        ? `Created issue #${created.identifier}: ${created.title}`
        : "Failed to create issue.";
    },
  }),
};
