// Barrel re-export for the store. Existing consumers can keep importing from
// `@/store`, while new code should prefer subpath imports (e.g.
// `@/store/actions/chat`, `@/store/subjects`).
//
// Layout:
//   types/      — domain type declarations (no runtime code)
//   subjects/   — Subject / DeepSubject singletons
//   actions/    — action functions (the "verbs" the UI calls)
//   handlers/   — per-domain WS message dispatchers + handleWsMessage()

export * from "./types";
export * from "./subjects";
export * from "./actions";
export { handleWsMessage } from "./handlers";
