---
status: accepted
date: 2026-11-10
---

# Another machine's Panes run on its engine, and this device only draws them

_Roma accepted it on 2026-11-10, with each question as recommended
(Roma's calls, at the end). It is the short ADR of the roadmap's stage 2,
Remote Panes (M5), and builds ADR 0082 decision 13 and ADR 0089 decision
9. It stands on ADR 0101 (machines are peers, there is no home host) and
on [ADR 0105](0105-honest-when-away-what-the-person-sees-while-a-machine-is-away-and-what-may-wait-for-it.md)
(Honest when away), and keeps the one more deferred act that ADR 0105
leaves room for. It amends ADR 0063 (decision 6), ADR 0072 (decision 3),
ADR 0073 (decisions 5, 10 and 13), ADR 0082 (decisions 3, 12, 13 and 16),
ADR 0089 (decisions 2 and 9), ADR 0095 (decision 7), ADR 0101 (decision
7) and ADR 0105 (its rule for H5e), each with a dated note in place. Code
is cited from main at `98b9b22a`._

The roadmap's stage 2 (`docs/research/2026-11-08-roadmap-in-slices.md`)
asks for arc's terminal, Files, Git and Diff on the Mac; the pictures,
links and Run in an arc Agent's replies (E1); and arc's own settings from
the Mac (E4). Its rule is "the screen here, the data on the host", the
same contract the web and the phone need in stage 4. The machines are arc
(Arch, always on) and the Mac (m1pro), joined over `ssh` (ADR 0081 step 5
as amended; H5). Neither is home (ADR 0101): everything here works both
ways, and arc's window draws the Mac's Panes the same way.

The research is in `~/Banda/artifacts/remote-panes/research/`:
Banda today (`r1-banda-today.md`), how other products do it
(`r2-prior-art.md`), the computer science (`r3-cs-foundations.md`), one
rule for every Pane (`r4-one-rule.md`), the synthesis that joins them
(`synthesis.md`) and an adversarial check of it (`check.md`), whose
findings the synthesis took in. The Person's calls are in
`~/Banda/artifacts/remote-panes/decisions.md`, and the mock is
`mockup.html` beside it. The build plan past this ADR is
`~/Banda/artifacts/remote-panes/plan.md`.

## Where it stands

**What works already.**

- **A Pane of another machine's Project is drawn from that machine's
  session.** PaneFrame asks `useReach`
  (`client/core/src/react/hosts.ts:73-88`), which takes
  `KeptHosts.sessionOf(project, pane?, {drawn})`
  (`client/core/src/hosts.ts:341-354`, H5d), and the Pane gets that
  `Engine`. The Pane never asks where it is, and the Thread on arc runs
  so today.
- **A command to a machine that is away fails at once** with
  `Unreachable`, and one on its way as the machine goes says
  `may_have_run` (H5b, `sdk/contract/src/engine.ts:516-531`); `problem()`
  words both (`client/ui/src/lib/words.ts:12-27`).
- **The terminal lives on its machine.** Its PTY and 2 MiB of numbered
  history are in the engine (`apps/terminal/engine/src/history.rs:11`), so
  a shell outlives the window that drew it.
- **A restart is an event.** The welcome says `boot`
  (`kernel/src/api.rs:142-145`), and the browser's lent tabs end on a new
  one already (`apps/browser/desktop/src/lends.ts:30-37`).

**Only the Thread opens on another machine.**

- Only `agents.thread` says `elsewhere`
  (`apps/agents/pane/src/ThreadPane.tsx:31`; the flag,
  `client/ui/src/pane.ts:166-170`). Every other kind says "Not on arc yet"
  (`client/web/src/tiling/PaneFrame.tsx:482-483`; the e2e,
  `client/desktop/e2e/hosts.spec.ts:781`).
- The gate reads this machine's modules (`PaneFrame.tsx:240`, from the
  window's own engine, `client/web/src/App.tsx:30`), while New Pane lists
  by the Pane's engine (`client/web/src/registry.tsx:373-374`).
- Nothing checks the flag. A kind that says `elsewhere` may still call the
  desktop's bridge, and `elsewhere` is not in `window.json`
  (`engine/src/modules.rs:116-126`).

**Five places mount App code, by four rules.** PaneFrame gates and
routes. `FloatingPane` mounts a Pane on the window's own engine, with the
Shell's unfiltered `run`, for Quick Look and for the Sheet, where
Settings and Usage open since ADR 0102
(`client/web/src/window/Peek.tsx:144-193`,
`client/web/src/window/Sheet.tsx:156-166`,
`client/web/src/window/Shell.tsx:875-892`). The sign-in dialog of
Settings' Agents section mounts a Harness's Pane the same way
(`client/web/src/settings/Agents.tsx:91-92`). The Banda menu's sources get
the window's own engine and a folder from its own Projects
(`client/web/src/menu/BandaMenu.tsx:166-175`).

**What runs where is decided in four places.**

- A remote Pane's `run` passes four Window actions and the item actions
  marked `elsewhere` (`runOnHost`, `client/core/src/hosts.ts:791-821`;
  `ELSEWHERE`, `client/web/src/registry.tsx:179-183`). Anything else
  returns and says nothing (`hosts.ts:817`): `file.open`, `browser.open`,
  `terminal.run`.
- Keys, menus and the Thread menu run through the Shell's own `run`
  (`runAction`, `client/web/src/window/actions.ts:1334`;
  `client/web/src/window/Shell.tsx:595`), unfiltered, so one action
  behaves one way from a key and another way from a Pane.
- The Thread switches its parts off by `args.host`
  (`ThreadPane.tsx:41`, `apps/agents/pane/src/thread/Thread.tsx:103`) and
  holds Send with `heldWords` (`Thread.tsx:111`).
- An owner nobody knows falls through to this machine. `hostOfPane` gives
  none for a Project no machine lists (`hosts.ts:557-567`), and
  `sessionOf` then gives this machine's engine (`hosts.ts:346-349`). A
  Pane restored while its machine is away stays on it only through
  `args.host`, which PaneFrame writes back into the arrangement
  (`PaneFrame.tsx:280-287`); without it, it binds to this machine
  (`client/core/src/react/hosts.ts:81`).

**Acts still go later by themselves.** H5b fails a command at once; a
call and a stream still wait.

- A call made while the link is down waits for it
  (`sdk/contract/src/engine.ts:206`). 27 calls write or run:
  the terminal's `open`, `write`, `resize`, `close` and `stop_server`
  (`apps/terminal/engine/src/lib.rs:84-99`); git's `stage`, `unstage`,
  `revert`, `switch`, `branch` and `init`
  (`apps/git/engine/src/lib.rs:142-164`); the browser's four, the keys'
  seven, four of the harnesses' account calls and `window.answer`. The
  macro allows it: a `call` is "a read, or an act that keeps no receipt"
  (`kernel/src/methods.rs:9`).
- A stream asked for while the engine is not open is kept, and sent on
  the next welcome (`engine.ts:453`, `:614`); only one already sent ends
  with `may_have_run` (`engine.ts:681-690`). Four streams act: `git.act`,
  which commits, pushes and pulls (`apps/git/engine/src/lib.rs:157`);
  `files.move` and `files.copy` (`apps/files/engine/src/lib.rs:173`,
  `:177`); and `agents.write` (`apps/agents/engine/src/lib.rs:346`).
- Before its act, Commit asks two reads, `git.prompt` and `git.written`,
  and between them has a Harness write the message on `agents.write`
  (`apps/git/pane/src/chain.ts:173-188`, `:90-121`). A read waits while
  its machine is away, by H5b's own test
  (`sdk/contract/test/engine.test.ts:485-524`).
- So a hunk reverted in arc's Diff (`apps/git/pane/src/DiffPane.tsx:190`),
  or a Commit clicked, while arc is away, would run once arc is back.
- A right is authority, not effect. `projects.browse` and
  `projects.foreign` need Manage and only read
  (`kernel/src/kernel.rs:388`, `:392`), as `harnesses.account` does
  (`platform/harnesses/engine/src/module.rs:113`); `terminal.watch` needs
  Run and only reads the screen (`apps/terminal/engine/src/lib.rs:93`).

**Electron main and the device read this machine's disk.**

- The byte and page hosts find a Project's folder through main's one
  engine client (`folderOf`, `client/desktop-kit/src/engine.ts:23`;
  `wholeIn` and `FileHost.url`, `client/desktop-kit/src/files.ts:277-296`;
  `client/desktop-kit/src/preview.ts:86`), and `useFileUrl` asks main, not
  the Pane's session (`client/ui/src/hooks/use-file-url.ts:54`).
- The agents module's `media` and `paths` find files on this machine
  (`apps/agents/desktop/src/index.ts:26-40`).
- Every `file.*` action asks this device's disk first (`present`,
  `client/web/src/window/actions.ts:529-536`).
