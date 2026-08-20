# 01 — Tokens

Source of truth: the Tailwind v4 `@theme` block in `src/app/globals.css`.
Tokens become utilities automatically (`--color-mauve` → `bg-mauve`, `text-mauve`,
`border-mauve`; `--text-md` → `text-md`).

## Color palette — Catppuccin Mocha

**Note:** Catppuccin's "base" was renamed to `background` to avoid colliding with
Tailwind's `text-base` font-size utility. There is **no** `base`, `teal`,
`sapphire`, or `maroon` token (see [08-anti-patterns.md](08-anti-patterns.md)).

### Neutrals (dark → light)

| Token | Hex | Role |
|---|---|---|
| `crust` | `#11111b` | Deepest recess: log wells, tooltips, code blocks |
| `mantle` | `#181825` | Raised surfaces: modals, cards, floating windows, sidebar |
| `background` | `#1e1e2e` | App canvas / body background |
| `surface0` | `#313244` | Chip/input fills, hover fills, default borders |
| `surface1` | `#45475a` | Borders on surface0 fills, hover-up, scrollbar thumb |
| `surface2` | `#585b70` | Scrollbar thumb hover, blockquote border |
| `overlay0` | `#6c7086` | Muted labels, hints, idle icons — the most-used text color |
| `overlay1` | `#7f849c` | Slightly brighter muted (modal close buttons) |
| `subtext0` | `#a6adc8` | Secondary body text, window titles |
| `subtext1` | `#bac2de` | Between subtext0 and text (rare) |
| `text` | `#cdd6f4` | Primary text |

### Accents

| Token | Hex | Semantic (details in [02-color-semantics.md](02-color-semantics.md)) |
|---|---|---|
| `mauve` | `#cba6f7` | Genie brand, primary buttons, assistant identity |
| `lavender` | `#b4befe` | Hover state of mauve only |
| `blue` | `#89b4fa` | Focus, selection, info, links, SSH |
| `green` | `#a6e3a1` | Shell/tmux sessions, healthy, running, success |
| `yellow` | `#f9e2af` | Transitional, degraded, reconnecting |
| `red` | `#f38ba8` | Error, destructive, down |
| `peach` | `#fab387` | **Claude/Anthropic identity**; also warning tier in gauges (≥70%) |

## Type scale (custom, px-based — NOT default Tailwind)

Defined via `--text-*` variables. ⚠️ `text-md` (13px) is larger than
`text-base` (12px) — the opposite of standard Tailwind. Body default is 13px.

| Utility | Desktop | Mobile (`.mobile-fonts`) | Line height |
|---|---|---|---|
| `text-2xs` | 8px | 10px | 1.2 |
| `text-xs` | 10px | 12px | 1.4 |
| `text-sm` | 11px | 13px | 1.4 |
| `text-base` | 12px | 14px | 1.5 |
| `text-md` | **13px — the body/default size** | 15px | 1.5 |
| `text-lg` | 14px | 16px | 1.5 |
| `text-xl` | 15px | 17px | 1.5 |
| `text-2xl` | 16px | 18px | 1.4 |
| `text-3xl` | 18px | 20px | 1.4 |

Observed usage frequency: `text-md` ~1137×, `text-xs` 288×, `text-base` 96×,
`text-sm` 84×, `text-lg` 23×. When in doubt, use `text-md`.

Mobile sizes come from the `.mobile-fonts` wrapper class redefining the
variables +2px — components never pick per-surface sizes themselves
(see [07-mobile.md](07-mobile.md)).

## Fonts

```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
--font-mono: "SF Mono", "Fira Code", monospace;
```

- Body: `font-sans` at 13px on `bg-background` / `text-text`.
- `font-mono` for anything machine-flavored: hostnames, IPs, VM/tmux names,
  tokens/keys, log output, SQL, file paths, elapsed timers, diffs.
- Counters/durations/sizes pair mono with `tabular-nums` (a custom `@utility`
  setting `font-variant-numeric: tabular-nums`).

## Global body behavior

```css
body {
  font-family: var(--font-sans);
  font-size: 13px;
  background: var(--color-background);
  color: var(--color-text);
  overflow: hidden;      /* app shell scrolls per-panel, never the body */
  user-select: none;     /* ⚠️ selection is opt-in */
}
```

Because `user-select: none` is global, any copyable/technical text must
explicitly add `select-text` (often with `cursor-text`) — error messages, logs,
chat content all do this.

## Scrollbars

- Global: 6px, transparent gutter, thumb `surface1` → hover `surface2`.
- `scrollbar-thin` custom utility: 4px overlay scrollbar, thumb invisible until
  container hover. Use on internal scroll panes.
- Terminal (xterm) viewport: always-visible 10px thumb (`surface2` → hover
  `overlay0`).

## Custom utilities defined in globals.css

- `scrollbar-thin` — as above.
- `tabular-nums` — tabular numerals.
- `.chat-markdown` — full markdown styling for chat bubbles (code on
  `surface0`, links `blue` underlined, table borders `surface1`, zebra rows
  `mantle`, blockquote border `surface2` + `subtext0` text).
- `.chat-message-content` — `select-text` + `cursor-text` for plain bubbles.
- Named animation classes — see [06-motion.md](06-motion.md).
