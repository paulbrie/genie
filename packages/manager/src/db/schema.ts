import { pgTable, uuid, text, boolean, timestamp, index, integer, real, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleId: text("google_id").unique().notNull(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  isAgent: boolean("is_agent").default(false).notNull(),
  validated: boolean("validated").default(false).notNull(),
  role: text("role", { enum: ["user", "tazcloud", "admin", "superadmin"] }).default("user").notNull(),
  gitToken: text("git_token"),
  gitlabToken: text("gitlab_token"),
  defaultEditor: text("default_editor"),
  /** Most recent changelog version this user has acknowledged via the
   *  "What's new" modal. Null for users who have never seen it. */
  lastSeenUpdateVersion: text("last_seen_update_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type", { enum: ["dm", "room"] }).notNull(),
  name: text("name"),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").references(() => conversations.id).notNull(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_conv_members_conv").on(table.conversationId),
    index("idx_conv_members_user").on(table.userId),
  ]
);

export const docFolders = pgTable(
  "doc_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_doc_folders_user").on(table.userId),
    index("idx_doc_folders_parent").on(table.parentId),
    index("idx_doc_folders_project").on(table.projectId),
  ]
);

export const docs = pgTable(
  "docs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    title: text("title").notNull(),
    content: text("content").default("").notNull(),
    folderId: uuid("folder_id").references(() => docFolders.id, { onDelete: "set null" }),
    isPublic: boolean("is_public").default(false).notNull(),
    publicKey: text("public_key"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_docs_user").on(table.userId),
    index("idx_docs_project").on(table.projectId),
    index("idx_docs_public_key").on(table.publicKey),
  ]
);

export const docShares = pgTable(
  "doc_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    docId: uuid("doc_id").references(() => docs.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id).notNull(),
    sharedWithUserId: uuid("shared_with_user_id").references(() => users.id).notNull(),
    permission: text("permission", { enum: ["read", "write"] }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_doc_shares_doc").on(table.docId),
    index("idx_doc_shares_shared_with").on(table.sharedWithUserId),
  ]
);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  workingFolder: text("working_folder"),
  commands: jsonb("commands").default([]).notNull(),           // ProjectCommand[]
  commandStatuses: jsonb("command_statuses").default({}).notNull(), // Record<string, ProcessStatus>
  vps: jsonb("vps"),                                            // VpsInfo | null
  vpsProvider: text("vps_provider").default("digitalocean").notNull(),  // "digitalocean" | "tazcloud"
  vpsRegion: text("vps_region"),
  vpsSize: text("vps_size"),
  vpsImage: text("vps_image"),                                  // TazCloud image slug (ubuntu-22 etc.); null for DO
  vpsBaseImageId: integer("vps_base_image_id"),
  vpsBaseImageConfigName: text("vps_base_image_config_name"),
  setupFiles: jsonb("setup_files").default({}),
  secrets: jsonb("secrets").default([]),
  doToken: text("do_token"),
  gitlabDeployKey: text("gitlab_deploy_key"),
  dbUrl: text("db_url"),
  gitFolders: jsonb("git_folders").default([]),              // string[] — paths relative to project root
  // Visibility: normal users only see projects whose teamId matches one of their teams.
  // Null teamId = visible only to admins/superadmins.
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_projects_team").on(table.teamId),
]);

/** User-created recipes for the Add-ons panel. Built-in recipes live in code
 *  (VPS_RECIPES in renderer/project-detail.tsx) and are merged with these on the
 *  client. A recipe describes how to check/install/uninstall a piece of software
 *  on a VM over SSH. */
export const recipes = pgTable("recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),       // url-safe stable id (e.g. "redis")
  label: text("label").notNull(),              // display name (e.g. "Redis 7")
  description: text("description").default("").notNull(),
  icon: text("icon").default("Package").notNull(),  // lucide icon name
  port: integer("port"),
  checkScript: text("check_script").notNull(),
  installScript: text("install_script").notNull(),
  uninstallScript: text("uninstall_script").default("").notNull(),
  setupShSnippet: text("setup_sh_snippet").default("").notNull(),
  commands: jsonb("commands").default([]).notNull(),  // RecipeCommand[]
  options: jsonb("options").default([]).notNull(),    // RecipeOption[]
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_recipes_slug").on(table.slug),
]);

