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

## VPS Service Logs
- Next.js dev service (recipe `nextjs`) logs to `/var/log/nextjs-dev.log` on the VM. Recipes installing this service must write their systemd unit's `StandardOutput`/`StandardError` to this path.