- Apps call the desktop's bridge with bare paths
  (`client/ui/src/lib/outside.ts:72-98`), as Files' rows do
  (`apps/files/pane/src/RowMenu.tsx:167-196`).
- A drag and Files' clipboard hold bare whole paths
  (`client/ui/src/lib/file-drag.ts:16-29`,
  `apps/files/pane/src/clip.ts:9-16`), and both machines have
  `/home/roma/…`.

**The terminal's Pane.**

- A key is a `terminal.write` call, which waits while the link is down.
- A Pane's close sends `terminal.close` once and drops any error
  (`apps/terminal/pane/src/TerminalPane.tsx:114-119`). Since H5d a close
  while its machine is away sends nothing (`closedOf`,
  `client/web/src/registry.tsx:314-325`), so the shell would run on.
- A watch that finds its terminal gone starts a new shell by itself
  (`TerminalPane.tsx:336-339`), so after an engine restart the screen
  comes back empty and nothing says why.
- The screen fits when its Tile's size changes
  (`TerminalPane.tsx:375-386`), and the away pill takes 32 px inside the
  Tile (`PaneFrame.tsx:470`), so the last rows would go under its edge.
- A link opens with `window.open` (`TerminalPane.tsx:149`), past the
  device.
- A reply's Run opens a terminal Pane with its line in the Pane's args,
  typed once its shell runs (`apps/terminal/pane/src/index.ts:31-42`,
  `TerminalPane.tsx:252-260`). The args keep the line until then, across
  a restart too, so a Pane opened while its machine is away would run the
  line once the machine is back.

**Settings.** One global look holds every file
(`client/ui/src/lib/look.ts:10`), from this device's `banda look
--follow`. A new Thread's account comes from this device's `agents.toml`
(`useStartsOn`, `apps/agents/pane/src/thread/starts-on.ts:143-151`). The
engine can write a setting (`keys.settings_set`,
`platform/keys/engine/src/lib.rs:464`) but not read one.

**Tests.** The end-to-end "arc" shares this machine's disk
(`client/desktop/e2e/hosts.spec.ts:1-38`), so a test passes while main
reads the wrong machine's file. devbox's containers make no user
namespaces (`.github/workflows/ci.yml:1-5`), and the fence's tests run on
GitHub's Ubuntu VM for that reason (`ci.yml:167-204`). The architecture
ratchet reads each file's own imports
(`client/web/src/architecture.test.ts:152`), so a helper in `@banda/ui`
hides a bridge. Files' previewers are in no kind's imports at all: the
module registers them (`apps/files/pane/src/index.ts:27`), each loads its
view lazily (`apps/files/pane/src/previewers.ts`), and the window hands
every module's previewers to every Pane (`client/web/src/App.tsx:73`).
Some of them reach the device (`apps/files/pane/src/views/page.tsx:22`,
`apps/files/pane/src/views/markdown.tsx:162`).

## Decision

### The six laws

They hold for every Pane, key, menu and Widget, and for any App, Banda's
or one from elsewhere. Decisions 1 to 9 apply them. Each law says its
basis in one line and what holds it.

**Law 1. A Pane holds three handles, and nothing else.**

- **Its owner:** a session to the machine that holds what it shows. That
  is its Project's machine, or, for a machine's own Panes (Settings for
  arc, arc's Usage), the machine it names.
- **Its window:** the arrangement (open, update, close, label, run), the
  Message box and Quick Look, and the Person's shared files, from the
  window's own machine (ADR 0101, decision 2).
- **The device:** its capabilities (ADR 0082 decision 12, ADR 0089
  decision 2), the device's files (`terminal.toml`, the look) and its
  storage (a Thread's drafts).

It reaches no disk, no bridge, no `window.banda`, no engine of its own,
and no store bound to one engine for every Project. Two kinds sit at the
edges by nature: `browser.browser` is the device's (ADR 0062, decision
12), and `window.settings` holds all three handles at once.

- _Basis:_ least authority and object capabilities, "only connectivity
  begets connectivity" (Miller 2006); the confused deputy (Hardy 1988);
  Plan 9's per-process name space.
- _Held by:_ the kind checker (decision 2), every Pane mounted through one
  function (decision 1), and the ratchet "client/desktop reads no Project
  path" (step 4b).

**Law 2. Every value that leaves a Pane names its owner, stamped by the
session.**

- A file is a `ProjectFile {project, path}`; a machine's own file outside
  any Project is a `MachineFile {machine, path}`; a web address is a
  `Link {url, of}`; a thing is an Address (ADR 0082, decision 15).
- Only a session makes a `ProjectFile`, and it stamps `project` from its
  own binding. A ProjectId in a host's answer is never copied into a
  value: another host is only semi-trusted (ADR 0082, decision 15), and
  the clash rule lets this machine win an ID both hold (`#placed`,
  `client/core/src/hosts.ts:461-485`), so an arc reply naming one of the
  Mac's Projects would hand Preview the Mac's file.
- A `Link` from a host is http(s) only: `file:` and `app:` never reach the
  device.
- Nothing kept or shared holds a route or a device's name for a machine.
  Only the owner compares two paths: a Mac's disk ignores case by default
  and a Linux one does not.
- _Basis:_ Saltzer's closure, a name means nothing outside its context
  (1978); RFC 1498's names, addresses and routes; Zooko's petnames.
- _Held by:_ a brand on `ProjectFile` and a lint against making one
  outside the session; drop and paste payloads parsed, never trusted; a
  test that a host's answer naming another machine's Project is refused;
  the same-path test (step 1a′).

