---
status: proposed
date: 2026-11-11
---

# Each machine updates its own Banda, in one `updates` module

_It moves the updater of ADR 0041, 0045, 0072 and 0092 (decision 12) out
of the window's main process into a platform module whose logic is in the
engine. It builds ADR 0086 decision 6 (the engine restarts once no Turn
runs) and ADR 0081 decision 8 (versions are agreed, not matched), and
gives #775 ("Update arc") and #737's last item their home._

Roma, on 2026-11-11 (translated), after putting Banda's engine on devbox
by hand: "let us think through the update flow for several machines and a
server, in one module, so the logic is in one place, and the update widget
with good UX and UI".

## Where it stands

- **Only the window updates, and only its own app.** `client/desktop/src/update.ts`
  looks at the channel's releases hourly (`releases.ts`), downloads the
  AppImage, and on macOS shows a `brew` command. An engine with no window
  is never updated, and a machine with no screen has nothing that could
  update it: a release carries an AppImage and a macOS zip, both apps.
- **An update stops the Agents.** Before it restarts, the window runs
  `banda stop --force` (`main.ts:426-434`, `engine.ts:152-206`), which
  ends every Turn, Harness and Terminal. Only the page waits for idle,
  and only for this machine's Threads (`bar/Update.tsx:150-157`).
- **Another machine is never updated.** The window sees its other build
  ("dev.617 vs dev.642", #768) and logs it; "Update arc" (#775) is a mock.
  On devbox the engine was put in place by hand, unpacked from an
  AppImage (`devbox-setup/setup/4-banda.sh`).
- **Versions must match exactly.** `PROTOCOL` is 1 and a window of
  another protocol is refused (`kernel/src/api.rs:433-437`). `welcome`
  names no version, and there is no `contract/released.json`, so a newer
  window may call a method an older engine lacks and learn it only then.

## Decision

1. **Each machine updates itself.** Its engine looks at its channel's
   releases, takes the new engine and restarts on it, with no window and
   with nobody connected. The laptop, the Mac and devbox do the same.
   Machines stay peers (ADR 0101): no machine updates another, and none
   follows another's version. They meet because they read the same
   channel.
2. **One module, `platform/updates`, holds the logic.**
   - Its engine part decides: when to look, what is newer, what to take,
     when to restart. It reads the channel's feed (`releases.ts`'s rules,
     moved to Rust: Dev reads the newest Devs, Stable only `Banda <version>`
     releases), downloads, checks and puts the new copy in place in
     `<data>/engine/<version>/` as `program.ts` does now, keeping two.
   - Its desktop part only carries out what the app needs: the AppImage
     swap with electron-updater, and brew on macOS. It asks the engine
     part what is wanted and tells it what happened. `update.ts` moves
     there and loses its decisions.
   - Its window part is the widget (decision 7).
   - `banda update` is its CLI: `--check`, `--now`, `--follow`, and
     `--version <v>` to go to a given one, back too.
