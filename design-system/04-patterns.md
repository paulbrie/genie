# 04 — Composite patterns

Recipes assembled from tokens + primitives. Class strings are verbatim from the
codebase — copy them.

## Modals

### A. Overlay + centered fixed panel (the dominant form)

Two **sibling** elements (not a flex-centering wrapper):

```html
<div class="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
<div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            w-[440px] max-w-[92vw] bg-mantle border border-surface0
            rounded-lg shadow-xl z-50 flex flex-col overflow-hidden">
```

Invariants: `bg-mantle` + `border border-surface0` + `rounded-lg` +
`shadow-xl` + `flex flex-col`; fixed px width paired with `max-w-[9Xvw]`
(add `max-h-[80vh]` for scrolling bodies); overlay z is always exactly one
below panel z (40/50, 60/61, 200/201).

**Header** (byte-identical across ~15 modals):
```html
<div class="flex items-center gap-2 px-4 py-3 border-b border-surface0">
  <Icon size={14} class="text-blue" />              <!-- or text-mauve / text-red -->
  <span class="text-text font-medium text-md">Title</span>
  <div class="flex-1" />
  <button class="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer">
    <X size={14} />
  </button>
</div>
```

**Body:** `flex flex-col gap-3 px-4 py-3`
**Footer:** `flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0`
(destructive dialogs add `bg-background/30`).

### B. Flex-centering wrapper (dialogs with role="dialog")

```html
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
  <div role="dialog" class="bg-mantle border border-surface0 rounded-lg w-[340px] p-4 flex flex-col gap-3"
       onClick={e => e.stopPropagation()}>
```

### C. Destructive confirm

Portal'd, red-tinted chrome, backdrop blur:
```
overlay: fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm
panel:   w-full max-w-md mx-4 bg-mantle border border-red/40 rounded-lg
         shadow-2xl shadow-red/20 overflow-hidden
header:  <AlertTriangle size={16} class="text-red shrink-0" />
```
Inline error box inside dialogs: `flex items-start gap-2 px-2.5 py-2 rounded
bg-red/10 border border-red/30`.

## Panels (full views)

Shell: `flex-1 flex flex-col px-5 pb-5 overflow-hidden` (add
`overflow-y-auto` variant for scrolling panels). Header is `<ViewHeader>`
(h-12, border-b) — see 03. Title band variant: `px-5 py-4 border-b
border-surface0` with `text-xl font-semibold text-text`.

**Settings card** (inside panels):
```
card:    bg-mantle rounded-lg p-4      (siblings add mt-4; dense variant p-3)
label:   block text-md font-medium text-subtext0 mb-2
suffix:  <span class="ml-2 text-md text-overlay0 font-normal">Global default</span>
hint:    text-md text-overlay0 mt-2
success: text-md text-green mt-2       ("Saved")
```

**Card grid:**
```
grid:  grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3
card:  flex flex-col gap-2 p-4 rounded-lg text-left transition-colors cursor-pointer
       bg-mantle border border-surface0 hover:border-blue/50 hover:bg-surface0/50
```
Note hover shifts the border to blue as well as the fill.

## Bottom drawer

```
container: fixed left-0 right-0 bottom-0 z-50 flex flex-col bg-mantle
           border-t border-surface0 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]
drag grip: h-2 shrink-0 cursor-ns-resize flex items-center justify-center
           hover:bg-surface0 transition-colors group
           + <GripHorizontal size={14} class="text-overlay0 group-hover:text-subtext0" />
header:    flex items-center justify-between px-3 py-1.5 border-b border-surface0 shrink-0
           + <h2 class="text-md font-semibold text-text"> + count pill
split:     flex-1 flex min-h-0 ; left flex-1 min-w-0 border-r border-surface0 ;
           right inspector w-[40%] min-w-[280px] max-w-[50%] shrink-0
statusbar: px-3 py-1 border-t border-surface0 text-md text-overlay0 shrink-0
```

## Floating windows

Draggable/resizable windows over the app (terminal, VM popups, Claude chat,
assistant, build logs). Canonical chrome:

```js
cn(
  "fixed bg-mantle border flex flex-col transition-[border-color,box-shadow] duration-150 overflow-hidden",
  maximized ? "rounded-none" : "rounded-xl",
  isFocused
    ? "border-blue/60 shadow-2xl shadow-blue/20"      // generic windows
    : "border-surface0 shadow-2xl shadow-black/50",
)
```

- **Claude windows swap blue for peach:** focused `border-peach/70
  shadow-peach/20`, unfocused `border-peach/30 shadow-black/50`, plus the
  `claude-thinking` class while loading.
- Neutral windows (assistant, build log): `border border-surface0 shadow-2xl
  shadow-black/50 rounded-xl`.
- The transition is property-scoped (`transition-[border-color,box-shadow]`)
  so drag/resize geometry is never animated.

**Title bar** (drag handle):
```
flex items-center justify-between px-3 py-2 border-b border-surface0
cursor-grab active:cursor-grabbing select-none shrink-0
title: text-md font-semibold text-subtext0
subtitle suffix: <span class="text-overlay0 font-normal"> · {subtitle}</span>
```
Window controls, always in order Minimize (Minus) → Maximize
(Maximize2/Minimize2) → Close (X), each:
`p-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors`
with `size={13}` icons; Close overrides to `hover:text-red hover:bg-red/10`.