export const trackerLabels = pgTable("tracker_labels", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_tracker_labels_created_by").on(t.createdBy)]);

export const trackerIssues = pgTable("tracker_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  identifier: integer("identifier").notNull(),
  title: text("title").notNull(),
  description: text("description").default("").notNull(),
  status: text("status", { enum: ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] }).default("backlog").notNull(),
  priority: text("priority", { enum: ["none", "urgent", "high", "medium", "low"] }).default("none").notNull(),
  assigneeId: uuid("assignee_id").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  sortOrder: real("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tracker_issues_project").on(t.projectId),
  index("idx_tracker_issues_status").on(t.status),
  index("idx_tracker_issues_assignee").on(t.assigneeId),
  index("idx_tracker_issues_identifier").on(t.identifier),
]);

export const trackerIssueLabels = pgTable("tracker_issue_labels", {
  id: uuid("id").defaultRandom().primaryKey(),
  issueId: uuid("issue_id").references(() => trackerIssues.id, { onDelete: "cascade" }).notNull(),
  labelId: uuid("label_id").references(() => trackerLabels.id, { onDelete: "cascade" }).notNull(),
}, (t) => [
  index("idx_tracker_issue_labels_issue").on(t.issueId),
  index("idx_tracker_issue_labels_label").on(t.labelId),
]);

export const trackerIssueComments = pgTable("tracker_issue_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  issueId: uuid("issue_id").references(() => trackerIssues.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id),
  authorName: text("author_name").notNull(), // "Genie", "system", or user display name — denormalized for easy display
  authorAvatar: text("author_avatar"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tracker_comments_issue").on(t.issueId),
  index("idx_tracker_comments_user").on(t.userId),
]);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").references(() => conversations.id).notNull(),
    senderId: uuid("sender_id").references(() => users.id).notNull(),
    content: text("content").notNull(),
    metadata: text("metadata"), // JSON string for tool uses etc.
    replyToId: uuid("reply_to_id"),
    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_messages_conv").on(table.conversationId),
    index("idx_messages_created").on(table.createdAt),
  ]
);

export const deployLogs = pgTable("deploy_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  status: text("status", { enum: ["running", "success", "error"] }).default("running").notNull(),
  progress: jsonb("progress").default([]).notNull(),   // string[]
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
}, (t) => [
  index("idx_deploy_logs_project").on(t.projectId),
]);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  modelId: text("model_id").notNull(),
  modelLabel: text("model_label").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cost: real("cost").notNull(), // USD
  source: text("source"), // project name or "Genie"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ai_usage_user").on(t.userId),
  index("idx_ai_usage_created").on(t.createdAt),
  index("idx_ai_usage_model").on(t.modelId),
]);

export const assistantChatLogs = pgTable("assistant_chat_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull(),
  projectId: text("project_id"),
  instanceId: text("instance_id"),
  userId: text("user_id"),
  clientType: text("client_type").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  modelId: text("model_id"),
  toolUses: jsonb("tool_uses"),
  usage: jsonb("usage"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_acl_session").on(t.sessionId),
  index("idx_acl_project").on(t.projectId),
  index("idx_acl_created").on(t.createdAt),
]);

export const baseImageTemplateHistory = pgTable("base_image_template_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateName: text("template_name").notNull(),
  action: text("action", { enum: ["created", "updated", "deleted", "restored"] }).notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_base_image_tpl_hist_name").on(t.templateName),
  index("idx_base_image_tpl_hist_created").on(t.createdAt),
]);

export const savedQueries = pgTable("saved_queries", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  query: text("query").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_saved_queries_project").on(t.projectId),
  index("idx_saved_queries_user").on(t.userId),
]);

