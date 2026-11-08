---
status: accepted
date: 2026-11-08
---

# Seen and archive are Thread data on its host

_It takes (b) for the architecture vision's decision 13, in place of (a),
and so amends ADR 0082 (decisions 1, 15 and 16). It also amends ADR 0005
(decision 8), ADR 0011 (decision 1), ADR 0069 (decision 5), ADR 0074
(decision 2), ADR 0081 (decision 12), ADR 0087 (decision 12) and ADR 0089
(decision 6). Code is cited from main at `d8fc6436`._

Roma, on 2026-11-08 (translated), after opening arc's Threads from the
Mac: "It works, but they are all marked Done and not in the archive. I
think this needs syncing too."

Asked where seen should live so that the Mac and arc see the same: (a)
with all the Person's marks on one home machine, as decided on
2026-11-06, which needs A2 and E8 first; or (b) in the Thread on its
machine, next to the snooze. He chose (b).

**Where it stands.**

- **Seen** is kept in each window's `localStorage`, under
  `banda.agents.seen`: `{ThreadId: TurnId}`, the last finished turn the
  Person saw, the latest 500 (`apps/agents/pane/src/list/seen.ts:12-15`,
  `client/ui/src/lib/kept.ts:26-30`).
  - A window writes it while the Thread's Pane has the focus, the window
    is in front and the latest turn that began has ended
    (`apps/agents/pane/src/thread/session.ts:159-164`, `settledTurn` in
    `list/marks.ts:57-63`). "In front" is `document.hasFocus()` and
    nothing more (`client/ui/src/hooks/use-in-front.ts:18-20`).
  - "Mark as read" writes the last ended turn the lists heard of; "Mark as
    unread" drops it (`seen.ts:26-41`).
  - Only `markOf` reads it: a done or failed turn calls until seen holds
    that turn (`list/marks.ts:19-36`). The sidebar, the bar's counts and
    its Mark, `Alt+U`, the workspace dots and the notifications all read
    the mark.
- **Archive** is kept there too, under `banda.sidebar.archived`:
  `{archived, at}` in the window's own time, up to 10,000
  (`client/web/src/sidebar/archived.ts:16-22`, `:78-88`).
  - `{archived, at}` is what the Person last chose, archive or bring
    back, and when. A Thread is archived while that choice is archive,
    it is newer than what changed in the Thread, and no snooze is newer
    than it (`archived.ts:35-46`).
  - The three quiet days left a cutoff, written once as
    `banda.sidebar.archived-before` (`archived.ts:55-76`, ADR 0069,
    decision 5).
  - Shell's `archiveThread` wakes a snoozed Thread with a second command,
    keeps what the Person chose and closes the Thread's Panes
    (`client/web/src/window/Shell.tsx:356-366`); `Alt+S` toggles it
    (`:367-378`).
- **Another machine's Thread** (#768, #796) comes in a list from its own
  engine (`client/web/src/bar/Watches.tsx:128-150`), but its seen and
  archive are read from and written to this window's keys, by the
  Thread's ID. So a Thread of arc never opened on the Mac stays Done
  there, and one archived on arc is still in the Mac's list: Roma's bug.
- **The snooze is the pattern.** It is a column on the Thread,
  `agents_threads.snooze` (`apps/agents/engine/src/store.rs:172`),
  written by `set_thread_json`, which leaves `updated_at` alone
  (`store.rs:272-283`, `:318-320`), and listed with each Thread
  (`store.rs:622-648`). `agents.snooze` and `agents.wake`
  (`apps/agents/engine/src/lib.rs:415`, `:419`) publish `thread.snoozed`
  and `thread.woke`. The window sends them through `engineOf(project)`,
  so they reach the Thread's host (`Shell.tsx:323-355`), and a Pane of
  another machine may run them (`client/web/src/calls/hosts.ts:321-328`).
- ADR 0074, decision 2, already says "Archive moves to the engine in its
  own step, later". `refactor.md` E7 makes the marks threads commands
  "stored in the Project" and leaves "Project versus Person" to Roma.
- The vision's decision 13 (`docs/research/2026-11-06-architecture-vision.md:850-854`)
  and ADR 0082 (decisions 1, 15 and 16) put seen in the Person's
  documents on the home host, joined by the client. The code has neither
  a home host nor a Person scope: `Scope` is a Project or the machine
  (`kernel/src/module.rs:22-28`), and A2 and E8 are not built.
- A rewind deletes the turn it takes back and every later turn
  (`store.rs:1093-1122`).
- The Person is the engine's owner, `Participant::Person`
  (`kernel/src/api.rs:215-225`). `switch` refuses an Agent with a check of
  its own (`lib.rs:1095-1101`).

## Decision

1. **Seen and archive are the Thread's data, in its Project, on its
   host.** The agents module keeps them on the Thread beside the snooze,
   and they move with the Project (ADR 0081, decision 11). Every window,
   machine and Agent reads the same marks. This takes option (b) of the
   vision's decision 13 in place of (a). The Person's documents on the
   home host (A2; ADR 0081, decision 12) do not hold seen (Roma,
   2026-11-08).
   - A mark can be reached exactly when its Thread can, so there is no
     home host to choose and nothing to queue.

