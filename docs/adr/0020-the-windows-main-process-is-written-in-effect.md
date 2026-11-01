---
status: accepted
date: 2026-11-01
---

# The window's main process is written in Effect

The desktop window's main process (`app/desktop/src`) is 1,700 lines of
TypeScript in a dozen files. It runs two programs as its children (the
engine, `banda serve --with-parent`, and the look, `banda look --follow`),
keeps the settings files, the browser's profile, its extensions and their
popups, the desktop notices, and answers 17 IPC channels from the page.
ADR 0013, step 4, adds the biggest part yet: a CDP endpoint that many
clients reach over WebSockets, each attached to tabs through
`webContents.debugger`.

What that costs as it is written now:

- **Each child process is supervised by hand.** `EngineProcess` and
  `LookProcess` each keep their own child, waiters, back-off, "stopping"
  flag and kill timer, the same forty lines twice, with no test.
- **A wait has no end of its own.** `#create` in `extensions.ts` keeps a
  map of resolvers and a 10 s timer; `first(within)` in `look.ts` a
  listener and a timer; `stop()` in `engine.ts` another timer. Each clears
  what it made in its own way, and a leak shows only as a page that never
  answers.
- **Input from the page is checked by hand.** `isBox`, `typeof` tests and
  URL prefixes, one per channel, and some channels check nothing. The CDP
  endpoint brings input from any program on the machine that has its
  token.
- **Errors are strings.** A handler that fails throws, and the page gets
  Electron's text of it; nothing says which failures a channel can have.

The CDP endpoint makes each of these worse: a client that leaves must
detach the debugger from every tab it drove, close its socket and remove
the Agent's mark, whatever it was doing.

Effect is a TypeScript library for exactly this: services built as
layers, resources that are released when their scope closes, fibers that
can be interrupted, typed errors, and `Schema` to decode untrusted input.
T3 Code's server is written in it. Roma chose it for the main process and
the CDP endpoint, and not the page ("effect делаем", "Main + CDP").

**Decision.**

1. **Effect 4, in the main process only.**
   - `effect` and `@effect/platform-node`, at one exact version each (4.1
     now), in `app/desktop` alone. The preload stays plain TypeScript: it
     is sandboxed, and small.
   - The page, the modules' Panes and `@banda/contract` do not use Effect.
     The contract's types stay generated from Rust (ADR 0014); Effect
     does not get a second copy of them.

2. **Each part of main is a service, given as a layer.**
   - `Engine` and `Look` run their programs through `ChildProcess`, scoped:
     the program stops when its scope closes, and starts again on a
     schedule (from 500 ms, doubling to 10 s, back to 500 ms after 30 s of
     health). The supervision is written once, for both.
   - `Settings`, `Notices`, `Extensions` (with its popup) and `Browser`
     are services too. What one needs from another it asks for by its
     type, not by a closure passed in.
   - `main.ts` builds one `ManagedRuntime` from the layers when Electron
     is ready, and disposes of it when the window quits; that is how the
     engine and the look stop.
   - Electron's callbacks (`ipcMain`, `app`, `webContents` events) are the
     edge: each runs one effect on the runtime and does nothing else.

3. **IPC handlers are effects with typed errors.**
   - Each channel decodes its arguments with a `Schema`, runs its effect,
     and returns its result or one of the errors it declares. The page
     sees the same shape it sees now; only main changes.
   - `Schema` is used to decode input that comes from outside main (the
     page, an extension, a CDP client, a file on disk), and not to define
     the contract's types again.

4. **The CDP endpoint is written in Effect from its first line.**
   - It is an `HttpServer` on `127.0.0.1` with WebSockets (ADR 0013,
     decision 7). Each client is a scope; each tab it attaches to is a
     resource in that scope, so a client that leaves, by closing or by
     error, detaches the debugger, ends its sessions and removes the
     Agent's mark.
   - A click on the mark interrupts the fibers of the clients attached to
     that tab.

5. **Tests run on the services without Electron.**
   - `@effect/vitest`, with a fake layer for each service the one under
     test needs: the supervision with a fake `ChildProcessSpawner` and a
     test clock, the CDP endpoint with fake tabs.
   - The window's e2e (`app/desktop/e2e`) stay as they are and must pass
     after each step.

6. **How to write it is in `AGENTS.md`.** A short section: services with
   `Context.Service` and `Layer`, `Effect.fn` for named functions, errors
   as tagged classes, no `runPromise` but at the edge, no `Effect` in the
   page.

**Plan.** Each step is its own PR, and `scripts/check.sh` passes after
each.

1. Effect in `app/desktop`; the runtime in `main.ts`; `Engine` and `Look`
   as services with the supervision written once, and its tests.
2. The IPC handlers as effects, decoding with `Schema`; `Settings` and
   `Notices` as services.
3. `Browser`, `Extensions` and the popup as services.
4. ADR 0013's step 4: the CDP endpoint, `banda browser`, the skill's
   `browser` topic, the Agent's mark and its stop.

**Consequences.** Effect is a new way to write TypeScript, and an Agent
or Person working on main has to know it; the section in `AGENTS.md` and
Effect's own docs are where they learn it. Main's bundle grows by Effect's
size, which the window loads once at start. Steps 1–3 change no behaviour,
so the e2e that pass now are what shows they are right.
