# 07 — Mobile surface

The mobile route (`/mobile`, `components/mobile/`) is the same design system
at touch scale — same tokens, same color semantics — with these deltas.

## Font scaling via wrapper, not per-component sizes

The root shell applies one class:

```html
<div class="mobile-fonts fixed inset-0 flex flex-col bg-background text-text overflow-hidden">
```

`.mobile-fonts` redefines every `--text-*` variable +2px (see table in
[01-tokens.md](01-tokens.md)), so every existing `text-*` utility enlarges
automatically. **Never** pick special sizes for mobile components — write
`text-md` as usual and let the wrapper scale it.

Viewport is set at the route layout, not with safe-area utility classes:
`width=device-width, initialScale 1, maximumScale 1, userScalable false,
themeColor #1e1e2e, viewportFit cover`. No `env(safe-area-inset-*)` padding
anywhere currently.

## Interaction: `active:` replaces `hover:`

Hover states are essentially absent on mobile. Press feedback instead:
- `active:bg-surface0`, `active:bg-surface0/40`, `active:bg-surface1`,
  `active:opacity-70`
- Press scale: `active:scale-95` or `active:scale-[0.97] transition-transform`

## Scale-ups

- **Cards:** `bg-mantle rounded-xl` (borderless — no `border border-surface0`)
  with rows separated by `divide-y divide-surface0/50`.
- **Rows/buttons:** `px-3.5 py-3` / `px-3.5 py-2.5` (vs desktop `px-3 py-1.5`).
- **Icons:** back `ChevronLeft size={22}`, actions `size={16–18}` (vs 13/14).
- **`text-2xs`** (8→10px) is essentially mobile-only: health badges, uptime,
  hostnames.

## Screen chrome

**Screen header** (replaces ViewHeader):
```
flex items-center gap-2 px-3 py-2.5 border-b border-surface0 shrink-0
back: p-1 -ml-1 rounded-lg text-overlay0 active:bg-surface0  (+ ChevronLeft 22)
+ two-line title block (title text-md, sub text-2xs text-overlay0)
```

**Section headers** — the uppercase idiom with count suffix:
```
text-xs uppercase tracking-wide text-overlay0 px-0.5      → "SERVERS · 3"
```

**Menus** — bottom-anchored dropdowns, same tokens as desktop context menus
but wider and roomier:
```
absolute right-1.5 top-full z-40 mt-0.5 min-w-[168px] bg-surface0
border border-surface1 rounded-lg overflow-hidden shadow-xl
```

**Empty state** — large centered stack with an icon badge:
```
flex-1 flex flex-col items-center justify-center gap-5 px-2 text-center
badge: w-14 h-14 rounded-2xl bg-peach/15 grid place-items-center text-peach
```
(badge tint follows the feature's accent: peach for Claude, blue for SSH, …)

## Same semantics, shared components

- Claude = peach everywhere (screen accents, `accent="peach"` props, VM banner
  `border-b border-peach/20 bg-peach/10`); SSH tile = blue; tmux = green.
- Mobile composes desktop components rather than forking them:
  `ChatMessageList`, `ClaudeChatSurface variant="mobile"`, `LoginScreen`,
  `CircularGauge`, `scrollbar-thin`. Per the project's store-first rule, chat
  behavior changes go into the shared `ClaudeChatSurface`, never into one
  surface only.