3. **The engine restarts once nothing runs.** Once a new copy is in place,
   the engine restarts on it as soon as nothing runs, through its systemd
   unit or launchd job, which the new copy writes again. Nothing runs
   means:
   - no Turn runs;
   - no Terminal is open, while a restart still ends them (#462); once
     Terminals outlive it, only no program in front in one (ADR 0106 step
     1d's `terminal.running`);
   - no key reached this machine's Panes in the last 10 minutes, so it
     never restarts under the Person's hands.
   - **On every machine, by default.** A server's and a desktop's alike
     (ADR 0086, decision 6). `machine.toml`'s `updates = "when-idle"`
     says so; `"ask"` waits for the Person, `"off"` and `BANDA_UPDATES=off`
     take nothing at all. One flat key, as the file's others are: its
     reader names any key it does not know, so a table would be a second
     shape for one choice.
   - **Restart now** warns while Agents work, in the words of Quit, and
     restarts anyway once the Person confirms.
   - A restart ends the Terminals, as it does today; keeping them stays
     #462. Until then an open Terminal holds the restart, and the widget
     says which.
4. **The window no longer stops the engine to update.** The window and
   the engine are updated apart. The app restarts when the Person says,
   at once: the engine and its Agents go on, as when the window closes
   (ADR 0086, decision 3). The engine then follows by decision 3. The
   page's own wait for idle goes.
5. **Each release carries the engine alone.** Beside the apps, a release
   has `<folder>-<version>-engine-<os>-<arch>.tar.gz` (`banda`, its line
   tables on macOS, `adapters/` and the licenses, laid out as the engine's
   own copy) for each system Banda is packed for, Linux x86_64 and macOS
   arm64 today, and a feed file of its own beside the app's,
   `<feed>-engine-<os>.yml` (`dev-engine-linux.yml`), with the file's size
   and sha512 (`scripts/engine.mjs`). A gzip'd tar, as every machine opens
   one with what it has. The engine takes that file on every machine, so a
   server needs no Electron; the app on a desktop still brings its own.
   - The bundle carries no Node yet: a machine with no window runs the
     adapters on a Node 22 or newer on its PATH. Carrying one, as Windows'
     app does (`scripts/node.mjs`), is step 1b.
   - A copy is checked by size, sha512 and its own `--version` before it
     is renamed into place.
   - **On Stable, a copy is put in place by itself only once it is
     signed** (#348): the sha512 comes from the same release, so it only
     catches a broken download, not a release that was swapped. Until
     releases are signed, Stable takes a new engine only when the Person
     says. Dev, Roma's own, takes it by itself from the start.
   - Where a package manager owns Banda (`package-type`, the AUR's
     `banda-bin`), the module takes nothing and says who updates it.
6. **Versions are agreed, not matched** (ADR 0081, decision 8).
   - `welcome` names the engine's version and build.
   - A change to the engine's methods keeps the last Dev's windows
     working: `scripts/contract.mjs`, in `check.sh`, compares them with
     main's, whose previous commit is the last Dev, so no copy of the
     released contract is kept beside it. A method gone or of another
     kind, params that take less, or an answer that says more fail, by
     method. A break that is meant is said in a commit of the PR,
     `Contract-Break: <method>, <what an older window does without it>`.
     So a window a version ahead or behind works with an engine waiting
     to restart, and does without what it lacks.
   - `hello` gets a range of protocols with the first change of
     `PROTOCOL`; while every build speaks 1, there is nothing to pick.
   - A window that cannot attach says so and offers that machine's
     update, never a stop.
7. **One widget shows every machine.** The bar's update widget becomes
   the machines': one row each, with its version, what it waits for and
   its acts.
   - **The bar:** the icon and pill say the worst state over the machines
     the window shows: ready, waits, failed, or nothing new.
   - **The popover:** this window's app first, then each machine:
     "devbox · dev.640 → dev.642 · waits for 2 Threads", with Restart now
     and Later; an away machine says so and has no acts. "Update all when
     idle" restarts each machine that waits as decision 3 would.
   - Settings → Machines shows the same row, and the sidebar's "other
     build" opens the widget at that machine.
   - **This window is a row of its own**, above the machines: the app
     restarts at once and the engine waits, so one row for both would
     hide which waits.
   - The mock, variant A, is `~/Banda/artifacts/updates/updates-v1.html`
     with its pictures beside it; variant B, a summary with the machines
     that need nothing folded, was not taken.
8. **A machine with no Banda is set up from the window, once.** Add →
   Connect on a machine where no engine is found offers "Install Banda on
   devbox". The desktop part runs over the same ssh what
   `4-banda.sh` does: the host's own `uname` picks the bundle, the host
   downloads it from the release, checks it and puts it in its data
   folder, and Banda starts it there. From then on that machine updates
   itself (decision 1).
   - Then it offers what the Agents there need: "Sign in to Claude on
     devbox", which opens a terminal on devbox (ADR 0106, step 1c). On
     2026-11-11 devbox's first Thread failed on an expired Claude sign-in.

## What it amends

| ADR | What |
|---|---|
| 0041, 0045, 0072 | The updater's decisions move from `update.ts` to the engine part; the widget becomes the machines' (decision 7) |
| 0081 | Decision 8 built; #737's "the laptop installs its own build on the other machine" becomes decision 8 here, a first install only |
| 0086 | Decision 6 and plan steps 6 and 7f built here; decision 2's copy is made by the engine part |
| 0092 | Decision 12's looks move to the engine; a release also carries the engine alone |
| 0095 | Decisions 6 and 7: "Update arc" is a row of the widget |

## Plan

Each step is its own PR, and Banda keeps updating after each.

| Step | What it does |
|---|---|
| 0 | This ADR and the widget's mock |
| 1 | The engine bundle and `<feed>-engine-<os>.yml`, packed by `package.sh` and published by `release.yml` (#1534, on #1533, which packs on GitHub's runner): done |
| 1b | The bundle carries a pinned Node, as Windows' app does |
| 2 | The contract's check against main, `scripts/contract.mjs` (#1537); `welcome` names version and build |
| 3 | `platform/updates`' engine part: reads the feed, takes and checks the bundle, puts it in place; `updates.state`; `banda update --check/--follow`. It restarts nothing yet (#1541): built |
| 4 | The restart once nothing runs, Restart now; `machine.toml`'s `updates` reaches the restart |
| 5 | The desktop part: `update.ts` moved, the app swap asked of the engine part; the window stops no engine to update |
| 6 | The widget over every machine, as the chosen mock |
| 7 | Install Banda on another machine from Add → Connect: `scripts/install.sh`, published with each release and packed in the app, run over ssh (#1577): built; "Sign in to Claude on <name>" after it waits, as a machine just set up has no Project for its terminal |

devbox runs on `4-banda.sh` until step 3, and is set up by step 7 after.

## Roma's calls (2026-11-11)

1. **Each machine follows its channel**, not the window that connects to
   it.
2. **An engine restarts once idle, on every machine**, servers and
   desktops alike; Restart now warns.
3. **The engine alone is a file of the release**, not unpacked from the
   AppImage.
4. **One widget on the bar** for every machine.
5. **Variant A of the mock, with this window's own row**: Roma left the
   pick to the agent.
6. **By itself, not through the Person, but never under their hands**:
   an open Terminal and recent keys hold a restart, and Stable waits for
   signed releases before it updates by itself.

## Consequences

- Banda updates with no window open, and a server with nobody connected.
- Updating the app no longer ends a Turn: only the engine's restart does,
  and it waits for none to run.
- A release grows by a file of about 52 MB for each system.
- The window may run against an engine a version apart for a while; the
  contract's check is what keeps that safe. On main's week before it, 7
  of 87 changes to the contract would have needed a trailer.
- A machine set to `"ask"` or `"off"` drifts until the Person acts; the
  widget shows it.

## Later

- Signed releases (#348): the gate of Stable's own updates (decision 5).
- Terminals that outlive the engine's restart (#462).
- Windows: its engine as a service and its updates (ADR 0090).
- A Stable promoted from a Dev daily (ADR 0092, step 6) needs nothing new
  here: a machine on Stable reads Stable's feed.
