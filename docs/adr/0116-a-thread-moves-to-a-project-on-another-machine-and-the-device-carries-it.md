---
status: proposed
date: 2026-11-11
---

# A Thread moves to a Project on another machine, and the device carries it

_A draft, with Roma's calls of 2026-11-11 at the end. Code is cited from
main at `f7a03ea2`._

Roma, on 2026-11-11 (translated): "I work on the Mac, and then I throw
this Thread over to another Project on devbox", and: "on the laptop I
can throw a Thread over to the server and close the laptop, and the task
goes on."

**Where it stands.**

- **A Thread moves to another Project of its own machine, whole**
  (ADR 0098, decision 14; `apps/agents/engine/src/to_project.rs`):
  `agents.move_thread{thread, project}`. Its rows in the module's five
  tables go (`THREAD_TABLES`, `ThreadRows`), with its images, its
  Visuals' pages, the files kept for its Person's messages and its Claude
  Code sessions. Only a Thread at rest moves (`rules::to_project::may_move`).
  The copy is written first, the Thread leaves second, and a move cut
  short leaves it in both Projects, to be moved again.
- **Its menu row is on its way**: "Move to Project ▸", a submenu of this
  machine's other Projects (#1531).
- **A Claude Code session is a file in the Project's data**
  (`data/sessions/claude/<session>.jsonl`), found by its ID whatever
  folder it was written under (ADR 0078, decision 3;
  `platform/harnesses/adapters/src/sessions.ts`). ADR 0078 kept it there
  so that a Thread goes on "on this computer or, later, on another host".
  A Codex session is a rollout in that machine's `CODEX_HOME`, shared by
  its Codex accounts.
- **Machines are peers** (ADR 0101). No engine talks to another: a window
  reaches each machine's engine over ssh, and an act goes to its
  Project's machine (`KeptHosts.sessionOf`). Each machine is its own
  Person.
- **A Project moves on command, as one artefact** (ADR 0081, decision 11;
  ADR 0085, decision 11). That is the whole Project, and is not built.
  This ADR moves one Thread, and leaves the Project where it is.

## Decision

1. **Move to Project lists the Projects of every machine the window
   reaches.** It is one act and one row, "Move to Project ▸". The submenu
   has this Thread's machine first, then each other machine under its
   name and icon (ADR 0095), with its Projects. No Project, a missing
   Project and an archived one are left out, as now. A machine that is
   not live shows its name and its state ("away"), dim, with no
   Projects under it.

2. **It goes whole, as it does within a machine, with what its folder
   holds that is not committed (decision 8).**
   - What goes: its turns, items, notices and sub-agents' lanes; the
     Person's marks, its Later, its title, its settings; its images, its
     Visuals' pages, the files kept for its Person's messages; its
     Claude Code sessions with their sub-agents'.
   - The old folder is not changed: what is there stays there, now a
     copy.
   - The old Project's log keeps what the Thread said there. A Thread
     that names it as its parent, or that it names, names it still; the
     window shows such a name as plain text while the other is not in a
     Project it reaches.
   - It is a move, never a copy: the Thread is in one Project. Fork is
     the copy, and stays within a Project.

3. **Only a Thread at rest moves, and only between engines that keep it
   the same way.**
   - `may_move` holds as it is: no turn, sub-agent, Question, waiting
     message or awaited answer, and no fork that has not run.
   - **Move and go on.** The dialog (decision 7) takes a message for the
     Agent there. With one, the window sends it to the Thread on its new
     machine as soon as it arrived, so the work goes on there and this
     device may close. For a Thread at work the dialog offers "Move when
     its turn ends": the window waits for the turn, then moves. That
     wait is the window's: closed before the turn ends, nothing moves.
   - Both engines must keep a Thread in the same tables, columns and
     fact version. One that does not refuses, and says which machine to
     update: "devbox runs an older Banda: update it, then move the
     Thread."
   - Both machines must be live. A move to or from a machine that is
     away is refused at once and nothing waits (ADR 0105): "devbox is
     away: the Thread was not moved."