**Resize grip** (bottom-right):
```html
<div onPointerDown={...} class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" style="touch-action:none">
  <svg width="16" height="16" viewBox="0 0 16 16" class="text-overlay0/50">
    <path d="M14 14L8 14L14 8Z" fill="currentColor" />
    <path d="M14 14L11 14L14 11Z" fill="currentColor" opacity="0.5" />
  </svg>
</div>
```

Maximized: `{ left:0, top:0, width:"100vw", height:"100vh" }` + `rounded-none`,
drag disabled. Minimized windows collect in a taskbar:
```
bar:  shrink-0 bg-mantle border-t border-surface0 px-3 py-1.5 flex items-center gap-2
item: flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface0 hover:bg-surface1
      text-md text-subtext0 transition-colors
```

## Forms

No `<Input>` primitive — inputs are hand-written in two families:

**Family A — dialogs/forms (mauve focus, surface0 fill):**
```
bg-surface0 border border-surface1 rounded-md px-2.5 py-1.5 text-md text-text
placeholder:text-overlay0 outline-none focus:border-mauve
```

**Family B — settings/admin/mono values (blue focus, background/crust fill):**
```
w-full bg-background text-text border border-surface0 rounded-md px-3 py-2
text-md outline-none focus:border-blue font-mono
```

**Family C — ring focus (feedback/DB query boxes):**
```
bg-surface0 text-text rounded px-2.5 py-1.5 outline-none
focus:ring-1 focus:ring-mauve text-md border-none
```

Universal rules:
- Placeholder is **always** `placeholder:text-overlay0`.
- `outline-none` always paired with a focus border or ring.
- Textareas: `resize-none` (composers) or `resize-y min-h-[Npx] max-h-[Npx]`.
- `font-mono` for tokens/keys/hosts/SQL.
- Field wrapper `flex flex-col gap-1`; label `text-md text-overlay1` (modals)
  or `text-md text-subtext0`, settings label `block text-md font-medium
  text-subtext0 mb-2`.

## Lists, rows, tables

- **No zebra striping** (except markdown-rendered tables). Rows separate with
  `border-b border-surface0/50` or `divide-y divide-surface0`.
- Row hover, two tiers: full `hover:bg-surface0` (nav/menu/file rows) vs
  subtle `hover:bg-surface0/50` or `/30` (data/table rows).
- Selected row: opaque `bg-surface0` (contrasts with translucent hover).
- Active nav row: `bg-background text-text` (recessed), inactive
  `text-overlay0 hover:bg-background hover:text-subtext0`.
- Table markup: `<thead class="text-subtext0 text-left sticky top-0 bg-background">`,
  header row `border-b border-surface0`, `<th class="py-2 pr-3 font-normal">`
  (headers are **font-normal**, not bold), `<td class="py-1.5 pr-3
  text-subtext0 tabular-nums">`. Grid-style headers alternatively use
  `font-bold uppercase tracking-wide text-overlay0 sticky top-0 bg-background`.
- Uppercase section labels: `text-xs uppercase tracking-wide text-overlay0`
  (10–11px variants with `text-[10px]`/`text-[11px]` in dense spots).

## Menus

Context/action menus portal at extreme z (see 05): panel `rounded-md` on
`bg-mantle`/`bg-surface0`, `border border-overlay0/30`, dividers
`border-overlay0/15`, `shadow-lg`; items `px-2.5 py-1.5 text-md` +
`hover:bg-surface0`, icons `size={12}`.

## Chat bubbles

- Markdown content renders inside `.chat-markdown` (see 01).
- Bubble tail idiom: `rounded-lg` with one corner flattened, e.g.
  `rounded-bl-sm` for incoming.
- Error bubble: `max-w-[90%] px-2.5 py-2 rounded-lg rounded-bl-sm text-md
  bg-red/10 text-red border border-red/20`; title `font-medium`, detail
  `text-red/90`, hint `text-[11px] text-red/70`, retry chip `px-2 py-0.5
  rounded bg-red/20 hover:bg-red/30 text-red text-[11px] font-medium`.

## Empty, loading, and error states

1. **Terse centered text** (default): `flex items-center justify-center h-full
   text-md text-overlay0` or `px-3 py-6 text-center text-overlay0 text-md`.
2. **Icon + copy stack:** `flex flex-col items-center justify-center py-16
   text-overlay0 gap-2` + a lucide icon `size={24–28}` at `opacity-40/50` +
   one-line `<p>`.
3. **Dashed call-to-action box:** `text-md text-overlay0 border border-dashed
   border-surface0 rounded-lg px-4 py-8 text-center`, with the actionable noun
   highlighted `<span class="text-text">New server</span>`.
4. **Loading:** same shapes with `<Loader2 size={13–16} class="animate-spin" />`
   before the text.
5. **Errors:** use `ErrorMessage` (banner at panel top, inline in cards) — see 03.

Remember `select-text` on any copyable output (body is `user-select: none`).
