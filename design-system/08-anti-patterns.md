# 08 — Anti-patterns

Mistakes that exist in the codebase or are easy to make. Do not copy them; fix
them on contact where cheap.

## Dead / undefined tokens (render as nothing)

1. **`bg-base` / `bg-base/80` / `bg-base/40`** — `--color-base` does not exist
   (Catppuccin "base" was renamed `background`). ~20 stale usages remain
   (ssh-panel, admin dialogs, extension pages, invite page). Use
   `bg-background`.
2. **`teal` (≈19×), `sapphire` (5×), `maroon` (1×)** — Catppuccin colors that
   were never added to `@theme`. Either use a defined accent or add the token
   deliberately.
3. **`ui/card.tsx`** — unused shadcn stub on foreign tokens (`bg-card`,
   `text-card-foreground`, `text-muted-foreground`) with `p-6` spacing. Zero
   imports. The real card idiom is `bg-mantle border border-surface0
   rounded-lg p-4` (or borderless `bg-mantle rounded-lg p-4`).

## Scale traps

4. **`text-base` ≠ body size.** The custom scale inverts Tailwind: body is
   `text-md` (13px), `text-base` is 12px. Reaching for `text-base` out of
   Tailwind habit makes text smaller than intended.
5. **Don't use rem-based Tailwind defaults** (`text-sm` from stock Tailwind
   ≈14px assumptions, `p-6` card padding, `h-10` inputs). Everything here is
   one step denser.

## Styling traps

6. **Never hardcode hex values** — route through token utilities or
   `var(--color-*)` even inside arbitrary values
   (`shadow-[0_0_4px_var(--color-green)]`).
7. **`<button>` has no reset.** Hand-rolled buttons need explicit
   `bg-transparent border-none cursor-pointer` or they render with UA chrome.
8. **`user-select: none` is global.** Forgetting `select-text` on logs,
   errors, IDs, or chat content makes them uncopyable.
9. **Don't animate window geometry.** Window chrome transitions must stay
   scoped to `transition-[border-color,box-shadow]`; a bare `transition-all`
   makes dragging/resizing rubber-band.
10. **Don't invent z-indexes.** Follow the ladder in
    [05-layout-spacing.md](05-layout-spacing.md); floating windows take z from
    the store's `nextZIndex`.
11. **Don't use full-strength accent borders for semantic states** — use
    alpha steps (`border-red/30`, `border-peach/40`). The only full-strength
    accent border is the active tmux pill (`border-2 border-peach|green`).
12. **No zebra tables, no light mode, no white backgrounds.**
13. **Icons:** don't size lucide icons with `w-4 h-4` classes — use
    `size={n}`. Reserve `w-N h-N` for status dots and hand-rolled SVGs.
14. **Lavender is not an accent** — it only exists as mauve's hover.

## Process traps (from project conventions)

15. **Chat surfaces:** never add composer/interaction features to
    `claude-stream-window.tsx` or `claude-screen.tsx` directly — they go into
    the shared `ClaudeChatSurface`; protocol/state goes store-first
    (`$claudeStream`), components only render.
16. **New keyframe animations** belong in `globals.css` with a
    `prefers-reduced-motion` fallback, matching the existing pattern.