**Law 3. An act runs where its values live, or says why not.**

- One router, `routeAct`, decides for every Pane, key, menu and Widget.
  It has four targets:
  - values of one Project go to that Project's machine;
  - a machine's own thing, named by its Host scope's ID, goes to that
    machine: Settings for arc, sign-in on arc, arc's Usage;
  - device things go to the device;
  - an act with no values is the window's.
- An owner the directory does not know fails closed: it never falls
  through to this machine's engine. Values of two machines are refused in
  words, and later make a named transfer. Nothing runs on this machine in
  another's place, and nothing is dropped without a word.
- The router is the client half of resolving an intent (ADR 0087 decision
  5, ADR 0062 decision 6, ADR 0082 decision 7): an App reaches another by
  `verb@major`, and the router finds whose machine runs it. There is one
  router, not two.
- _Basis:_ complete mediation through one reference monitor (Saltzer and
  Schroeder 1975); one writer per record (ADR 0081, decision 1).
- _Held by:_ `routeAct`'s unit tests, an unknown owner failing closed
  among them; the same-path test's roads.

**Law 4. A read may wait for the link; an act goes now, or says why not.**

- A **read** is a query, a subscription or a stream that watches. It is
  safe to send late: it waits for the link, or answers "as of" once H5c's
  cache is there, and goes on from the last event it had.
- An **act** is anything else: a command, a call that writes or runs, a
  stream that does something. It goes now, at most once, and ends done,
  refused, or `Unreachable` with `may_have_run`. While its machine is
  away it fails at once.
- **A gesture is one act.** The reads a gesture makes before its act, as
  Commit's `git.prompt` and `git.written` around its Harness's
  `agents.write`, go with it and fail as it would, so a click never
  completes later by itself.
- **What may wait** is only what the Person chose: "Send when back" on a
  message to a Thread (ADR 0105), and what an ADR names as deferred by the
  Person in its own words. Here that is one thing: a terminal closed while
  its machine is away (decision 4). Nothing else runs later by itself.
- An act is known by its method's line in `methods!`, not by its kind or
  its App. A right says what a method may do, not what it does, so it is
  only the default: a method whose right is Read is a read, and any other
  is an act unless its line says `read`. A missing mark is safe: a read
  taken for an act fails fast while away, and says so.
- A query is always a read and a command always an act. A `call`, until
  ADR 0082 decision 11 makes each a query or a command, is either by its
  line. Step 0′ does not make every write a command: one that is repeated
  or shared still becomes a command, with its receipt (ADR 0082,
  decisions 3 and 4).
- _Basis:_ partial failure belongs in the interface (Waldo et al. 1994);
  the end-to-end argument, only the App can say what "may have run" means
  (Saltzer, Reed and Clark 1984).
- _Held by:_ an `Engine` test, every act failing at once while away,
  calls and streams alike, one in flight ending with `may_have_run`, and a
  Commit with its reads refused whole; a snapshot of the contract's table
  of reads and acts, so a new method or a changed mark shows in review.

**Law 5. The platform watches the link; the App says what a missed act
means.**

- PaneFrame and the hosts router alone show live, away, restarted and
  "Not on arc yet", the same for every Pane, in ADR 0105's words.
- The App decides only what an act that did not happen means: a key
  refused, a draft kept, a close sent once the machine is back.
- A Pane may read its owner's status, as the Message box must to turn Send
  off while away (ADR 0095, decision 7), but it writes no connection code.
- _Basis:_ Erlang's supervisors and monitors, "let some other process fix
  the error" (Armstrong 2003); E's broken references (Miller 2006).
- _Held by:_ the kit's skeleton (`client/ui/src/testing/conformance.ts`):
  every `elsewhere` kind mounted with a recording session, played live,
  away before an act, away with an act on its way, and back with a new
  `boot`; nothing hangs without words, and there is one pill.

**Law 6. No Pane asks where it is; it asks what can run.**

- `device.has(cap)` and `device.local(file)` answer for the device.
- `runs(action)` asks the router two things: whether the action's App is
  on the owner's machine (the welcome's `modules`), and whether its values
  can be routed. Asking method by method needs each action to name the
  methods it calls (ADR 0082 decision 2's `calls`, not built); until then
  a missing method is the engine's refusal, shown as "Not on arc yet".
- Machines run different builds, so a feature is detected, never assumed
  from a version or a place.
- _Basis:_ feature detection, not the user agent; Deutsch's fallacy "there
  is one administrator"; ADR 0082 decision 14's N−1.
- _Held by:_ a ratchet that App code reads no `args.host` and no
  `Here.pane.host`; a case in the kit for a machine that lacks the App or
  the method.

**One budget, which is not a law: one round trip per gesture.** Methods
take batches (`files.locate {paths}`); an answer that names bytes carries
their URLs; no act chains a stat before it, as `present()` does today.
The per-host latency of the end-to-end tests counts a gesture's round
trips. ADR 0088 decision 1's 16 ms is for tiling keys, drawn before the
host answers (its decision 11); a key to arc's PTY echoes only after a
round trip.

### The decisions

1. **A Pane is the same code on every machine and every client.**
   - It names its Project and the one thing it shows (ADR 0087). Its owner
     is `sessionOf(project, pane)` (H5d; ADR 0089, decision 5), and
     `PaneProps.engine` stays that handle, so its call sites stay.
   - `PaneProps` gains `device`, thin in stage 2: `has(cap)` and
     `local(file)`. `run` goes through `routeAct` (law 3), and `runs`
     asks the router (law 6), not a list of flags.
   - Every Pane host mounts a Pane through one function: PaneFrame (the
     Strip, the Drawer, a popped-out window), `FloatingPane` (Quick Look,
     and the Sheet where Settings and Usage open) and the sign-in dialog
     of Settings' Agents section. The Banda menu's sources and Widgets take
     their session the same way.
   - `args.host` stays until a device-local directory cache maps each
     ProjectId to its machine's ID (`welcome.machine` now; ADR 0082
     decision 15's `Host(key)` after pairing). Then PaneFrame stops
     writing it, routing stops preferring it, as ADR 0062 decision 13,
     ADR 0082 decision 15 and ADR 0087 decision 4 already say, and a Pane
     restored while its machine is away shows "arc is away", not this
     machine's refusal.
   - An owner the directory does not know fails closed.
   - The Thread's `args.host` branches go, one per slice.

2. **A kind opens on another machine when it says `elsewhere`, the kind
   checker passes it, and that machine's welcome lists its App** (Roma,
   Q1 B).
   - `elsewhere` stays on kinds, off by default. A kind that says it must
     pass the kind checker in the architecture test: over its transitive
     imports, `@banda/ui`'s helpers and `import()` included, its code
     reaches no `@banda/ui/desktop`, `window.banda`, `navigator.clipboard`,
     `window.open` or `new Engine`, outside the device's own helpers (the
     clipboard's text: `copyText`, which the copy button uses too, and the
     terminal renderer's own copy and paste) and a named list that only
     shrinks: the Thread's, until steps 3c, 4c and 4d. The walk stops at
     `@banda/core` and `@banda/contract`: they make every Pane's session
     and declare the bridge, and are the platform's, with ratchets of their
     own. It
     works per kind, not per module, and matches calls by their symbol,
     not a parameter named `window`. It is a lint: it cannot see dynamic
     access.
   - A previewer (ADR 0073, decision 6) is code a kind draws without
     importing it: the window hands every module's previewers to every
     Pane. So a previewer says `elsewhere` too, and the checker passes it
     as it does a kind. A file of another machine is drawn only by a
     previewer that says it; any other shows the file's facts, as arc's
     PDFs, pictures and videos do until step 4 (call 10 A).
   - Stage 2 makes these `elsewhere`: New Pane (1a), the terminal (1b),
     Diff (2a), Files' tree and file with the previewers that draw text
     (3b), the byte previewers (4c) and the Visual (4d).
   - The gate reads the owner's welcome, not this machine's. New Pane on
     another machine's Project lists what opens there; the rest show
     dimmed, "Not on arc yet", and its top says "in banda on arc" (call 6
     A).
   - A machine whose build lacks an App says "Not on arc yet", and the
     pill offers "Update arc" (ADR 0095, decision 7). A missing method is
     the engine's refusal, in the same words: never an empty Pane.
   - `window.settings` and `harnesses.usage` go to a named machine (law
     3). Stage 2 builds Settings for arc (5b); arc's Usage waits.
   - `browser.browser` is the device's by nature (ADR 0062, decision 12),
     not an exception that shrinks. An arc page reaches it as a `Link`,
     and later through a forwarded port.

