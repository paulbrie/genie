# Custom terminal renderer (Phase 2)

A self-contained VT100/VT500 terminal emulator + renderer for genie, built to
render full TUIs (Claude Code, vim, htop) — not just streaming chat output as
Phase 1 did. Owned in-tree so we control theming, custom UX (hyperlinks,
shell-integration blocks), bundle size, and don't depend on xterm.js.

## Architecture

```
genie:terminal:data ─▶ VtParser ──▶ Grid ──▶ React renderer (custom-terminal.tsx)
   (PTY output)        (vt-parser)  (grid)     per-row memoised, virtualised
                          │            │
                          │            └─▶ responder ─▶ wsSend("terminal:data")  (DA/DSR)
   key/mouse/paste ──▶ input.ts ──▶ wsSend("terminal:data")
   resize          ──────────────▶ grid.resize + wsSend("terminal:resize")
```

| File          | Responsibility |
|---------------|----------------|
| `terminal.ts` | The `Terminal` performer interface (byte-intent → screen mutation). |
| `vt-parser.ts`| VT500 state machine. ESC/CSI/OSC/DCS, params, UTF-8 + surrogate chunk safety, char-width table. Drives a `Terminal`. |
| `grid.ts`     | `Grid` — rows×cols cell model. Primary + alt buffers, scrollback ring, absolute cursor, scroll regions, SGR (256/true-colour), DEC modes, charsets, reflow, device reports. |
| `input.ts`    | Pure key/mouse/paste/focus → byte encoders, mode-aware. |
| `*.test.ts`   | Unit + conformance tests (57 cases). |

The React component (`../../components/terminal/custom-terminal.tsx`) wires the
WS data stream to the parser, renders the grid snapshot, and forwards input.

## Milestone status

- **M0 — Safety nets**: vitest harness, `Grid.toText()` snapshots, UTF-8/surrogate chunk safety. ✅
- **M1 — Grid core**: 2D grid, alt-screen, scroll regions, cursor, erase/insert/delete, SGR true-colour. ✅
- **M2 — Parser**: VT500 state machine, charsets, DA/DSR responses. ✅
- **M3 — Resize + reflow**: cell metrics + ResizeObserver → `grid.resize` + `terminal:resize`; soft-wrap reflow. ✅
- **M4 — Input + modes**: app cursor keys, bracketed paste, SGR mouse, focus events, modifiers, F-keys. ✅
- **M5 — Unicode**: wide-char + combining-mark handling. ✅ (full wcwidth table is a follow-up)
- **M6 — Virtualization**: renders only the visible window + overscan. ✅
- **M7 — Custom UX**: OSC 8 hyperlinks (rendered as `<a>`), OSC 133 shell-integration marks recorded on the grid. ✅
  - Follow-ups: selection model, URL/path auto-linkify, block collapse / "explain this output" built on shell marks, configurable themes.
- **M8 — Conformance + cutover**: synthetic full-screen TUI conformance test present. **Cutover deliberately not automated** — see below.

## Cutover plan (manual — needs a human call)

The custom renderer is already selectable per-tab (`tab.renderer === "custom"`,
see `terminal-window.tsx`). To make it the default and eventually drop xterm:

1. Capture real fixtures (Claude Code, vim, htop, lazygit) and diff custom vs
   xterm side-by-side using the existing debug split.
2. Flip the default `tab.renderer` to `"custom"` behind a setting; soak.
3. Once at parity, remove the xterm dependency (`@xterm/*`) and
   `terminal-bridge.ts`.

Not done automatically because it's a user-facing behaviour change and removing
the xterm dependency is hard to walk back.

## Known limitations / follow-ups

- Reflow re-anchors the cursor best-effort; deep edge cases (wide char exactly
  on the wrap boundary mid-edit) may shift by a cell.
- Char width uses a coarse range table, not the full Unicode wcwidth/emoji-ZWJ
  tables.
- SGR colon-subparam true-colour (`38:2::r:g:b`) is treated like the semicolon
  form; the empty colour-space slot isn't special-cased.
- OSC 52 (clipboard) and DCS bodies are consumed but not acted on.
