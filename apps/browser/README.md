# Browser

The browser App: Chromium in a Pane, for the Person and every Agent
(ADR 0013, ADR 0029). `pane/` is the Pane, its tabs and its row;
`desktop/` the pages and profiles in Electron's main process.
[The architecture](../../docs/architecture.md#window) is the map this
page is one part of. A change to this App changes this page in the same
PR.

## What it does

- **The browser's pages** (ADR 0013) are Electron `<webview>`s in the
  window's layer over its workspaces (`PANE_LAYER`), which never moves:
  Electron destroys a `<webview>` that moves in the DOM. The browser Pane
  draws an empty slot, and its page follows the slot on every frame, cut
  to what the workspace shows of it (`apps/browser/pane/src/pages.ts`).
  - The desktop attaches a page only in one of the browser's profiles:
    the Person's, `persist:browser`, or a Project's Agents',
    `persist:agents-<project>`, where the tabs they open load (ADR 0083,
    decision 4). A tab keeps whose it is in its Pane's args, and a page
    opens its new tabs in its own profile. Every page is sandboxed,
    context-isolated and without Node. A fixed sandboxed preload
    supplies synchronous `prompt` (ADR 0060); in each profile alike a site
    asks before it uses the camera, the location or another program, and
    downloads go to the Person's Downloads
    (`apps/browser/desktop/src/profile.ts`). An Agents' profile loads
    the web alone, no file by any way, and shows a site none of the
    Person's client certificates. The extensions live in the Person's
    profile alone (`Extensions`, ADR 0020): an Agents' page is no
    extension's tab, and its menu has no extension's items.
  - Page dialogs are owned by `Dialogs` in main and drawn at the center of
    their page. Native callbacks, the prompt shim, the Person's bridge and
    Agent actions share a dialog ID; the first answer wins (ADR 0060).
  - Banda's Alt keys and the browser's Ctrl keys are taken from the page in
    `before-input-event` and pressed again in the window, so the actions
    and the Pane hear them as their own. A key a page hears while
    Banda's hands act in it (`Tabs.hands`) stays the page's, and the
    window hears none. An Agent's press of one of Banda's keys in force
    there is refused before the hands touch the page: they send its key
    once, held back from the page, and main reads it in
    `before-input-event`, which Electron tells of a key sent with
    `sendInputEvent` before that returns, as Electron makes it
    (`apps/browser/desktop/src/keys.ts`; ADR 0083, decision 3). A key
    of theirs the page leaves unhandled goes on to the window as the
    Person's does, where only the app menu's keys act: Linux and Windows
    have no menu, and a Mac's hears a key only with its native event,
    which a key sent with `sendInputEvent` has not. A key added to the
    menu is checked against this rule.
  - A page takes the keys as an iframe does, with no focus event of its
    own; its tile takes the focus once the window blurs.
  - A Pane keeps its tabs in its args, and holds their pages while it
    has them: only the shown tab's page follows the slot, and a tab is
    made a page the first time it shows. A page's new tabs, its icon and
    the downloads come from the desktop as `browser.listen`, by the page's
    web contents ID; Banda's page shows no remote image, so the desktop
    fetches the icon in the page's profile.
  - Agents drive tabs with Banda's tools (ADR 0029): the engine part asks
    main, and each request names the call's Project and its Agent. Main
    answers only about the tabs in that call's reach
    (`apps/browser/desktop/src/asked.ts`, `Tabs.seen`): those its
    Project's Agents opened, and those the Person lent its Thread (ADR
    0083, decision 4). A tab outside its reach is refused as one there is
    not. The workspaces' `panes` tool shows an Agent a browser's args with
    its Project's Agents' tabs alone.
  - The Person lends one of their tabs to a Thread of the Pane's Project
    by a gesture in the tab: the mark at the address's end, or the
    action `browser.lend` (Alt+Shift+L), pressed in the Pane or in the
    page it shows; the page tells main on the bridge's channel of the
    same name. An Agent's press of it is refused, as of each of Banda's
    keys (above). `Tabs` keeps each lend, which ends as the Person takes it
    back, the tab closes, or the Thread's session ends: its Project lists
    it no more (the bridge's `ended`), or the engine starts again, as the
    boot its `welcome` says changes. As one ends, `Drive` ends the
    Thread's hold on the tab at once, a call that runs there too, and a
    call whose tab left its reach meanwhile answers as for a tab there is
    not. On a lent tab an Agent goes, reads and acts only at an http or
    https address, and never at a site the Person denied every Agent.
    Each lend and each end goes to the engine as `browser.lent`, whose
    fact the agents module posts in the Thread as a notice its Agent
    reads before its next message, the page's title quoted
    (`apps/browser/desktop/src/lends.ts`).
  - Main's hands are Playwright, over each tab's own CDP socket
    (`apps/browser/desktop/src/cdp.ts`): an Effect HTTP server on
    127.0.0.1 whose sockets each see one tab, at an address with a
    secret of its own that opens once, within seconds, and is never
    written down. No endpoint drives the whole browser. A tab's `webContents.debugger` is
    attached while a client uses it, and each client's session on it is a
    Chromium session of its own; a client is a scope, so one that leaves
    detaches. A tab with a client's session is told `driven`: it shows the
    Agent's mark and keeps drawing while hidden; a click on the mark sends
    `browser.stop`, which ends every session on it. A tab asked for with
    no browser Pane opens a new one without the focus, through the
    browser module's `start`.
