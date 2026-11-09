---
status: accepted
date: 2026-11-06
---

# The engine is the machine's, and outlives the window

_Drafted as ADR 0049 on 2026-11-04, in PR #460. Main has since given 0049
to another ADR, so this one is 0086. Commits before then say ADR 0049.
Roma accepted it as part of the architecture vision on 2026-11-06 (ADR
0062 decision 19). Its decisions are as drafted, but for decisions 6 and
8, and for login start and what follows from it, which Roma decided on
2026-11-09 (decisions 1, 3, 4 and 6; see Changes)._

Today the engine is the window's child. The window starts
`banda serve --with-parent`, and the engine stops when its stdin closes
(`docs/architecture.md`, "The engine is the window's child"). So closing
the window stops every Turn, every Harness and every Terminal. The
glossary already says otherwise: the Engine is "the one process on a
machine", and windows and the CLI are its clients.

On 2026-11-04, Omarchy's crash notices came in again and again. There
were 39 core dumps in four days, of two kinds:

- **SIGTRAP, `electron .` from a checkout.** These were Agents' test
  runs of Banda Local, in bursts of five in ten minutes. Each said
  `FATAL: GPU process isn't usable. Goodbye.` Twice the Agent's own
  process group was stopped in the same second. Part of the app stayed
  in the Agent's group, and died with it.
- **SIGBUS, Banda Dev's AppImage.** The AppImage runs from
  `/tmp/.mount_banda-*`, and that folder goes away when the AppImage
  stops. Whatever still runs from it then dies:
  `chrome_crashpad_handler`, zygotes, `banda serve`, and a
  `banda look --follow` that lived 18 minutes after its window.

Both come from one thing: a process lives in a place that is not its
own. Roma said Banda must outlive its window, because Agents work there.
Other machines and a server are coming too. So this is to be done
properly, once.

Roma decided on 2026-11-04:

- The engine never stops by itself. It stops on Quit Banda, or when the
  Person logs out.