2. **Seen is the ID of the latest ended turn the Person saw, never a
   time.**
   - It moves forward only, among the Thread's turns that still exist. A
     turn of another Thread, one that has not ended, or one older than
     the mark changes nothing, and the mark it already holds writes
     nothing.
   - A rewind that deletes the marked turn clears seen in the same
     transaction. A mark that names no turn counts as none.
   - "Mark as unread" clears it. "Mark as read" with no turn marks the
     latest ended turn the host knows.

3. **A window marks seen by itself only while the Person is there**: the
   Thread's Pane has the focus, the window is in front, and there was a
   key, pointer or wheel input in that window within the last minute.
   Otherwise it marks on the first input after.
   - Without this, a window left in front on arc would hide Done on the
     Mac. All of it is the device's own; no clock is compared across
     machines.
   - A mark taken back by "Mark as unread" stays so until the Person
     leaves the Thread and comes back, as now (ADR 0077, decision 6).
   - This is the mark every machine reads. Where a Thread opens
     (ADR 0094) stays the device's view, by what was on screen; a window in
     the background still counts there, as ADR 0094 leaves open. What a
     window says when a turn ends stays as ADR 0011, decision 1, has it.

4. **Archive is `{at}`, in the host's time.** A Thread stays archived
   while it is archivable and nothing in it changed after `at`.
   - The engine refuses to archive a Thread that works or asks (ADR 0069,
     decision 4).
   - Archiving wakes a snoozed Thread, and snoozing clears the archive,
     both in the engine, each in one transaction (ADR 0074, decision 4).
   - The window that archives closes the Thread's Panes, as now.

5. **Only the Person marks.** The mark commands refuse an Agent, through
   its CLI too, with the same check as `switch`; ADR 0083's fence (F0, its
   plan's step 4) hardens them all.
   - Only the Person archives (ADR 0069, decision 5). An Agent that marked
     its own Thread seen would silence the one call that brings its
     Person back.
   - Agents read both marks in `threads`, as they read the snooze.

6. **The mark facts never move a Thread in the list.** The window follows
   `thread.seen`, `thread.unseen`, `thread.archived` and
   `thread.unarchived` without touching what changed, and the engine
   writes them without touching `updated_at`. The one-time move
   (decision 9) writes one `marks.moved` fact, and each list reads itself
   again, as it does after `thread.rewound`.

7. **No comparison uses a device's clock.** The window sends Thread and
   turn IDs, and the host stamps `at`. It is compared only with the host's
   own times, its `updated_at`. Clocks minutes apart change nothing.

8. **A mark made while its host is away fails, and nothing queues it.**
   - A seen the window writes by itself fails quietly. One from a menu or
     a key fails with the toast a snooze shows today.
   - Nothing in that Thread changes while its host is away, so the Person
     marks it again once it is back. The window shows the last list it
     heard, as it does now.
   - A host older than this refuses the commands, and the window's toast
     names that machine. Its list has no marks, so its Threads show Done,
     as today.

9. **Each machine's window moves its own marks once per Project.**
   - It sends, for this machine's Projects only, one `agents.import_marks`
     each: seen as it stands, and the Threads the old rule shows archived
     at that moment (what the Person last chose, archive or bring back;
     the cutoff; and the snooze), by ID. The host stamps `now`. Unknown
     IDs are ignored.
   - An imported seen follows decision 2: it moves the host's seen
     forward, never back. An imported archive is dropped where the host
     already has one, so the host's wins; that is for archive only.
   - `banda.marks.moved` keeps which Projects are done. The old keys stay,
     read only, for one stable release, as ADR 0069 (decision 3) kept its
     old names.
   - Marks a window kept for another machine's Threads are dropped: that
     machine's own window brings its marks.

10. **Calls on the host read seen there** (E8). Its projection raises and
    clears done and failed calls by the Thread's own seen, `calls.inbox`
    carries the result, and the client joins nothing. A host's push, and
    its withdrawal, go by seen, not only by where the devices are. What
    this ADR builds is E8's input, not something E8 redoes.

11. **The other marks of a window stay for now.** The woke rows' seen and
    dismissed marks and the supervised notes stay per window, each an
    issue. A draft and the Banda menu's recent picks stay the device's
    (ADR 0081, decision 1).

## The contract

All are `Write` commands of the agents module on the Thread's Project,
with no tool, and each refuses an Agent (decision 5):

| Command                                | Fact                         |
| -------------------------------------- | ---------------------------- |
| `agents.read {thread, turn?}`          | `thread.seen {thread, turn}` |
| `agents.unread {thread}`               | `thread.unseen {thread}`     |
| `agents.archive {thread}`              | `thread.archived {thread}`   |
| `agents.unarchive {thread}`            | `thread.unarchived {thread}` |
| `agents.import_marks {seen, archived}` | `marks.moved {}`             |

