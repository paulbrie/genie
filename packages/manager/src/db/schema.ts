import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex, integer, real, jsonb, bigint } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Nullable so admins can invite a user (creates a stub row) before that user
  // ever signs in with Google. On their first OAuth sign-in we hydrate this
  // column from `sub` and mark the user validated.
  googleId: text("google_id").unique(),
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
  vpsProvider: text("vps_provider").default("digitalocean").notNull(),  // "digitalocean" | "tazcloud" | "hetzner"
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

/** Recipes for the Add-ons panel — the *single source* at runtime. Built-in
 *  recipes are seeded on manager boot from `default-recipes.ts`; user-created
 *  recipes are inserted via the UI. Both kinds live in this table — the panel
 *  no longer distinguishes between them. A recipe describes how to check /
 *  install / uninstall a piece of software on a VM over SSH. */
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
  /** Per-apply prompted values (e.g. GitHub PAT). Never persisted to user
   *  config — re-prompted on every Install/Re-apply. See RecipeSecret type. */
  secrets: jsonb("secrets").default([]).notNull(),
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
  // Nullable: agent/MCP-created issues have no human author (mirrors
  // tracker_comments.user_id, which is null for "Genie" comments).
  createdBy: uuid("created_by").references(() => users.id),
  sortOrder: real("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tracker_issues_project").on(t.projectId),
  index("idx_tracker_issues_status").on(t.status),
  index("idx_tracker_issues_assignee").on(t.assigneeId),
  // Identifiers are per-project (TER-1, TER-2, … reset per project), so the
  // human-facing number is only unique *within* a project. The composite
  // unique index enforces that and also serves the (projectId, identifier)
  // lookups the MCP tracker tools do.
  uniqueIndex("uniq_tracker_issues_project_identifier").on(t.projectId, t.identifier),
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

/** Platform communication emails sent from the super-admin Communication panel.
 *  One row per recipient per send (a broadcast to N users writes N rows) so the
 *  log table can show per-recipient delivery results. */
export const emailLogs = pgTable("email_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Recipient user id when the address resolves to a known user; null for
   *  ad-hoc / no-longer-existing addresses. */
  recipientUserId: uuid("recipient_user_id"),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** "sent" once SendGrid accepts it, "failed" otherwise. */
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  /** SendGrid / transport error message when status = "failed". */
  error: text("error"),
  /** The super-admin who triggered the send. */
  sentByUserId: uuid("sent_by_user_id"),
  sentByName: text("sent_by_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_email_logs_recipient").on(t.recipientUserId),
  index("idx_email_logs_status").on(t.status),
  index("idx_email_logs_created").on(t.createdAt),
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

// Encrypted SSH private keys for generic ("bring-your-own") servers connected
// with the paste-a-key auth method. The key is never stored plaintext — see
// vps/credential-crypto.ts (AES-256-GCM, per-row salt + iv). Genie-key servers
// have no row here (they reuse the shared Genie keypair).
export const serverCredentials = pgTable("server_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  instanceId: text("instance_id").notNull(),  // the VpsInstance.id this key belongs to
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  salt: text("salt").notNull(),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_server_credentials_project").on(t.projectId),
]);

// Per-instance bearer token the on-VM genie-stats daemon uses to authenticate
// its HTTPS stats postback to the manager (POST /api/vps/stats). One row per
// (projectId, instanceId); `token` is the lookup key on ingest.
export const vpsStatsTokens = pgTable("vps_stats_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  instanceId: text("instance_id").notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uniq_vps_stats_tokens_token").on(t.token),
  uniqueIndex("uniq_vps_stats_tokens_instance").on(t.projectId, t.instanceId),
]);

export const globalSettings = pgTable("global_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const securityScans = pgTable("security_scans", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  // Set for scans run via the genie-security MCP, which is scoped to one project
  // by its bearer token. Null for in-app (SecurityPanel) scans, which are scoped
  // by userId instead. The MCP list/get path filters on this so one project's
  // VM can't enumerate another project's scans.
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
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
  index("idx_security_scans_project").on(t.projectId),
  index("idx_security_scans_started").on(t.startedAt),
]);