export const chatSessionMeta = pgTable("chat_session_meta", {
  sessionId: uuid("session_id").primaryKey(),
  name: text("name"),
  deletedAt: timestamp("deleted_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Resume metadata — populated when a chat turn observes the Claude Code
  // session id streamed back from the `claude` CLI. Lets the History panel
  // reinstall the right --resume mapping when the user re-opens the session.
  claudeCodeSessionId: text("claude_code_session_id"),
  projectId: text("project_id"),
  instanceId: text("instance_id"),
});

/**
 * Persisted mapping of `projectId:instanceId` → Claude Code session id, used to
 * pass `--resume <id>` to the `claude` CLI across Manager restarts. Conversation
 * content itself lives on the VPS in `~/.claude/projects/...jsonl`; this table
 * just remembers which session id to resume.
 */
export const assistantSessionState = pgTable("assistant_session_state", {
  sessionKey: text("session_key").primaryKey(),               // "projectId:instanceId"
  claudeCodeSessionId: text("claude_code_session_id").notNull(),
  projectId: text("project_id").notNull(),
  instanceId: text("instance_id").notNull(),
  lastActivity: timestamp("last_activity").defaultNow().notNull(),
}, (t) => [
  index("idx_ass_session_state_project").on(t.projectId),
  index("idx_ass_session_state_last_activity").on(t.lastActivity),
]);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  payload: jsonb("payload"),
  ip: text("ip"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_audit_log_user").on(t.userId),
  index("idx_audit_log_action").on(t.action),
  index("idx_audit_log_created").on(t.createdAt),
]);

export const fileTemplates = pgTable("file_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  files: jsonb("files").default({}).notNull(),  // Record<string, string>
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_file_templates_created_by").on(t.createdBy),
]);

export const globalSettings = pgTable("global_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const securityScans = pgTable("security_scans", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  target: text("target").notNull(),
  status: text("status", { enum: ["completed", "error", "stopping"] }).notNull(),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  ports: jsonb("ports").default([]).notNull(),        // PortResult[]
  findings: jsonb("findings").default([]).notNull(),  // WebFinding[]
  operations: jsonb("operations").default([]).notNull(), // string[]
  error: text("error"),
}, (t) => [
  index("idx_security_scans_user").on(t.userId),
  index("idx_security_scans_started").on(t.startedAt),
]);

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").references(() => teams.id).notNull(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    role: text("role", { enum: ["member", "owner", "superadmin"] }).default("member").notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_team_members_team").on(table.teamId),
    index("idx_team_members_user").on(table.userId),
  ]
);

/**
 * Genie-side display names for cloud VMs, independent of provider API support.
 * DO supports renaming via its API; TazCloud does not. To give a unified rename
 * experience we store the name here and prefer it over the provider-returned name.
 * (provider, vmId) is unique.
 */
export const cloudVmAliases = pgTable(
  "cloud_vm_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider", { enum: ["digitalocean", "tazcloud"] }).notNull(),
    vmId: text("vm_id").notNull(),                  // text — DO ids are numeric, taz ids are uuid
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_cloud_vm_aliases_lookup").on(table.provider, table.vmId),
  ]
);

/**
 * Persistent terminal session metadata. The id matches the tmux session name on
 * the VPS — tmux's `new -A -s ${id}` attaches if the session exists or creates
 * it otherwise, so a reattach is just another spawn with the same id. The row
 * survives Manager restart; the tmux session survives SSH channel drops. Pair.
 */
export const ptySessions = pgTable("pty_sessions", {
  id: text("id").primaryKey(),                                // = tmux session name = renderer tab id
  ownerId: text("owner_id").notNull(),
  kind: text("kind", { enum: ["shell", "claude"] }).default("shell").notNull(),
  projectId: text("project_id"),                              // nullable for direct-SSH terminals
  instanceId: text("instance_id"),
  vpsHost: text("vps_host").notNull(),                        // for display + filtering
  commandLabel: text("command_label"),                        // e.g. "claude" or "bash -l"
  sshConfig: jsonb("ssh_config"),                             // for direct-SSH reattach: {host,port,username,privateKeyPath,...}
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastActivity: timestamp("last_activity").defaultNow().notNull(),
}, (t) => [
  index("idx_pty_sessions_owner").on(t.ownerId),
  index("idx_pty_sessions_project").on(t.projectId),
  index("idx_pty_sessions_last_activity").on(t.lastActivity),
]);

/**
 * Per-VM "deletion lock" — when a row exists for (provider, vmId), the VM is
 * locked: only a superadmin may delete it, and the UI requires typed-name
 * confirmation. Anyone with delete access can set a lock; only a superadmin can
 * clear it. Default state is unlocked (no row).
 */
export const cloudVmLocks = pgTable(
  "cloud_vm_locks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider", { enum: ["digitalocean", "tazcloud"] }).notNull(),
    vmId: text("vm_id").notNull(),
    lockedBy: text("locked_by"),                    // user id of whoever set the lock; null if unknown
    lockedAt: timestamp("locked_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_cloud_vm_locks_lookup").on(table.provider, table.vmId),
  ]
);