4. **The device carries it, and each engine writes only its own
   Project.** The window that the Person clicked in runs the move, in
   three steps. It may be on either machine, or on a third.
   1. **Pack**, on the Thread's machine: `agents.pack_thread{thread}`
      holds the Thread (`Hold::Moving`), checks `may_move`, and writes
      one artefact into the Project's data, `moves/<move>.tar`: the
      Thread's rows as JSON with their columns, the files they name, and
      a header with the store's shape, the machine's name, the Project's
      name and folder, and a SHA-256 of the rest. It answers
      `{move, size, sha256}`.
   2. **Carry and unpack**, on the other machine: the window reads the
      artefact in pieces (`agents.packed{move, at}`) and writes each to
      the other engine (`agents.take_piece{move, at, bytes}`), which
      keeps them in that Project's data. Then
      `agents.unpack_thread{move}` checks the hash and the shape, refuses
      a Thread that is there already and went on (`already`), puts the
      files in place through no link (`copy_beneath`), and writes the
      rows with `ThreadArrived` and the notice (decision 6).
   3. **Leave**, on the Thread's machine: `agents.leave{move}` takes the
      Thread out if it is still as it was packed, as `leave` does now,
      with `ThreadLeft`, and deletes the artefact. If it refuses, the
      window asks the other machine to give the copy back
      (`agents.give_back{move}`), as `take_back` does now.
   - Cut short between unpack and leave, as by a closed window or a
     machine that went away, the Thread is in both Projects and nothing
     is lost. Moved again, the move goes on while the copy is as it came.
   - The artefact is the Person's: only a Person packs, carries, unpacks
     and leaves. No Agent calls any of the five, with a pass or without,
     and only the Person binds a key to the act (ADR 0083, decision 3).
   - An artefact not left or unpacked within a day is swept.
   - Within one machine `agents.move_thread` stays as it is.

5. **Its Agent goes on there on the same Harness, and on Claude Code in
   the same session.**
   - **Claude Code.** The session's files go along, and the next turn
     resumes it in the new Project's folder. Only the prompt cache is
     lost, as on a move to another account (ADR 0078, decision 4).
   - **Codex.** The rollout stays in the old machine's `CODEX_HOME`.
     There the Thread has no Codex session, so its next turn opens a new
     one and is handed the Thread's history from Banda's log, as a
     Harness it never ran on is (ADR 0078, decision 5).
   - **The account.** An account's ID is its machine's. There the Thread
     runs on the account of the same ID and Harness if there is one, else
     on that Harness's default. Its turns keep the account each ran on,
     shown by the name that turn recorded.
   - **A Harness that machine does not have**, or has disabled, refuses
     the move before anything is carried: "devbox has no Codex: add it
     there, or move the Thread to Claude Code first."
   - **The Person.** Each machine is its own Person. What the Person
     wrote in the Thread is written there as that machine's Person.

6. **The Thread says where it came from, and its Agent reads it.** The
   notice names both machines and says what came with it: "Moved here
   from “banda” on m1pro. Its Agent works in /work/code/banda on devbox
   from now on, on feat/engine-feed with the 3 files it had changed
   there; ignored files did not come." With no snapshot it says instead
   that what it changed stays in the old folder on m1pro. Its Agent reads it before
   its next message, as now. The Thread shows it as its divider.

7. **The window asks once, and then shows the Thread where it went.**
   - Across machines the window confirms before it packs. The dialog
     says where the Thread goes, that the conversation goes whole, and
     what of the folder goes with it (decision 8): the branch, how many
     files are changed and not committed, and what does not go. It has a
     message box for the Agent there (decision 3). Within a machine there
     is no dialog, as now.
   - While it carries, a toast says so with what is left: "Moving to
     devbox · 8 of 31 MB". Esc or its Cancel stops it before the Thread
     leaves, and the copy is given back.
   - Once it left, the Pane that showed the Thread shows it in its new
     Project, and the sidebar's card names the new machine. A toast says
     "Moved to banda on devbox".
   - A refusal is a toast in the machine's words and the act's, and the
     Thread stays as it was, Panes and all.

