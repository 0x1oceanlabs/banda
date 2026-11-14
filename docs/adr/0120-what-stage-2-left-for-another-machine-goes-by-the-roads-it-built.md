---
status: accepted
date: 2026-11-14
---

# What stage 2 left for another machine goes by the roads it built

_It decides the six things [ADR 0106](0106-another-machine-s-panes-run-on-its-engine-and-this-device-only-draws-them.md)
left for later (its decision 9 and its Later), each with its issue:
arc's ports and Codex's sign-in on arc (#1240), the Panes an arc Agent
opens (#1245), arc's Usage and Limits (#1246), Add Project on arc
(#1011), "Update arc" (#775) and copying a file between machines
(#1244). It stands on ADR 0101 (machines are peers), ADR 0105 (honest
when away) and ADR 0106's six laws, and adds no law. Code is cited from
main at `6a947d0f`._

Roma, on 2026-11-12 (translated): the six go in one ADR, and are then
built in its order. The rule is the house's: UNIX composition, deep
modules, explicit contracts, and no ornate layers. So each decision says
which road it takes, of those stage 2 built (`sessionOf`, `routeAct`, the
device's capabilities, the byte relay `app://files/<machine>/<token>`,
the piece carry of ADR 0116, `subscribe` with a filter), and what, if
anything, is new.

The machines are as in ADR 0106: the Mac (m1pro), arc (Arch, always on,
with a screen) and devbox (a server with no window). Neither is home.
Everything here works both ways, and arc's window does the same with the
Mac's.

## Where it stands

**Stage 2 is built through step 4d, and 5a.** arc's terminal, Diff,
Files and paths, its bytes, pictures, PDFs and video, Save a copy to this
Mac, Visuals, Run and Sign in in a reply, and a new Thread on arc's
account all run on arc's engine and are drawn on the Mac
(`git log --grep "ADR 0106"`). Step 5b's engine half is merged
(`keys.settings_read`, `keys.settings_changed`); its window half,
"Settings for: This Mac / arc", is being built, and this ADR does not
touch it.

**A link to arc's own address does not open.** A `Link` from arc that
names `localhost`, a loopback or `0.0.0.0` carries `of`
(`client/core/src/link.ts:6-9`, `:18-24`), and the router refuses it:
"localhost:3000 is arc's", with Copy and "It opens here once port
forwarding comes." (`link.ts:52-62`). The desktop's main already runs one
`ssh -L` per machine, from this device's loopback to arc's engine's port
(`client/desktop/src/hosts.ts:18-19`; `forwardArgs`, `:686-699`), and
nothing else of arc's is forwarded.

**Codex does not sign in on arc from the Mac.** Codex's ChatGPT way runs
inside its Harness and opens a browser on its own machine, so the
Thread's sign-in card on an arc Thread hides it and says "Codex signs in
on a web page in a browser on arc's own computer. Sign in on arc for
now." (`apps/agents/pane/src/thread/SignIn.tsx:146-160`). Codex's
device code runs in a terminal (`codex login --device-auth`,
`platform/harnesses/engine/src/accounts/mod.rs:454-468`), and
`account_status` lists it (`:413-421`), but the card offers only the
ways its Harness gives. ChatGPT asks the Person to turn device codes on
in its security settings first
(`docs/research/2026-11-02-first-run-and-agent-setup.md:79`).

**An arc Agent's Pane shows only in arc's arrangement.** `open_pane` is
the workspaces module's, the machine's (`platform/workspaces/engine/src/lib.rs:188`),
and places the Pane into the arrangement of the engine it runs on
(`:788-835`). An Agent opens four kinds: a Thread, a Diff, a file and a
browser at a web address (`AGENT_KINDS`, `:209-214`). A window of
another machine never hears of it. `window.json` does not say which
kinds open on another machine (`PaneKind`, `engine/src/modules.rs:116-130`),
so the Mac's engine could not check one if it were asked (#1245). ADR 0101
decision 6 says each machine whose window shows the Thread places it, and
Roma's call 2 there: only where its Thread shows.

**Usage and the Bar's Limits are this machine's.** The Usage Pane counts
"the Harnesses' own journals on this machine" (`platform/harnesses/pane/src/UsagePane.tsx:1-5`)
and opens on the window's own engine (`openUsage`,
`platform/harnesses/pane/src/index.ts:10-20`). The Limits Widget reads
`harnesses.limits` from the engine its Widget is given
(`platform/harnesses/pane/src/LimitsWidget.tsx:72-78`), which is the
window's own: `WidgetProps` holds one engine (`client/ui/src/module.ts:497-500`).
An account two entries share is counted once already, on one machine
(`Limits.also`, `platform/harnesses/engine/src/model.rs:283-287`).

**Add Project adds to this machine only.** The Banda menu's Add Project
looks folders up, asks about trust and adds through the menu's own engine
(`client/web/src/menu/BandaMenu.tsx:512-537`; `projects.browse`,
`client/web/src/menu/browse.ts:41`), the window's. Its folder picker is
this device's (`window.banda.folder`, `browse.ts:18-27`). The new
Thread's menu has one Add Project, under every machine
(`client/web/src/sidebar/NewThreadMenu.tsx:346-349`), and the Thread
offers it only on this machine (`apps/agents/pane/src/thread/Thread.tsx:502`;
ADR 0095, decision 9). The engine has every method it needs:
`projects.create`, `add`, `browse`, `foreign` and `locate`, each under
Manage (`kernel/src/kernel.rs:380-403`). On devbox, which has no window,
a Project comes about only by `banda project add` in its own shell
(#1011's comment).

**Each machine updates its own engine, and no window updates another.**
The updates module takes its channel's newest engine and puts it beside
the running one; restarting on it is a later step
(`platform/updates/engine/src/lib.rs:1-13`; its methods, `check` and
`state`, `:369-378`). Its ADR, "Each machine updates its own Banda, in
one updates module", is
[ADR 0119](0119-each-machine-updates-its-own-banda-in-one-updates-module.md)
(PR #1522), with "Update arc" as a row of one widget for every
machine (its decision 7). The pill has no "arc runs another build": it
waits for a button to press (`reachWords`, `client/core/src/hosts.ts:1004-1025`;
ADR 0095, decision 9).

**A file does not go from one machine to another.** A Mac file dropped or
pasted onto arc's tree is refused, "That file is on this Mac. Files
don't move between machines yet." (`client/core/src/route.ts:247-251`).
`files.copy` and `files.move` copy within one engine's disks
(`apps/files/engine/src/lib.rs:183-193`). Two roads that carry bytes
are built:

- **Out of a machine, by URL.** `bytes.issue` gives the window a token
  for a file it may read, and the device reads it by range through
  `app://files/<machine>/<token>` (`client/desktop/src/bytes.ts:1-9`).
  The relay passes `GET` and `HEAD` only
  (`client/desktop-kit/src/files.ts:152-159`).
- **Into a machine, in pieces.** A Thread's move reads an artefact in
  pieces of 512 KiB from one engine and writes each to the other,
  through the window (`apps/agents/engine/src/to_machine.rs:1-7`,
  `:51-52`; `take_piece`, `:581-620`). Only a Person carries.

No engine talks to another (ADR 0101; ADR 0116, "Where it stands").

## Decision

Each decision names its **road**, what stage 2 or an earlier ADR built
and it takes as it is, and what is **new**.

1. **Add Project adds on the machine it is asked on** (#1011).
   - Add Project names a machine: it is a machine's own act (law 3's
     second target). The Window keeps its one door, the Banda menu's
     "Add Project" branch: where the Window reaches other machines, the
     branch asks where first, "This Mac", "arc", "devbox", and goes on
     as it does today. A door that knows its machine, as an arc Thread's
     Project list, opens the branch there.
   - A machine with no Projects is a row of that step, "no Projects
     yet", so devbox, with no window of its own, starts from the Mac. It
     gets no row of its own in the sidebar, and an away machine's row
     says so and adds nothing (Roma, 2026-11-14, on the mock).
   - The path field, New Project, the trust question and the add each go
     to that machine's engine: `projects.browse`, `create`, `foreign`,
     `add` and `locate` there. The menu's top says where: "Add Project on
     devbox".
   - The system's folder picker is this device's, so it shows only where
     the folders it picks are the owner's: on this machine. On another
     machine the path field, which browses that machine's folders, is the
     whole road.
   - **Road.** `sessionOf` by the machine's Host scope ID; the kernel's
     project methods as they are; the Banda menu's Add Project branch.
   - **New.** Nothing in the engine. The branch carries its machine.

2. **A port of another machine opens here through a forward of its own,
   when the Person opens a link to it** (#1240).
   - A click on a `Link` whose `of` is arc, as `localhost:3000` in an arc
     reply, terminal, Visual or Files, opens it in this device's browser
     through a forward: main runs one more `ssh -N -L` to arc, from
     this device's `127.0.0.1:<port>` to arc's `127.0.0.1:<port>`, and
     opens `http://localhost:<port>/<rest>` once that ssh listens. A
     toast says "localhost:3000 opens from arc".
   - **The same port**, when it is free on this device: a page that
     names its own address, a dev server's socket and a sign-in's
     callback then work unchanged. When it is taken, the next free port,
     and the toast says so: "3000 is taken on this Mac: opens as
     localhost:3001".
   - Only the Person's click forwards. An Agent forwards nothing, and a
     port is never forwarded because a program printed it.
   - The forward listens on this device's loopback only. It never
     forwards arc's engine's own port, which Banda's forward has already
     and which serves only with its secret.
   - It lasts while the window runs and arc is live, and ends with arc's
     link, as the engine's forward does. A later click opens it again.
     Nothing waits: while arc is away the click is refused at once, "arc
     is away: localhost:3000 did not open." (law 4).
   - The router asks the device, not the place (law 6): a new capability,
     `forward_port`, joins ADR 0082 decision 12's closed list, as
     `save_file` did. A web page or a phone has none yet, and keeps
     "localhost:3000 is arc's · Copy".
   - **Road.** ADR 0081 decision 4's `ssh` route, and `forwardArgs`
     (`hosts.ts:686-699`) as it is, with arc's `ssh` and its options; the
     router's `refuses` for a `Link` of arc's (`link.ts:52-62`), which now
     offers to open it; the device capabilities (law 6).
   - **New.** `Hosts.forward(machine, port)` in the desktop's main, which
     answers the port it listens on here or why not; the capability
     `forward_port`; and the words.
   - **Not here.** Finding arc's servers by themselves and listing them on
     the Bar (#1240 stays open for it), and arc's Agents' own browser,
     which is ADR 0062 decision 12's Chromium on the host (question 3).

3. **Codex signs in on arc in this device's browser, and by its device
   code** (#1240).
   - The sign-in card of an arc Thread offers Codex's ChatGPT way as
     Codex's own `codex login`, in a terminal on arc, by the road ADR
     0106's step 1c built for Claude Code's (`TerminalWay`, `SignIn.tsx`).
     Codex prints the sign-in page's address and listens on arc's
     `localhost:1455` for the answer.
   - The address is public, so it opens in this device's browser. A
     public `Link` of arc's whose `redirect_uri` names arc's own address
     forwards that port first, at the same number, as decision 2 does.
     The browser's redirect to `localhost:1455` then reaches Codex on
     arc. Port 1455 taken on this device refuses, since the page's
     callback names it: "Port 1455 is taken on this Mac: sign in with a
     code instead."
   - The card also offers "ChatGPT (device code)", which needs no
     forward, for an account that has device codes turned on.
   - Claude Code's sign-in on arc stays as built: a terminal way that
     takes a pasted code.
   - On this machine nothing changes: the ChatGPT way runs in the
     Harness, as now.
   - **Road.** ADR 0106's terminal ways on arc (step 1c);
     `login_account`'s device code (`accounts/mod.rs:454-468`), which the
     window now offers; ADR 0108's one door, the engine running a
     sign-in to its end; decision 2's forward.
   - **New.** Codex's ChatGPT way gets a terminal form, beside its device
     code; `linkOf` reads a sign-in's `redirect_uri`. "Sign in on arc for
     now" goes for Codex.

4. **A file goes from one machine to another as a copy the window
   carries** (#1244).
   - A file of arc's dropped or pasted onto a folder of a Mac Project, or
     the other way, is copied there. Across machines a drop always
     copies, and a cut and paste copies too: the file stays where it was,
     and the toast says so.
   - **Out**, by the byte road: the window asks the sending machine for
     the file's token (`bytes.issue`) and reads it by range through
     `app://files/<machine>/<token>`.
   - **In**, by the piece road: the window writes each 512 KiB piece to
     the receiving machine, `files.take_piece {job, at, data}`, kept in
     that Project's data; then `files.place {job, into, name, size,
     taken}` puts the file in the folder, by the rule `files.copy` keeps
     for a name taken (ask, replace, keep both, skip). It answers as
     `files.copy` ends, with what undoes it.
   - **Whole or not at all.** The window looks at the file before it
     reads and after (`files.stat`); one that changed meanwhile is not
     placed: "notes.md changed on arc while it was copied: copy it
     again." `place` checks the size. A copy cut short leaves no file in
     the folder; its pieces go with `files.cancel`, or after a day.
   - **Both machines live.** It is an act: while either is away, it is
     refused at once; one machine going away in the middle ends it with
     "arc went away: the copy did not finish." Nothing goes on later by
     itself.
   - A toast says how far: "Copying to arc · 8 of 31 MB", with Cancel.
   - A file dropped from Finder onto arc's tree goes the same way in,
     its bytes read from the drop.
   - Files, one or many. A folder is refused in words until a step of
     its own: "Folders don't go between machines yet."
   - Only a Person carries: no Agent calls `take_piece` or `place`, with
     a pass or without, as for a Thread's move (ADR 0116, decision 4).
   - **Road.** `bytes.issue` and the relay as they are (ADR 0106's step
     4c), so the
     window gets no new way to read; ADR 0116's pieces, their size and
     their rule that only a Person carries; `files.copy`'s name rule and
     undo; `files.cancel`.
   - **New.** `files.take_piece` and `files.place`. The relay stays
     `GET` and `HEAD`: nothing is written through it.
   - The issue's `files.copy_from`, where the receiving engine fetches
     from the sending one, is not taken: no engine reaches another
     (ADR 0101).

5. **arc's Usage is a Pane of arc's, and the Bar's Limits count every
   machine's accounts** (#1246).
   - The Usage Pane says `elsewhere` and takes the machine it counts in
     its args, `{machine}`, its Host scope's ID. It mounts with that owner
     (law 3's second target), so its `engine` is arc's session. Its head
     has the same switch as Settings, "Usage for: This Mac / arc", from
     ADR 0106's step 5b; opened from an arc Pane, it opens on arc. While
     arc is away it shows its last screen "as of 14:02".
   - Usage stays each machine's: the journals it counts are that
     machine's. No sum across machines.
   - The Limits Widget reads `harnesses.limits` from every machine the
     window shows. An account signed in on two machines, the same Harness
     and the same address, is one account with one set of Limits, and
     counts once, as `also` does on one machine. The ring shows the room
     of the best account of each Harness over all of them. The popover
     lists the accounts by machine, this one first and each other under
     its name and icon (ADR 0095); an away machine's rows dim "as of".
   - A Widget takes each machine's session as a Pane does (ADR 0106,
     decision 1): `WidgetProps` gains the machines with their sessions.
     The updates widget of PR #1522 needs the same.
   - **Road.** `sessionOf` by a machine's Host scope ID; the mount every
     Pane host shares; ADR 0106's step 5b switch; `harnesses.limits` and
     `harnesses.usage` as they are.
   - **New.** `machine` in Usage's args and `elsewhere` on its kind; the
     machines in `WidgetProps`; one account across machines by Harness
     and address.

6. **An Agent's Pane on another machine is placed by each window that
   shows its Thread** (#1245; ADR 0101 decision 6, H6).
   - On arc, `open_pane` places the Pane in arc's arrangement as built,
     with a window or none. In the same command it records one fact in
     arc's machine log: `workspaces.pane.asked@1 {thread, project, kind,
     args, beside?}`.
   - A window follows that fact on each other machine it reaches while
     one of that machine's Threads shows in its arrangement, by
     `subscribe` with a filter on the machine's log, as the Limits Widget
     follows `limits_changed`. It checks the Project: one the directory
     does not place on that machine is dropped (law 2). Then it asks its
     own engine to place the Pane: `workspaces.place_asked {from, at,
     thread, project, kind, args}`.
   - The window's engine checks it as an Agent's, though the window
     asks: the kind is one of `AGENT_KINDS` with its args' rule, and its
     kind says `elsewhere` in this build's `window.json`. It places the
     Pane into the Thread's Group by the Flow, takes no focus and marks
     it, as `open_pane` does. A Thread not shown here places nothing
     (ADR 0101, call 2).
   - Each arrangement keeps, per other machine, the last position it
     placed through, so a reload or a second window places nothing twice.
     A fact older than the arrangement's first follow is not placed.
   - A browser Pane from arc at arc's own address opens through decision
     2's forward only on the Person's click: "localhost:3000 is arc's ·
     Open from arc".
   - The Agent's `move_pane` and `close_pane` stay with arc's
     arrangement. The Pane on the Mac is the Person's once placed. The
     Agent's `panes` lists arc's arrangement only, and says so.
   - **Road.** `open_pane`'s rules and Flow as built; the kernel's
     `subscribe` with a filter (`kernel/src/api.rs:30-33`), on a
     machine's log by its Host scope ID as `useMachineLive` follows one
     (`client/ui/src/hooks/use-live.ts:191-197`); the directory
     and law 2's check; the window's own engine for its own arrangement
     (ADR 0101, decision 5).
   - **New.** `elsewhere` in `window.json`; the fact
     `workspaces.pane.asked@1`; `workspaces.place_asked` with its
     position kept per machine. ADR 0101's `show.requested@1` in the
     Project's log is this fact in the machine's log, where `open_pane`'s
     receipt is.

7. **"Update arc" is arc's row in the updates widget** (#775).
   - PR #1522's ADR decides how a machine updates itself and draws one
     widget with a row for each machine. This ADR adds only where the
     Person meets it on an arc Pane.
   - The pill says "arc runs another build · Update arc" only while arc's
     own `updates.state` has a newer engine ready, so the button does
     something. Without one, the builds differ and the label says so;
     no pill shows (#775's comment).
   - "Not on arc yet" for an App arc's build lacks offers "Update arc" on
     the same condition (ADR 0106, decision 2), else it says only "Not on
     arc yet".
   - Update arc opens the widget at arc's row. Its act is that ADR's
     Restart now, sent to arc's engine. While arc is away, it is refused
     at once.
   - **Road.** The updates module and its widget (PR #1522); `routeAct`'s
     machine owner; the pill and `reachWords`.
   - **New.** The words, and one case in `reachWords`.

8. **Each act here goes now or says why not.** None of the six adds a
   queue or an away rule of its own: a forward, a sign-in, a placement, a
   Restart now, an add and a copy are acts by law 4, and refused at once
   while their machine is away. The reads (Usage, Limits, the fact a
   window follows) wait, and show "as of".

## The contract

| Where | What | Step |
|---|---|---|
| `client/web` | Add Project's branch names its machine | 1 |
| desktop | `Hosts.forward(machine, port)` → the port here, or why not; ends with the machine's link | 2 |
| device | `forward_port`, in ADR 0082 decision 12's closed list | 2 |
| `client/core` | a `Link` of arc's offers "Open from arc" where the device has `forward_port`; `linkOf` reads a public link's `redirect_uri` | 3, 4 |
| host | Codex's ChatGPT way as a terminal way, `codex login` | 4 |
| host | `files.take_piece {job, at, data}`; `files.place {job, into, name, size, taken}` → as `files.copy` ends; Person only | 5 |
| `client/ui` | `WidgetProps` gains the machines with their sessions | 8 |
| `engine` | `window.json`'s `PaneKind` says `elsewhere` | 9 |
| host | `workspaces.pane.asked@1 {thread, project, kind, args, beside?}`, recorded by `open_pane`; `workspaces.place_asked {from, at, thread, project, kind, args}`, with the position kept per machine | 9 |

- **Kept, unchanged:** `bytes.issue` and `/b/`; the relay's `GET` and
  `HEAD`; `open_pane`, `AGENT_KINDS` and the Flow; `harnesses.limits`
  and `harnesses.usage`; the kernel's project methods; `login_account`.
- **Never added:** an engine that calls another; `files.copy_from`; a
  write through the relay; a forward an Agent or a printed line asks for.

## The words

"localhost:3000 opens from arc" · "3000 is taken on this Mac: opens as
localhost:3001" · "arc is away: localhost:3000 did not open." ·
"localhost:3000 is arc's · Open from arc" · "Port 1455 is taken on this
Mac: sign in with a code instead." · "ChatGPT (device code)" · "Add
Project on devbox" · "Usage for: This Mac / arc" · "arc runs another
build · Update arc" · "Copying to arc · 8 of 31 MB" · "notes.md changed
on arc while it was copied: copy it again." · "arc went away: the copy
did not finish." · "Folders don't go between machines yet." · "The file
stays on this Mac." (after a cut across machines).

"That file is on this Mac. Files don't move between machines yet." goes;
"That file is on arc" stays for what still does not cross, as a file of
arc's dropped into a Mac Thread's Message box.

## Plan

Each step is its own PR; S is up to a day, M one to two: eleven PRs
after this ADR. The order puts first what devbox, with no window,
needs: a Project, a sign-in, its dev server. Each step's e2e runs on the fake arc of the
same-path job (ADR 0106, step 1a′).

| Step | Track, size | What it does |
|---|---|---|
| 0 | docs | This ADR |
| 1 | window, S-M | Add Project on another machine: the branch asks where and carries its machine, an empty machine is a row of that step, no picker there (decision 1) |
| 2 | desktop, M | `Hosts.forward`: the same port or the next, the engine's port refused, an end with the link; `forward_port` (decision 2) |
| 3 | window, S | A `Link` of arc's opens through the forward on a click; the words; an Agent's browser Pane at arc's address (decision 2) |
| 4 | both, S | Codex's ChatGPT way in a terminal on arc, its callback forwarded at the same port; its device code in the card (decision 3) |
| 5 | engine, M | `files.take_piece` and `files.place`, with the name rule, the size check and the sweep (decision 4) |
| 6 | window, M | A drop and a paste across machines copy; the toast with Cancel; a file from Finder; folders refused (decision 4) |
| 7 | window, S | Usage `elsewhere`, by machine, with the switch of ADR 0106's step 5b (decision 5) |
| 8 | window, S-M | The Limits Widget over every machine, one account counted once (decision 5) |
| 9 | engine, S | `elsewhere` in `window.json`; `pane.asked` from `open_pane`; `place_asked` with its checks and position (decision 6) |
| 10 | window, S-M | The window follows other machines' `pane.asked` while their Threads show, and places (decision 6) |
| 11 | window, S | The pill's "Update arc" and "Not on arc yet · Update arc", once PR #1522's steps 4 and 6 are in (decision 7) |

Step 7 waits for ADR 0106's step 5b, whose switch it takes. Step 11
waits for the updates module's restart and widget. The rest wait for
nothing but their order; steps 2 and 5, of the desktop and the engine,
may go beside the window's.

**What Roma tries.**

- **1.** On the Mac, Add Project in the Banda menu asks where; pick
  devbox. Type
  `/work/code/` and see devbox's folders; add one, trust it, and start a
  Thread there.
- **2 to 4.** `pnpm dev` in arc's terminal on the Mac; click
  `localhost:5173` in its output: arc's page opens in this Mac's
  browser, and saving a file on arc reloads it. On an arc Codex Thread
  that needs a sign-in, Sign in with ChatGPT: a terminal on arc, the
  page in this Mac's browser, and the Thread goes on.
- **5, 6.** Drag a screenshot from the Mac's Files onto arc's tree: it is
  on arc. Copy a log from arc's Files and paste it into a Mac Project.
  Cut arc while a large file copies: "arc went away: the copy did not
  finish", and nothing half is left.
- **7, 8.** Usage for: arc shows arc's cost. The Bar's ring counts arc's
  Codex account beside the Mac's Claude Code, and the same Claude
  account once.
- **9, 10.** An arc Agent opens a Diff: it shows beside its Thread on the
  Mac, and in arc's own window.
- **11.** Once arc has an engine ready, the pill on an arc Pane says
  "arc runs another build · Update arc"; press it, and arc restarts on
  it.

## What it amends

Each with a dated note in place, once accepted:

- **ADR 0082, decision 12:** `forward_port` joins the closed list.
- **ADR 0101, decision 6:** H6's request is `workspaces.pane.asked@1` in
  the Agent's machine's log, carried by each window to its own engine,
  which places and checks it.
- **ADR 0106, decision 3:** a `Link` of arc's opens through a forward
  where the device has `forward_port`; an act on two machines' files is a
  copy where it is a drop or a paste. **Decision 9 and its Later:** these
  six are decided here.
- **ADR 0073, decision 10:** a drop across machines copies.
- **ADR 0043:** Usage is its machine's, and its Pane names the machine.
- **ADR 0095, decision 7:** "arc runs another build · Update arc" shows
  while arc has an engine ready.

## Consequences

- devbox, and any machine with no window, is set up from another
  machine's window: its Projects, its sign-ins, its servers.
- One more ssh runs for each port opened, for as long as the window
  runs. A dev server's port on arc is reachable from any program on
  this Mac while it is forwarded, as a server on this Mac's own
  loopback is.
- An arc Agent's Pane shows on the Mac a moment after it shows on arc,
  one round trip later, and only while its Thread shows there.
- A copy costs its size through the window's two ssh links, as a Thread's
  move does, and a third more on the way in, as the pieces go in base64.
- The Bar's Limits follow every live machine's log, and opening the
  popover asks each machine for a read, as it asks this one.
- `GLOSSARY.md` gains **Forward**: a port of another machine opened on
  this device over its ssh, while the window runs. **Usage** reads "on
  its machine", not "on this computer". **Sign-in** says that Codex on
  another machine signs in through a terminal there.

## Roma's answers

Roma answered on 2026-11-14, each as recommended.

1. **Which port does a forward take here?** The same as arc's when it is
   free here, else the next free one, said in the toast. A sign-in's
   callback takes the same port or is refused, since the page names it.

2. **Does Banda find arc's servers by itself?** No, not now. A port opens
   when the Person clicks a link to it. Listing arc's servers on the Bar
   stays #1240.

3. **Does arc's Agent get a browser while arc has no window?** Not in
   this ADR. Roma asked for a research of its own first: an Agent's pages
   in the host's Chromium (ADR 0062, decision 12; the vision's I7), which
   works with the laptop closed. Its ADR follows that research.

4. **Folders, and a cut, across machines?** Files only, one or many; a
   folder is refused in words, until the Person asks. A cut and paste
   across machines copies, and the file stays.

5. **What does the Bar's ring count?** Every machine's accounts, one
   account once by Harness and address, the best room of each Harness
   over all of them; Usage stays one machine's, with the switch.

6. **Where does an arc Agent's Pane show?** As ADR 0101 call 2 says, in
   each window that shows its Thread, and nowhere else; the Agent moves
   and closes only arc's.

7. **The order.** The Plan's: Add Project (devbox needs it first), ports
   and Codex's sign-in, copying, Usage and Limits, an Agent's Panes,
   Update arc last.