- It starts as herdr-core's does
  (`docs/research/2026-11-01-herdr-core.md`, "Started as systemd user
  units"): any client starts it when it is not running.
- An icon on the bar shows that it runs, and has Quit Banda. On macOS it
  is in the menu bar, with Quit there too.

**Decision.**

1. **The engine is a service of the Person's session, not the window's
   child.**
   - **It starts at login, by default, on every OS.** A setting, "Start
     Banda at login", turns that off. macOS has it first, Linux next,
     Windows later.
   - On Linux it is a systemd user unit, `<folder>-engine`
     (`banda-engine`, `banda-dev-engine`; ADR 0033's folders). With the
     setting on, the unit is enabled, so the user manager starts it at
     login. Otherwise a client starts it with `systemd-run --user`, as
     herdr-core does. Either way a window crash, a closed window or a
     dropped ssh does not take it down. Logging out does, because the
     user manager stops then. A machine that serves others has the
     user's linger on (`loginctl enable-linger`), so its engine runs
     from boot and outlives a logout.
   - On macOS it is a launchd agent, `<bundle id>.engine`. With the
     setting on, launchd starts it at login. launchd keeps the job, so it
     starts the engine again after a crash.
   - **Any client starts it** when it is not running: the setting is
     off, or the engine was quit. The window, `banda call`,
     `banda follow` and the other commands first look for a running
     engine. If none answers, they start it, then wait up to 5 s for it
     to answer. The lock that refuses a second engine stays as it is.
   - **A client on this computer comes in through the owner socket,
     checked by its user** (ADR 0083, decision 1).
   - Harnesses, Terminals and the servers started in them (ADR 0044) are
     the engine's children. So they live in the engine's unit, never in
     the window's or an Agent's process group.
   - **Its environment is the session's, never its starter's.** The unit
     gets the user manager's environment, as herdr-core's does, so a
     `banda call` run inside Claude Code does not pass on `CLAUDECODE` or
     `CLAUDE_CODE_SESSION_ID`. Otherwise every Harness and Terminal would
     think it is nested. The user manager's PATH lacks what the shell
     adds (mise, for one), and launchd's is bare, so the engine takes
     PATH from the login shell itself, as the window already does on
     macOS (`login.ts`).
   - **One child's death does not stop it.** The unit has
     `OOMPolicy=continue`, as herdr-core's does. Without it, systemd
     stops the whole unit when the kernel kills one Harness for want of
     memory.
   - **It stops its children first.** The unit has `KillMode=mixed`.
     SIGTERM goes to the engine, which stops its Harnesses and Terminals
     itself. Whatever is left after the timeout is killed. macOS has no
     such unit, so there the next engine stops what a crashed one left,
     before it listens.
   - **It knows how the last engine left.** On a clean exit the engine
     writes that it left, and how: `stopped` or `handed over` (an
     update). An engine that finds no such word knows the last one
     crashed. It writes that into the problems journal (ADR 0039), and
     marks the Turns it cut as cut by a crash, not as ended.
   - **It is whole before it listens.** The engine reads its Projects,
     marks the cut Turns, and only then says it runs and takes calls, as
     herdr-core adopts before it listens. So no client sees an engine
     half started.
   - **Banda Local stays the window's child**, with `--with-parent`, as
     today. A checkout is for development, and an Agent's test run must
     leave nothing behind.

2. **The engine runs from its own copy, never from inside the AppImage
   or the app.**
   - The window copies its `banda` into `<data>/engine/<version>/banda`,
     next to a file that names the version. Then it runs the copy once
     with `--version`, and only then renames the folder into place. So a
     half-written copy, or one that does not start, is never run. The
     unit runs that copy.
   - **A `banda` that a package manager owns is not copied.** Banda from
     the AUR (`banda-bin`) runs its `banda` where pacman put it, and only
     pacman replaces it. pacman replaces a file by a rename, so a running
     engine keeps its own.
   - **A build is known by its build id**, the ELF build id from
     `/proc/self/exe` (on macOS, the Mach-O UUID), as herdr-core does. So
     the window knows when the running engine is not its own build, even
     when the version string is the same, as two Banda Local builds are.
   - The last two versions are kept. Older ones are removed once no
     engine runs from them.
   - `banda look --follow` stays the window's child. It now watches its
     parent the way `serve --with-parent` does, and it stops when its
     stdin closes.

3. **Closing the window is not quitting Banda.**
   - Closing the last window closes the window only. The engine goes on,
     and so do the Agents.
   - **Quit Banda stops the engine.** It is in the Banda menu, on Ctrl+Q
     (⌘Q on macOS), on the bar icon, and in a new `banda stop`.
   - If Turns are running, Quit asks first, in one set of words
     everywhere, with Cancel as the default: "2 Agents work on this Mac"
     / "Quitting Banda stops them too." / "Quit anyway" or "Cancel". With
     one Agent: "An Agent works on this Mac" / "Quitting Banda stops it
     too." `banda stop` asks the same, and `--force` skips the question.
   - The engine stops its Harnesses and Terminals itself, on SIGTERM,
     before it exits.

4. **The bar shows that Banda runs.**
   - **On Omarchy, Banda ships a shell plugin.** It is a bar widget, as
     Superwhisper's panel is. It follows a new `banda status --follow`,
     which prints one JSON line on each change: the engine's version, and
     who works and who waits (ADR 0035's counter).
   - The icon is the Banda mark, and its ring is the bar's counter. With
     no engine running, there is no icon.
   - Its panel lists who works and who waits. Each row opens its Thread.
     Under the list are Open Banda and Quit Banda.
   - The window offers to install the plugin on its first run. It is
     never installed unasked. Other Linux desktops get nothing for now,
     beyond `banda status`.
   - **On macOS, Banda stays in the menu bar.** With no window open,
     Banda.app keeps running, with no Dock icon, only an icon in the menu
     bar. It has the same panel and the same Quit Banda. ⌘Q is Quit Banda
     (decision 3). Closing a window with ⌘W or the red button only closes
     it.
   - **An engine with no app opens it.** Started from another machine,
     or left running after the app crashed, the engine opens Banda.app
     hidden, by its path (`open -g -j`), so the menu bar icon and the
     calls are there.
   - The panel's look is shown to Roma as a mock first. The macOS menu
     bar mock (`mac-menubar-v1`) is accepted (2026-11-09).

5. **With no window, the engine calls the Person itself.**
   - ADR 0011's calls come from the window today: an Agent waits, or a
     Turn ends. With no window, the engine sends them itself, on Linux
     through the freedesktop notification service. Clicking one opens a
     window on that Thread, through a new `banda open --thread <id>`.
   - On macOS, Banda.app stays running, or the engine opens it
     (decision 4), so it calls the Person as it does today.

6. **An update restarts the engine once no Turn runs, or when the Person
   says so.**
   - ADR 0041 restarts the window into the new version, as before.
   - The engine is restarted from the new copy (decision 2) once no Turn
     runs, on every OS. If Turns are running, it waits. The updater says
     "Banda updates when the Agents finish", with "Restart now".
   - **Restart now warns while Agents work**, as Quit does (decision 3),
     and restarts the engine anyway if the Person confirms.
   - **brew's cask never quits Banda.** Its `uninstall` has no `quit:`
     and no `launchctl:`, so `brew upgrade` leaves the engine and its
     Agents running. Its `zap` removes the job.
   - A restart ends the Terminals, as it does today. If programs run in
     them, the update says how many before it restarts. Keeping Terminals
     across a restart is herdr-core's holder (research, point 9). That is
     its own ADR, later.
   - **The window and the engine say what they speak.** The engine's
     `welcome` says what it speaks: the protocol it picked from the
     client's range, its version and build, its Apps and their versions
     (ADR 0082, decisions 11 and 14). A window meets an engine of another
     build:
     - When their ranges meet, it attaches. It does without what the
       engine lacks, and the engine restarts later, as above.
     - When they do not, the engine answers `goodbye{unsupported}`. The
       window says why it cannot attach yet, and has "Restart now".
   - **The contract has a released copy.** `contract/released.json` is
     the contract of the last release. A test fails on any change that
     would break a client of it: a removed field, a new required input, a
     narrower input. herdr-core's `schema/released.openrpc.json` does the
     same. So a window and an engine of different builds keep working
     together. That matters here, and more once an engine is on another
     machine.

7. **Agents run Banda Local in a unit of its own.**
   - The Banda skill and `CONTRIBUTING.md` say to start a checkout's
     window with `systemd-run --user --scope`, and to stop it with
     SIGTERM, never by killing its process group. So a test run lives
     and dies on its own, apart from the Agent's group.

8. **Another machine runs the same engine**, as decision 1 says, with
   linger on. ADR 0081 and ADR 0082 say how clients reach it.
   - A Banda folder copied to another computer takes a new identity
     there, as herdr-core's machine id does.
   - This ADR only makes the engine something a machine runs without a
     window.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each.

1. The engine runs from its own copy, checked before it is used, and not
   copied where a package manager owns it. The build id comes with it,
   and `look --follow` watches its parent (decision 2). The engine is
   still the window's child here. This step alone ends the SIGBUS of
   `banda serve` and `look`.
2. Agents' test runs in their own unit (decision 7).
3. Linux: the engine as a systemd user unit, started by any client, with
   the session's environment and the login shell's PATH,
   `OOMPolicy=continue` and `KillMode=mixed`. It knows how the last
   engine left, and is whole before it listens. Closing the window is
   not quitting, and Quit Banda and `banda stop` come with it (decisions
   1 and 3). The owner socket comes with the fence (ADR 0083, plan
   step 4).
4. `banda status --follow`, and the Omarchy shell plugin, mock first
   (decision 4).
5. The engine calls the Person when no window is open (decision 5).
6. The engine updates once no Turn runs, or on Restart now, with the
   versions `welcome` names (ADR 0082, plan step 12),
   `contract/released.json` and its test (decision 6). The released copy
   and its test may come earlier, on their own.
7. macOS, in six PRs (decisions 1, 3, 4 and 6):
   - 7a. The engine as a launchd job, started at login unless "Start
     Banda at login" is off, and by any client when it is not running.
   - 7b. Cleanup after a crash: the next engine stops the Harnesses and
     Terminals a crashed one left, before it listens.
   - 7c. arc starts the Mac's engine over ssh while the Person is logged
     in at the Mac's screen.
   - 7d. `banda status --follow` (step 4's command, built here first, so
     the menu bar and Omarchy's plugin read one source). ADR 0097 (keep
     awake, battery) comes first.
   - 7e. The menu bar icon and its menu, the Dock icon only while a
     window shows, the one set of Quit words, as the accepted mock, and
     an engine with no app opens Banda.app hidden.
   - 7f. Updates: the engine restarts on the new version once no Turn
     runs, Restart now with its warning, and a cask that never quits
     Banda (what step 6 has not built yet comes here).
8. Linux: login start. The unit is enabled while "Start Banda at login"
   is on, and a machine that serves others has linger on. Linger is
   turned on once and off the start path, as herdr-core does, since
   `loginctl` can wait long on polkit (decision 1).

Another machine (decision 8) is ADR 0081's plan, after step 3. Windows
starts at login too, later.

**Consequences.**

- New commands: `banda status [--follow]`, `banda stop [--force]` and
  `banda open [--thread <id>]`. A new setting, "Start Banda at login",
  on by default.
- macOS lists the engine under Login Items, and says so once when it is
  added.
- `docs/architecture.md`: "The engine is the window's child" becomes
  "The engine is the machine's", and the window becomes a client that
  starts the engine when it is not running.
- The browser's tools work only while a window is open, until the
  Agents' pages run in the host's Chromium (ADR 0062, decision 12). With
  none, they say "No Banda window is open". `banda menu` says the same.
- Banda.app on macOS stops quitting when its last window closes
  (`window-all-closed`). On Linux, the Electron process exits with its
  last window, so a closed Banda costs only the engine.
- Most of the SIGBUS notices go: the engine and `look` no longer run from
  the AppImage. If `chrome_crashpad_handler` still dies at quit, that is
  Electron's helper. It is looked at in step 1, and kept apart from the
  rest.
- Muting the crash notices is not the fix, and is not done.
- What herdr-core has and Banda does not take: it has no access control,
  and any process of the same user can act as anyone. Banda keeps its
  passes and its one access rule (ADR 0082, ADR 0083).

**Changes.**

- ADR 0011, decisions 3 and 6: the window says how the Person is called.
  With no window, the engine sends the system notification itself, and
  a click opens a window on that Thread (decision 5). Once calls are
  worked out on the host, they follow ADR 0081 decision 6 and ADR 0082
  decision 15.
- ADR 0041, decision 2: an update still restarts the window into the new
  version; the engine restarts from its new copy once no Turn runs, or
  on Restart now (decision 6).
- Decision 1, as step 3 built it (2026-11-07): a client waits up to two
  minutes, not 5 s, for an engine whose unit runs, as the engine answers
  only once it has opened every Project, with their migrations. The
  session's display and ssh agent come from the starter where the user
  manager lacks them, as some desktops do not hand them to it.
- Decision 7, behind the fence (ADR 0083, 2026-11-07): a Thread's
  Harness runs behind the fence on Linux, which hides the session's
  runtime folder, the user manager's bus in it too. An Agent's
  `scripts/local.sh` finds no user systemd there and runs the window as
  it is: a trial an Agent starts lives inside the fence, apart from its
  process group still (`--detach`), and ends when its Harness does. The
  engine does not let a Harness go for idling while a process under it
  listens, as a trial or a server it started does. A Person's terminal
  starts its windows in a unit of their own, as before.
- Decision 1 on macOS, until step 7c (2026-11-08, Roma): another
  machine's window sees a Mac's engine over ssh only while Banda is open
  there. The `banda start --with-parent` it runs there says so
  (`BANDA_OVER_SSH`), and on a Mac it starts no engine: one would stop
  as the link drops, with its Agents, and lack the Mac's PATH. While no
  Banda is open there it exits 75, and that window shows the Mac away
  and tries again (`docs/hosts.md`). From step 7c (2026-11-09, Roma),
  arc may start the Mac's engine over ssh while the Person is logged in
  at the Mac's screen, even with the screen locked. The engine then runs
  in the screen's session, with the Person's sign-ins, as if started
  there, and takes PATH from the login shell itself. With nobody logged
  in, the Mac is away (exit 75), as before. Tried on m1pro on
  2026-11-09.
- Decision 1, login start (2026-11-09, Roma): the engine starts at login
  by default on every OS, and a setting, "Start Banda at login", turns
  that off. This replaces "started on demand, not at login" on macOS,
  and adds login start on Linux. Any client still starts it when it is
  not running. On macOS it is a launchd agent; on Linux an enabled user
  unit, with linger on a machine that serves others; Windows later.
  herdr-core uses launchd only to start its server once, apart from the
  app that launched it, and then lets the job go: no login start, no
  restart after a crash, and over ssh a plain start. Banda keeps its
  job, so the engine starts at login, comes back after a crash, and from
  ssh runs in the screen's session.
- Decisions 3, 4 and 6 (2026-11-09, Roma): Quit has one set of words
  everywhere, Cancel by default. An engine with no app opens Banda.app
  hidden, and the macOS menu bar mock is accepted. An update restarts
  the engine once no Turn runs, on every OS, and "Restart now" warns
  while Agents work, then restarts it anyway if the Person confirms.
  brew's cask never quits Banda, and its zap removes the job. Plan step
  7 is six PRs, 7a to 7f, and Linux login start is step 8.
- Decision 1 on macOS, as step 7c built it (2026-11-09): once the Mac's
  job stops as asked, another machine's window tells a Quit at the Mac
  from a logout by the Person's gui domain there. Still there 10 s on,
  Banda quit at the Mac: the host shows stopped, and is not started
  again until the Person starts it from that window, or that window's
  Banda starts again. Gone, they logged out: the host is away, and that
  window tries again each minute.
- Plan step 7c (2026-11-09): an engine with no app opening Banda.app
  hidden moves from 7c to 7e. Until 7e the app shows its window, in
  front, as it opens, so opened from another machine it would come up
  at the Mac's screen. 7e opens it with no window and turns this on.
- The draft in PR #460, decision 6: the engine's own `hello` with a
  "generation" gives way to ADR 0082's `challenge`, `hello` with a
  range, and `welcome`.
- The draft in PR #460, decision 8: what it said of another machine
  goes (the engine on loopback only and reached through ssh, the calls
  and the browser kept on the window's machine). ADR 0081
  (decisions 4 and 6), ADR 0082 (decisions 15 and 17) and ADR 0062
  (decision 12) hold how clients reach a host, where calls are worked
  out and where an Agent's pages run. A Project is on one host (ADR
  0081, decision 11).
