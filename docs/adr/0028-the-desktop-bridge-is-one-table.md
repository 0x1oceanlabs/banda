---
status: accepted
date: 2026-11-02
---

# The desktop bridge is one table

The page reaches Electron's main process through `window.banda` (ADR 0005,
ADR 0020). Each thing it can ask is written three times:

- its type, in `Host` (`app/web/src/host.ts`) and `BrowserHost`
  (`modules/browser/pane/src/desktop.ts`);
- its wiring, in `app/desktop/src/preload.ts`: a channel name and
  `ipcRenderer.invoke`, `send` or `on`;
- its handler, in `app/desktop/src/main.ts`: the same name again, and a
  `Schema` for its arguments.

In git the three change together in almost every commit that touches one
of them. There are about 25 channels, named two ways (`browser.tabs` next
to `notify:show`). What main sends the page (`look`, `menu:open`,
`notify:answer`, `browser:news`) is typed nowhere in main. A channel
misspelt on one side shows only when it is called. And `main.ts` names
the browser's channels one by one, though they are the browser module's:
its `module.toml` holds the `desktop-main` unstable mark for it (ADR
0022, decision 6).

Issue #161, from the architecture review of 2026-11-02 (#168).

**Decision.**

1. **One table names every channel, by where it sits on `window.banda`.**
   - `BRIDGE` in `app/web/src/host.ts` is a plain object: each leaf says
     what the page does with it, `invoke<[args], Reply>()`, `send<[args]>()`
     or `push<Value>()`, and its words are the method's documentation.
   - A channel's name is its path: `settings.set`, `look.listen`.
     `bridge(table)` writes each leaf's name once, so there is no other
     name to keep in step.
   - `Host` is derived from `BRIDGE`, so the page's API stays as it is
     and nothing that calls `window.banda` changes.
   - The table is types and names, without Effect (ADR 0020, decision 1).
     Its helpers are in `@banda/contract/bridge`.

2. **The preload builds `window.banda` from the table.** It walks
   `BRIDGE` and makes each leaf an `ipcRenderer.invoke`, `send`, or a
   `listen` that returns how to stop. A key main took from a browser page
   comes on a `push` leaf too, which the preload hears itself and presses
   in the window. Only the extensions' buttons stay written by hand:
   electron-chrome-extensions answers them on channels of its own.

3. **Main answers by the table's names, checked by the compiler.**
   - `serve(runtime, fromPage, BRIDGE, answers)` takes one answer per
     `invoke` and `send` leaf, nested as the table: a missing, extra or
     misspelt one does not compile, and each answer's `Schema` must decode
     to the table's argument types.
   - Main tells the page through `tellPage(contents, leaf, value)`, which
     takes only a `push` leaf and its value's type.

4. **A module brings its part of the table and of main.**
   - The browser's leaves are `BROWSER_BRIDGE`, in its
     `modules/browser/pane/src/desktop.ts`, which `BRIDGE` takes in under
     `browser`.
   - Its answers come with its part in main (below), and main puts them
     under `browser` without naming its channels.
   - The browser's main-process code (`browser.ts`, `cdp.ts`, `tabs.ts`,
     `extensions.ts`, `popup.ts`, `blocker.ts`) moves into the module, as
     `modules/browser/desktop`, with its layer and its answers.
   - What a module's main-process part may use of main is
     `@banda/desktop-kit` (`app/desktop-kit`): the window, the look, the
     settings and the engine as services' tags, the dialogs, the errors,
     and `serve`'s and `tellPage`'s types. Main gives their layers; a
     module needs no part of main, and main none of the module but its
     part.
   - `app/desktop/src/modules.ts` is the one file in main that names a
     module, as `app/web/src/modules.ts` is in the page. Then `main.ts`
     names none, and the `desktop-main` mark goes. The preload keeps a
     narrower mark: the extensions' buttons it calls by hand.

5. **The channels that write a setting stay.** `sidebar.preset`,
   `browser.tabs` and `browser.pin` each check or edit what
   `settings.set` cannot (a preset that exists, a list of pins), and each
   writes through `Settings`.

**Plan.** Each step is its own PR, and `scripts/check.sh` passes after
each.

1. `@banda/contract/bridge`; `BRIDGE` and `BROWSER_BRIDGE`; `Host` and
   `BrowserHost` derived from them; the preload built from the table;
   `serve` and `tellPage` in main, and every channel moved to them. The
   page does not change.
2. `@banda/desktop-kit`; the browser's main-process code in
   `modules/browser/desktop`, with its layer and answers;
   `app/desktop/src/modules.ts`; `main.ts` names no module; the
   `desktop-main` mark goes.

**Consequences.**

- A new channel is one line in a table and one handler; the compiler
  says what is missing.
- `main.ts` stops growing with each module's channels.
- The channels' names change once, to their paths. Only main and the
  preload use them, and they ship together.
