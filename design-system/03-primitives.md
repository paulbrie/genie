# 03 — Shared primitives

All live in `src/components/ui/`. Classes merge through `cn()` (clsx +
tailwind-merge). These are the exact class strings — reproduce them verbatim
when porting.

## Button (cva)

```
base:    inline-flex items-center justify-center rounded-md text-md font-medium
         cursor-pointer transition-colors disabled:pointer-events-none disabled:opacity-50

default: bg-surface0 text-text border border-surface1 hover:bg-surface1
primary: bg-mauve text-background border border-mauve font-semibold
         hover:bg-lavender hover:border-lavender
danger:  bg-surface0 text-red border border-red hover:bg-red hover:text-background
ghost:   bg-transparent border-none text-overlay0 hover:bg-background hover:text-subtext0
active:  (identical to primary)

size default: px-2.5 py-1 text-md
size sm:      px-2 py-0.5 text-md
```

Hand-rolled filled accent buttons also exist (settings/admin):
- Blue: `px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity`
- Mauve: `px-3 py-1.5 rounded-md bg-mauve text-background hover:bg-lavender border-none cursor-pointer disabled:opacity-50`

Two filled-hover idioms: blue dims (`hover:opacity-90`), mauve shifts hue
(`hover:bg-lavender`).

⚠️ There is no CSS reset for `<button>` — hand-rolled buttons explicitly carry
`bg-transparent border-none cursor-pointer`.

## Icon buttons (recipes, not a component)

```
standard:    p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors
dense row:   p-0.5 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors
no-bg hover: p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-text transition-colors
modal close: text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer
destructive: add hover:text-red (and optionally hover:bg-red/10)
```

Lucide icon sizes (use the `size={n}` prop, reserve `w-N h-N` for status dots
and hand-rolled SVGs):

| size | Where |
|---|---|
| 14 | default: modal close, header actions, toolbars |
| 13 | window-control buttons |
| 12 | inline row icons, menu items, copy buttons |
| 11 / 10 | dense badges, tool pills, footer hints |
| 16 | sidebar nav, back arrows, file rows |
| 18–22 | mobile only (bigger tap targets) |

## Select (native, styled)

```
appearance-none bg-surface0 text-text border border-surface1 rounded-md
px-2.5 py-1.5 pr-7 text-md outline-none transition-colors
focus:border-blue hover:border-overlay0
disabled:opacity-50 disabled:pointer-events-none
```
+ inline data-URI chevron (16px, right 6px center, stroke `#6c7086` = overlay0).

## Switch (Radix)

Track: `h-5 w-9 rounded-full border-2 border-transparent transition-colors
data-[state=checked]:bg-mauve data-[state=unchecked]:bg-surface1`.
Thumb: `h-4 w-4 rounded-full bg-background shadow-lg transition-transform
data-[state=checked]:translate-x-4`.

## Tooltip (Radix, portal)

```
z-[2000000050] max-w-[280px] rounded-md bg-crust border border-surface0
px-2.5 py-1.5 text-base text-text shadow-lg shadow-black/50
animate-in fade-in-0 zoom-in-95
```
`sideOffset={6}`. The huge z-index sits above floating chat windows (~2M) and
context menus (~2G) — see the z-ladder in [05-layout-spacing.md](05-layout-spacing.md).

## AutoTextarea

Auto-growing textarea (`minRows`/`maxRows`, default 1–6), Enter submits /
Shift+Enter newline, parent `onKeyDown` gets first dibs (autocomplete menus).
Always `resize-none`; visual styling comes from the caller (see form families
in [04-patterns.md](04-patterns.md)).

## ViewHeader — canonical panel header

```
container: flex items-center justify-between h-12 border-b border-surface0 shrink-0
title:     <h2 class="text-lg font-semibold text-text whitespace-nowrap">
subtitle:  <span class="text-md text-overlay0 truncate">
back btn:  flex items-center justify-center w-7 h-7 -ml-1 rounded text-overlay0
           hover:text-text hover:bg-surface0 transition-colors shrink-0  (+ ArrowLeft size 16)
actions:   flex items-center gap-1.5 shrink-0
```

## ViewTabs — underline tabs

```
container: flex gap-0 border-b border-surface0 shrink-0
tab:       px-3 py-2 text-md font-medium border-b-2 transition-colors cursor-pointer bg-transparent
active:    border-blue text-text
inactive:  border-transparent text-overlay0 hover:text-subtext0
```

## ErrorMessage

```
wrapper:        flex items-start gap-2 group
variant inline: text-red text-md                                   (default)
variant banner: px-3 py-2 text-red bg-red/10 border-b border-red/20 text-md
text:           flex-1 min-w-0 select-text break-words whitespace-pre-wrap
copy button:    shrink-0 p-0.5 text-red/50 hover:text-red transition-colors
                opacity-0 group-hover:opacity-100 mt-0.5   (Copy/Check size 12, 2s swap)
```
Convention: `banner` at the top of a panel/list; inline inside cards; pass
`className` for spacing/mono overrides.

## ToolPill

```
pill:    inline-flex items-center gap-1 bg-surface0 rounded-full px-2 py-0.5
         text-[10px] text-subtext0 cursor-default   (+ animate-pulse while running)
icon:    size={10} shrink-0; running → Loader2 size={10} animate-spin
elapsed: tabular-nums font-mono + (running ? text-blue : text-overlay0)
```
Wrapped in Tooltip (`side="top" max-w-[380px]`) showing input detail (mono
11px) and a 200-char result preview above a `border-t border-surface1`.

## TmuxPill — the peach/green convention in one place

```
base:      inline-flex items-center gap-1 rounded font-mono transition-colors shrink-0
size:      compact px-1 py-0.5 text-[10px] | default px-1.5 py-0.5 text-[11px]
active+claude: border-2 border-peach bg-peach/35 text-peach font-semibold shadow-sm shadow-peach/25
active+shell:  border-2 border-green bg-green/20 text-green font-semibold shadow-sm shadow-green/20
idle+claude:   border border-peach/40 bg-peach/15 text-peach hover:bg-peach/25 hover:border-peach/60
idle+shell:    border border-transparent bg-surface0 text-overlay1 hover:text-text hover:bg-surface1
running:   tmux-running-glow-peach | tmux-running-glow-green
           + dot: inline-block w-1.5 h-1.5 rounded-full animate-pulse bg-peach|bg-green
icon:      ClaudeLogo | Terminal, size 9 (compact) / 10
```

## Misc small primitives

- Count pill: `text-md text-overlay0 bg-surface0 px-1.5 py-0.5 rounded-full tabular-nums`
- kbd: `text-[10px] text-overlay0 border border-surface0 rounded px-1 py-0.5`
- Segmented control: group `inline-flex rounded-md border border-surface1
  overflow-hidden`; segment `px-2 py-1 text-md` + `border-l border-surface1`
  on non-first; on `bg-mauve text-background`, off `bg-surface0 text-overlay0
  hover:bg-surface1`.
- Sidebar nav item: `flex items-center gap-2 px-2.5 py-1.5 rounded-md text-lg
  font-medium transition-colors duration-150`; active `bg-background
  text-text`, inactive `text-overlay0 hover:bg-background hover:text-subtext0`.

## ⚠️ Do not use

`ui/card.tsx` is a dead shadcn stub (`bg-card`, `text-muted-foreground`, `p-6`)
with zero imports and tokens that don't exist in the theme. The real card idiom
is `bg-mantle border border-surface0 rounded-lg p-4` (or borderless
`bg-mantle rounded-lg p-4` in settings).
