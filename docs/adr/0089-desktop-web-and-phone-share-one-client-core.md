---
status: accepted
date: 2026-11-07
---

# Desktop, web and phone share one client core

_Proposed on 2026-11-07, to be accepted with ADR 0087 and ADR 0088. The
research behind it is `docs/research/2026-11-07-client-architecture.md`,
§7 (here "the research"). Its decisions shape no PR before step W0 except
the ratchet on `window.banda`, but ADR 0087 (the forms) and the GLOSSARY
(Client, Area, the Bar's phone line) cite it, so the three are accepted
together (research §11.13). Code is cited as `path:line` from main at
`ed293406`._

The vision makes the phone's first client a PWA (vision decision 15) and
the web client its own milestone (M8): the page runs without Electron
(W1), the host serves it (W2), and a browser adapter brings Web Push (W3).
It names `client/core` for the hosts router, the directory cache, the
Inbox merge, the device vocabulary, view state and the renderer (vision
§9.1).

Today the page cannot start without Electron. It reads `window.banda` at
boot and says "Open Banda from its desktop app" otherwise
(`client/web/src/main.tsx:16-21`, `:59-64`). `window.banda` is read across
`client/web`, `client/ui`, `apps` and `platform`. Electron main and the
preload import the page's bridge table (`client/desktop/src/main.ts:47-52`,
`client/desktop/src/preload.ts:10`), and that table imports App packages
(`client/web/src/host.ts:9-13`). Client stores are module singletons that
assume one engine (`client/ui/src/lib/signs.ts:14`,
`client/ui/src/lib/projects.ts:74`, `client/ui/src/lib/look.ts:10`, the one
`engine` at `client/web/src/main.tsx:21`). The Person's seen and archived
marks live in each device's localStorage
(`apps/agents/pane/src/seen.ts:12`, `client/web/src/sidebar/archived.ts:18-19`).

The designs for this (working drafts, not kept; the research names each
side it did not take) proposed a core with no DOM, ports for React Native,
and a phone that projects the tiling into pages. The critiques found the
React Native doors premature (Hermes runs no WebAssembly; ghostty needs a
canvas), and a phone that writes the arrangement would rearrange the
desk while the Person is away from it. This ADR keeps the part that serves
desktop, web and the PWA now.

**Decision.**

1. **`client/core` is the one core of every client.**
   - It is TypeScript with no DOM: WebSocket, fetch, WebAssembly and
     timers only. Its React bindings are `@banda/core/react`, which
     depend on `react` alone.
   - It names no App, takes no disk path, and owns no pixels or motion.
   - It is born at W0 from what ADR 0087 builds in `client/web/src/window/`:
     the Here store, the items, calls and marks stores, the action
     matcher, and the device port. The hosts router (H5), the tiling
     driver (ADR 0088 decision 11) and the Tree runtime (V2) join it
     later.
   - A lint keeps `document`, `window`, `localStorage` and Electron out of
     it.

2. **The device port is the only way to the device.**
   - It carries ADR 0082 d12's closed list (`notify`, `sound`,
     `clipboard`, `pick_file`, `open_outside`, `webview`, `drag_out`),
     each optional, plus the screen's facts (scale, refresh rate, insets,
     reduced motion, pointer, whether there is a keyboard, keys the
     client cannot take), presence (in front, awake, away), and storage
     for per-viewer conveniences.
   - On the desktop it adds the window parts: the inset of the window
     buttons, the material and accent, popped-out windows, the update and
     the `banda menu` socket.
   - Each client brings an adapter: the desktop's over the preload, the
     browser's over Web APIs and a Service Worker.
   - Only `boot/desktop.ts` and Electron main touch `window.banda` or
     Electron. A ratchet counts the other reads down to none.

3. **The desktop's device session stays in Electron main.** Main holds it
   today (`client/desktop/src/road.ts:1-6`). There is one device per
   machine, the Agents' browser drive stays next to its webContents, and a
   page reload or a popped-out window registers no new device. The PWA's
   session lives in its page's core. The port is the same.