/**
 * Top-level organizations. Sit ABOVE teams: a team has at most one org. An
 * admin who creates an org becomes its owner; org membership is what binds
 * users to the orgs they can see / be assigned to projects under.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    // owner = full org control incl. delete; admin = manage users/projects;
    // member = visibility only (project-level ACL still applies).
    role: text("role", { enum: ["owner", "admin", "member"] }).default("member").notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_org_members_org").on(table.orgId),
    index("idx_org_members_user").on(table.userId),
  ]
);

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // Owning org. Nullable for legacy rows; boot-time migration backfills it.
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_teams_org").on(table.orgId),
]);

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

/** Reusable invite links that add users to an org + team on accept. */
export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
    token: text("token").notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    index("idx_team_invites_token").on(table.token),
    index("idx_team_invites_team").on(table.teamId),
    index("idx_team_invites_org").on(table.orgId),
  ]
);

/**
 * Per-project ACL. A user sees a project iff they are listed here OR they
 * are an owner/admin of the project's org (via teams → orgs → org_members).
 * Superadmins bypass both checks.
 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: text("role", { enum: ["owner", "member"] }).default("member").notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_project_members_project").on(table.projectId),
    index("idx_project_members_user").on(table.userId),
  ]
);

/**
 * Additional teams granted access to a project, beyond its primary
 * `projects.teamId` owner. A project's effective team set is
 * `{ teamId } ∪ project_teams.teamId`; any member of any of those teams can see
 * it. This is the many-to-many counterpart to the single-team `projects.teamId`
 * (which stays the canonical owning team).
 */
export const projectTeams = pgTable(
  "project_teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_project_teams_project").on(table.projectId),
    index("idx_project_teams_team").on(table.teamId),
    uniqueIndex("uniq_project_teams_project_team").on(table.projectId, table.teamId),
  ]
);

/**
 * Per-org encrypted credentials for cloud providers / external services. One
 * row per (org, kind) — e.g. ("...uuid", "tazcloud-token"). Stored using the
 * same AES-256-GCM envelope as server_credentials so a manager-secret rotation
 * has the same blast radius for both. Kept normalised (one row per secret)
 * rather than columns-on-organizations so adding DigitalOcean / GitHub /
 * GitLab tokens later is just another `kind` value.
 */
export const orgCredentials = pgTable("org_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),            // "tazcloud-token" | "tazcloud-ssh-key" | …
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  salt: text("salt").notNull(),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // $onUpdate bumps updatedAt on every drizzle UPDATE so the readCredential
  // tiebreaker stays correct even if a future direct UPDATE forgets to set it.
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  // UNIQUE so setCredential can use ON CONFLICT (one round trip, atomic) and
  // concurrent writes can't produce duplicate rows for the same (org, kind).
  uniqueIndex("idx_org_credentials_lookup").on(t.orgId, t.kind),
]);

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
    provider: text("provider", { enum: ["digitalocean", "tazcloud", "hetzner"] }).notNull(),
    vmId: text("vm_id").notNull(),                  // text — DO/Hetzner ids are numeric, taz ids are uuid
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_cloud_vm_aliases_lookup").on(table.provider, table.vmId),
  ]
);

/**
 * Persistent terminal session metadata. The id matches the dtach socket name
 * (or tmux session name for legacy claude-tmux rows) on the VPS — `dtach -A`
 * attaches if the socket exists or creates it otherwise, so a reattach is just
 * another spawn with the same id. The row survives Manager restart; the dtach
 * socket survives SSH channel drops. Pair.
 */
export const ptySessions = pgTable("pty_sessions", {
  id: text("id").primaryKey(),                                // = dtach socket id = renderer tab id
  ownerId: text("owner_id").notNull(),
  kind: text("kind", { enum: ["shell", "claude", "claude-tmux"] }).default("shell").notNull(),
  projectId: text("project_id"),                              // nullable for direct-SSH terminals
  instanceId: text("instance_id"),
  vpsHost: text("vps_host").notNull(),                        // for display + filtering
  commandLabel: text("command_label"),                        // e.g. "claude" or "bash -l"
  sshConfig: jsonb("ssh_config"),                             // for direct-SSH reattach: {host,port,username,privateKeyPath,...}
  dtachSocketPath: text("dtach_socket_path"),                 // populated for dtach-persisted sessions; null for legacy/tmux
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
    provider: text("provider", { enum: ["digitalocean", "tazcloud", "hetzner"] }).notNull(),
    vmId: text("vm_id").notNull(),
    lockedBy: text("locked_by"),                    // user id of whoever set the lock; null if unknown
    lockedAt: timestamp("locked_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_cloud_vm_locks_lookup").on(table.provider, table.vmId),
  ]
);

