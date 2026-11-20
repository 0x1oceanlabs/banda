# Updates

`platform/updates`: each machine updates its own Banda, with or without
a window (ADR 0119, ADR 0131).
[The architecture](../../docs/architecture.md#window) is the map this
page is one part of. A change to this part changes this page in the same
PR.

## What it does

- **The engine updates itself** (ADR 0119), with or without a window:
  the machine-scope module `updates` (`platform/updates/engine`) looks
  at its channel's releases a minute after the engine starts, then
  hourly, and on `updates.check` (`banda update --check`). Each look
  and each take runs in `banda-update`, the updater's own program
  beside the engine's (ADR 0131, decision 2): the engine runs
  `banda-update check` or `take <v>` with the Banda it is for, and takes
  each line of JSON it prints, an `UpdateState`, into its own; a copy
  that carries none looks in the engine's process. Where the engine is
  its machine's service (its systemd user unit or launchd job) and takes
  updates, it starts `banda-update run` as a service of its own beside
  it, `<folder>-update` on Linux (`systemd-run`, `Restart=always`),
  `<app id>.update` on macOS (`launchctl submit`), in place of one that
  ran: that service looks a minute after it starts, then hourly, keeps
  each look's state in `<data>/engine/state.json`, which the engine
  follows, and guards a move (`daemon.rs`, `guard.rs`). A copy the engine
  moved onto that does not answer on its version, in `engine.json`,
  within two minutes is listed in `<data>/engine/bad`, never taken or
  moved onto again, and the copy it moved from starts again with its
  `banda start`, after `systemctl --user reset-failed` of a unit that
  gave up. Banda Dev
  reads every Dev, Banda only a Stable (`feed.rs`); the window's app
  reads the release it found newest. A release carries an engine feed,
  `<dev|latest>-engine-<linux|mac>.yml`, naming one bundle,
  `<folder>-<version>-engine-<os>-<arch>.tar.gz`, with its size and
  SHA-512. The module downloads the newest above the running and the
  ready one, following GitHub's one redirect only to its storage hosts
  (the HTTPS client follows none), checks size and hash, unpacks it into
  `<data>/engine/.<version>.new/`, runs its `banda --version`, which must
  say that version, writes `version`, and renames it into
  `<data>/engine/<version>/`, the window's layout. The two newest copies
  stay, and the running one. It takes nothing for Banda Local, where
  `package-type` sits beside the program, with `BANDA_UPDATES=off`, or
  with `updates = "off"` in machine.toml (default `when-idle`). The
  stream `updates.state` says what it runs, the newest found, a take's
  progress, what is ready, what that waits for and why not (`banda
  update --follow`).
- **The engine moves onto a ready copy once nothing runs** (ADR 0119,
  decision 3; `platform/updates/engine/src/restart.rs`): no Turn runs
  (the kernel's `Working`), no terminal is open, as a restart still ends
  them (#462), and no key reached one for ten minutes (the kernel's
  `Hands`, which the terminal module tells: the keys typed into this
  machine's terminals are the Person's one input the engine receives).
  One pure function, `restart::next`, decides from those, machine.toml's
  `updates` and how the engine moves; `when-idle` moves by itself, `ask`
  waits for the Person, `off` neither takes nor moves. `updates.state`'s
  `waits` says for what: `turns`, `terminals`, `typed_until`, `person`, or
  `restart`, why it does not move by itself. Restart now
  (`updates.restart`, `banda update --now`) asks first while Turns run,
  in Quit's words (`quit::restart_asks`), and moves anyway with `force`;
  open terminals and keys hold it not. The mechanism is the engine's
  (`engine/src/moving.rs`): the module asks through `Restart`, the engine
  stops as a TERM stops it, and once its runtime and the children that
  die with it are gone, ends what is left in its unit's cgroup (TERM, then
  KILL after 15 s, as systemd's `KillMode=mixed` does) and `exec`s the
  copy's `banda` with its own arguments: the same process, so the same
  unit or launchd job and one holder of the state's lock throughout. A
  transient unit's program cannot change, so a crash starts the copy the
  unit was started with, which moves again once idle; a unit from its
  file names the new copy once it runs, as the engine rewrites the file
  as it starts, so a crash or a boot starts that. The window's child,
  and Windows, do not move: they restart with Banda.
  `banda update --version <v>` (`updates.take`, Manage) puts that
  version in place, an older one too, keeps it in `<data>/engine/chosen`,
  and the engine moves onto it by the same rule; the looks take nothing
  above a version chosen, and `--version newest` drops the choice. A copy
  older than this step neither reads `chosen` nor moves by itself.
- **The engine says the app's part too, and one Update takes both**
  (ADR 0137). `updates.state`'s `app` is what the app on this machine
  does with its own update, as its window's main says each change of it
  with `updates.app`: the module keeps it, and nothing else writes the
  state. `updates.restart` (`banda update --now`) updates the machine:
  the engine moves onto its copy where one is ready and it moves by
  itself, and the app is asked to restart into its version ready
  (`wants_app`, a time two minutes on: past it, or once the app says it
  installs, it is asked no more), not when the Person chose a version;
  an engine that moved as the Person said asks its app as it starts.
  While Turns run that this would end, it refuses, restarts with
  `force`, or with `wait` holds it (`held`) until none runs;
  `updates.later` (`banda update --later`) drops that. With `ask` it
  does nothing, and answers what it would do and how many Turns it would
  end (`stops`): `banda update --now` reads that before it asks the
  Person, so it asks only where the engine says Agents would stop.
- **The window only swaps its own app, and says each step to the
  engine** (ADR 0119, decisions 2 and 4; ADR 0137;
  `platform/updates/desktop`, `@banda/updates-desktop`). It follows its
  engine's `updates.state` and, at each look the engine made, reads the
  release the engine found newest with electron-updater: that release's
  app update file, naming only this app's files (`releases.ts`). It
  downloads at once and installs at the quit while a look at most an
  hour old still offered it, or as the engine asks (`wants_app`): the
  Person's Update is the engine's `updates.restart`, and main has no
  call of its own for it. One machine does this on every system
  (`app.ts`); what differs is how a version is taken and installed, its
  `Installer` (`installer.ts`): electron-updater's for an AppImage and
  Windows, brew's for a Mac. Windows' installer shows Banda's card
  while it works, as Banda has none then (below). With no window shown, a Banda
  with a version ready restarts into it by itself, unseen, where its
  installer can start it so (`unseen`): a Mac's today, and the others
  once Banda has a tray there (#1870). It tells the engine what its
  update is at each change (`updates.app`), and again an engine that has
  it not, as one that started since. Where the engine takes nothing
  (`off`), the app takes nothing. The restart stops no engine: the
  engine and its Agents go on, as when the window closes, and a window's
  packed copy put in place beside the running engine (`program.ts`) is
  ready to it at its next look, which the window asks for at once when
  the engine runs another version than the app. One rule, the engine's:
  the newest copy in place wins, whoever put it there, and the engine
  moves onto it once nothing runs. An engine older than ADR 0137 refuses
  `updates.app`: its app still takes its version and installs it at the
  quit, and its row has no Update for the app until that engine moved.
- **The page only draws** (ADR 0137, decision 5;
  `client/web/src/bar/update`). It reads each machine's `updates.state`
  and draws one row a machine, this machine's with its app's part in it.
  From the Person's Update to the new window that row says what it does,
  with no button: Installing, then Restarting. Update is one call,
  `updates.restart`; where it would stop Agents the page asks first, and
  "Update when they finish" is `wait`, which the engine holds (`held`),
  so a window that loads again still shows it. "Check now" is
  `updates.check` on each machine. That Banda updated a window shows
  once, and keeps for itself that it did. It says only what it knows
  (`machines.ts`): a machine is "Up to date" on the newest version any
  machine found, else its row names the version it runs and the one that
  is out; this machine stopped says "Stopped", and nothing of what its
  engine last said; "Checked" is the oldest last look of the machines
  reached, so it is true of each; and "on every machine" stands only
  while every row is up to date.
- **Windows' installer shows Banda's card, not NSIS's windows**
  (`platform/updates/setup`, `banda-setup.exe`; ADR 0090). The
  installer, electron-builder's one-click NSIS, starts the card from its
  plugins folder as it starts (`client/desktop/installer.nsh`), then
  goes on silent: the card, a borderless layered window drawn in pixels
  (`card.rs`: the `banda` theme's colours, Inter, a tile's corner, the
  lift's shadow; Windows' light or dark), shows the app's icon, whose
  hat tilts while it installs, and a bar it measures itself from the
  bytes unpacked and copied. NSIS tells it the step and asks its
  questions by two window messages (`window.rs`): Banda is open (close
  it and install, or cancel), a part of it could not be stopped (try
  again), this Windows is too old. Installed, it opens Banda and the card
  stays until Banda's window shows. A card that does not come up leaves
  NSIS's own windows, and a silent run shows none. `banda-setup --png`
  draws the card into a picture on any system.
- **A machine with no Banda is set up by `scripts/install.sh`** (ADR
  0119, decision 8), one POSIX sh script, published with each release
  and packed in the app's resources: it puts the engine bundle of a
  version in place as the module does, as the Person, and says each step
  on a line whose first word is what it is. Add → Connect runs the app's
  copy over ssh (`hosts.ts`, `installCommand`, the script in base64 so
  any login shell takes it), `--check` first, then for real, and draws
  its lines as steps.