- `thread.archived` takes its `at` from the event's own. `import_marks`
  takes `seen` as `{thread: turn}` and `archived` as a list of Threads,
  and writes one fact however many marks it moves.
- `ListedThread` gains `seen?: TurnId` and `archived?: {at}`.
- The window has two toggles, and keeps their ids through B4d
  (client-architecture §6.4): `thread.unread`
  (`client/web/src/window/actions.ts:800`) sends `agents.unread` or
  `agents.read`, and `sidebar.archive` (`:765`) sends `agents.archive` or
  `agents.unarchive`, by the Thread's mark. The Thread menu's rows send
  the same. B7's `item@1` maps the four commands one to one onto the
  platform's read, unread, archive and unarchive (ADR 0087, decision 12).
- The Person's words do not change: "Mark as read", "Mark as unread",
  "Archive thread", "Unarchive thread".

## What it amends

- **The vision's decision 13**: (b). Its text says so, with a dated note.
- **ADR 0082, decisions 1, 15 and 16**: seen marks leave the Person's
  documents; the client joins none, and none waits on the device while
  home is away.
- **ADR 0005, decision 8**: seen and archived are kept on the Thread by
  its host, as the snooze is.
- **ADR 0011, decision 1**: the seen mark also needs input in the window
  within the last minute (decision 3).
- **ADR 0069, decision 5**: the cutoff becomes per-Thread archives on the
  host, once (decision 9), and the window's cutoff goes.
- **ADR 0074, decision 2**: "Archive moves to the engine" is step 1a.
- **ADR 0081, decision 12**: the Person's files do not hold seen.
- **ADR 0087, decision 12**: for a Thread, the platform's read, unread,
  archive and unarchive are calls to the Thread's host; the mark is the
  Thread's.
- **ADR 0089, decision 6**: a Thread's seen and archived come from its
  host, not from a Person document; nothing waits on the device.
- **`refactor.md` E7**: "Project versus Person" is answered: the Project.

## Plan

Each step is its own PR.

0. This ADR, `GLOSSARY.md`, the notes in the ADRs above, and the vision's
   decision 13.
1. **The engine.**
   - **1a, archive** (in progress, `feat/archive-on-host`): the `archived`
     column and its setter, and the field in `threads` (`store.rs`);
     `Archived`, `thread.archived`, `thread.unarchived`, `marks.moved` and
     `ListedThread.archived` (`model.rs`); a new `marks.rs` with
     `archive`, `unarchive` and the archived part of `import_marks`; a
     snooze that clears the archive (`snoozes.rs`); `lib.rs`; the
     generated contract; tests. Its fields only add, so it merges before
     any window reads them.
   - **1b, seen**: the `seen` column, which a rewind clears
     (`store.rs`); `thread.seen`, `thread.unseen` and `ListedThread.seen`
     (`model.rs`); `read`, `unread` and the seen part of `import_marks`
     (`marks.rs`); tests.
2. **The window.**
   - **2a, the Pane's side**, none of B4d's files:
     `apps/agents/pane/src/list/list.ts` (the five facts in
     `THREADS_FILTER`, none moving a Thread, and `marks.moved` reading the
     list again); `apps/agents/pane/src/thread/session.ts`, whose seen
     waits for a small hook for the Person's presence (decision 3) and
     then goes to the Thread's host as `agents.read` as well as to
     today's `localStorage`, failing quietly (decision 8), so each host's
     seen fills before the flip; a new
     `apps/agents/pane/src/list/marks-moved.ts`, the agents module's, as
     the window names no App method, with frozen copies of the old seen,
     archive and cutoff rules, one `import_marks` per Project of this
     machine and the `banda.marks.moved` flag, not yet wired; tests. Its
     file list is agreed with the window's session first.
   - **2b, the flip**, in the window's session's files, after its B4d and
     before B4e or inside it: `thread.unread`, `sidebar.archive` and the
     Thread menu's rows, as B4d leaves them, call the commands; `markOf`
     and `isArchived` read the listed fields, with what was sent shown
     until its fact comes back; the `localStorage` writes and the cutoff
     go; Shell's archive and `Alt+S` become one command; `RUNS_ELSEWHERE`
     gains `thread.unread` and `sidebar.archive`; `marks-moved` runs once,
     from the agents module's `index.ts` after the first list load.
3. **Rollout.** Both machines get a build with 1a to 2b, then each
   machine's window starts once, which moves its marks.

## Later

Each is an issue:

- The woke rows' seen and dismissed marks, and the supervised notes, per
  window (decision 11).
- A Thread marked seen on one machine does not take back the other's
  system notification.
- arc's window keeps the Panes of a Thread archived on the Mac open.
- A pin on another machine's Project goes to this machine's engine
  (`Shell.tsx:1062-1063`).

When Banda has several Persons on one host (organisations), the two
columns become a table keyed by Thread and Person, which only adds.
