# The desktop

`client/desktop`: Electron's main process. It starts or finds the engine,
serves the page and hands it the engine's address. How its code is
written is in [`AGENTS.md`](../../AGENTS.md#effect-in-the-windows-main-process).
[The architecture](../../docs/architecture.md#window) is the map this
page is one part of. A change to main changes this page in the same PR.

## What it does

- **The page reaches the engine only through the API.** Electron main gives
  it one thing: the engine's address, through `window.banda.engine()` in
  a sandboxed preload. That address is the engine's door (ADR 0124,
  decision 5): main pairs the window with its own machine each time the
  engine starts, by this device's key, kept in `device.key` in Banda's
  state for its owner alone (`client/desktop/src/key.ts`), and hands the
  page the door, the device and the host key. It signs the page's `hello`
  to that door (`window.banda.sign`) and nothing else, so the page holds
  no key, and no owner secret where its engine has a door and paired the
  window. An engine with no door yet, or one that would not pair, is
  reached by the secret, as before, and main's log says so. The page is served from `app://banda` with a
  strict Content Security Policy. It cannot navigate, open windows or get
  permissions, and links open in the browser. It may run WebAssembly
  shipped with it, which Ghostty draws terminals with.
- **The window reaches the engine; it does not own it** (ADR 0086,
  decisions 1 and 3). Main runs `banda start --with-parent`, which starts
  the engine when it does not run, prints where it listens, and follows
  it while the window is open; where the engine is the window's child,
  it is the engine, `serve --with-parent`, and its stdin closing stops
  it. When Quit Banda stops the engine, here or by `banda stop`, the
  program ends with code 0 and the window quits. Stopped as asked by
  anything else, as its unit stopped by hand, it ends with code 3: the
  window stays, its Panes say Banda is stopped on this machine, and
  Start starts it again (ADR 0124, decision 9). When it crashed, main
  starts it again (waiting up to 10 s between tries). Closing the last
  window only closes it: the engine and its Agents go on. Quit Banda
  (`banda.quit`, Ctrl+Q, but for a terminal's program, whose key it is
  there) asks first while Agents work, then main runs `banda stop
  --force`. Quit asks in one set of words everywhere, the page, macOS's
  dialog, the menu bar and `banda stop` alike: "2 Agents work on this
  Mac" (this computer, off macOS) / "Quitting Banda stops them too." /
  "Quit anyway" or "Cancel", Cancel the default; with one Agent, "An
  Agent works on this Mac" / "Quitting Banda stops it too."
  (`engine/src/quit.rs` writes them for the contract's `quitAsks`). On
  macOS the app stays, and its engine, a launchd job, outlives it
  (`client/desktop/src/closing.ts`): closing the main window hides it,
  its page left to call the Person and sound, and its Panes' own windows
  close; the menu bar's Open Banda or a row of its menu, or Banda opened
  again, shows it. In the page ⌘Q is Quit Banda's own key. The menu
  bar's Quit Banda, the app menu's and the Dock's Quit, and ⌘Q where the
  page leaves the key (in a terminal, over a dialog, with the window
  hidden), run `banda stop`, which stops the engine where no Agent
  works; where some do, the page's Quit Banda asks first while its
  window shows, or a system dialog does when no window shows, the page
  crashed or loads, or the Person quits again within 10 s. A logout,
  restart or shutdown quits without asking.
- **On macOS Banda lives in the menu bar** (ADR 0086, decision 4; the
  accepted mock, mac-menubar-v1). With no window open, Banda.app keeps
  running with no Dock icon, only its icon in the menu bar: the Dock's
  icon is there only while a window is open, shown or minimized, and
  stays as it is while Banda is hidden (⌘H). The icon is Banda's mark, a
  template in the menu bar's own colour: its hat a square at rest, a
  circle while Agents work, a triangle lit in orange while one asks the
  Person or failed, happy eyes while what waits is done, asleep and dimmed
  while the engine does not answer; beside it one number, how many wait
  for the Person, else how many work. Its menu, a plain macOS menu built
  again as its items change, never while it is open, lists this Mac's
  Threads, what waits first, then
  what works, each row opening its Thread in the window (the page's
  `pane.pick`); then Open Banda, the version, and Quit Banda (⌘Q while
  it is open). All of it comes from one child of main, `banda status
  --follow --with-parent`, started again when it dies (`status.ts`,
  `menubar.ts`, `tray.ts`; its icons drawn by
  `client/desktop/icons/menu-bar/draw.mjs`). An engine with no app opens
  Banda.app hidden, by its path (`open -g -j <app> --args --hidden`),
  which then shows no window and no Dock icon, only the menu bar's; it
  never opens an app that runs, nor one the Person quit or ended with
  Force Quit, which leaves no crash dump newer than the app's lock and
  than the engine's last look that saw it run (a page's or the GPU's
  dump from before is not the app's), and
  stops trying after three opens with no app that ran five minutes
  (`engine/src/service/app.rs`). Linux and Windows have no menu bar icon
  yet (`hasMenuBar`). `banda look --follow --with-parent` stays the window's
  child. Both are Effect services in main (`Engine`, `Look`; ADR 0020),
  started by one runtime and stopped when it is disposed. The client
  then reconnects and follows on from the last event it delivered, so a
  Pane sees no gap.
- **A packed Banda runs its own copy of `banda`** (ADR 0086, decision
  2), never the one inside its AppImage or its app, whose folder may go
  while the program runs. Main copies it into `<data>/engine/<version>/`,
  beside what its `--version` said, its line tables (`banda.dSYM` on
  macOS, `banda.pdb` on Windows), the ACP adapters the app carries, and on
  Windows the Node they run on there (`node/`), runs the copy once with
  `--version`, and renames it into place only when it says the same
  version and build id (`program.ts`). A copy in place is run again while
  it and what it carries are as long as the packed ones and it says the
  same, and one that goes while the window runs is made again before the
  next run. The last two versions are kept. On Windows, where nothing
  tells what runs, an old copy is renamed aside and removed there, its
  programs first; one Windows will not move, or whose program will not
  go, stays (ADR 0090, decision 5). A copy that cannot be made leaves the
  engine where it was packed, and a Problem says why. A `banda` that a
  package manager owns, as the AUR's, says so in `package-type` beside it
  and runs where it was put; a checkout's runs where cargo built it.
- **What still runs from inside the AppImage** is Electron's, and, for an
  engine that is the window's child, the Node the ACP adapters run on,
  the window's Electron. An engine started as the session's service from
  an AppImage is not told that Electron, which goes as the AppImage
  stops. The adapters' files run from
  the engine's own copy, which carries them. A macOS app's copy also has
  `electron` beside it, which names the app's Electron, so an engine
  started with no window runs the adapters on it; an AppImage's copy
  names none, as its Electron goes when it stops, and such an engine
  looks for a `node` on PATH. On Quit nothing of it is left. When main is
  killed, `chrome_crashpad_handler` and the network service die with
  SIGBUS as the AppImage's folder goes; `banda` does not. That is
  Electron's helper, kept apart from the engine (seen on 2026-11-07).
- **Only `window.banda` ties the page to the desktop.** It names no
  Electron API, so a browser can host it later; for now the engine lets in
  only `app://banda` and pages on localhost. Its channels are one table,
  `BRIDGE` in `client/desktop/src/bridge.ts`, each named by its path (ADR 0028):
  the preload builds `window.banda` from it, and in main each channel
  answers Banda's page alone, decodes its arguments with a `Schema` and
  runs one effect (`serve` in `@banda/desktop-kit`, ADR 0020). A module
  brings its part of the table and of main; `client/desktop/src/modules.ts`
  is the one file in main that names one.
- **A port of another machine opens here on the Person's click.** A web
  address of another machine's own computer, as `localhost:3000` in an
  arc reply, a terminal or a file, opens through a forward of that port
  (ADR 0120, decision 2): the window's `link.open` asks the device's
  `forward_port` (`hostForward` on the bridge), and main runs one more
  `ssh -N -L` to that machine, by the engine's forward's own arguments,
  loopback to loopback (`client/desktop/src/forward.ts`). It takes the
  same port here when that is free, so a page that names its own address
  works unchanged, else the next free one, and a toast says which. The
  forward lasts while that machine is live, and a click while it is away
  says so at once. A device with no `forward_port`, as a web page, says
  whose the address is and offers it to copy.

## Checks

- **Architecture tests.** Main runs an effect only in `main.ts`, on its
  runtime, and in the two places `client/desktop/src/architecture.test.ts`
  lists with their count and reason (ADR 0020).