3. **An act goes where its values live, through one router, and nothing
   is dropped silently.**
   - `routeAct` in `client/core` replaces `runOnHost`, `RUNS_ELSEWHERE`,
     `ITEMS_ELSEWHERE` and the registry's `ELSEWHERE`. No action carries
     a flag (Roma, Q1 B): `ItemAction.elsewhere` goes too, as an item
     action's Item names its Project.
   - An action whose args name no Project takes the Pane's, by ADR 0087
     decision 4's fill rule.
   - Keys, menus, Widgets and Panes share the router, so an action does
     the same from each.
   - An action the owner's machine does not run says so in a toast, "Not
     on arc yet: Open in a browser", in place of a click that does
     nothing.
   - Rows that act on this device's disk (open in its app, reveal, open
     in an editor, drag out) draw where `device.local(file)` gives a file
     of this computer (ADR 0082, decision 12). For another machine's file
     the row says "Show in Files" (call 7 A).
   - A link is a `Link`. A public page opens in this device's browser
     (call 5 A); another machine's `localhost` says "localhost:3000 is
     arc's · Copy" until port forwarding.
   - An act on two machines' values is refused in words that say where
     the file is: "That file is on arc", or "That file is on this Mac.
     Files don't move between machines yet." for a Mac file held over
     arc's tree (call 8 A).

