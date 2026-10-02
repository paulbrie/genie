# 05 — Layout, spacing, radius, borders, shadows, z-index

## Density philosophy

Genie is compact. 13px body, tight paddings, 4px-grid spacing. When porting a
design from a generic template, shrink everything one step.

## Canonical padding pairings

| Element | Padding |
|---|---|
| Icon button | `p-1` (dense rows: `p-0.5`) |
| Pill / badge | `px-1.5 py-0.5` |
| Small button | `px-2 py-0.5` |
| Default button | `px-2.5 py-1` |
| Input (compact) | `px-2.5 py-1.5` |
| Input (settings) | `px-3 py-2` |
| List row | `px-3 py-1.5` (tight file rows: `px-2 py-1`) |
| Window title bar | `px-3 py-2` (or `py-1.5`) |
| Modal header/body/footer | `px-4 py-3` |
| Panel shell | `px-5 pb-5` (title band: `px-5 py-4`) |
| Card | `p-4` (dense: `p-3`) |

Most-used gaps: `gap-2` (icon↔text, general row rhythm) > `gap-1` >
`gap-1.5` (badge rows, header action clusters) > `gap-3` (form field stacks)
> `gap-0.5` (window-control cluster) > `gap-4` (card grids).

## Radius ladder

| Utility | Use |
|---|---|
| `rounded` (4px) | icon buttons, pills, inline chips, small inputs, code spans, kbd |
| `rounded-md` | buttons, inputs, Select, nav items, menus, tooltip |
| `rounded-lg` | modals, cards, context menus, log wells |
| `rounded-xl` | floating windows, command palette, mobile cards |
| `rounded-2xl` | mobile empty-state icon badges |
| `rounded-full` | status dots, count pills, avatars, tool pills, quick-reply chips |
| `rounded-none` | maximized window state only |

## Borders

- Default divider/edge: `border-surface0` (by far the most common).
- Border on a `bg-surface0` fill: `border-surface1`.
- Softer row dividers: `border-surface0/50`.
- Menu edges: `border-overlay0/30`, menu dividers `border-overlay0/15`.
- Semantic borders always alpha-stepped: `border-red/30`, `border-green/30`,
  `border-blue/40`, `border-peach/30..60`, `border-mauve/40`. Full-strength
  accent borders only for the active tmux pill (`border-2 border-peach`).
- Dashed only for empty-state CTA boxes: `border-dashed border-surface0`.

## Shadows

| Shadow | Use |
|---|---|
| `shadow-lg` | menus, tooltips (tooltip adds `shadow-black/50`) |
| `shadow-xl` | modals |
| `shadow-2xl` + tint | floating windows, command palette, confirms |

Window shadow tints: unfocused `shadow-black/50`; focused `shadow-blue/20`
(generic) / `shadow-peach/20` (Claude); destructive `shadow-red/20`. Drawer
uses an arbitrary upward shadow `shadow-[0_-4px_20px_rgba(0,0,0,0.3)]`. Glow
dots: `shadow-[0_0_4px_var(--color-green)]`.

## Z-index ladder (respect it exactly)

| Layer | Value |
|---|---|
| Click-away scrims for local popovers | `z-10` … `z-30` |
| Modal overlay / panel | `z-40` / `z-50` (most common) |
| Secondary modal over a panel | `z-[60]` / `z-[61]` |
| Confirm dialogs | `z-[100]` |
| VM modals | `z-[200]` / `z-[201]` |
| ActionMenu backdrop / panel | `z-[999]` / `z-[1000]` |
| Floating windows | dynamic, starting at `10000` (store-managed `nextZIndex`) |
| Claude chat windows | base `2_000_000`, focused `+1000` |
| Tooltips | `z-[2000000050]` |
| Context menus (portal) | `2_000_000_000` / `2_000_000_001` |
| Command palette | `z-[3000000]` |

Rules: overlay z = panel z − 1; new floating-window types take z from the
store's `nextZIndex`, never hardcode; anything that must beat a Claude window
needs > 2,001,000.

## Layout skeleton

- Body never scrolls (`overflow: hidden`); each panel manages its own
  scrolling (`flex-1 min-h-0 overflow-y-auto`, often `scrollbar-thin`).
- Vertical stacks use flex + `shrink-0` on chrome (headers, footers, tabs) and
  `flex-1 min-h-0` on content.
- `min-w-0` + `truncate` on any text that can grow (titles, subtitles, paths).
- Fixed-width side columns: `w-[40%] min-w-[280px] max-w-[50%] shrink-0`.
