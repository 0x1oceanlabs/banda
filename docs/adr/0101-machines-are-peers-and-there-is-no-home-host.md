---
status: accepted
date: 2026-11-09
---

# Machines are peers, and there is no home host

_Accepted by Roma on 2026-11-10, with each Open question as recommended
(Roma's calls, at the end). It amends what ADRs 0062, 0080,
0081, 0082, 0083, 0087, 0088, 0089 and 0100 say of a home host, each part
listed under "What it amends", and leaves ADR 0068 as it is, with two
notes for the sync. Code is cited from main at `6c8024f3`._

Roma, on 2026-11-09 (translated): "We have no central machine, just
computers joined together, on different platforms", and "we are just
joining several computers over a network." His own notes said "a node
stays autonomous" (the vision's `critic-distributed.md`, row 12). The
vision answered with a home host and a client overlay; this ADR answers
with peers.

The same day Roma decided the window session's call 13: there is no main
machine; each machine keeps its own keys, sidebar and notifications, as
now; copying them comes later. Call 14, keys on two machines, moved here
too (`~/Banda/artifacts/remote-panes/decisions.md`). This ADR decides what
the next slices need; the sync, the web page and shared keys each wait for
their own ADR (Later).

**Where it stands.**

- **Each window reads and writes its own machine's files,** through
  `banda look --follow` and `banda settings` there
  (`client/desktop/src/look.ts:1-7`). They are one folder,
  `~/.config/banda`, and no file says whose it is
  (`platform/look/src/file.rs:21-31`). `look.toml`, `agents.toml` and
  `browser.toml` each mix owners. `keys.toml` is `mod` and `[binds]`, and
  its binds name real keys (ADR 0068, decision 5).
- **The arrangement is the machine's:** the `workspaces` module is
  `Scope::Machine`, in the engine of the window's own machine
  (`platform/workspaces/engine/src/lib.rs:1-6`), and a Pane of another
  machine's Project sits in it with `args.host`. No overlay is built.
- **An Agent's Pane is placed by its own machine** (`open_pane`, #1076,
  #1077): an arc Agent watched from the Mac opens it where no Mac draws.
- **Another machine is reached over ssh** (ADR 0081, step 5), an act
  through `KeptHosts.sessionOf` (H5d, building now). Each machine is its
  own Person (`engine/src/places.rs:307-319`); pairing is not built.
- **Nothing of the home host is built.** The kernel has two scopes, a
  Project and the machine (`kernel/src/module.rs:23-29`). The home host,
  the Person scope and `not_home` are only in the ADRs above and in
  `GLOSSARY.md`.

## Decision

1. **Machines are peers.** The Person's machines are joined over the
   network, on any platform. None is central, and none must be on. Each
   starts and works with no network and no other machine.
   - An always-on machine, as arc is, or a host in Banda Cloud, is a peer
     that is up more. Nothing waits for it; pairing asks nothing about it.
   - One writer still holds where it held (ADR 0081, decision 1). A
     Project's records are its machine's, and move only on command (ADR
     0081 decision 11, ADR 0085 decision 11). A machine's files are that
     machine's. The view is the device's. Nothing is merged: no CRDT.
   - What changes is the Person's own files: every machine keeps a full
     copy (decision 2). Copying them is the sync, later (E14).
   - The kernel keeps two scopes, Project and Host. Today's machine scope
     is the Host's, the arrangement with it (decision 5). There is no
     Person scope: the Person's files are files on each machine.

2. **Each machine keeps its own full copy of the Person's files, and a
   device uses only its own machine's.**
   - A device's own machine is the one it runs on, or, for a browser tab
     or the phone, the one that served it.
   - A window reads and writes the Person's files on its own machine, even
     when the Pane in focus is another machine's: a key bound on the Mac
     works in arc's terminal shown on the Mac. Nothing a device applies or
     shows comes from another machine's copy. An engine acts on its own
     copy too: arc's pushes follow arc's `[notify]`.
   - Until the sync, each machine's copy is its own, as today (call 13).
     Settings says which copy it edits: "on this Mac".
   - A machine's own files are read and written through that machine's
     engine, from whichever window (ADR 0081, decision 12). Stage 2's
     slice 5b builds that road (`keys.settings_read`, `settings.changed`).
   - How an act finds its engine does not change: `KeptHosts.sessionOf
     (project, pane?)` sends it to its Project's machine (H5d). H5b and
     H5c stand.
   - The vision's E5, "the look from the API", keeps its ID and narrows:
     each machine reads its own theme folders, and the device works the
     theme out (ADR 0100). What is left of E5 is the web page's look,
     taken from the machine that served it and worked out where stage 4
     decides. W1 waits on that, never on E14.

3. **Every settings file is shared, the device's or the machine's.**
   - **Shared**: what the Person means everywhere; a full copy on every
     machine, copied between them once the sync is built. **Device**: how
     this screen looks and sits under the hand; never copied.
     **Machine**: what that machine has; read and written through its
     engine, never copied.
   - When in doubt, a setting is the device's. It is never copied, so it
     never clashes, and moving it to shared later only adds.

   | File today | Part | Class |
   |---|---|---|
   | `sidebar.toml`, `sidebars/<name>.toml` | all; `[machines]` too, as it names machines from the window's side (`this-too`) | shared |
   | `keys.toml` | `[binds]` | shared |
   | `keys.toml` | `mod` | device (decision 4) |
   | `look.toml` | `[notify]` | shared, in a file of its own |
   | `look.toml` | the rest: `theme`, `mode`, glass (`[desk]`), `[display.*]`, `[colors]`, `[tokens]`, `radius`, `[gaps]`, `[tile]`, `[focus]`, `[columns]`, `[bar]`, `[drawer]`, `[overview]`, `[groups]`, `[motion]`, `[font]`, `[sound]` | device |
   | `themes/<name>/` | all | shared |
   | `agents.toml` | `enter`, `flow` | shared |
   | `agents.toml` | `[start]` | machine |
   | `browser.toml` | the Agents' browser: `[agents]`, `sites` | machine |
   | `browser.toml` | the Person's browser: `tabs`, `search`, `pinned`, `blocker` | device |
   | `files.toml` | `pinned` (paths on that machine) | machine |
   | `files.toml` | the rest, the editor too | device |
   | `terminal.toml` | all | device |
   | `harnesses.toml`, `machine.toml`, `sharing.toml` | all | machine |
   | `hosts.toml` | all | device (ADR 0095) |
   | Web Apps' manifests (not built) | all | shared |

   - Colours meant for every machine are a theme of one's own, a shared
     folder; `look.toml`'s `[colors]` are this device's. A theme whose
     folder is not on this machine falls back to `"platform"`, and
     Problems says so.
   - "Notifications" is `[notify]` alone; the bell's recent list stays the
     window's (ADR 0089, decision 6). The arrangement (decision 5) and
     seen and archive (ADR 0096) are not files, and never copied.
   - Each file says its class in its `SettingsFile`, with stage 2's slice
     5, where Settings first shows which copy it edits. The mixed files
     are cut (`mod` and `[notify]` out, `agents.toml` and `browser.toml`
     in two) only when the sync first copies them.

4. **Keys stay each machine's for now** (call 14). Each machine keeps its
   own `keys.toml`, its `mod` and its `[binds]`, as today, and ADR 0068
   holds as it is. Decision 3's split, the binds shared and the mod each
   device's, takes effect only with the sync (Later).

5. **The arrangement is the machine's whose window shows it, as built.**
   - The workspaces, columns, Groups and widths are the `workspaces`
     module's, in the Host scope of the window's machine (ADR 0025,
     decision 1), never copied. A Pane of another machine's Project sits
     in it, and its work runs there (ADR 0062, decision 13).
   - The tiling's authority is that machine's engine. The model stays one
     Rust crate, run there, and in each client as WebAssembly to predict
     (ADR 0062 decision 17, ADR 0088 decision 11). For a desktop window
     that engine is local, so the desktop needs no overlay (T2).
   - A browser tab arranges its serving machine's arrangement, as a second
     window does; a phone writes none (ADR 0089, decision 8). Whether a
     tab gets the overlay is decided with the web (stage 4).
   - A Pane is one arrangement's; two machines never share one. A terminal
     it runs on another machine ends when that arrangement lets it go:
     `pane.left@1` comes from the engine that holds the arrangement, and
     its window carries it to the Project's machine.

6. **A Pane an Agent opens is placed by each machine whose window sees
   it, in its own arrangement.**
   - In the end shape (H6) the Agent writes `show.requested@1` into its
     Project (ADR 0082, decision 7). Each machine whose window sees it
     (only those where its Thread shows: Roma's call 2) places it into the Thread's Group
     (ADR 0065), and its engine checks it again, as ADR 0082 decision 15
     had the home host do.
   - Each arrangement places an event once, by its own `placed_through`,
     from the log's head when it first follows a Project. A placed Pane's
     id comes from the event and the placing machine, and its
     `pane.left@1` ends that placement only. The Agent's read of its Panes
     lists them by machine.
   - **One road in each arrangement.** Where the Agent's machine is the
     window's, `open_pane` places the Pane at once, with a window open or
     none (#1076, #1077). It stays, and from H6 it also moves that
     arrangement's `placed_through` past the event, so a window that
     carries the same event places nothing more. Until H6, an arc Agent's
     Pane shows only in arc's arrangement.
   - `not_home` goes. An Agent writes the Person's files on its own
     machine only, through Banda's tools, as a proposal where ADR 0083
     decision 3 asks one. What it asks of a device goes by the device road
     (ADR 0082, decision 12); no machine answers for the others.

7. **A machine that is away takes only its own things away.** Its Projects
   and its machine files are away: an act is refused at once (H5b), rows
   dim "as of" (H5c), and "send when back" keeps a command in the visible
   queue with `not_after` (ADR 0082, decision 16), as does `next_wake_at`
   for a cloud host. The Person's files never are: each machine has its
   own copy, so a change to them never waits for another machine.
   _Amended 2026-11-10 by
   [ADR 0105](0105-honest-when-away-what-the-person-sees-while-a-machine-is-away-and-what-may-wait-for-it.md):
   only a message to a Thread waits in that queue; every
   other act is refused at once._

## Later, each its own ADR when its slice comes

- **The sync (E14): the Person's files on every machine.** Whole files,
  never merged. When two machines both changed a file, the last edit wins,
  by a stamp of the machine and its time of the edit. The other version is
  kept, and Problems shows it until the Person picks. Copies go only
  between the Person's own machines, and only after the fence (ADR 0083,
  decision 1). The first time two machines meet, Banda asks once whose
  settings to use. E14 is a new ID, not yet placed in the roadmap.
- **The web page and the phone (stage 4, W1).** There is no home to serve
  them; any of the Person's machines can. Which ones do, and the trust
  that costs, are decided with the web. Open for that ADR: each machine
  that may serve the page is a place whose code acts as the Person's
  device toward the others, where ADR 0083 decision 8 chose one server so
  as to add no place to trust.
- **Shared keys (with E14).** Now each machine keeps its own `keys.toml`
  and its own mod (decision 4). Shared binds come with the sync, and how
  they are written then (by level, `Mod+M`, which ADR 0068 decision 5
  keeps out of the file) is decided there. The window session recommends
  its option A: one set of binds, written by level, and the mod each
  device's, as the Mac and arc need different ones.

**Notes for E14**, from this ADR's review:

- Each engine writes only its own copy: `settings.offer` lists stamps,
  `settings.take{file, text, stamp, base}` is refused if the base moved.
  A window carries the bytes and applies none.
- A stamp is the machine, its time and the text's hash, kept wherever the
  copy goes. Against the hash two machines last agreed on, a side that
  alone changed is taken; a file as Banda's template wrote it, or absent,
  is unchanged; a tie goes to the lower ID.
- A theme folder is one unit. A delete reaches the other machine unless
  it changed the file since they last agreed. The loser goes to
  `~/.config/banda/kept/`; the winner carries the stamp it beat, so the
  losing machine learns it. Problems offers Open both, Use this Mac's and
  Join them.
- The first meeting's answer is written on both before anything is
  copied; a machine with only Banda's templates is never asked.
- A change that gives an Agent more, such as a Web App's grant, waits for
  the Person's gesture there (ADR 0083, decision 3). A key an older Banda
  does not know is a word in Problems, not a refusal (W4).
- The Person's own machines are, today, those its owner reaches by ssh;
  after pairing, the chain's members. Two that never meet wait for one
  that meets both. Roaming stays off.

## What it amends

| ADR | Part | Now |
|---|---|---|
| The vision | decisions 4, 8, 12 and 15, rules 1 and 5, §9.3 | no home host; A2 is each file's class, no Person scope; E5 narrows (decision 2); W1 waits on that E5, not on E14; H6 needs no Person scope; E14 is a new row |
| 0062 | decision 9 | a Web App's manifest is a shared file |
| 0062 | decision 13 | the arrangement is the machine's whose window shows it; the Person's files are a copy on every machine; an Agent's Pane is placed by each machine whose window sees it |
| 0062 | decision 17 | the authority is the engine of the machine whose arrangement it is; the overlay waits for the web |
| 0062 | decision 18 | the theme folders are shared; which theme, the mode and the glass are the device's |
| 0062 | plan steps 1, 6 and 7, Consequences, Changes | no home host; step 6's gate is local for a desktop window; the placing machine checks a placement |
| 0080 | decision 1 and its Later | the theme choice is the device's, the folders shared |
| 0081 | decision 1 | one writer holds; the Person's files are a copy on every machine; no CRDT |
| 0081 | decision 9 | "the Person's home" row goes; a cloud host is one more peer |
| 0081 | decision 12 | each file is shared, the device's or the machine's (decision 3) |
| 0081 | plan step 6 | one client over several machines, the merged Inbox; no home host |
| 0082 | decision 1 | two scopes, Project and Host; no Person scope |
| 0082 | decisions 7 and 15 | each machine whose window sees a Pane places and checks it; `not_home` goes; an Address is `Project(id) \| Host(key)` |
| 0082 | decision 11 | the welcome's `person{id, home}` is `person{id}` |
| 0082 | decision 14 | the Person's files are files, not documents with a `rev` |
| 0082 | decision 16 | its home half goes; fail fast, the visible queue and `next_wake_at` stay |
| 0082 | decision 17 | no home host serves the PWA; which machines do is decided with the web |
| 0082 | plan steps 1, 6 and 15, Consequences, Changes | two scopes; each file's class; placements in each window's own machine; a write to the Person's files never waits; the ADR 0005, 0025, 0032 and 0071 entries lose the home host |
| 0083 | decision 6 | the chain signs the members only |
| 0083 | decision 8, Changes | no home host serves the page; which machines do, and the trust, are decided with the web |
| 0087 | decisions 1 and 10 | the arrangement and its placement policy are in the engine of the window's machine; `flow` is shared |
| 0088 | decision 11, plan step 7 | the authority is the engine that holds the arrangement; T2 waits for stage 4 |
| 0089 | decision 6 | "looked at" stays the device's |
| 0089 | decision 8 | the phone's sidebar is the `sidebar.toml` of the machine that served it |
| 0089 | decision 9, Deferred | the look is the device's, from its machine's copy (E5 as narrowed) |
| 0100 | decisions 1, 2 and 5, step 0, change to ADR 0007 | the split is shared, device and machine, each machine reading its own copy; step 0 loses its slice |

## Effects on work in flight

- **ADR 0100's step 0** loses its slice: the Mac reads its own keys and
  sidebar. Each file's class comes with stage 2's slice 5, the file moves
  with E14, the `look` crate's split with ADR 0100's step 1.
- **Stage 2, Remote Panes** (`~/Banda/artifacts/remote-panes/adr-draft.md`)
  takes decision 3's table and drops ADR 0100 decision 1 from its header;
  its "E5" is E4 alone, and "the Person's settings on every machine" is
  E14; slice 5 stays E4, 2 PRs, its 5b reading each file's class. The
  `*.before-peers.md` copies stay out of any PR.
- **H5** is unchanged. In **T-a and T-b** (`~/Banda/artifacts/t-a/`), a
  Group's owner and `pane.left@1` are the engine's that holds the
  arrangement (decision 5). T2 waits for stage 4, so ADR 0088's plan step
  7 ends with T1.
- **PR #995**'s "the keys hold in every window of theirs" holds on each
  machine. **PR #690** (ADR 0090): a WSL host's machine files come from
  it, and the Person's files and keys are the Windows machine's own.
- **The roadmap**: stage 2 keeps E4 only; "a home host that sleeps"
  becomes "a machine that sleeps: the others work on". **`open_pane`'s
  words** say it opens on the Agent's machine (an issue).

## Plan

Each step is its own PR.

0. This ADR and the notes in the ADRs above.
1. The words, once accepted: `GLOSSARY.md` (Home host goes; Peer, Shared,
   Device and Machine file come); dated notes on the vision (the parts
   above, §4.6, §4.7, §8, the risks), the client research, `docs/sdk/`,
   `platform/skill/SKILL.md`'s file table and the roadmap's stage 2 and
   risks.
2. Each file's class in its `SettingsFile` (decision 3), with stage 2's
   slice 5.
3. H6's placements, by each machine (decision 6).

## Roma's calls (2026-11-10)

All three as recommended:

1. **The sync comes later**, as E14, only when the Person feels the need.
   Nothing now depends on it; decisions 1 to 7 hold either way.
2. **An Agent's Pane shows only where its Thread shows.** A window
   without the Thread is not watching that Agent. The Agent's own machine
   places it as built.
3. **Decision 3's "when in doubt" rows stay the device's** (sound, the
   drawer, the overview, groups, how Files shows things). Moving one to
   shared later only adds.
