# 02 — Color semantics

Colors carry meaning consistently across desktop and mobile. Do not repurpose
an accent for something outside its lane.

## Accent meanings

### `mauve` — Genie brand / primary action
- Brand wordmark in the sidebar (`text-xl font-semibold text-mauve`).
- Primary buttons (`bg-mauve text-background`, hover → `lavender`).
- Genie Assistant identity (Bot icon), folder icons, superadmin role.
- Switch checked state (`data-[state=checked]:bg-mauve`).
- Form focus in dialogs (`focus:border-mauve`).

### `lavender` — hover state of mauve, nothing else
Only appears as `hover:bg-lavender hover:border-lavender` on mauve buttons.
Never use it as a standalone accent.

### `peach` — Claude / Anthropic identity
The strongest convention in the app. Anything that *is* Claude gets peach:
- Claude floating-window chrome: `border-peach/70 shadow-peach/20` (focused),
  `border-peach/30` (unfocused), `claude-thinking` breathing border while a
  turn is in flight.
- Claude tmux pills (active: `border-2 border-peach bg-peach/35 text-peach`),
  the `tmux-running-glow-peach` halo.
- Claude composer accents, mobile Claude tiles/banners (`bg-peach/10
  border-peach/20`), empty-state icon badges (`bg-peach/15 text-peach`).
- Secondary meaning: the mid "warning" tier in circular gauges (≥70% peach,
  ≥90% red).

### `green` — shell/tmux session + healthy/running/success
- Shell (non-Claude) tmux pills (active: `border-2 border-green bg-green/20
  text-green`), `tmux-running-glow-green`.
- Terminal-window icon, "manager running" dot with glow:
  `bg-green shadow-[0_0_4px_var(--color-green)]`.
- Connected tunnel dots, Docker "running", WS **received** direction, "Saved"
  confirmations (`text-md text-green`).

### `blue` — focus / selection / info / links / SSH
- Focused generic floating windows: `border-blue/60 shadow-2xl shadow-blue/20`.
- Form focus in settings/admin (`focus:border-blue`), active tab underline
  (`border-blue`), links (`text-blue`, markdown `a`).
- Unread/mention dots, WS **sent** direction, running elapsed timers, mobile
  SSH tile, card hover borders (`hover:border-blue/50`).

### `yellow` — transitional / degraded / partial
- "Connecting" dots (`bg-yellow animate-pulse`), "Reconnecting" chips,
  Docker "some running", pod STARTING.

### `red` — error / destructive / down
- ErrorMessage and error bubbles (`text-red`, `bg-red/10`, `border-red/20`).
- Destructive confirm chrome (`border-red/40 shadow-red/20`), danger buttons,
  close/delete icon hovers (`hover:text-red`, `hover:bg-red/10`).
- Docker exited/dead, tunnel disconnected, gauge ≥90%.

## Neutral ladders

**Text (bright → dim):** `text` → `subtext1` (rare) → `subtext0` (secondary,
window titles) → `overlay1` (modal close idle) → `overlay0` (hints, labels,
idle icons — the most common muted color).

**Surfaces (deep → raised):** `crust` (log wells, tooltips, code) → `mantle`
(modals, cards, windows, sidebar, drawers) → `background` (app canvas — note
it sits *between* mantle and surface0 in lightness) → `surface0` (chips,
inputs, hovers) → `surface1` → `surface2`.

Quirk worth knowing: active sidebar-nav rows use `bg-background` (darker than
the `bg-mantle` sidebar), i.e. "active = recessed", and ghost-button hover is
also `hover:bg-background`.

## Status dot palette (canonical mappings)

Dot shape: `w-2 h-2 rounded-full shrink-0` (dense inline: `w-1.5 h-1.5`).

| State | Classes |
|---|---|
| healthy / running / connected | `bg-green` |
| connecting / starting / degraded / partial | `bg-yellow animate-pulse` (pulse for in-progress, static for degraded) |
| down / exited / disconnected / terminated | `bg-red` |
| stopped / unknown / idle | `bg-overlay0` |
| "live" emphasis | add glow `shadow-[0_0_4px_var(--color-green)]` |

## Tinted badge formula

`bg-{color}/15 text-{color}` (use `/20` for a stronger read), optionally
`border border-{color}/30`. Examples in the wild: `bg-red/15 text-red border
border-red/30`, `bg-blue/15 text-blue`, `bg-peach/15 text-peach`. Semantic
*borders* always use an alpha step (`border-red/30`, `border-peach/40`) —
never a full-strength accent border except the active tmux pill (`border-2
border-peach`).
