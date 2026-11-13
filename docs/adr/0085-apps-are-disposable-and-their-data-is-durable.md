---
status: accepted
date: 2026-11-06
---

# Apps are disposable, and their data is durable

_Accepted by Roma on 2026-11-06, with the architecture vision and its
decisions 10 and 16. Nothing here is built. Research:
docs/research/2026-11-06-architecture-vision.md (§7, §11) and its
`work.md` (part F)._

The architecture vision makes Banda a kernel, a platform and Apps built on
one SDK. An App is code a host installs and a Project turns on; Threads,
git and Files are Banda's own Apps (ADR 0062). Roma's brainstorm of
2026-11-04 says it in one line: Apps are disposable, data is durable.
The design written for it (the draft in `work.md`, numbered 0082 there,
before ADR 0082 took the number) went further: a generic Task in the
kernel, Units for processes, delegation across hosts, compositions,
migrations by hash.

What stands today:

- Only Threads has work a Person sees: a turn and its state (queued,
  running, done, stopped, failed, interrupted, withdrawn). The outbox's
  rows are "the kernel's bookkeeping, not records of the work"
  (`kernel/src/outbox.rs`).
- The Harness process pool (`Hosts<H>`,
  `modules/harnesses/engine/src/hosts.rs`) already supervises. It starts
  a process when asked, starts one that died again after a growing pause,
  lets an idle one go after 30 minutes and kills its process group.
- Each module keeps its own ledger of migrations (ADR 0002, decision 6),
  counted by steps. A Project whose ledger has more steps than the engine
  knows does not open at all (`kernel/src/store.rs`), though only one
  module is newer.
- Nothing removes a module. Its tables sit in the Project's store under
  its prefix, its events in the Project's log, its files in
  `projects/<id>/`, shared with the other modules.
- ADR 0081, decision 9, backs a Project up as its log, sealed. A module's
  tables are written beside its events, and not all of them can be built
  again from the events: Questions, receipts, the outbox.
- The Threads App's id is still `agents`: its methods, events and tables
  carry it, while the window says Thread. Once other Apps listen to its
  events by name, the name is hard to change.

