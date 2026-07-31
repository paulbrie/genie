# Genie Project Conventions

## State Management
- Use `Subject` for simple/flat values (primitives, arrays, simple objects) and `DeepSubject` for complex nested objects.
- Import `Subject` from `"subjecto/core"`, `DeepSubject` and `batch` from `"subjecto"`, hooks from `"subjecto/react"`.
- Naming: prefix with `$` — e.g. `$auth`, `$apps`, `$admin`, `$selectedAppId`.
- **Subject** pattern: `const [value, setValue] = useSubject($subject)` in components.
- **DeepSubject** pattern: mutate via proxy (`$subject.getValue().field = value`), use `batch()` for multi-field updates, subscribe with `useDeepSubject($subject, 'path')` in components.
- For components needing many fields from a DeepSubject, use the `useDeepSubjectAll` helper hook.

## Concepts / Knowledge bundle
- Conceptual documentation about how Genie itself is built lives in `knowledge/` (markdown), surfaced in the superadmin **Concepts** panel and backed by the `knowledge_docs` DB table. When you need architecture/concept context, read `knowledge/index.md` and the files it links.
- The DB is the runtime source of truth (Concepts are editable in the UI); `knowledge/` is the file-authoring surface, synced both ways on demand:
  - **Read current Concepts:** `npm run knowledge:export` (DB → `knowledge/`), then read the files.
  - **Update Concepts:** edit/add `knowledge/*.md` (frontmatter `title:` sets the display title; the body is markdown), then `npm run knowledge:import` (disk → DB, upsert by path) to push them live. Commit the `knowledge/` changes.
  - Import/export are on-demand only — nothing is auto-seeded on boot. Deletions are done in the UI (import is non-destructive).

## Claude chat — desktop & mobile stay in sync
- The Claude chat has two surfaces over ONE shared state: the desktop floating window (`components/chat/claude-stream-window.tsx`) and the mobile screen (`components/mobile/screens/claude-screen.tsx`). Everything below the message list — composer, send/queue/stop, plan mode, `!cmd` bang mode, image paste, autocomplete, dictation, the AskUserQuestion dialog, context footer — lives in the shared `components/chat/ClaudeChatSurface`; the message list is the shared `ChatMessageList`.
- **Store-first rule:** new `claude:stream:*` features land in the store first (`store/types/claude-stream.ts` → `store/handlers/claude-stream.ts` → `store/actions/claude-stream.ts`), never as protocol/state logic inside a component. Components only render `$claudeStream`.
- **No surface-only features:** a change to the chat's composer/interaction area goes into `ClaudeChatSurface` (variant-gated if needed), NOT into `claude-stream-window.tsx` or `claude-screen.tsx` directly. If you touch one surface's chat behavior, verify the other surface still matches.

## VPS Service Logs
- Next.js dev service (recipe `nextjs`) logs to `/var/log/nextjs-dev.log` on the VM. Recipes installing this service must write their systemd unit's `StandardOutput`/`StandardError` to this path.
- ASP.NET Core dev service (recipe `dotnet-dev`) logs to `/var/log/dotnet-dev.log`, same rule.