4. **`client/web` is the one page for every DOM client.**
   - The Electron window and the PWA run the same build. `boot/index.ts`
     picks the adapter: `boot/desktop.ts` when `window.banda` is there,
     else `boot/browser.ts`.
   - A browser tab with no paired host shows the pairing page (W2), not a
     dead end.
   - The bridge table (`BRIDGE`, with the modules' parts of it) moves
     from `@banda/web/host` into `client/desktop`, so main no longer
     imports the page, and the page no longer imports App packages for
     main. The page's `boot/desktop.ts` takes only its type, `Host`.

5. **Every client store is keyed by host from its birth.** Until H5 there
   is one host, `local`. Then the hosts router owns every session, and
   each `Engine` a part holds comes from `sessionOf(project)`. H5 and H6
   do not rewrite the stores.

6. **The Person's marks live behind one store.** Seen, archived and
   looked at have one interface in the core. Its adapter is localStorage
   until E8 makes them a Person document on the home host (vision
   decision 13); then a mark made while home is away waits on the device.
   _Changed on 2026-11-08, by ADR 0096:_ a Thread's seen and archived come
   from its host, in its list, and go there as commands; one made while
   that host is away fails, and nothing waits on the device.
   Device storage keeps only conveniences: the view, widths, an unsent
   draft, recent toasts.

7. **Three forms, from the device's display.** Wide, narrow and phone
   come from the width in look units, the pointer and the keyboard. Only
   the Window knows the form, and it gives it to the Tiling's view. It is
   not in Here (ADR 0087 d4), so App code cannot branch on the device; the
   catalogue's components adapt.

8. **The phone in v1 shows the sidebar and Threads, and never writes the
   arrangement.**
   - Home is the sidebar list, as `sidebar.toml` arranges it.
   - A Thread screen shows the Thread with Stop, the Message box, its
     Questions, and a Next button in its header, the phone's Alt+U.
   - New Thread asks for the Project, or takes it from the section it
     came from.
   - There is no Tiling. The phone keeps its own stack of screens. A
     Thread's Group's other Panes are named in its header and open on a
     wide screen.
   - `pane.pick`, from a row, a push tap or Next, is answered by the
     Window, which pushes the Pane's screen on the stack (ADR 0087 d7).
     On a phone that is a Thread's screen; a Pane of another kind is
     named and opens on a wide screen.
   - The Bar is a header: the Mark, Here's title and at most two widgets
     marked `compact` (ADR 0087 d11), placed by the Person's `[bar]` with
     a default. The Top layer becomes bottom sheets.
   - Per-Pane phone fields wait until Panes can be Trees (M10).
   - _For Roma:_ the alternative is a Thread screen with its Group as
     read-only tabs, drawn from the arrangement; it needs terminal and
     browser Panes that work on a phone.

9. **Electron main is the window parts and the device's capabilities.**
   Main becomes `os-window/` (material, inset, accent, popped windows,
   update, the menu socket), which the device port carries as `os`, and
   `device/<cap>.ts`. It reads no Project
   path once bytes, settings and the look come from the host (E1, E4, E5),
   and names no App once the capabilities replace each App's desktop
   part.

10. **The catalogue's code stays where the vision put it,** `sdk/kit` as
    `@banda/kit` (L3). The Tree runtime goes in the core; the web renderer
    in the kit (V2). The alternative, `client/kit`, rests on no code from
    outside Banda ever importing the React kit; the package name is the
    same either way.

11. **Borders are held by tests.**
    - `client/core` imports no `react-dom`, no kit, no `@banda/web`, no App
      and no Electron, and names no App id in its strings.
    - `client/web` reads `window.banda` only in `boot/desktop.ts`, and
      names App packages only in its generated module list.
    - `client/desktop` imports nothing from `@banda/web`.
    - An App's view imports only `@banda/core/react`, the kit and its own
      contract.

**Deferred.** The native phone app and a native kit; WebAssembly under
Hermes; an asynchronous storage port and a scheduler port that only React
Native would need; the core in a worker; popped-out Panes on the web; the
look resolver on the device (E5 resolves it on the host for v1); a
screencast backend for the browser's page on the web.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each. Ids
are the research's §9 and the vision's §9.3.

1. The ratchet on `window.banda`, counting today's reads (with ADR 0087's
   B4b, which gathers the Window's own into `window/device.ts`).
2. W0: `client/core` with the device port and its desktop adapter, Here,
   the stores keyed by host and the marks store; the bridge table moves
   into `client/desktop`.
3. H5 (vision): the hosts router, stale hosts and the visible queue;
   `sessionOf(project)` feeds every Pane.
4. W1 to W3 (vision): the page without Electron, served by the host, the
   browser adapter, Web Push.
5. W4: the phone form of decision 8, through a mockup.

**Consequences.**

- The web client and the phone add an adapter and a form, not rules.
- A page reload on the desktop no longer drops the device: the session
  stays in main.
- Seen and archived agree across devices once E8 lands, with no change to
  what reads them.
- The phone can start, follow, stop and answer Threads (vision M8)
  without the tiling model in WebAssembly, so it does not wait for T1.

**Changes.**

- **ADR 0062, decision 13:** "A phone shows the same arrangement its own
  way (one Group to a screen) and keeps only its view" becomes: in v1 a
  phone shows the sidebar and Thread screens, keeps only its stack of
  screens, and never writes the arrangement. One Group to a screen comes
  when Panes work on a phone (decision 8).
- **ADR 0028, decisions 1 and 4:** `BRIDGE`, with the modules' parts of
  it, moves from `client/web/src/host.ts` into `client/desktop`; `Host`
  is still derived from it, and the page takes only that type (decision
  4).
- **Vision §9.1 (not an ADR):** `client/desktop`'s main is "the window
  parts and `device/<cap>.ts`", and the desktop's device session stays in
  main (decisions 3 and 9). The core's "renderer" is split: the Tree
  runtime is in `client/core`, and the web renderer in the kit
  (decision 10).
- **GLOSSARY:** Client says every client but the CLI shares one core and
  only its Window knows the device; Area and the Bar gain their phone
  lines (decisions 1, 7 and 8).