8. **What the folder holds that is not committed goes as a git
   snapshot, beside the artefact, and the Git App makes it.** No push,
   no remote, nothing sent outside the Person's machines.
   - **The Git App owns it**, as it owns a turn's checkpoints
     (`apps/git/engine/src/checkpoint.rs`, under
     `refs/banda/checkpoints`): the same snapshot, made as the Thread is
     packed, with the same limits and the same care for filters. The
     Agents App knows nothing of git.
   - **Pack.** `git.pack_folder{move, have}` on the Thread's machine
     writes a snapshot commit of the Project's folder through an index
     of its own, so the branch, the index and the files are not touched:
     every changed and new file but the ignored ones, on top of `HEAD`.
     It answers the branch, `HEAD` and how many files changed.
   - **Only what is missing.** Before it packs, the window asks the
     other machine which of the source's branch tips and `HEAD` it has
     (`git.folder_for{commits}`, which also says whether its folder is
     free). The snapshot goes as a git bundle without those, in the
     Project's data beside the Thread's artefact, `moves/<move>.bundle`:
     mostly the diff, and the branch's commits that were never pushed.
     The window carries it in pieces as it carries the Thread
     (`packed` and `take_piece`, which name the part).
   - **Unpack.** `git.unpack_folder{move}` on the other machine, after
     the Thread arrived, fetches the bundle into
     `refs/banda/moves/<thread>`, then puts its folder as the old one
     was: the same branch at the same commit, the snapshot's changes not
     committed. The ref stays until the Thread is deleted.
   - **A folder there that is not free refuses the move, before anything
     is carried**: it has changes of its own that are not committed, or
     a Thread at work in it. "banda on devbox has changes that are not
     committed: commit or stash them there, then move the Thread." A
     branch of the same name there that went another way refuses too.
   - **What does not go:** ignored files, as `.env`, `node_modules` and
     builds. The dialog says so, and the notice tells the Agent.
   - **No git, or another repository.** A folder that is no git
     repository, or two that share no commit, moves the Thread alone.
     The dialog says the code stays and lists the files the Thread's
     turns changed (`agents.changes`). Banda runs no `git init`.

## Not in this ADR

- **A Thread's own worktree there**, so a folder that is not free need
  not refuse. A Thread has no worktree of its own yet (ADR 0034,
  decision 11).
- **The files a Thread changed in a folder with no git**, carried as
  files and refused where the other folder has another version.

- **A Codex session that goes along.** It needs the rollout taken out of
  one `CODEX_HOME` and written into another, and its reasoning dropped
  (ADR 0078, decision 3).
- **A Thread's pull requests.** The Pulls App's links do not follow a
  Thread to another Project today, on one machine either.
- **An Agent that moves its own Thread**, and a move while the Thread
  works. ADR 0078 decision 7 left the first open too.
- **Moving a whole Project** (ADR 0085, decision 11).

## Consequences

- `GLOSSARY.md`'s Thread says it may move to another Project, on its
  machine or another's.
- The contract gains six methods of the Agents App and three of the Git
  App, each the Person's alone. `ThreadRows` and the files' list get a form that is written
  down, so two builds can tell whether they keep a Thread the same way.
- A move's cost is the Thread's size: its transcript and its images,
  through the window's two ssh links. A Thread of 30 MB takes seconds on
  a LAN and longer from a café.
- The artefact holds the whole conversation in the clear, in each
  Project's data for as long as the move takes, where that Project's
  Agents can read it. They can read the Thread there anyway.

## Steps

Each step is its own PR.

1. This ADR.
2. **The engine, one machine:** pack, pieces, unpack, leave and give
   back, tested between two Projects of one engine, with the shape's
   check and the sweep.
3. **The folder, in the Git App:** `folder_for`, `pack_folder` and
   `unpack_folder` on its checkpoint's snapshot, the bundle carried as a
   part of the move, the folder put as it was, and the refusals of a
   folder that is not free.
4. **The engine, across:** the account and the Harness there, the Person
   there, Codex's handoff, and the notice with both machines.
5. **The window:** the submenu by machine (on #1531), the dialog with its message box,
   the toast with Cancel, the Pane that follows the Thread, the refusals.

## Roma's calls (2026-11-11)

1. A move copies the Thread whole into the other machine's store, and it
   leaves the old one. The laptop may then close.
2. Only a Thread at rest moves; "Move and go on" sends the next message
   there.
3. The folder's work goes as a git snapshot (decision 8). A folder there
   that is not free refuses, until a Thread has a worktree of its own.
4. With no git, the Thread moves alone, and the dialog says what stays.
5. As recommended: the window carries the bytes; it asks first, across
   machines only; a Codex Thread is handed its history there.
