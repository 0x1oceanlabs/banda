---
status: proposed
date: 2026-11-09
---

# Machines are peers, and there is no home host

_Proposed on 2026-11-09; Roma accepts it. It amends ADR 0062 (decisions 9,
13, 17 and 18, plan steps 1, 6 and 7, and what follows from them), ADR 0068
(decision 1: where `mod` is kept), ADR 0080 (decision 1 and its Later), ADR
0081 (decisions 1, 9 and 12, plan step 6), ADR 0082 (decisions 1, 7, 11,
15, 16 and 17, plan steps 6 and 15, and its consequences and changes), ADR
0083 (decisions 6 and 8), ADR 0087 (decisions 1 and 10), ADR 0088 (decision
11), ADR 0089 (decisions 6 and 8) and ADR 0100 (decisions 1, 2 and 5, step
0, and its change to ADR 0007). Code is cited from main at `6c8024f3`._

Roma, on 2026-11-09 (translated): "We have no central machine, just
computers joined together, on different platforms", and "we are just
joining several computers over a network."

It is the idea of his own notes, 13:11, as the vision's critique quotes
them: "a node stays autonomous; losing the other nodes does not stop local
Banda" (`docs/research/2026-11-06-architecture-vision/critic-distributed.md`,
its table's row 12). The vision answered it with a home host and a client
overlay. This ADR answers it with peers.

The themes session proposed how the Person's files split once machines
are peers. Roma has not answered it yet, so this ADR proposes it.

**Where it stands.**

- **Each window reads its own machine's files.** The window runs
  `banda look --follow` on its machine, and "the look is this machine's,
  so it needs no engine" (`client/desktop/src/look.ts:1-7`); it writes
  through its own `banda settings` (`client/desktop/src/settings.ts:1-7`).
  The look, `sidebar.toml` and `keys.toml` are "the window's machine's,
  not a Project's" (`platform/look/src/lib.rs:10-16`).
- **All of it is one folder,** `~/.config/banda`
  (`platform/look/src/theme.rs:13-16`), and no file says whose it is
  (`platform/look/src/file.rs:21-31`, `platform/settings/src/lib.rs:20-28`).
  Three files mix owners: `look.toml` holds the theme, glass, columns,
  bar, drawer, overview, groups, motion, font, sound and `[notify]`
  (`platform/look/src/settings.rs:16-72`); `agents.toml` holds `enter` and
  `flow` beside `[start]`, whose accounts are that machine's
  (`apps/agents/engine/src/sending.rs:60-72`); `browser.toml` holds the
  Agents' browser beside the Person's (`apps/browser/engine/src/settings.rs`).
- **`keys.toml` is `mod` and `[binds]`.** The platform's defaults come
  from the build (`platform/look/src/keys.rs:619`).
- **The arrangement is the machine's.** The `workspaces` module is
  `Scope::Machine`, one store in the engine of the window's own machine
  (`platform/workspaces/engine/src/lib.rs:1-6`, `:392-393`), and the window
  draws only that engine's arrangement
  (`client/web/src/tiling/useTiling.ts:72-73`). A Pane of another
  machine's Project sits in it, with `args.host` naming that machine
  (`client/core/src/pane.ts:24-34`). No overlay is built.
