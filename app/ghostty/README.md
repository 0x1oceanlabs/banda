# @bandaso/ghostty

A terminal drawn by Ghostty on a canvas, for the window's terminals. It is
T3 Code's browser adapter over the official `libghostty-vt` C ABI compiled
to WebAssembly, vendored as it is, so a newer pin is a copy.

## Where it comes from

| What | From | Licence |
|---|---|---|
| `src/t3/*.ts`, `src/t3/vendor/*.wasm` | T3 Code, `apps/web/src/terminal/ghostty/` at commit `15fe2832727893cbdd2214383f9f971474849695` (2026-10-31), github.com/pingdotgg/t3code | MIT, `LICENSE-T3` |
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

Only import paths, so the files find each other here, and the tests import
`vitest` instead of T3's `vite-plus/test`. T3's tests of its own terminal
drawer are not brought: they test T3's transport, not the adapter.

`src/index.ts` is Bandaso's: it names what the window uses.
