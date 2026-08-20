# 06 — Motion

## Transitions

- **`transition-colors` is the near-universal transition** on anything
  interactive. Default duration (150ms) is assumed; explicit `duration-150`
  appears on nav items and window chrome.
- `transition-opacity` for filled-button hovers (`hover:opacity-90`) and
  reveal-on-hover.
- `transition-transform` for mobile press feedback and chevron rotation.
- Property-scoped for windows: `transition-[border-color,box-shadow]
  duration-150` — deliberately excludes geometry so drag/resize isn't animated.
- Slow (`duration-500`) only for gauge arcs and progress bars.

## Busy / live indicators

- **`<Loader2 size={10–16} className="animate-spin" />` is the only spinner.**
- `animate-pulse` marks "live/transitional": running tmux dots, reconnecting
  chips, active tool pills, `bg-yellow animate-pulse` connecting dots.
- Reveal-on-hover idiom: parent `group`, child
  `opacity-0 group-hover:opacity-100` (copy buttons, row actions).
- Tooltip entrance: `animate-in fade-in-0 zoom-in-95` (the only `animate-in`).

## Named keyframe classes (defined in globals.css)

### `claude-thinking`
Breathing peach border + soft outer glow on the Claude window while a turn is
in flight. Animates the element's own `border-color`/`box-shadow` (not a
pseudo-element) so it survives `overflow: hidden` and keeps the drop shadow:

```css
@keyframes claude-thinking {
  0%, 100% { border-color: color-mix(in srgb, var(--color-peach) 40%, transparent);
             box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5); }
  50%      { border-color: var(--color-peach);
             box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5),
                         0 0 14px 0 color-mix(in srgb, var(--color-peach) 45%, transparent); }
}
.claude-thinking { animation: claude-thinking 1.8s ease-in-out infinite; }
```

### `tmux-running-glow-peach` / `tmux-running-glow-green`
Pulsing halo on busy tmux badges (peach=claude, green=shell):

```css
@keyframes tmux-running-glow-peach {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-peach) 45%, transparent); }
  50%      { box-shadow: 0 0 8px 1px color-mix(in srgb, var(--color-peach) 55%, transparent); }
}
/* green variant: 40% / 55% */
.tmux-running-glow-peach { animation: tmux-running-glow-peach 1.6s ease-in-out infinite; }
```

### `genie-streaming-border`
Rotating conic mauve→blue gradient border for streaming responses, via a
registered `@property --genie-angle` and a masked ::before ring:

```css
@property --genie-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
@keyframes genie-border-spin { to { --genie-angle: 360deg; } }
.genie-streaming-border::before {
  inset: -1.5px; border-radius: 14px; padding: 1.5px;
  background: conic-gradient(from var(--genie-angle),
    transparent 40%, var(--color-mauve) 50%, var(--color-blue) 55%, transparent 65%);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  animation: genie-border-spin 2.5s linear infinite;
}
```

## Reduced motion

Every named keyframe class carries a `@media (prefers-reduced-motion: reduce)`
fallback in globals.css (animation off, static accent border where relevant).
JSX-level `animate-*` utilities are not guarded — but any **new** keyframe
class must follow the globals.css pattern and include a reduced-motion
fallback.
