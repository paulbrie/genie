# Genie — Feature Status

## Login (Google OAuth)
- [x] Google OAuth loopback flow (desktop-friendly)
- [x] JWT token issuance (30-day expiry)
- [x] Token persistence in localStorage for auto-login
- [x] Auth guard on WebSocket (blocks non-auth messages)
- [x] Login screen with Catppuccin theming
- [x] `open-external` IPC for system browser launch

## Database (PostgreSQL + Drizzle ORM)
- [x] Schema: users, conversations, conversation_members, messages
- [x] Drizzle config + `db:push` script
- [x] Lazy DB singleton connection
- [x] Claude agent user seeded on startup

## Chat System (Unified Conversations)
- [x] DM with Claude (auto-created per user)
- [x] Room creation with optional Claude membership
- [x] Message persistence in PostgreSQL
- [x] Streaming Claude responses (Anthropic API)
- [x] @Claude mention trigger in rooms
- [x] Conversation list with last-message previews
- [x] Chat nav view with split layout (list + messages)
- [x] Legacy ephemeral chat still available via bottom panel
