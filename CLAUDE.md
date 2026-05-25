# Genie Project Conventions

## State Management
- Use `Subject` for simple/flat values (primitives, arrays, simple objects) and `DeepSubject` for complex nested objects.
- Import `Subject` from `"subjecto/core"`, `DeepSubject` and `batch` from `"subjecto"`, hooks from `"subjecto/react"`.
- Naming: prefix with `$` — e.g. `$auth`, `$apps`, `$admin`, `$selectedAppId`.
- **Subject** pattern: `const [value, setValue] = useSubject($subject)` in components.
- **DeepSubject** pattern: mutate via proxy (`$subject.getValue().field = value`), use `batch()` for multi-field updates, subscribe with `useDeepSubject($subject, 'path')` in components.
- For components needing many fields from a DeepSubject, use the `useDeepSubjectAll` helper hook.

## VPS Service Logs
- Next.js dev service (recipe `nextjs`) logs to `/var/log/nextjs-dev.log` on the VM. Recipes installing this service must write their systemd unit's `StandardOutput`/`StandardError` to this path.
