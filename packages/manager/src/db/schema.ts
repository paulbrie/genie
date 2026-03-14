import { pgTable, uuid, text, boolean, timestamp, index, integer, real, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleId: text("google_id").unique().notNull(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  isAgent: boolean("is_agent").default(false).notNull(),
  validated: boolean("validated").default(false).notNull(),
  role: text("role", { enum: ["user", "admin", "superadmin"] }).default("user").notNull(),
  gitToken: text("git_token"),
  defaultEditor: text("default_editor"),
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
  vpsRegion: text("vps_region"),
  vpsSize: text("vps_size"),
  vpsBaseImageId: integer("vps_base_image_id"),
  vpsBaseImageConfigName: text("vps_base_image_config_name"),
  setupFiles: jsonb("setup_files").default({}),
  secrets: jsonb("secrets").default([]),
  doToken: text("do_token"),
  gitlabDeployKey: text("gitlab_deploy_key"),
  dbUrl: text("db_url"),
  gitFolders: jsonb("git_folders").default([]),              // string[] — paths relative to project root
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});

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