- **An Agent's Pane is placed by its own machine.** `open_pane` puts it
  into the Thread's Group in the arrangement of the Agent's own engine
  (`platform/workspaces/engine/src/lib.rs:708-733`, `model.rs:410-417`;
  ADR 0065, #1076, #1077). So an arc Agent watched from the Mac opens its
  Pane in arc's arrangement, which no Mac window draws.
- **Another machine is reached over ssh** (`hosts.toml`, `docs/hosts.md`;
  ADR 0081 step 5 as amended). An act goes to the machine that owns its
  Project; H5d puts `KeptHosts.sessionOf(project, pane?)` behind every one
  (building now). H5b refuses at once while a machine is away, H5c dims
  its rows "as of".
- **Each machine is its own Person.** Each makes its own owner ID on first
  run (`engine/src/places.rs:307-319`); pairing (ADR 0081 step 2) is not
  built. Its config is kept out of Windows' Roaming, so no system copies
  it (`engine/src/places.rs:17-20`).
- **Nothing of the home host is built.** The kernel has two scopes, a
  Project and the machine (`kernel/src/module.rs:23-29`). The home host,
  the Person scope and `not_home` are only in docs and `GLOSSARY.md`.
- **The accepted ADRs say otherwise.** ADR 0062 (decisions 13 and 17),
  ADR 0081 (decisions 1, 9 and 12), ADR 0082 (decisions 1, 15, 16 and 17),
  ADR 0083 (decisions 6 and 8) and ADR 0100 (decision 1) put the Person's
  files, the tiling's authority, the PWA and the chain's "home" on one
  always-on host.

## Decision

1. **Machines are peers.** The Person's machines are joined over the
   network, on any platform. None is central, and none must be on. Each
   starts and works with no network and no other machine.
   - An always-on machine, as arc is, or a host in Banda Cloud, is a peer
     that is up more. Nothing waits for it, and pairing asks nothing about
     it.
   - One writer still holds where it held (ADR 0081, decision 1). A
     Project's records are its machine's, and move only on command (ADR
     0081 decision 11, ADR 0085 decision 11). A machine's files are that
     machine's. The view is the device's. No Project and no store is
     merged: no CRDT, no replica.
   - What changes is the Person's own files: every machine keeps a full
     copy (decision 2), and a later step copies them between machines
     whole (decision 7). That is the one place two machines write the same
     thing, and it is small text files only.
   - The kernel keeps two scopes, Project and Host. Today's machine scope
     is the Host's, the arrangement with it (decision 5). There is no
     Person scope: the Person's files are files on each machine.

2. **Each machine keeps its own full copy of the Person's files, and a
   window reads its own machine's.**
   - A window reads and writes the Person's files on its own machine, even
     when the Pane in focus is another machine's. A key bound on the Mac
     works in arc's terminal shown on the Mac, and arc's own window keeps
     arc's keys. A device never reads or writes another machine's copy.
   - A machine's engine acts on its own copy too: arc's pushes follow
     arc's `[notify]`, with a window open or none.
   - Until the sync (decision 7), each machine's copy is its own, as today.
     Settings says which copy it edits: "on this Mac".
   - A machine's own files stay as ADR 0081 decision 12 has them: read and
     written through that machine's engine, from whichever window. Stage 2
     builds that road (its slice 5b: `keys.settings_read` and a
     `settings.changed` stream).
   - How an act finds its engine does not change: it goes to the machine
     that owns its Project, through `KeptHosts.sessionOf(project, pane?)`
     (H5d).

3. **Every settings file is shared, the device's or the machine's.**
   - **Shared**: what the Person means everywhere. A full copy on every
     machine, copied between them (decision 7).
   - **Device**: how this screen looks and sits under the hand. Never
     copied.
   - **Machine**: what that machine has. Read and written through its
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

   - A tweak to colours meant for every machine is a theme of one's own,
     a folder, which is shared; `look.toml`'s `[colors]` are this device's.
     A device that names a theme whose folder has not reached its machine
     yet takes `"platform"`, and Problems says so.
   - "Notifications" here is `[notify]` alone. The bell's recent list stays
     the window's (ADR 0089, decision 6).
   - Not files, and not copied: the arrangement is the machine's
     (decision 5); seen and archive are the Thread's (ADR 0096).
   - Each file says its class in its `SettingsFile`, so Settings and the
     sync read it from one place. ADR 0100's step 0a cuts the mixed files;
     an old file still reads, and `banda settings check` says where each
     moved key went.

4. **Keys: one set of binds, and the mod is each device's** (the window
   session's call 14, A).
   - `[binds]` is shared: the Person's keys are the same on every machine.
   - `mod` is the device's, and leaves `keys.toml` for the device's file
     with ADR 0100's step 0a. The Mac and arc need different mods: ⌘ alone
     is refused on a Mac, and Hyprland holds Super on arc.
   - ADR 0068, decision 1, stands otherwise: Alt is the default everywhere,
     and ⌘ alone is refused. "Cmd on a Mac" is not taken.
   - The platform layer is Banda's own defaults for each platform, built
     in as today, and the device's `mod`. Windows' clashes (draft ADR 0090:
     AltGr, Alt+Space) are in that layer. A key the Person binds goes into
     the shared binds.

5. **The arrangement is the machine's whose window shows it, as built.**
   - The workspaces, columns, Groups and widths are the `workspaces`
     module's, in the Host scope of the window's machine (ADR 0025,
     decision 1). They are never copied. A Pane of another machine's
     Project sits in this arrangement and names its Project (ADR 0062,
     decision 13); its work runs on that machine.
   - The tiling's authority is that machine's engine. The model stays one
     Rust crate, run there, and in each client as WebAssembly to predict
     (ADR 0062 decision 17, ADR 0088 decision 11). For a desktop window
     that engine is local.
   - A browser tab arranges the arrangement of the machine that serves it,
     as a second window of that machine does. A phone writes none (ADR
     0089, decision 8). Only a tab's engine is on another machine, so only
     a tab could need the overlay; whether it gets one is decided with the
     web (stage 4).
   - A Pane is one arrangement's. A program it runs on another machine, a
     terminal, ends when that arrangement lets the Pane go: `pane.left@1`
     comes from the engine that holds the arrangement, and its window
     carries it to the Project's machine. Two machines never share one
     Pane, so two never both stop one terminal.

6. **A Pane an Agent opens is placed by each machine whose window sees
   it, in its own arrangement.**
   - In the end shape (ADR 0082 decision 7, H6) the Agent writes
     `show.requested@1` into its Project. Each machine whose window
     follows that Project places it once per event id in its own
     arrangement, by ADR 0065's rule: into the Thread's Group where the
     Thread shows. That machine's engine checks it again: its kind is in
     that machine's registry, it runs nothing as the Person, and the
     browser's check of its address passes. Each arrangement keeps its own
     `placed_through`, so two windows of one machine place it once.
   - #1076 and #1077 built the case where the Agent's machine is the
     window's: its own engine places the Pane. It stays.
   - Until H6, an arc Agent's Pane shows only in arc's arrangement, and
     `open_pane`'s words say it opens on the Agent's machine.
   - `not_home` goes. An Agent writes a shared file on its own machine
     only, through Banda's tools, as a proposal where ADR 0083 decision 3
     asks one. The sync carries it as any other edit. It reaches no other
     machine's files.
   - What a machine's Agents ask of a device goes by the device road
     (ADR 0082, decision 12): to a named device, or where the Person is.
     No machine answers for the others.

7. **The sync, later: whole files, last edit wins, the other kept
   beside.** It is E5, "the Person's files on every machine", a step of
   its own, not built now.
   - **When.** Two machines sync when one window reaches both as their
     owner: today an ssh entry in its `hosts.toml`, after pairing the
     members of the Person's chain (ADR 0083, decision 6). The window
     carries the files, so hosts still never call each other (ADR 0062,
     decision 13). Two machines never open in one window wait for one
     that is, or for an always-on peer that passes copies on, such as a
     host in Banda Cloud.
   - **What.** Shared files only, each whole, as its text is on disk.
     Device and machine files never leave their machine. A theme folder
     goes file by file. A file deleted on one machine is deleted on the
     other, unless the other changed it since they last agreed.
   - **Which is newer, with no one clock.** Each machine keeps, for each
     shared file and each other machine, the hash of the version the two
     last agreed on. When they meet, a side that alone changed since then
     is taken, and nothing clashes. When both changed, the later edit goes
     in front: each machine's own time, corrected by the clock's offset
     Banda measures (H5c); a tie goes to the machine whose name sorts
     first. The other is kept, so a wrong pick loses nothing.
   - **The other version** is kept on the machine whose edit lost, in
     `~/.config/banda/kept/`, named after the file, its machine and the
     day. That machine's Problems says: "keys.toml changed on arc and on
     this Mac. arc's is in use; this Mac's is kept." With Open both, Use
     this Mac's, and Join them, which asks an Agent to make one of the two
     as a proposal the Person accepts. It stays until the Person picks.
   - **The first time two machines meet,** most shared files may differ.
     Banda asks once, on the device that brought them together: "Use this
     Mac's settings, or arc's?" The other side's are kept in `kept/`,
     together, and nothing asks again.
   - **What arrives takes effect at once,** read and checked as a file the
     Person wrote there. Only what passed the rules where it was written
     leaves a machine.
   - **Versions.** The copy is the file's text, never written again from
     what a Banda understood, and Banda's one writer changes one key and
     keeps every other line (`platform/settings/src/write.rs:1-4`). The
     sync step makes a key an older Banda does not know a word in
     Problems, not a refusal, so that Banda reads the rest and keeps the
     line (`critic-distributed.md`, W4).
   - No system sync: Banda copies its own files, and Roaming stays off.

8. **The web and the phone are served by any machine.** A machine reached
   over `direct` TLS serves the page from the signed binary it runs, never
   from a disk an Agent can edit (ADR 0083, decision 8). From there the
   page connects to the Person's other machines, as a window does. A phone
   reads and writes the shared files of the machine that served it, and
   keeps its device part (theme, mode, zoom) in its own storage. Which
   machine a phone opens first is the Person's pick.

9. **A machine that is away takes only its own things away.** Its Projects
   and its machine files are away: an act is refused at once (H5b), rows
   dim "as of" (H5c), and "send when back" keeps a command in the visible
   queue with `not_after` (ADR 0082, decision 16). The Person's files never
   are: each machine has its own copy, so a change to them never fails or
   waits for another machine. ADR 0082's `next_wake_at` rule for a cloud
   host stays.

## What it amends

- **The vision's decisions 4, 8, 12 and 15, and its rules 1 and 5**: no
  home host; dated notes in plan step 1.
- **ADR 0062, decision 9**: a Web App's manifest is a shared file, a copy
  on every machine.
- **ADR 0062, decision 13**: the arrangement is the machine's whose window
  shows it; the Person's files are a copy on every machine; an Agent's
  Pane is placed by each machine whose window sees it; "the home host is
  the always-on host" and "while the home host is away" go.
- **ADR 0062, decision 17**: the tiling's authority is the engine of the
  machine whose arrangement it is; the overlay is only for a client whose
  engine is elsewhere.
- **ADR 0062, decision 18**: the Person's theme folders are shared; which
  theme, the mode, the glass and which display takes which are the
  device's.
- **ADR 0062, plan steps 1, 6 and 7, Consequences and Changes (ADR 0032
  decision 3)**: no "home host" in the words; step 6's gate is local for a
  desktop window; placements are checked by the placing machine.
- **ADR 0068, decision 1**: `mod` is the device's, in the device's file;
  the rest stands.
- **ADR 0080, decision 1 and its Later**: as ADR 0100 has it, with the
  theme choice the device's and the theme folders shared.
- **ADR 0081, decision 1**: one writer holds for Projects, machine files
  and the view; the Person's shared files are a copy on every machine,
  copied whole, with no CRDT.
- **ADR 0081, decision 9**: "the Person's home" row goes; a cloud host is
  one more peer.
- **ADR 0081, decision 12**: each file is shared, the device's or the
  machine's (decision 3 here).
- **ADR 0081, plan step 6**: "one client over several machines, the merged
  Inbox"; the sync is E5.
- **ADR 0082, decision 1**: two scopes, Project and Host; no Person scope;
  the Person's files are files on each machine.
- **ADR 0082, decisions 7 and 15**: a placement goes to the window's own
  machine and is checked there; `not_home` goes.
- **ADR 0082, decision 11**: the welcome's `person{id, home}` is
  `person{id}`.
- **ADR 0082, decision 16**: its home half goes; fail fast, `unreachable`,
  the visible queue, `not_after` and `next_wake_at` stay.
- **ADR 0082, decision 17**: any machine reached over `direct` serves the
  PWA.
- **ADR 0082, plan steps 6 and 15, Consequences and Changes**: step 6 is
  each file's class and the last-agreed hashes; step 15 places in the
  window's own machine; a write to the Person's files never waits; its
  entries for ADR 0005 decision 7, ADR 0025 decision 1, ADR 0032 and ADR
  0071 decision 5 lose the home host.
- **ADR 0083, decision 6**: the chain signs the members only.
- **ADR 0083, decision 8**: the web client's code comes from the signed
  binary of the machine that serves it.
- **ADR 0087, decisions 1 and 10**: the arrangement and its placement
  policy are in the engine of the window's machine; `flow` is a shared
  file each machine reads from its own copy.
- **ADR 0088, decision 11**: the authority is the engine that holds the
  arrangement.
- **ADR 0089, decision 6**: "looked at" stays the device's, by the Pane's
  id in its machine's arrangement; it never goes to a home host.
- **ADR 0089, decision 8**: the phone's sidebar is the `sidebar.toml` of
  the machine that served it.
- **ADR 0100, decisions 1, 2 and 5, and step 0**: the split is shared,
  device and machine, read on each machine from its own copy; step 0
  becomes 0a, the split on each machine alone, and 0b, this ADR's sync.

## Effects on work in flight

- **ADR 0100's step 0** no longer waits for stage 2. 0a (the split, each
  file's class, `mod` and `[notify]` moved, an old file read) can start at
  any time; 0b is E5 here.
- **Stage 2, Remote Panes** (the window session's
  `~/Banda/artifacts/remote-panes/adr-draft.md`): decision 7 cites this
  ADR, and its table takes decision 3's (columns, bar, drawer, overview,
  groups and how Files shows things are the device's; `mod` replaces "the
  mod key"); its header drops ADR 0100 decision 1 from what it amends; its
  context's E5 is this ADR's sync; decision 9 cites decision 6 here;
  slice 5 stays E4 alone, 2 PRs. `decisions.md` calls 13 and 14 name this
  ADR. The `*.before-peers.md` copies stay out of any PR.
- **H5** (`~/Banda/artifacts/two-machines/h5-plan.md`) is unchanged:
  decision 16's fail fast stays whole. Its "Not H5" line reads E5 as this
  ADR's sync, and H6 places in each machine's arrangement.
- **T-a and T-b** (`~/Banda/artifacts/t-a/t-a-design-1.md:247`,
  `t-a-check.md:302-308`): a Group's owner and `pane.left@1` are the
  engine's that holds the arrangement (decision 5).
- **PR #995**: "the keys hold in every window of theirs" holds on each
  machine until E5; its code is right as it is.
- **PR #690**, draft ADR 0090: a WSL host's machine files come from it,
  and the Person's files are the Windows machine's own copy (decision 3,
  in place of ADR 0081 decision 12); Windows' keys are the platform
  layer (decision 4); "no Roaming" stays.
- **The roadmap**: stage 2 keeps E4 only; E5 is not placed yet; "a home
  host that sleeps" becomes "a machine that sleeps: the others work on
  with their own copies".
- **`open_pane`'s words** say it opens on the Agent's machine (an issue).

## Plan

Each step is its own PR.

0. This ADR and the notes in the ADRs above.
1. The words, once accepted: `GLOSSARY.md` (Home host goes; Peer, Shared
   file, Device file and Machine file come; Scope, Person document,
   Person key, Tiling, Arrangement and Overlay follow); notes on the
   vision (rules 1 and 5, decisions 4, 8, 12 and 15, §4.6, §4.7, §8, the
   risks); a status note in
   `docs/research/2026-11-07-client-architecture.md`;
   `docs/sdk/guidelines.md` (borders.8, data.5, the checklist) and
   `docs/sdk/skill-apps.md`; the file table in `platform/skill/SKILL.md`;
   the roadmap's stage 2 and its risk.
2. ADR 0100's step 0a (decision 3, `mod` and `[notify]` moved).
3. E5, the sync (decision 7), where Roma places it.
4. H6's placements, by each machine (decision 6).

## Open

- Is the sync wanted at all, or does each machine keep its own files for
  good? The rest holds either way; only decision 7 and step 3 would go.
- An Agent's Pane on every machine whose window follows its Project, or
  only on those where its Thread shows?
- Decision 3's rows taken by "when in doubt": sound, the drawer, the
  overview, groups and how Files shows things are the device's. Any can
  move to shared.
