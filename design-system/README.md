# Genie Design System — Agent Handbook

Self-contained instructions for building UI that looks and behaves like Genie.
Written to be handed to another agent: every token value, className recipe, and
convention is spelled out inline — you do not need access to the Genie repo to
apply it (file references are included for provenance only).

## What Genie is

A dense, dark-only, desktop-first infrastructure console (Electron-style shell,
Next.js renderer) for managing VPSes, tmux sessions, Claude chat sessions,
Docker, and deployments. The aesthetic is a compact developer tool: small type
(13px body), tight spacing, Catppuccin Mocha palette, floating draggable
windows, monospace for anything machine-flavored.

## Stack

- **Next.js 16 + React 19**, client components (`"use client"`), no RSC styling.
- **Tailwind CSS v4** — tokens defined in a CSS `@theme` block, no `tailwind.config.ts` theme. Custom utilities via `@utility`.
- **class-variance-authority (cva)** for the Button variants; `cn()` = `clsx` + `tailwind-merge` for class merging everywhere.
- **Radix primitives** only for Switch and Tooltip. Everything else is hand-rolled.
- **lucide-react** for icons (via the `size={n}` prop, not `w-*/h-*` classes).
- **shadcn** config exists (`components.json`, new-york style) but is vestigial — components are custom, not generated.

## Reading order

| File | Contents |
|---|---|
| [01-tokens.md](01-tokens.md) | Color palette (hex), type scale, fonts, custom utilities — the `@theme` source of truth |
| [02-color-semantics.md](02-color-semantics.md) | What each color *means* (peach=Claude, green=shell, blue=focus…) |
| [03-primitives.md](03-primitives.md) | The shared components: Button, Select, Switch, Tooltip, ViewHeader, ViewTabs, ErrorMessage, pills |
| [04-patterns.md](04-patterns.md) | Composite recipes: modals, panels, drawers, floating windows, forms, lists, badges, empty states |
| [05-layout-spacing.md](05-layout-spacing.md) | Spacing, radius, border, shadow, and z-index conventions |
| [06-motion.md](06-motion.md) | Transitions, spinners, named keyframe animations, reduced-motion |
| [07-mobile.md](07-mobile.md) | The mobile surface: font scaling wrapper, tap targets, active: instead of hover: |
| [08-anti-patterns.md](08-anti-patterns.md) | Dead tokens and mistakes to avoid |

## Ten rules that carry 90% of the look

1. **Dark only.** Canvas `bg-background` (#1e1e2e), raised surfaces `bg-mantle`, recessed wells `bg-crust`. Never white, never light mode.
2. **Body text is `text-md` (13px).** Warning: the scale is custom — `text-md` (13px) is *larger* than `text-base` (12px).
3. **Never hardcode a hex.** Every color routes through a token utility (`text-peach`, `bg-surface0`) or `var(--color-*)` inside arbitrary values.
4. **Default divider/edge is `border-surface0`.** Elements filled `bg-surface0` take `border-surface1`.
5. **Semantic color = tint formula.** Badges/banners are `bg-{color}/15 text-{color}` (optionally `border border-{color}/30`), never solid fills.
6. **Peach means Claude, green means shell/healthy, blue means focus/info, mauve is the Genie brand/primary action, red is error/destructive, yellow is transitional.**
7. **Muted-text ladder:** `text-text` → `text-subtext0` → `text-overlay0` (most-used muted color) for primary → secondary → hint/idle.
8. **Icon buttons:** `p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors` with lucide `size={14}` (13 in window chrome, 12 in dense rows).
9. **Radius ladder:** `rounded` chips/icon-buttons → `rounded-md` buttons/inputs/menus → `rounded-lg` modals/cards → `rounded-xl` floating windows → `rounded-full` dots/pills.
10. **`transition-colors` on everything interactive**; `Loader2` + `animate-spin` is the only spinner; `animate-pulse` marks "live/in-flight".

## Repo pointers (if you do have the repo)

- Tokens: `packages/renderer/src/app/globals.css` (`@theme` block, lines 10–55)
- Primitives: `packages/renderer/src/components/ui/`
- `cn()`: `packages/renderer/src/lib/utils.ts`
- Mobile shell: `packages/renderer/src/components/mobile/mobile-app.tsx`