/** Scalar VPS resource samples (5s cadence when stats stream is active). */
export const vpsMetricSamples = pgTable("vps_metric_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  instanceId: text("instance_id").notNull(),
  sampledAt: timestamp("sampled_at").notNull(),
  cpuPercent: real("cpu_percent").notNull(),
  memUsedBytes: bigint("mem_used_bytes", { mode: "number" }).notNull(),
  memTotalBytes: bigint("mem_total_bytes", { mode: "number" }).notNull(),
  memPercent: real("mem_percent").notNull(),
  diskUsedBytes: bigint("disk_used_bytes", { mode: "number" }).notNull(),
  diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }).notNull(),
  diskPercent: real("disk_percent").notNull(),
}, (t) => [
  index("idx_vps_metric_samples_lookup").on(t.projectId, t.instanceId, t.sampledAt),
  index("idx_vps_metric_samples_sampled_at").on(t.sampledAt),
]);

/**
 * User-definable AI agents. An agent is a named LLM persona with its own
 * system prompt, model, tool allowlist, and sandbox target — think "recipes
 * but for AI". Built-in agents are seeded on boot (isBuiltin=true) and can be
 * forked by users; user-created agents have an ownerUserId and isBuiltin=false.
 * Runs of an agent are tracked in `agentRuns`.
 */
export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),                       // url-safe stable id (e.g. "echo", "reviewer")
  label: text("label").notNull(),                              // display name
  description: text("description").default("").notNull(),
  systemPrompt: text("system_prompt").default("").notNull(),
  /** Model id from chat.ts CHAT_MODELS — kept as free-form text so adding a new
   *  model in code doesn't require a migration. Empty/unknown → default. */
  modelId: text("model_id").default("claude-sonnet").notNull(),
  maxToolRounds: integer("max_tool_rounds").default(40).notNull(),
  /** Allowlist of tool names (strings). Empty array = allow all built-in tools.
   *  Names match the keys exposed by createTools() in @genie/vps-agent. */
  tools: jsonb("tools").default([]).notNull(),
  /** Where the agent runs. v0: `{kind:"project-docker", projectId, instanceId, timeoutSec?}`.
   *  Future: `{kind:"firecracker", host, ...}`. */
  sandbox: jsonb("sandbox").default({}).notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  isBuiltin: boolean("is_builtin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_agents_slug").on(t.slug),
  index("idx_agents_owner").on(t.ownerUserId),
]);

/**
 * One execution of an agent. Status flows queued → running → (succeeded |
 * failed | timeout | cancelled). `toolEvents` accumulates the streamed
 * `{name,input,result}` tool calls (same shape as assistantChatLogs.toolUses).
 * `parentRunId` is set for agent-to-agent calls (Phase 4).
 */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }).notNull(),
  parentRunId: uuid("parent_run_id"),
  triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  instanceId: text("instance_id"),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "timeout", "cancelled"] })
    .default("queued").notNull(),
  input: jsonb("input").default({}).notNull(),
  output: jsonb("output"),
  error: text("error"),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  costUsd: real("cost_usd").default(0).notNull(),
  toolEvents: jsonb("tool_events").default([]).notNull(),
  /** Backend-specific reference for cleanup (Docker container id, microVM id). */
  sandboxRef: text("sandbox_ref"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (t) => [
  index("idx_agent_runs_agent").on(t.agentId),
  index("idx_agent_runs_project").on(t.projectId),
  index("idx_agent_runs_status").on(t.status),
  index("idx_agent_runs_started").on(t.startedAt),
]);

// SSH disconnect flight recorder (see vps/ssh-events.ts). Persists every
// attributed connection drop + wireproxy lifecycle event so a stream-stop or
// connection-loss can be triaged after the fact, including correlating all-hosts
// drops against a wireproxy exit on the same timeline.
export const sshEvents = pgTable("ssh_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  occurredAt: timestamp("occurred_at").notNull(),
  host: text("host").notNull(),
  port: integer("port"),
  username: text("username"),
  kind: text("kind").notNull(),          // client | pty | stats | tunnel | wireproxy
  event: text("event").notNull(),        // disconnect | wireproxy-exit | wireproxy-respawn | wireproxy-gaveup
  cause: text("cause"),                   // SshDisconnectCause for disconnects
  lifetimeMs: integer("lifetime_ms"),
  lastDataAgeMs: integer("last_data_age_ms"),
  detail: text("detail"),
}, (t) => [
  index("idx_ssh_events_host_time").on(t.host, t.occurredAt),
  index("idx_ssh_events_time").on(t.occurredAt),
  index("idx_ssh_events_cause").on(t.cause),
]);
