# The model in the window: a trial

Research, 2026-11-16. Step 3 of
[ADR 0135](../adr/0135-every-pane-behaves-by-the-same-laws-and-one-short-table.md):
what it costs to run the engine's own model of the workspaces in the
window, compiled to WebAssembly, in place of the window's copy in
TypeScript (ADR 0088, decision 11, "T1"). It is evidence, with its limits
said; nothing in the product changed.

## The answer

It works, and it is cheap to run. The model's own source files, built for
`wasm32-unknown-unknown` with no line of them changed, gave the engine's
answer on every step of every golden trace.

| What | Measured |
|---|---|
| Steps replayed, of the 21 traces | 354, of them 71 refused |
| Steps with the engine's answer and arrangement, or its refusal's code | 354 |
| One command, with JSON in and out, in Node | 0.07 ms |
| The `.wasm` file, built for size | 406 KB; 134 KB gzipped |
| The window's copy it would replace | `arrangement.ts`, 1,617 lines, 56 KB of source |

A key has 16 ms (ADR 0088): a command through the model takes under a
hundredth of that.

## How it was tried

A crate of its own, outside the repository, took in by path, unchanged:
`platform/workspaces/engine/src/model.rs`, `placing.rs` and `commands.rs`,
of the branch of ADR 0135's step 2 (`a9dd8447`). Beside them stood what
they name of other crates, cut down to it:

- of the kernel: the IDs (`ids.rs`), `Refusal` and `Code` (the head of
  `error.rs`), `Wall` and `decode`;
- of `banda-look`: `columns::Display` and `columns::share`;
- of `tiling.rs`: the rule's types, `Opens`, `Front`, `When` and `Rule`,
  without the file's reader.

One function was added: a command with its arrangement, facts and seed as
JSON in, the answer and the arrangement after, or the refusal, as JSON
out. [`replay.mjs`](2026-11-16-the-model-in-the-window/replay.mjs) loads
the file in Node and runs every step of
`platform/workspaces/traces/` through it, comparing as `parity.test.ts`
compares the copy.

## What stands in the way, and how big each is

None of it is in the model. Each is a border to draw.

1. **The kernel does not build for the browser.** It holds the server,
   SQLite, the network and Tokio. The model needs five small things of
   it, and they need a home a leaf crate can depend on.
2. **The IDs know SQLite.** The `id!` macro gives every ID its reading
   and writing for `rusqlite`. For the trial those two `impl`s were cut
   out. In the product they go behind a feature, or to the kernel beside
   the macro's use.
3. **The rule's types live with the file's reader.** `tiling.rs` holds
   both `Opens`, `When`, `Rule` and the reading of `tiling.toml`, which
   needs `banda-look` whole. The types move to the model's crate; the
   reader stays.
4. **`Facts` and `Flow` are written, never read.** The engine only sends
   them. The window must hand them in, so they gain `Deserialize`.
5. **A new ID by the clock.** `uuid` asks for a source of randomness in
   the browser, and brings `wasm-bindgen`'s imports with it. The model
   makes every ID from its command's seed (v5) and needs none: the IDs'
   `new()` goes behind the same feature as SQLite.
6. **The build.** `cargo build --target wasm32-unknown-unknown` for one
   crate, before the window's tests and its build; the target on each
   machine and in CI. The page's policy lets WebAssembly run already
   (`script-src 'wasm-unsafe-eval'`, `client/desktop/src/os-window/page.ts`).

## What it would change

- `arrangement.ts` goes, and with it the rule that every change to the
  model is written twice. `parity.test.ts` becomes the test that the
  window's file is the engine's code.
- `model.ts`, `arrange.ts` and `unheard.ts` stay: they are the window's
  view and its drawing ahead, and call the model where they call the copy
  today (`arranged.ts`, `unheard.ts`, `opening.ts`, `useMoving.ts`,
  `actions.ts`, `arrange.ts`, `useTiling.ts` import it).
- The rule of ADR 0135's step 4, what a change does to the view, can be
  written once, in the model's crate, and run by the window on its own
  view.

## Not measured

- The file's size in a browser's cache and its start: the page loads it
  once; how long a phone takes to compile 406 KB was not tried.
- The time in the page, with the arrangement passed as JSON on each
  command. Node's 0.07 ms says it is far from the budget; the page was
  not timed.
- The work in days. By the list above: one crate to cut out (a move of
  three files and four types), one feature in the kernel's IDs, two
  derives, the build's step, the loader, and the window's seven callers.

## The order it suggests

1. The model's crate: `model.rs`, `placing.rs`, `commands.rs` and the
   rule's types, a leaf; the engine's crate uses it. No behaviour changes.
2. The build and the loader, with `parity.test.ts` run through the
   WebAssembly file beside the copy.
3. The window calls the model; `arrangement.ts` goes.
4. ADR 0135's step 4, the view's rule, written once.