4. **A terminal runs on its machine; the device only draws it.**
   - The PTY, its history and its title stay on the host. The font, size
     and cursor are this device's `terminal.toml` (ADR 0101, decision 3).
   - **A key goes now or never** (call 2 A), law 4 applied. Once Banda
     knows arc is away no key goes, and the terminal says so in ADR 0105's
     words: "arc is away: your typing was not sent." Whether a key after a
     quiet spell waits for H5c's ping first is #1223, decided in step 1b.
   - **That is said honestly** (Roma, Q3 A). Bytes ssh had already written
     stay in the system's socket, which sends them again until TCP gives
     up, often a minute or more, so a key typed just before Banda knew may
     still land once the link is back. The terminal's note says so in its
     tooltip: "What was typed before arc went away may still arrive once
     it is back." The pill stays ADR 0105's. The end fix is a `not_after`
     checked in the host's time, with H5c's clock offset: later, #1241.
   - **The shell outlives the link.** When arc is back, the same shell and
     screen come back. A Pane opened or restored while arc is away watches
     its shell again and sends its size once arc is live (#1224, steps 1a″
     and 1b).
   - **Run goes now or not at all.** Run in an arc reply (ADR 0063,
     decision 6) runs its line in a new terminal on arc. While arc is away
     it is refused at once, "arc is away: Run was not sent.", and no Pane
     opens. A terminal Pane types its line only into the shell its first
     open started: if that open fails, the line is dropped, so a line never
     runs later by itself, after a reconnect or a restart. Sign in on arc
     starts its terminal with `terminal.open` before its Pane opens, an act
     that is refused at once the same way
     (`apps/agents/pane/src/thread/SignIn.tsx:199-205`).
   - **It ends** when its Pane closes, or when Banda restarts on arc. A
     new `boot` with the terminal gone says "Ended: Banda restarted on arc
     · New shell here", in place of today's silent new shell. An update
     waits while one of its machine's terminals runs a program in front,
     as it waits for Turns (call 4 B; amends ADR 0072). Keeping terminals
     across a restart stays #462.
   - **A Pane closed while arc is away closes on arc once arc is back**,
     with a toast, "Closes on arc once it is back" (call 3 A). It is the
     one deferred act law 4 names here, the room ADR 0105 leaves, and it
     waits as ADR 0105's message does (its Q1 and its rule for H5e): in
     H5e's queue on this device, per machine, kept across a restart of the
     window (Q6), counted in the pill's "· 1 waiting" (Q3), and sent once
     arc is live, in the order queued, before anything new.
     - It keeps the queue's longest time, 7 days, with no Keep for: a
       close that lands late still does what the Person meant, as it ends
       only a shell no Pane draws.
     - It names the `boot` its terminal ran under, and is dropped once
       arc's welcome says another, since that shell ended with it.
     - `terminal.close` is a call with no CommandId. One that may have
       gone goes again, since a second close does nothing.
     - In the end shape it is `pane.left@1`, sent by the engine that holds
       the arrangement and carried by its window to arc (ADR 0101,
       decision 5).
   - The away pill's band comes out of the size the Tile gives the Pane
     (ADR 0088), so the prompt stays in view.
   - Nothing from another machine writes this device's clipboard: no OSC
     52.
   - Flow control is measured first: `cat` a large file while a Thread
     streams. VS Code pauses at 100k characters not acknowledged. Credits
     (ADR 0082, decision 11) come only if the measure asks for them
     (#1237).
   - The size rule for two viewers (tmux's `latest`) is written down
     before "Running on arc" (#1234), the only road to a second viewer
     (ADR 0101, decision 5).

5. **Files, Git and Diff of a machine are its engine's, and a value
   carries its Project.**
   - arc's Files is arc's engine's Files, not a remote folder (ADR 0073,
     decision 15, stands).
   - A `ProjectFile` crosses each boundary: chips, a drag, the clipboard,
     `file.*` args. Inside a Pane a path stays a string.
   - Quick Look, quick open, Project signs and every `file.*` act use the
     session of the file's Project; `present()` becomes `files.stat`
     there. Quick Look's header names the machine as a Pane's does.
   - The host judges whether two names are one file: no path is compared
     on the device.
   - A dragged or copied file carries its Project. Dropping or pasting it
     into another machine's Pane is refused (call 8 A). A file from
     another app dropped into a Message box still goes, as a picture, as
     its bytes travel today.
   - Pinned places are each machine's (call 9 A). Until step 5b arc shows
     its Home, Desktop, Downloads and Projects (`files.places`).
   - arc's PDFs, pictures and videos show the file's facts until step 4
     (call 10 A).
   - A line comment and Add to chat go to the Message box of a Thread on
     the same machine. The comment is Files' code view's
     (`apps/files/pane/src/views/code.tsx:223`); the Diff has none yet
     (#1225).
   - Commit, Push, a hunk revert, a move and a copy are acts by law 4.
     Commit's control stays pending until its stream ends; after
     `may_have_run` it offers "Check", which reads arc's git again and
     says what happened. A resend that runs only if the first did not
     needs `git.act` as a command plus facts (ADR 0082, decisions 4 and
     8): later, #1233.
   - A file edited while arc goes away keeps its unsaved text, with "Not
     saved: arc is away". It saves on the next keystroke or Save once arc
     is back, over its base hash, as today.

6. **Bytes come from the host by a signed URL** (ADR 0082, decision 13).
   - `platform/bytes` issues them: `bytes.issue {path, use}` gives a token
     for `/b/<token>`, read by range, or `/p/<token>` for a page shown in
     a frame. `FileLinks` and `PreviewHost` move to Rust as they are:
     realpath, inode, no link followed, ranges, an hour, the sandbox CSP.
   - `bytes.issue` asks what `files.read` asks: the same right, and only a
     file that session may read, so an Agent's pass mints a token only
     for what its own reads reach. A token serves the one file it names,
     and nothing else.
   - _Amended 2026-11-10, with step 4a:_ the URL is not signed. A token
     is 256 bits from the system's randomness, kept only in the engine's
     memory beside the file it serves, so it names nothing and a restart
     ends every token. And an Agent is given none yet: `/b/` serves
     outside the fence, so it would not read a file as an Agent's own
     reads do. The window asks for what it draws, as the window's hosts
     gave links to the window alone, and an answer to an Agent carries no
     URLs. Every way the engine gives a token keeps that one rule (#1264).
   - The engine serves `GET /b/` and `GET /p/` beside `/ws`. A `/p/` page
     is sandboxed with an opaque origin, since any loopback origin may
     open `/ws` (`origin_allowed`, `kernel/src/api.rs:266`).
   - An answer that names bytes carries their URLs (`files.list`,
     `files.locate`, a Thread's media), so no gesture asks for a URL and
     then fetches it. A Pane keeps `{project, path}`, never a URL, and asks
     again after a reconnect.
   - The desktop relays `app://files/<machine>/<token>` and
     `app://preview/<machine>/<token>` to that machine's forward (call 11
     A; `Hosts.address`, `client/desktop/src/hosts.ts:1007`). `<machine>`
     is this device's name for it in `hosts.toml`, which is fine only
     because the URL is never kept (law 2). The page's rules stay as they
     are, a link keeps working when ssh reconnects on a new port, and one
     client function makes the URL, so the web differs only there.
   - This machine takes the same road, so Electron main reads no Project
     path (ADR 0089, decision 9): its signer, `folderOf`, `wholeIn` and
     the agents module's `media` and `paths` go. The test that says so
     comes with step 4b and names `paths` as its one exception, which
     goes with step 3c.
   - `files.locate` is `findFiles` moved into Files (ADR 0073, decision
     12), so a reply's paths are found by the host that has them. It
     keeps `findFiles`'s rule that a path to a network share is never
     looked at (`onThisMachine`, `apps/agents/desktop/src/paths.ts:6-8`).
   - _Amended 2026-11-10, with step 3c:_ an answer is
     `{asked, file, relative, inside}`, what the window draws a path
     with, and has no `line`: the window takes a path's line off before
     it asks, and matches the answer by `asked`. Only paths that name a
     file are answered. An Agent's call looks only inside its Project's
     folder, so what it finds says nothing of what is outside, and a
     URL's path (`smb://host/…`) is never looked at.
   - Until pairing (H3) a token is the capability, bound to the file and
     the hour, not yet to a device (#1248).
   - **Save a copy to this Mac** (step 4c) is a device capability,
     `save_file`: the Person picks the place in the device's own save
     dialog, and the device fetches the bytes by the host's URL. It joins
     ADR 0082 decision 12's closed list and ADR 0089 decision 2's port.
   - Visuals come by `/p/` too (call 12 A). Their layout check stays E13
     (#1247).

7. **Each settings file is read and written by its owner** (ADR 0081
   decision 12; ADR 0101 decisions 2 and 3).

   | Class (ADR 0101, decision 3) | Files | Read and written |
   |---|---|---|
   | Machine | `machine.toml`, `harnesses.toml`, `sharing.toml`, `agents.toml` `[start]`, `browser.toml`'s Agents' part, `files.toml` `pinned` | through that machine's engine: `keys.settings_read` with `keys.settings_changed` (new), `keys.settings_set` and the rest (there) |
   | Shared | `keys.toml` `[binds]`, `sidebar.toml`, `[notify]`, `themes/`, `agents.toml` `enter` and `flow` | each machine's own copy; a window reads and writes its own machine's, never another's (copied later, E14) |
   | Device | `hosts.toml`, `terminal.toml`, `mod`, the rest of `look.toml`, `files.toml` but `pinned`, the Person's browser | never leave the device |

   - Each section says its class in its `SettingsFile`
     (`platform/look/src/file.rs:24`), and step 5b reads it: only machine
     files switch with "Settings for: This Mac / arc" (call 16 A),
     opened from an arc Pane on arc; the rest say "on this Mac".
   - A window reads the Person's files from its own machine even when the
     Pane in focus is arc's (law 1's window handle): a key bound on the
     Mac works in arc's terminal on the Mac, and arc's own window keeps
     arc's keys.
   - While arc is away its settings show "as of 14:02", and a change is
     refused at once. "Open the file" is hidden for arc's files; the path
     shows, with Copy (call 18).
   - Stage 2 changes only the machine's files. The arrangement stays the
     machine's whose window shows it (ADR 0101, decision 5).

8. **Stage 2 adds no away handling of its own, once every act fails
   fast.** Step 0′ makes that true: until then calls and acting streams
   wait. Then H5b refuses at once, H5c keeps rows dim with "as of", and a
   remote Pane keeps its last screen under the pill (ADR 0095 decision 7,
   ADR 0105). The additions are decision 4's terminal rules, among them
   the close that waits, and a Pane restored while its machine is away
   showing the pill's words (step 1a″).

9. **Not in stage 2.** Each is in Later, with its issue.
   - arc's browser and port forwarding, with arc's servers on the Bar.
   - Panes an arc Agent opens, shown on the Mac (ADR 0101 decision 6, H6).
     The machine that places one needs `elsewhere` in `window.json` to
     check its kind.
   - Add Project on arc (#1011); arc's Usage Pane and the Bar's Limits for
     arc.
   - A Visual's layout measured on the Mac (E13); the terminal keeper
     (#462); credits and binary frames (ADR 0082, decision 11); predicted
     echo; copying files between machines; a terminal that keeps its
     machine awake (ADR 0097 counts Turns only).
   - What stage 4 and the SDK need and stage 2 does not (Roma, Q5 A):
     typed results on every call (`Read`, `Outcome`), the typed device
     port with an opaque `DeviceFile` (W1), the welcome's Apps and
     methods (ADR 0082 decisions 14 and 2), the web shard, property tests,
     `banda app check`, and `app.toml`'s `device` list (`[needs]` is
     refused today, `engine/src/modules.rs:77-82`). ADR 0082 decision
     12's list of capabilities changes only by `save_file` (decision 6):
     `device.local` is a question about a file, not a capability.

## The contract

| Where | What | Step |
|---|---|---|
| kernel, contract | `methods!` takes `read` on a method whose right is not Read but which only reads: `terminal.watch`, `projects.browse`, `projects.foreign`, `harnesses.account`, `window.requests`. The contract says of each method whether it is a read or an act, as a value the client reads at run time | 0′ |
| `sdk/contract` | `Engine` fails every act at once while its machine is away, calls and streams as commands already do; one on its way as the machine goes ends with `may_have_run`. The reads a gesture makes first are asked as part of its act. No wire change, no receipt, no new queue | 0′ |
| `client/ui` | the kind checker, over kinds and previewers; `elsewhere` on a previewer; the kit's skeleton (`client/ui/src/testing/conformance.ts`) | 1a′ |
| tests | the same-path job on GitHub's VM; the fake arc's files only in its own folders; per-host `BANDA_TEST_LATENCY` and a `blackhole` that drops packets without a reset | 1a′ |
| `client/core` | `routeAct` and `Owner` (a Project, a machine, the device, the window) in place of `runOnHost` and the three sets; `ItemAction.elsewhere` goes | 1a |
| `client/ui` | `PaneProps.device` (`has`, `local`); `PaneProps.runs` asks the router | 1a |
| `client/core` | the directory cache, ProjectId to the machine's ID, kept on the device; then no `args.host` written | 1a″ |
| `client/core` | `Link {url, of?}`, from a host http(s) only | 1b |
| host | `terminal.running`, a Read stream of how many of a Project's terminals run a program in front, again as it changes; the update's wait sums its machine's Projects (the terminal module is a Project's, `kernel/src/module.rs:23-29`) | 1d |
| `client/core` | a terminal's close in H5e's queue (ADR 0105), with the `boot` it ran under | 1d |
| `client/core` | `ProjectFile {project, path}`, made only by a session; `MachineFile {machine, path}` | 3b |
| host | `files.locate {paths, worked}` → `[{asked, file, relative, inside}]` (amended with step 3c), with byte URLs (4c) | 3c |
| host | `bytes.issue {path, use}` → `{token, until}`, under `files.read`'s right and reach; `GET /b/<token>` with ranges; `GET /p/<token>`, sandboxed | 4a |
| desktop | `app://files/<machine>/<token>`, `app://preview/<machine>/<token>` relayed to that machine | 4b, 4c |
| device | `save_file`, a save dialog and then the bytes by the host's URL | 4c |
| host | `agents.defaults` also says the machine's start account and fallback | 5a |
| host | `keys.settings_read {file}` → `{file, values?, keyed, problems, rev}`; `keys.settings_changed` → `{file, rev}`, a Read stream (amended with step 5b) | 5b |

- **Kept, now checked:** `PaneKind.elsewhere`.
- **Never added:** the draft's `Action.elsewhere`, and `PaneProps.runs` as
  a lookup of flags.
- **Kept from before:** `sessionOf`, `Unreachable` with `may_have_run`,
  the welcome's `modules`, `machine` and `boot`, the terminal's program
  in front.
- **Later (W1, stage 4, the SDK):** `Read` and `Outcome` as every call's
  result (#1226); the typed device port and `DeviceFile` (#1227); the
  welcome's Apps and methods (#1231); `terminal.watch {after}` from the
  last piece (#1236), and `terminal.list` (#340).

## The words

What the Person reads:

"Not on arc yet" · "Not on arc yet: Open in a browser" · "in banda on
arc" (New Pane's top) · "arc is away: your typing was not sent." · "What
was typed before arc went away may still arrive once it is back." · "arc
is away: Run was not sent." · "Closes on arc once it is back" · "Ended:
Banda restarted on arc · New shell here" · "Waits for a program in a
terminal to finish" (the update, beside "Waits for a Thread to finish its
turn") · "Opens in this Mac's browser" (a link's hint) · "localhost:3000
is arc's · Copy" · "That file is on arc" · "That file is on this Mac.
Files don't move between machines yet." · "Show in Files" · "Save a copy
to this Mac" · "Not saved: arc is away" · "Check" (after "arc went away;
Push may have gone through.") · "Settings for: This Mac / arc" · "on this
Mac" · "Change this once arc is back" (a machine's setting while it is
away) · "Sign in on arc for now".

Words of the code, which `GLOSSARY.md` gains with step 0′: an **act**, a
method that changes or runs something, and a **read**, one that only
reads (law 4); and a value's **owner**, the machine or device it belongs
to (law 2). They sit beside GLOSSARY's Query and Command: a query is a
read, a command is an act, and a `call` is either by its line. A value's
owner is not the Owner socket, the way the Person's own window and CLI
reach their computer's engine. The Person sees none of these words.

## Plan

Two tracks, as the roadmap has them: the window, and the engine with the
desktop's main. Each step is its own PR; S is up to a day, M one to two.
About 20 PRs; the build plan splits 1d, 3c, 4c and 5b into an engine or
desktop half and a window half, so the two tracks never share a file. Each slice's e2e opens arc's Project; the rest of the suite
stays as it is, so tests go remote slice by slice (Roma, Q4 A). The PRs'
files, tests, words, pictures and order are in the build plan,
`~/Banda/artifacts/remote-panes/plan.md`.

| Step | Track, size | What it does |
|---|---|---|
| 0 | docs | This ADR, its notes, and the mock |
| 0′ | both, S-M | Acts fail fast: the `read` mark, the contract's reads, `Engine`'s one rule, Commit's reads with its act |
| 1a′ (checker) | window, S-M | The kind checker over kinds and previewers, with the Thread's list, and the kit's skeleton |
| 1a′ (same path) | tests, S-M | The same-path job, the fake arc's own folders, latency per host and `blackhole` |
| 1a | window, M | `routeAct`; `runs` and `device`; the gate by the owner's modules; one mount for every Pane host; New Pane `elsewhere` |
| 1a″ | window, S | The directory cache; no `args.host` written; an unknown owner fails closed |
| 1b | window, S-M | The terminal `elsewhere`: keys by law 4, links as `Link`, the pill's band out of the Tile, flow measured |
| 1c | window, S | Run in an arc reply on arc, refused while arc is away; Sign in on arc opens arc's terminal; the Thread's issue link as a `Link` |
| 1d | both, S | The close in H5e's queue; "Ended" from `boot`; the update waits for a program in front |
| 2a | window, S-M | `git.diff` `elsewhere`; arc's git card; "Check" |
| 3a | window, S | `present()` as `files.stat` on the file's session; signs read by session |
| 3b | window, M | Files `elsewhere`, with its text previewers: `ProjectFile` at the boundaries, device rows by `device.local`, a cross-machine drop refused, pins by machine; a line comment to the Message box of a Thread on the same machine |
| 3c | both, S-M | `files.locate` on the host; the Thread's and the terminal's paths through it; the Thread's list shrinks |
| 4a | engine, M | `platform/bytes`, `/b/` and `/p/` |
| 4b | desktop, M | `app://` relayed to this machine's engine; main's signer goes; "client/desktop reads no Project path" |
| 4c | both, M | The relay to another machine; media in arc's replies; Files' byte previewers; "Save a copy to this Mac" (`save_file`) |
| 4d | both, S-M | Visuals by `/p/`; `agents.visual` `elsewhere`; the Thread's list ends |
| 5a | both, S | A new Thread on arc starts on arc's account |
| 5b | both, M | `keys.settings_read`, `keys.settings_changed`; the class per section; "Settings for: This Mac / arc" |

0′, both 1a′ and 4a come first, one on each track; the kind checker
comes before 1a, which needs it. The first try, arc's terminal, is ready
once 1d lands, about a week in. 1d also waits for H5e's kept queue (ADR
0105, H5e-2).

**What Roma tries.**

- **0′, 1a′, 4a:** nothing new to see. Their tests show a hunk revert, a
  Commit and a move clicked while arc is away refused at once.
- **1 (1a to 1d), arc's terminal.** Alt+N on an arc Project lists what
  opens on arc, the rest dimmed "Not on arc yet". On an arc Thread, New
  terminal (Ctrl+Alt+Enter): the header reads "zsh · ~/code/banda · arc";
  `hostname` says arc; vim and htop run, and the Tile resizes. Cut arc:
  the pill shows, the screen stays with its prompt in view, a key says it
  was not sent. arc back: the same `echo $$`. Close it while arc is away:
  "Closes on arc once it is back" and "· 1 waiting" in the pill, and once
  arc is back, the shell is gone. Restart the Mac with arc off: arc's
  Panes say "arc is away". Run in an arc reply opens arc's terminal and
  runs the line; with arc away, Run says it was not sent. Sign Claude Code
  in on arc. Update Banda on arc while `cargo build` runs in arc's
  terminal on the Mac: arc's update waits. From arc's window, a terminal
  on the Mac too.
- **2, arc's Git and Diff.** An arc Thread's git card: Commit with a
  message arc's Harness writes, Push with arc's keys, Create PR with arc's
  `gh`. Alt+D opens arc's Diff; stage and revert a hunk. With arc away,
  Commit is refused at once; one cut in the middle says it may have gone
  through, and Check says whether it did.
- **3, arc's Files, and paths in replies.** Alt+E on an arc Project: arc's
  tree. Open, edit, save; arc's Agent edits the same file and the conflict
  bar shows. A comment on some of its lines lands in an arc Thread's
  Message box. New file, rename, Trash, undo. Alt+P finds arc's files.
  Space opens Quick Look on code and markdown, its header naming arc; a
  markdown's pictures come with step 4. A PDF shows its facts.
  `src/a.ts:12` in an arc reply or terminal opens arc's file at line 12.
  Dragging a Mac file onto arc's tree is refused. A row of arc's says
  "Show in Files", not "Reveal in Finder".
- **4, arc's pictures (E1).** An arc Agent's screenshot in its reply; an
  arc PDF and a video in Quick Look, the video seeking; picture previews
  in arc's Files; Save a copy to this Mac; an arc Visual.
- **5, arc's settings (E4).** A new arc Thread starts on arc's default
  account. Settings for: arc lists arc's Harnesses and accounts; change
  arc's Claude mode and sharing from the Mac. With arc away, rows say "as
  of" and changes are refused. A key rebound on the Mac works in arc's
  terminal on the Mac; arc's own window keeps arc's keys.

## Later

Each is an issue, with what brings it in (Roma, Q5 A). Binary frames and
the ping stay ADR 0082's (decision 11), and `direct` TLS stays its
decision 17's (#737).

The terminal:

- **`not_after` on a terminal's keys**, checked in the host's time
  (#1241): once H5c's `pong` gives the clock offset, or a key that landed
  late is seen.
- **"Running on arc"**, terminals with no Pane, to open or close, with
  the size rule for two viewers (#1234, after #340's `terminal.list`):
  when a terminal is wanted from a second window, or one is lost behind a
  window that closed.
- **arc ends terminals nobody watched for a day** (call 3 C, #1235): when
  a forgotten shell is seen holding a machine's memory or a port.
- **`terminal.watch {after}`**, from the last piece in place of the
  whole screen again (#1236): when a reconnect over a slow link shows the
  redraw.
- **Credits** (ADR 0082, decision 11; #1237): when 1b's measure shows a
  terminal or a Thread starving the other.
- **mosh's end shape** for the terminal (skippable states, epochs,
  predicted echo; #1242): with the phone's terminal (stage 4).
- **A terminal holding its machine awake** (#1239): when a build on a
  sleeping Mac is lost.
- **Terminals that outlive a restart** stay #462's keeper.

Files, Git and bytes:

- **`git.act` as a command plus facts** (ADR 0082, decisions 4 and 8;
  #1233): when "Check" is not enough, or the commit run leaves the
  window's page.
- **A durable "as of" cache for reads** (#1243): H5c's first, then for
  any read, when a Pane must show more than its last screen while away.
- **arc's files opened in Zed or VS Code over ssh** (call 7 B, #1238):
  when the Person uses one of them on arc.
- **A named transfer between machines** (`files.copy_from {file}`,
  #1244): when the Person asks to copy a file across.
- **A line comment in the Diff** (#1225): when the Person reviews an
  Agent's change there and wants to point at lines.
- **Byte URLs bound to the device** (#1248): with pairing (H3).
- **A Visual's layout measured where it is drawn** (E13, #1247): E13's
  place in the vision, or an arc Visual's check seen to differ.

Other machines' things:

- **Port forwarding and arc's browser** (#1240), with Codex's sign-in on
  arc: when the Person opens arc's `localhost` from the Mac often, or
  signs Codex in on arc.
- **Panes an arc Agent opens**, placed by each window's machine, with
  `elsewhere` in `window.json` (H6, #1245): after stage 2, when an arc
  Agent's `open_pane` should show on the Mac.
- **arc's Usage and the Bar's Limits for arc** (#1246): when the Person
  checks arc's limits from the Mac.
- **Add Project on arc** stays #1011, and "Update arc" #775.

Stage 4 and the SDK:

- **`Read` and `Outcome` as every call's result** (#1226) and **the
  typed device port with `DeviceFile`** (#1227): W1.
- **The web shard** (#1228), **property tests** of "an act goes now or
  says why not" (#1229), and **the page fetching `/b/` and `/p/` itself**
  (call 11 B, #1249): stage 4.
- **`banda app check`** (#1230), **the welcome's Apps and methods** with
  `runs` by method (ADR 0082 decisions 2 and 14, #1231), and
  **`app.toml`'s `device` list** (#1232): the SDK.

## Alternatives weighed

Every design below keeps the same mechanics: `sessionOf`, bytes by
token, settings by owner, the PTY on its host. Four families leave them,
and were turned down first:

- **Pixels** (VNC, RDP, a screencast) lose the device's look, keys and
  clipboard (ADR 0101, decision 3), and every key is a round trip. They
  stay for a process that is not Banda's: the Agents' Chromium on arc,
  later (ADR 0062, decision 12).
- **Draw calls** (X11, waypipe, Plan 9's `cpu`) are bound by round trips
  and run an App's code against the device, which ADR 0062 decision 7
  forbids. JetBrains found plug-in UI drawn on the backend "usually of
  insufficient quality".
- **The file layer** (sshfs, SFTP, TRAMP) is a second Files behind the
  engine's back; a hard mount hangs, and the fence refuses fuse.
- **Replicas** (CRDTs, sync engines) cannot merge a PTY, a working tree,
  a push or a Turn, each of which has one writer. They fit the Person's
  shared files only, which is E14.

A terminal as `ssh -t` from main dies with its ssh and shares nothing
with the web. The page fetching arc's forwarded port itself (call 11 B)
loses the page's rules for `app://`, and its address changes each time
ssh reconnects on a new port; it is the web's road, with stage 4 (#1249).
Trees for every Pane now is the SDK's end shape (ADR 0062,
decision 7), but V2 is not built and the live components stay in the
catalogue; this design is the road to it.

Within the family the designs differ in how "it works on another
machine" is made and kept:

- **A, the draft:** `elsewhere` on kinds and on actions, `runs` as a
  lookup, `runOnHost` by Project. A flag is a claim nothing ties to the
  code: a kind that says `elsewhere` and keeps a bridge reads the Mac's
  `/home/roma/x`. It also needs a third branch for the web, where nothing
  is "here".
- **A, then D at stage 4:** builds every flag and `runs` site twice, and
  ships Files with the confused deputy open the day Files says
  `elsewhere`.
- **B, a session and a device port only:** closes the deputy for acts,
  not for values that move between Panes.
- **C1, the machine in every name** (`banda://arc/<project>/<path>`, as
  VS Code does): device names differ by device, and kept arrangements are
  rewritten whenever a Project moves.
- **C2, the Project in every name, with a router** (Zed's `ProjectPath`):
  right for values, silent on device acts.
- **D, B and C2 together**, and **D+**, D with three delivery classes,
  methods in the welcome and the terminal's additions: right, but D+
  costs 24 to 28 PRs counted honestly, much of it for stage 4 and the
  SDK, against "foundation only when a slice needs it".
- **A flag computed from the code alone** (check C3): every App's pane
  code fails it today, the Thread on arc among them, it flips a kind's
  reach on any import, and it is a lint all the same.

**Chosen: D′**, D+'s laws as corrected by the check, the kind's flag kept
and checked, and only what stage 2 needs. VS Code ships the declared
flag with a safe default (`extensionKind`); JetBrains places modules by
their dependencies. D′ takes both. It costs about 4 or 5 PRs over the
draft's 16, and no Pane branches on its machine, so stage 4 adds none.

## What it amends

Each with a dated note in place:

- **ADR 0063, decision 6:** Run in terminal runs on the Thread's machine,
  and is refused at once while that machine is away.
- **ADR 0072, decision 3:** an update also waits while one of its
  machine's terminals runs a program in front.
- **ADR 0073, decision 5:** bytes come from the Project's host by signed
  URL, and main's byte and page hosts become relays. **Decision 10:** the
  rows that act on this device's disk show only for a file of this
  computer, "Show in Files" for another machine's; a drag and the
  clipboard carry the Project, a cross-machine drop is refused, and a move
  or a copy is an act. **Decision 13:** `pinned` is the machine's, the rest
  of `files.toml` the device's.
- **ADR 0082, decision 3:** a write still made as a `call` is an act by
  its line, and fails fast as a command does; a write that is repeated or
  shared still becomes a command. **Decision 12:** `save_file` joins the
  closed list. **Decision 13:** until pairing a token is bound to the file
  and the hour, not to a device, and the desktop's main relays it by
  machine. **Decision 16:** every act fails fast, calls and acting
  streams with commands, and a terminal's close is the one act that
  waits besides ADR 0105's message, in the same queue.
- **ADR 0089, decision 2:** the port carries `save_file`. **Decision 9:**
  "client/desktop reads no Project path" becomes a test at step 4b, with
  the agents module's `paths` its one exception until 3c, and a machine's
  settings come through its engine at 5b.
- **ADR 0095, decision 7:** "Not on arc yet" is for kinds that do not say
  `elsewhere`, the kind checker holding those that do, and for Apps and
  methods the machine lacks; New Pane shows them dimmed.
- **ADR 0101, decision 7:** a terminal closed while its machine is away
  waits in the visible queue too, as ADR 0105 allows.
- **ADR 0105, its rule for H5e:** the terminal's close waits there with
  the queue's longest time and no Keep for, goes again after
  `may_have_run` with no CommandId, and is dropped on a new `boot`.

## Roma's calls (2026-11-10)

The five questions of the synthesis, each as recommended:

1. **Q1 B.** A kind's `elsewhere` stays, checked by a test that reads the
   kind's code; actions carry no flag, and a router follows each to its
   data's machine (decisions 2 and 3).
2. **Q2 A.** One client rule, before arc's terminal: every act fails at
   once while its machine is away (step 0′).
3. **Q3 A.** Keys are refused once Banda knows, and the terminal says
   honestly that a key typed just before may land (decision 4). It says
   so in its tooltip: the mock's pill, "arc · last heard 12 s ago", is not
   taken, since ADR 0105 decision 1 keeps the pill's one word.
4. **Q4 A.** One same-path job on a GitHub VM; the tests move to arc slice
   by slice (step 1a′).
5. **Q5 A.** Only what the slices need; the rest are issues, each with
   what brings it in (Later).

The window session's calls, from `decisions.md`: 1 A (terminal, then Git
and Diff, then Files, pictures, settings), 2 A, 3 A, 4 B, 5 A, 6 A, 7 A,
8 A, 9 A, 10 A, 11 A, 12 A, 16 A and 17 A, and yes to each of 18. Calls
13 to 15 are settled by ADR 0101: there is no main machine.

## Consequences

- One rule says where an act goes, and the same Pane code serves this
  machine's Project, arc's Project on the Mac, and later a browser tab.
- Nothing runs late that the Person did not choose: after 0′ a call or a
  stream that acts is refused while its machine is away, as a command is
  already. A gesture's first read refused costs a click, never a surprise.
- A Pane that says `elsewhere` and reaches a bridge fails a test, not the
  Person; what the checker cannot see, dynamic access, the same-path test
  catches on the roads it drives.
- The kind's flag is still a claim, held by a lint, and the Thread keeps
  a named exception until step 4d.
- A terminal closed while its machine is away may close up to 7 days
  later, and the pill counts it meanwhile.
- The machine is a device-local name in one place only, the byte relay's
  URL, which is never kept.
- arc's terminals still end with Banda on arc, now with words, and an
  update waits for a program in front; a terminal keeper is #462's.
- A key typed in the second before Banda knew may still land late. Only
  a deadline in the host's time ends that (#1241).
- The same-path job adds a job on GitHub's VM to CI, beside the fence's.
