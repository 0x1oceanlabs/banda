# @banda/ghostty

A terminal drawn by Ghostty on a canvas, for the window's terminals. It is
T3 Code's browser adapter over the official `libghostty-vt` C ABI compiled
to WebAssembly, vendored as it is, so a newer pin is a copy.

## Where it comes from

| What | From | Licence |
|---|---|---|
| `src/t3/*.ts`, `src/t3/vendor/*.wasm` | T3 Code, `apps/web/src/terminal/ghostty/` at commit `87f3d93deae017e8a3b0fbf03878e47f089442bc` (2026-11-04), github.com/pingdotgg/t3code | MIT, `LICENSE-T3` |
| `src/t3/lib/terminal-links.ts`, `src/t3/lib/observeResize.ts` | the same commit, `apps/web/src/terminal-links.ts`, `apps/web/src/lib/observeResize.ts` | MIT, `LICENSE-T3` |
| `src/t3/lib/shared.ts` | the same commit, cut unchanged from `packages/shared/src/keybindings.ts`, `apps/web/src/lib/selectionActions.ts` and `apps/web/src/appearanceFonts.ts` | MIT, `LICENSE-T3` |
| `src/t3/fonts/` | Symbols Nerd Font Mono, as T3 vendors it | MIT, `src/t3/fonts/LICENSE` |
| `native/` | Ghostty's `libghostty-vt` at `9f62873bf195e4d8a762d768a1405a5f2f7b1697` (`VERSION`), the key header the tests check against, and T3's build script | MIT, `native/LICENSE-GHOSTTY` |

`ghostty-vt.wasm` (630,932 bytes, sha256 `51b016a6…267629`) and
`ghostty-write-pty.wasm` (112 bytes, sha256 `75cb147e…d903`) are T3's
committed builds. `native/build-libghostty-wasm.sh` rebuilds them with Zig
0.15.2 from the pinned Ghostty; the ABI test checks the revision the WASM
embeds against `native/VERSION`.

## What changed

Import paths, so the files find each other here, and the tests import
`vitest` instead of T3's `vite-plus/test`. And these changes, marked
`Banda:` in `src/t3/`, that a newer pin keeps by hand:

- the canvas has alpha, and the default background is left clear rather
  than filled, so the Pane's tile shows through it (ADR 0023);
- a row is whole screen pixels tall and starts on a screen pixel's edge, at
  any scale, and a row's redraw clears its whole width: at a scale such as
  1.6 a row shared half a pixel with the next, and a cursor that left a row
  stayed there as a line (`src/pixels.test.ts`);
- the font takes `ligatures`, and with it false the canvas draws each
  letter on its own (`textRendering`), as `terminal.toml` says (ADR 0047);
- the surface takes a `cursor`, and `setCursor`: Ghostty's own default
  cursor (options 22 and 23), which a reset and DECSCUSR 0 come back to,
  and not only its blink;
- box-drawing, block and braille glyphs are drawn from the cell's own
  edges (`src/glyphs.ts`, Banda's), and each cell's edges, behind its
  background too, are on screen pixels (ADR 0047, decision 3).
- the surface takes a `linkTitle`: a link under the pointer shows it as
  the canvas's tooltip;
- `linkTextAt` names the link at a point, for the terminal's menu;
- the surface takes a `clock`, the host's, to ask for the tick it draws
  in: the window's, so the screen ticks with all else that moves (ADR
  0088, decision 3);
- hidden (`setVisible(false)`), the surface still takes its grid as its
  mount's size changes, and tells the PTY, but neither sizes its canvas
  nor draws: a terminal whose Tile is hidden keeps the size it would have
  shown; shown again, it draws at once the rows that changed meanwhile,
  over what its canvas kept, not the whole screen, and nothing if nothing
  changed (ADR 0088, decision 4);
- the surface takes `sized`, the host's word that its mount has a new
  size or the screen a new scale, instead of its own `observeResize` of
  the mount and watch of the screen's scale: the window's Tile says so,
  through its resize gate, without React's `flushSync` (ADR 0088, decision
  5); T3's observer stays for a host that says nothing;
- the core reads libghostty-vt's dirty rows into typed arrays, the
  snapshot's `grid`: a code point, two colours and a style for each cell,
  a hash for each row, and no object per cell; its foreground is asked
  for only where the style sets one (`src/grid.test.ts` checks it against
  a read of every value on its own, as T3's was);
- the scrollbar is written only where what it shows changed;
- the renderer is a `GhosttyRenderer`, which keeps what each row of the
  canvas shows: a frame draws only the rows whose cells, cursor or
  hovered link differ from it, and a screen that scrolled moves its
  pixels by the rows it scrolled, on screen pixels, and draws only the
  rows that came in. That holds where rows draw alike, at a scale of 1
  or 2 (`rowsDrawAlike`); at 1.25, 1.5 or 1.6, and while a glyph that
  stands past its row may be on the canvas, a diagonal's or a block
  cursor's, it draws as T3's did. A canvas whose context was lost and
  restored draws every row again (`src/renderer.test.ts`;
  `e2e/terminal-pixels.spec.ts` compares a build's pixels with main's)
  (ADR 0088, step P4).

T3's tests of its own terminal drawer are not brought: they test T3's
transport, not the adapter. `tools/pixel-fuzz/run.mjs` fuzzes the
renderer against another checkout's, pixel for pixel, at every scale; its
first lines say how.

`src/index.ts` is Banda's: it names what the window uses.
