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
- **The window only swaps its own app** (ADR 0119, decisions 2 and 4;
  `platform/updates/desktop`, `@banda/updates-desktop`). It follows its
  engine's `updates.state` and, at each look the engine made, reads the
  release the engine found newest with electron-updater: that release's
  app update file, naming only this app's files, and the notes since the
  running version (`releases.ts`). It downloads at once and installs on
  Restart, or at the quit while a look at most an hour old still offered
  it. "Check now" is the engine's `updates.check`. Where the engine
  takes nothing (`off`), the app takes nothing. The restart stops no
  engine: the engine and its Agents go on, as when the window closes,
  and a window's packed copy put in place beside the running engine
  (`program.ts`) is ready to it at its next look, which the window asks
  for at once when the engine runs another version than the app. One
  rule, the engine's: the newest copy in place wins, whoever put it
  there, and the engine moves onto it once nothing runs. An engine older
  than step 3, which answers no `updates.state`, leaves the app as it is.
- **A machine with no Banda is set up by `scripts/install.sh`** (ADR
  0119, decision 8), one POSIX sh script, published with each release
  and packed in the app's resources: it puts the engine bundle of a
  version in place as the module does, as the Person, and says each step
  on a line whose first word is what it is. Add → Connect runs the app's
  copy over ssh (`hosts.ts`, `installCommand`, the script in base64 so
  any login shell takes it), `--check` first, then for real, and draws
  its lines as steps.