Roma, 2026-11-06 (the vision's decision 10): the turn stays the unit of
work, `task@1` is reserved, and the draft in `work.md` is split, its data
part decided now and the rest later. And (the vision's decision 16):
rename `agents` to `threads` before any event is published, with
aliases.

**Decision.**

1. **The turn stays the unit of work** (Roma, 2026-11-06).
   - The work a Person sees is a Thread's turns, with the states Threads
     keeps. The kernel gets no record of work of its own now.
   - Outbox effects stay the kernel's bookkeeping: starting a turn, a
     push, a post. No client lists them. A Person sees an effect through
     the events its App writes.
   - A run of several steps, such as git's commit and push, is its App's
     own table plus outbox steps, on the host. Each step's CommandId is
     derived from the run and the step, so a step never runs twice.
   - Why: one App has work a Person must see. A generic record now would
     be written twice for every turn, for one reader.

2. **`task@1` is reserved for a generic Task, which comes later** (Roma,
   2026-11-06).
   - The name `task@1` is the kernel's. No App publishes it, or a list of
     running work of its own under another name.
   - The Task comes when a second App has work a Person must see (git's
     runs on the host, an App being installed), or when the phone needs
     one list of work across Apps. An ADR of its own decides it then.
   - `work.md` part A is its sketch: a small record the owning App writes
     in its own transaction, which ends as done, failed, cancelled or
     interrupted; a turn is one; a Task ends, while a Unit (decision 3)
     runs.

3. **The Harness process pool stays the supervisor.**
   - `Hosts<H>` keeps starting, starting again and letting go the
     Harnesses' processes, as above.
   - Units wait: one supervisor, with a wanted and a seen state, for
     Harnesses, MCP servers, workers and programs an Agent starts. They
     come with a second kind of process that needs them.
   - The servers started in Banda stay seen and stopped as ADR 0044 has
     it.

4. **The kernel keeps no kinds of resource.**
   - An App's own things, a calendar's events or a CRM's deals, stay in
     its own tables. The kernel keeps only what runs it: Projects, the
     log, receipts, the outbox, passes.
   - What makes Apps alike is at their surface: an address with no host
     in it, every method described by its schema, the listing every App
     fills (`item@1`).
   - Apps registering kinds of resource in the kernel is rejected. The
     kernel would grow with every App into a database of everyone's
     things.

5. **The Project owns an App's data.**
   - An App's data is three things:
     - its tables, under its prefix, in the Project's store;
     - its events, in the Project's log;
     - its files, in a folder of its own in the Project's data
       (`projects/<id>/apps/<app>/`).
   - An App's code is the host's: installed on a host, turned on for a
     Project. Its data moves with the Project; its code does not.
   - A Project opens on a host that lacks one of its Apps, or has it
     older. That App is unavailable in it, and its data waits untouched.

6. **Uninstalling an App keeps its data, read-only.**
   - Turning an App off for a Project, or uninstalling it from the host,
     stops its code. Its tables, events and files stay. Nothing writes
     them; its export reads them (decision 10).
   - Its effects still waiting in the outbox are settled as abandoned.
   - Turning it on or installing it again takes the data up where it
     stopped: its migrations run on from its ledger.

7. **Purge drops an App's data, after an export.**
   - `banda app purge <app> --project <P>` first writes the App's export
     into the Project's trash (`projects/<id>/trash/`), then drops its
     tables and its folder.
   - Its events stay in the log, which is never rewritten (ADR 0002,
     decision 6). A reader skips kinds it does not know.

8. **A refusal from one App's migrations blocks that App, not the
   Project.**
   - Each App keeps its own ledger, as ADR 0002 has it. When the ledger
     holds steps the App's code does not know (data a newer Banda wrote),
     the kernel refuses that App in that Project: `app_unavailable`, with
     why. The Project opens, and its other Apps work.
   - The App's data is not touched. A Banda that knows the steps opens it
     again.
   - Migrations stay forward only (ADR 0002, decision 12).
   - A move to a host with older Apps is checked before it starts
     (decision 11), so this is for the case nobody planned.
   - _Built 2026-11-13 (track 2, slice 2a), and widened: any step that
     fails, a step that reaches past the App's prefix included, refuses
     that App alone, for an App an Agent writes fails while it is
     written. The machine's own modules still stop the engine's start._

9. **Migrations are named by hash, later.**
   - Today a ledger counts steps. When a fork and its upstream both add
     steps to one App, a count cannot tell them apart. Then each step is
     named by the hash of its text: steps apply in their list's order,
     skipping hashes the ledger has, and a hash the App neither knows nor
     has retired blocks the App, as decision 8 says.
   - With it come a copy of the App's tables before new steps run, and
     going back to the version before.
   - Until then, "a shipped step never changes" holds by review.

10. **An App's export is its events plus its tables.**
    - `banda export --project <P> --app <A>` writes:

      ```
      <A>/app.json          its version, its ledger, each table's CREATE
      <A>/events.ndjson     its events, in the log's order
      <A>/<table>.ndjson    one row a line
      <A>/files/            its folder
      ```

    - `banda import` reads one back into a Project whose App knows its
      ledger.
    - It serves a purge (decision 7), a Person who takes their data
      elsewhere, and later one App replacing another: the old App's
      export into the new App's import. An App never reads another App's
      tables; the kernel refuses any table outside its prefix.
    - SQLite stays, on the Project's host, which may be the Person's own
      server or a host in the cloud. Banda promises export, not a move to
      PostgreSQL.

11. **A backup and a move are one artefact, and an export is not it.**
    - A Project's backup is its store as a SQLite online backup, a git
      bundle of its folder with `refs/banda/*`, and its data folders,
      but not the Agents' browser profile, which never moves (ADR 0083,
      decision 4). A move ships the same.
    - So every App's tables come back whole, with the Questions, the
      receipts and the outbox that the log alone cannot build again.
    - **A move is fenced.** Every App of the Project says it can move.
      The source host then writes `project.handed_off{to, epoch}` as the
      last event of the Project's log, and ships the artefact. The
      target host opens only an artefact whose last event names it.
      So the source cannot keep writing a Project it gave away, and a
      crash midway leaves the record in the log.
    - `projects.move --check` lists what stays behind (ADR 0084,
      decision 14) and refuses a target whose Apps are older.
    - An export (decision 10) is for one App: purging it, replacing it,
      taking it out.

12. **`agents` becomes `threads` before any event is published** (Roma,
    2026-11-06).
    - The Threads App's id is `threads` everywhere: its folder, its crate,
      its methods, its events, its Panes and its skill.
    - Nothing written before is lost, as ADR 0069 (decision 3) did for
      Space:
      - **What a log already holds is read in both names, for good.**
        Events written as `agents` read as `threads`; the manifest says
        `was = ["agents"]`.
      - **Tables keep their names, for good.** `agents_*` is a legacy
        prefix the manifest declares. Data at rest is never renamed.
      - **What a Person or an Agent types gets one stable release of
        grace.** `agents.*` answers as `threads.*`: in the CLI,
        `keys.toml` and the skill.
      - **A Pane** saved as `agents.thread` in the arrangement is read as
        `threads.thread`.
    - It lands before published facts (events other Apps may hear, named
      `<app>.<noun>.<past-verb>@<major>`). Those are the names that cost:
      `threads.turn.began@1` must name its own App.
    - The rule for any App: one that changes its id declares the old one,
      keeps its tables' prefix, and loses no data.

13. **What waits, and for what.** Each in an ADR of its own, when it is
    needed.

    | What | Until then | It comes when |
    |---|---|---|
    | A generic Task, `task@1` | the turn | a second App has work a Person must see, or the phone needs one list of work |
    | Units, with a wanted and a seen state | the Harness process pool | a second kind of process needs supervising: MCP servers, workers, an Agent's dev server |
    | Work across Projects and hosts | an Agent asks a Thread of its own Project (ADR 0019) | delegation stored and forwarded, with the receiving Project's grant; no host talks to another in v1 |
    | Scopes an App defines (`contacts.read`) | an App's methods and their rights | Apps from elsewhere bring things of their own |
    | Compositions as a file | an ordinary App with no view | a declarative form is needed; its name may be "Automation", since "composer" is the tiling |
    | Sessions made outside Banda | Usage reads them | a Claude Code or Codex session is imported as a Thread; Banda never attaches to a process it did not start |
    | Migrations by hash, going back, replace, fork | ledgers counted by steps | forks and upstream updates of one App |

**Plan.** Each step its own PR; `scripts/check.sh` passes after each.

1. The rename `agents` → `threads` (the vision's step T0). It comes after
   the one list of Apps from their manifests and the kernel's check on
   table prefixes, and before published facts. A copy of an old state
   folder opens with its Threads, Panes and keys.
2. The refusal by App: the ledger checked App by App; `app_unavailable`;
   the Project opens. A Project with one App's newer ledger opens, and
   its other Apps work.
3. Turning an App off and uninstalling it keep its data, read-only. Its
   waiting effects are abandoned; turning it on again takes up where it
   stopped.
4. `banda export` and `banda import` for one App; `banda app purge`, with
   its export first.
5. A backup and a move write one artefact, with ADR 0081's backups and
   the Project's move; the move fenced by `handed_off`, and its check.

**Consequences.**

- A Person can try an App and remove it without losing what it kept.
  Installing it again brings it back.
- Data from a newer Banda costs one App in a Project, not the Project.
- A purge drops an App's tables and files, never its events: what it said
  in the log stays, as everything in the log does.
- Until the Task, the bar and the phone count only Threads' work. Another
  App shows its long work in its own Pane and through the calls it
  raises.
- The kernel stays small: no Task, no supervisor of its own, no kinds of
  resource.
- `agents_*` tables keep their prefix for good, and `agents.*` answers
  for one stable release.

**Changes.**

- ADR 0002, decision 6: each App still keeps its own ledger, but a ledger
  with steps its code does not know blocks that App, not the Project;
  later a step is named by its hash, not its place in a count.
  Decision 1: any App's events and tables can be exported, beside a
  Thread's Markdown or JSONL.
- ADR 0022, decisions 1 and 5: the manifest (`module.toml`, `app.toml`
  once renamed) may name an App's earlier ids (`was`) and a legacy table
  prefix; one id names the App everywhere but in those. Decision 7: what
  removing an App does to its data is decided here; installing an App
  from elsewhere stays later.
- ADR 0081, decision 9: a backup is the store's online backup, a git
  bundle and the data folders, not sealed log segments, which cannot
  restore an App's tables. Decision 11: a move ships the same artefact,
  so "its log as a copy" is the whole store; it is fenced by
  `project.handed_off` as the source's last event, and the target opens
  only an artefact that names it (decision 11).
- The draft in the vision's `work.md` (numbered 0082 there, before ADR
  0082 took the number), never accepted, is split (Roma, 2026-11-06, the
  vision's decision 10). Its part F, the data, is decided here, but for
  migrations by hash, going back, replace and fork, which wait. Its parts
  A to E wait (the Task, delegation, Units, compositions), but for the
  rejection of kinds of resource in the kernel, which is decision 4 here.
  Its fix to the CommandId of `banda mcp` goes with receipts for every
  command (ADR 0082, decision 4).
