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
  0088, decision 3).

T3's tests of its own terminal drawer are not brought: they test T3's
transport, not the adapter.

`src/index.ts` is Banda's: it names what the window uses.
