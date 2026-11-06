# ADR draft (proposed 0082): Tasks for work, Units for processes, and App data that outlives the App

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

_Status: proposed, 2026-11-06. Scope: digest items 1, 5, 8 and 9, digest questions 1–2, and notes 15 and 18. Code is cited from origin/main. 0062 means the draft in `app-sdk-adr`, 0081 the accepted ADR. Nothing here is built._

## Context: what the code does today

- **No record of work outside Threads.** An outbox row is "the kernel's bookkeeping, not records of the work" (`kernel/src/outbox.rs:9-11`). Only Threads has work a Person can see: `agents_turns.state` (`modules/agents/engine/src/store.rs:31-41`) with 7 states (`model.rs:205-219`).
- **Delegation already exists, inside one Project.** `send` with `Opener::Asked` / `Answered` (`model.rs:287-300`) and `agents_turns.from_thread` (`store.rs:115`). The answer goes back by itself (ADR 0019 d4), and `waiting_for` walks the chain (`store.rs:1335`). Another Project is refused: a pass holds one Agent in one Project (`kernel/src/passes.rs:1-7, 22-34`), and ADR 0019 d4 says "only its own Space".
- **The Harness process pool is already a supervisor.** It starts on demand, backs off from 500 ms to 30 s, resets after 5 min of health, lets go after 30 min idle, and kills the process group on drop (`modules/harnesses/engine/src/hosts.rs:1-13, 23-28`). The Threads runtime and the harnesses module both use it (`live.rs:12-16`). Many sessions share one process. The session is evidence, not identity (`store.rs:23-25`).
- **Servers started in Banda are only observed.** They are found by `BANDA_PROJECT` in their environment and can be stopped (`modules/terminal/engine/src/servers.rs:1-7`, `kernel/src/lib.rs:64`). Terminals are Person-only and die on restart (`modules/terminal/engine/src/lib.rs:4-8`).
- **Effects give up after 5 tries** (`outbox.rs:97`). Recovery depends on the boot (`outbox.rs:124-166`). `banda mcp` makes a new CommandId for every tool call (`engine/src/mcp.rs:159`), so a retried tool call runs twice.
- **Migrations are counted, not identified** (`kernel/src/store.rs:420-443`). A newer ledger refuses the whole Project (`store.rs:435-439`).
- **One Agent per Thread, no Agent to manage** (ADR 0006 d1 and d4; `lib.rs:1598`).

## Summary

1. **Task** is Banda's process table: one small kernel row per finite unit of work. The owning App writes it in its own transaction, and the App keeps the detail. A Turn is a Task. Outbox effects, worker jobs, processes and sessions are not Tasks.
2. **Crossing a store boundary is mail, not a call.** Work that crosses from one Project's store to another (on the same host or another) goes as a delegation record plus store-and-forward delivery through the outbox, with a receipt at the far end. There are three verbs: `asked`, `answered`, `cancel`.
3. **An Agent on host A never calls host B's methods.** It may only ask a Thread in a Project on B, and only if that Project allows it.
4. **Unit** is supervised execution with desired and observed state. One platform supervisor runs all of them, extracted from `hosts.rs`. Origin is `managed` or `observed`; `imported` belongs to records, not processes.
5. **Third-party Apps get no resource kinds in the kernel.** They get uniformity through `Ref`, described methods, App scopes and the `Listed` projection.
6. **A composition is an SDK App with no view.** Its host part is Banda's interpreter, named the way a shebang names one. It acts with its own capabilities.
7. **The Project owns the data and App code is disposable.** Migrations are identified by hash. A refusal blocks one App, not the Project. One NDJSON export format serves backup, Project move and App replace.

---

## Decision

### A. The unit of work

**A1. Banda gets a generic Task: a kernel row, not a workflow engine.**

```sql
-- kernel migration, in every scope's store (Project; later Host and Person)
CREATE TABLE kernel_tasks (
  app TEXT NOT NULL, path TEXT NOT NULL,        -- 'threads', 'turn/0192…'
  parent TEXT,                                  -- Ref, may name another Project/host
  title TEXT NOT NULL, line TEXT,               -- 'Arc', 'Codex · building'
  state TEXT NOT NULL CHECK (state IN ('queued','running','waiting','done','failed','cancelled','interrupted')),
  waiting_on TEXT,                              -- 'person' | 'task:<Ref>' | 'delivery' | 'time:<ms>'
  can_cancel INTEGER NOT NULL,
  author_kind TEXT NOT NULL, author_id TEXT NOT NULL,
  boot TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER,
  PRIMARY KEY (app, path));
```

- **Write side.** `Tx::task_open(TaskOpen{path, title, parent, can_cancel})` and `Tx::task_set(path, TaskState, line)`.
  - The kernel enforces the transitions: terminal states are final, and a write after one is a bug and returns `Error`.
  - It emits a single fact, `kernel/task.changed@1` (subject `<app>/<path>`), one per transition and never per delta.
- **Read side** (kernel's own methods, through `Store::command`, unlike today's `projects.*`):
  - `tasks.list {active|recent, project?}`;
  - `tasks.follow`, a stream over every open Project of the host, resumed by seq like Heard;
  - `tasks.cancel {task: Ref}`.
- **Cancel is a signal the App handles.** The manifest names the App's own command (`[tasks] cancel = "cancel_task"`, params `{path}`). The kernel calls it as the caller, so rights apply. This is `kill` and a handler.
- **Boot rule, the same as the outbox's.** After a Project opens and every App's `opened` has run, any task still `running` or `queued` from another boot becomes `interrupted`, unless its App set it again during `opened`. A buggy App cannot leave a ghost "running" forever.
- **Address.** `Ref = banda:<project-uuid>/<app>/<path>`, a new type in `kernel/src/ids.rs`. It names no host, so it survives a Project move (0081 d11). A route resolves the host (A4).

**A2. How a Task relates to the other things.**

| Thing | Is it a Task? | Relation |
|---|---|---|
| Turn (Threads) | **yes**, `turn/<id>` | Queued→`queued`; Running→`running`, or `waiting(person)` while a Question is open; Done→`done`; Stopped and Withdrawn→`cancelled`; Failed→`failed`; Interrupted→`interrupted`. Written in the same transaction as `agents_turns` by `writer.rs`, the one place that changes turn state. |
| Delegation (A4) | **yes**, `delegation/<id>` | The stand-in on the asking side for work elsewhere. Parent is the asking turn; the remote turn's parent is the delegation. |
| Outbox effect | no | Invisible mechanism. An effect advances a Task. `Module::settle` writes the Task's failure (`module.rs:115`). |
| Worker job | no | A worker is a Unit (B), and its jobs are effects claimed by lease. |
| Harness process | no | A Unit (`harness` kind), leased by the Turns that run on it. |
| ACP session | no | Memory: evidence inside the Thread. It survives the process (`live.rs:12-16`). |
| git commit run, Project move, App install/update | **yes**, when they move to the host | Kills client sagas such as `git/pane/src/chain.ts`. Project move and App install live in the Host scope's store. |
| Dev server, MCP server | no | Standing things are Units: they have no end, only desired state. |

Rule: **a Task ends; a Unit runs.** This is systemd's `oneshot` against `simple`, or k8s's Job against Deployment. No `Job` or `Workflow` word enters Banda. A multi-step flow is an App's own state machine that writes one Task. A Task tree is causality only. A parent's state never rolls up its children's; a client folds "active while any descendant is active".

**A3. Who shows Tasks.**
- The bar's middle counts `running`, and `waiting(person)` across Apps. This generalizes ADR 0035, which counts Threads only.
- The phone's "Work" list is `tasks.follow` merged across hosts, the same way the Inbox merges (0081 d6). Every row carries `as_of {seq, host_time}`.
- An Agent's pass sees only its own Project's tasks.

**A4. Work crosses stores by delegation: store and forward.**
- **The rule.** Any write into another Project's store (same host or not) is:
  - a record on the sender plus an outbox effect, holding a CommandId fixed once in the transaction;
  - a receipt on the receiver.
  
  This gives exactly-once effect over at-least-once delivery. The local route is in-process; the remote route is a peer session (0081 d4).
- **Three methods, all in the Threads App, marked `peer` in `methods!`.** `peer` is a new mark like `tool`. A peer session may call only `peer`-marked methods.
  - `threads.asked {delegation, from: Ref, from_title, on_behalf: AgentId, project, harness | thread, text}` → `{thread, turn}`
  - `threads.answered {delegation, from: Ref, end: TaskState, reply}` → `()`
  - `threads.cancel_asked {delegation}` → `()`
- **Sender's record** (`threads_delegations`):

  ```sql
  CREATE TABLE threads_delegations (
    id TEXT PRIMARY KEY, turn TEXT NOT NULL, thread TEXT NOT NULL,
    to_project TEXT NOT NULL, to_thread TEXT, harness TEXT, message TEXT NOT NULL,
    command TEXT NOT NULL, deliver_by INTEGER NOT NULL,
    state TEXT NOT NULL, child TEXT, heard_at INTEGER, ended TEXT);
  ```

  On the receiver, `agents_turns.asked_by TEXT` (a Ref) sits beside `from_thread`. Delegation inside one Project keeps today's direct path (`from_thread`).
- **The receiver's grant** is a Project setting, written only by a Person (`Manage`): `threads.allow {from: [ProjectId] | "mine", mode}`. `mode` caps the delegated Thread's mode. The default is no grant, so nothing is accepted.
- **The answer is a capability by reference.** The sender accepts `threads.answered` only for an open delegation of its own whose `child` matches. No token is minted, and the peer reaches nothing else.
- **Every delegated turn answers exactly once, with its end state** (done, failed, cancelled or interrupted), not only on success.
- **Retry policy per effect** (an outbox change):
  - `delegation.deliver` retries until `deliver_by` (default 1 h, at most 7 d), then settles as `failed: unreachable since …`.
  - `delegation.answer` and `delegation.cancel` retry with no limit, with backoff capped at 5 min.
  - Today's fixed `ATTEMPTS = 5` becomes the default for other kinds.
- **Resolving a Project to its host.** v1 asks the paired hosts, which are few, and caches the answer (a peer-marked `projects.list`). A directory on the home host comes when Project moves do.
- **Receipts are kept 30 days**, longer than any delivery deadline. Receipts and done outbox rows are collected after that, which also fixes the map's "never collected" weakness.

**A5. May an Agent on host A act on host B in v1? No. It may only ask.**
- Arc never touches B's files, Units, Harnesses or arrangement.
- The only thing that crosses is a message to a Thread in a Project that allowed it. B's own Agent then works under B's Thread mode.
- 0081 d13 ("an Agent's `banda` goes to its own engine") stays true. Delivery is the engine's job, not the Agent's CLI.
- **Order.** This lands after 0081 steps 2–6 (keys, peer sessions, one client over several hosts).
- **Until then.** The Person makes the hop by hand, starting the Codex Thread on the laptop from the phone. That works once 0081 step 6 does.
- **Named Agents.** "Arc" is a standing Thread (Threads App: `standing = true`, a Person-given name, never auto-archived). It is not a kernel Agent resource, so ADR 0006 stands.

### B. Scenario trace: phone → Arc (server S, Project `ops`, Claude Code) → Codex (laptop L, Project `shop`) builds and runs the app

| Hop | Who owns the state | How the command arrives | Rights (checked by the receiver) | Retries and recovery | Events | What the phone sees |
|---|---|---|---|---|---|---|
| **0. Phone → S**: `agents.send {thread: arc, text}`, `command: C1` | S/ops: item, turn T1 (`queued`), task `threads/turn/T1` | One `call` frame on the device's session (relay route) | Device session (0081 d3, scopes ⊆ Person) → `Write` (`access.rs:31-47`) | Reconnect sends the same C1, and the receipt answers (`kernel.rs:569-573`). S unreachable: the phone keeps a *pending send* with a visible expiry and never queues silently. | `message.added`, `turn.queued`, `task.changed` | Its message; T1 queued then running; a "Work" row "Arc · running" |
| **1. T1 runs on S** | S/ops | Outbox `turn.start`, keyed by the Thread (`effects.rs:4-6`); a `harness` Unit leased; session resumed from evidence | Arc's pass, `only = ops` | S restarts: the effect is abandoned, settled, T1 `interrupted` (as today), the task follows | Turn facts | Live Thread from S |
| **2. Arc's tool**: `send {project: shop, harness: "codex", text}` | S/ops: item "asked Codex @ laptop/shop"; delegation D (`queued`, C2, deliver_by); task `threads/delegation/D` (parent T1, `waiting(delivery)`); outbox `delegation.deliver` keyed D. All in one transaction. | MCP `tools/call` → gateway or `banda mcp` | Agent `Write` in its own Project only. S checks that `shop` exists among its peers (fail fast). The grant is L's to check. | CommandId derived from (pass, MCP request id), fixing `mcp.rs:159`, so a retried tool call does not delegate twice. T1 may end now; the answer comes back by itself (ADR 0019 d4). | `delegation.queued`, `task.changed` | "Arc → Codex @ laptop: sending…" |
| **3. S → L**: `threads.asked {…}`, command C2 | L/shop: new Thread (a named one if `to_thread`), turn T2 (`Asked`, `asked_by = Ref D@ops`), task `threads/turn/T2` (parent D) | Outbox worker on S resolves `shop` → L, dials by route list (iroh by key), peer session (`hello` signed by S's host key, same PersonId), `call` frame | **Peer scope:** only `peer` methods. The author on L is `Agent(arc)` via `Host(S)`. Threads checks `shop`'s grant (`from ∋ ops`) and caps the mode. A refusal settles D `failed(reason)`, and Arc gets a notice turn. | L unreachable: `Retry` until deliver_by, with the reason "unreachable since 14:02" on D. C2's receipt on L dedupes. Delivered: `done_writing` sets D `waiting(task: T2@L)`, `child = Ref T2`. | S: `delegation.delivered`. L: `thread.started`, `turn.queued`, `task.changed`. | From S alone: "delivered 14:05, running on laptop (as of 14:05)". If L is reachable: T2 live. |
| **4. T2 runs on L; Codex builds, then runs the app** | L/shop. Unit U1 in L's Host store: `program`, managed, `want = running`, `owner = Ref T2`, project `shop` | Codex builds through its own exec under its Thread's mode. It runs the app with tool `units.start {name: "shop-dev", argv, cwd: ".", restart: "on_failure"}`. | Agent pass on L. `units.start` is allowed when T2's mode is full access; otherwise it becomes a Question → a call → a push to the phone (0081 d6) → the Person answers with `Decide`. | Why not just `npm run dev &`: it would live in the Harness's process group, which is killed when the pool lets go after 30 min idle (`hosts.rs:12-13, 23`). L restarts: T2 `interrupted`; U1's `want = running` is stored, so the supervisor starts it again. | L Host: `unit.changed` (starting → running; the scanner sees port 5173) | A Question as a push if the mode asks; L's servers in the bar when L is reachable |
| **5. T2 ends (any end) → S**: `threads.answered {D, end, reply}`, command C3 | S/ops: D ends with T2's end state; turn T3 (`Answered`, parent D) in Arc's Thread | In T2's ending transaction, L's Threads enqueues `delegation.answer` keyed D; the peer call goes to S | Peer scope. Accepted only if D is open, points to `shop`, and its child is T2. | Retries with no limit (5-min cap); receipts dedupe. S restarts: the receipt makes a resend a no-op. | S: `delegation.answered`, `task.changed(D done)`, `turn.queued(T3)` | Arc's answer; Arc's `notify` → a call → a push |
| **6. Cancel** | The owner of the task | Phone taps cancel on D (to S): if queued, D `cancelled` and the effect is dropped; if delivered, `delegation.cancel` → L `threads.cancel_asked` → `agents.stop` T2. Or the phone cancels T2 on L directly. | Person `Write` on the task's owner host | Store and forward, as in hop 3 | T2 `stopped`, then hop 5 carries `cancelled`, then D `cancelled` | Tree marked cancelled. U1 keeps running ("owned by an ended task") until the Person stops it in the bar. |

**Offline cases.**
- **L asleep at hop 3.** D waits visibly on S, then fails at `deliver_by`; Arc gets a notice turn and tells the Person.
- **L restarts during T2.** T2 is `interrupted`, and the answer carries it. Arc decides whether to ask again (a new C2 and a new D).
- **S down at hop 5.** L keeps retrying the answer. Nothing is lost, because it is in L's outbox.
- **Phone offline throughout.** Nothing stops. Tasks resume from seq, and the pushes queue.

**Tracing.** The trace is the parent chain T1 → D → T2 → T3 plus the CommandIds C1–C3 stored on each record. No separate trace ID in v1.

### C. Resource model

**C1. Four separate things, linked by Ref, with no containment.** Roma's `App → Agent → Session → Process` becomes:

| Thing | Answers | Writer | Lifetime | Lives in |
|---|---|---|---|---|
| Participant (Person, Agent, **App**) | who acts | kernel ids. An AgentId per Thread (ADR 0006). `Participant::App(name)` is new, for workers and compositions. | Agent: its Thread's | all records |
| Thread (Session as evidence) | the conversation and memory | Threads App | until archived; outlives processes | Project store |
| Task | finite work | the owning App (in `kernel_tasks`) | until terminal | the scope's store |
| Unit | execution: desired against observed | supervisor | standing | Host store |

- An App owns Tasks and declares Units (its workers, its MCP servers).
- A Thread leases a `harness` Unit per turn. Many sessions share one Unit.
- A Unit's `owner` is an App, a Task Ref or a Person.
- Identity is not execution (`ids.rs:1-2`), and the hierarchy is references, not ownership.

**C2. One supervisor: `platform/supervisor` (crate `banda-supervisor`), extracted from `modules/harnesses/engine/src/hosts.rs`.**

```rust
pub struct Spec { name: String, kind: Kind, argv: Vec<String>, cwd: PathBuf, env: Env,
                  project: Option<ProjectId>, owner: Owner,          // App(name) | Task(Ref) | Person
                  want: Want,                                       // Running | OnDemand{idle} | Stopped
                  restart: Restart, stdio: Stdio,                   // Never|OnFailure|Always ; Pipe|Pty|Null
                  place: Place }                                    // Host | ProjectContainer(ProjectId)
Supervisor::ensure(&Spec) -> Lease      // OnDemand: start if needed, hold busy (today's Activity::hold)
Lease::stdio() -> (ChildStdin, ChildStdout)
Supervisor::set(unit, Want); Supervisor::follow() -> Stream<UnitView>
```

- **State.** Desired is `running | stopped | on_demand`. Observed is `idle | starting | running | backing_off{until} | stopped | failed{reason}`. Backoff is today's numbers (500 ms doubling to 30 s, healthy after 5 min).
- **Stored and listed.** Table `supervisor_units`, written only by the supervisor. Methods: `units.list | follow | start | stop | restart | logs`. Logs are a ring buffer streamed like the terminal's, never written to the log.
- **What survives a restart.** Only `program` Units with `want = running` are restarted at boot. On-demand Units are rebuilt as they are asked for.

| Kind | Want | Key | Started by |
|---|---|---|---|
| `harness` | OnDemand{30 min} | (Project, Harness entry) | Threads, through the `harnesses` platform |
| `mcp` | OnDemand | (server, host) | the MCP gateway (0062 d16) |
| `worker` | OnDemand while its effect kinds are pending, or Running if declared | (App, host) | the App runtime (0062 d4) |
| `program` | Running (stored) | name in Project | `units.start` (a Person, or an Agent under its Thread's mode) |
| `chromium` | OnDemand | host | Browser, for Agents' pages (0062 d12) |

- **Exception, listed:** terminal PTYs stay the terminal App's (interactive, Person-only, die on restart by design).
- **Project isolation (question 3) plugs in here.** `Place::ProjectContainer` makes every Unit of a Project spawn inside that Project's container. Nothing above the supervisor changes.

**C3. Origin.**
- **On Units.** `managed` means the supervisor started it: it can be started, stopped, restarted and its logs read. `observed` means a scanner found it: today's servers carrying `BANDA_PROJECT`. It can be seen, and stopped only if it carries the Project's marker; it is never restarted.
- **On records.** `imported` belongs to a Thread or record, not a Unit. Example: a Claude or Codex session history imported as a Thread, continued through `session/load` in a new managed process.
- **Never:** attaching to a live process started outside Banda.
- **Finding, attaching and controlling are three capabilities:** `units.observe`, `logs`, `control`. Finding something never grants control.

**C4. One status vocabulary for every client.** Tasks use `queued / running / waiting / done / failed / cancelled / interrupted`. Units use desired and observed. That is two lists and two sets of words, and the phone shows both.

### D. Third-party resource kinds: rejected

**D1. Apps do not register resource kinds in the kernel.** Domain entities (Calendar Event, CRM Deal) stay in the App's own prefixed tables.

The kernel already gives every App a store, a log and watch (events plus Heard). A kind registry would duplicate that as a generic domain database, the k8s CRD path, and would grow the kernel with every App.

**D2. Uniformity comes at the interface, not in storage:**
- **Address:** `Ref` (A1), with an App-defined path (`contact/42`).
- **Discovery:** `apps.describe` returns JSON Schema for every method. `methods!` already produces it for tools, through schemars.
- **Permissions:** App-declared scopes (`contacts.read`) over its own methods (digest item 11).
- **Shell listing:** the platform's `Listed` projection (rows, mark, calls).
- **Work:** Tasks.
- **Execution:** Units.

The kernel holds only operational rows: Projects, events, receipts, outbox, tasks, cursors and passes.

### E. Compositions

**E1. A composition is an SDK App with no view.** Its host part is Banda's interpreter, named the way a shebang names one:

```toml
# app.toml
[app]  name = "meetings-to-calendar"  runtime = "compose"
[capabilities]  listens = ["crm.meeting.created@1"]  calls = ["calendar.create_event@1"]
# compose.toml
[[when]]
on   = "crm.meeting.created@1"
if   = { "payload.external" = true }                 # equality/exists only
do   = "calendar.create_event@1"
with = { title = "{payload.title}", at = "{payload.at}", people = "{payload.people}" }
```

- **One interpreter, many identities.** The platform ships one interpreter. Each composition is still its own App, with its own identity, grants, cursor and failure list.
- **Where it runs.** Installed per host, enabled per Project. It runs on the host whose Project emits the events.
- **Escape hatch.** Logic beyond field mapping means writing a normal SDK App with a WASM handler.

**E2. How it executes, reusing kernel parts.**
- A durable listener, `kernel_cursors(app, project, listener, seq)`, which the map already proposes.
- The handler advances the cursor and enqueues `intent.call` in one transaction, with the CommandId fixed in the payload.
- The effect calls the intent as `Participant::App(name)`, and the receipt dedupes.
- Failure: retries, then settle into `<app>_failed`, then an Inbox call ("meetings-to-calendar: calendar refused …"), then `banda app retry <app> <event>`.
- Firings are not Tasks; there would be too many.

**E3. Rights.**
- **Its own rights only.** A composition acts only with its declared capabilities: never the Person's rights, never `Decide`, `Manage` or `Run`.
- **Loud capabilities** are never granted without asking, first-party included:
  - ones that start Agents (`threads.send`, which makes it an Agent's boss);
  - running programs (`units.start`);
  - `net`.
- **No self-triggering.** An App never hears events it authored.
- **Install and update.** An Agent may write a composition in a Project; `banda app check` checks its event and intent schemas against the registry; a Person installs it. Updates show a capability diff (0062 plan 13).

**E4. Name.** Not "Composer", which is Roma's word for the tiling. I propose **Automation**, with the runtime named `automate`. Roma decides.

### F. Data lifecycle

**F1. Ownership.**
- **Package:** content-addressed, `~/.local/share/banda/apps/<name>/<sha256>/`, one per host.
- **Enablement:** per Project, recorded in its manifest as `apps = {name: {hash, source}}`.
- **Data:** the App's `<name>_*` tables, its events in the Project log, and `projects/<id>/apps/<name>/files/`. It belongs to the Project.
- **A Project moved to a host without the App** fetches the same hash from `source` or from the moving host. If it cannot, that App is unavailable in that Project and the Project still opens.

**F2. Migrations by hash.**
- `kernel_migrations(ledger, step, hash, at, PRIMARY KEY (ledger, hash))`.
- The App's steps are applied in list order, skipping hashes already in the ledger. A fork's step F and upstream's step U then both apply, whatever their order.
- A ledger hash that is neither in the list nor in its `retired = [hash]` list refuses **that App** in that Project (`app_unavailable: data from a newer or other version`). The Project still opens, replacing `store.rs:435-439`.
- "A shipped step never changes" (`module.rs:46`) becomes enforced:
  - `banda app check` compares against the last release's hashes;
  - CI keeps a frozen hash list per first-party App, like the ts-rs drift check.
- One-time backfill of hashes from the step count. This is exact for first-party Apps.

**F3. Upgrade and rollback.**
- Before an App's new steps run, the kernel copies its tables to `apps/<name>/before-<hash>.sqlite` (ATTACH + `CREATE TABLE AS`), keeping the last two.
- `banda app rollback <name>` restores the previous code hash. If migrations ran, it also restores the snapshot, and the Person confirms "changes since 14:02 in <name> are lost".
- Events the newer version wrote stay in the log, which is never rewritten. Readers skip kinds and versions they do not know, and that becomes an SDK rule.
- Pending outbox rows of unknown kinds settle as `abandoned`.

**F4. Uninstall and purge.**
- `banda app remove` disables the App. Its tables and events stay, read-only (export and `banda app data`).
- `banda app purge <name> --project P` always writes an export to `projects/<id>/trash/` first, then drops the tables and files. Events stay.

**F5. Export is one format with four uses: backup, Project move (0081 d11), App replace, and safe purge.**

```
<project>.banda/  project.json {id, name, apps{name:{hash,source}}, seq}
                  log.ndjson   tasks.ndjson
                  apps/<name>/app.json {hash, migrations[hash], tables{name: CREATE sql}}
                  apps/<name>/<table>.ndjson   apps/<name>/files/
```

- `banda export --project P [--app A]` and `banda import`.
- SQLite stays. Banda promises export, not Postgres.

**F6. Replace is export piped into import.**
- `banda app replace old new --project P` runs `export old` into the new App's `import(bundle)` host-part entry point (a WIT export), declared as `imports = ["old"]`, then disables `old`.
- The SQLite authorizer never lets an App read another App's tables (0062 d5 stays strict).

**F7. Fork.**
- Same name, with `forked_from = "<upstream>@<hash>"`, so data continuity holds and F2 makes upstream merges safe.
- A fork that becomes its own App takes a new name and uses F6.

---

## Borders: inputs and outputs of each part

| Part | Where | Input | Output | State (writer) |
|---|---|---|---|---|
| Tasks | `kernel/src/tasks.rs` | `Tx::task_open/task_set`; `tasks.cancel` | `task.changed@1`; `tasks.list/follow`; calls the App's cancel command | `kernel_tasks` (owning App, through the kernel) |
| Outbox | `kernel/src/outbox.rs` | `Tx::enqueue(kind, key, payload, until?)` | runs in-process, or a worker claims by lease | `kernel_outbox` (kernel) |
| Cursors | `kernel/src/cursors.rs` | `listen(name, filter)` | events, acked in the handler's transaction | `kernel_cursors` (kernel) |
| Delivery | `apps/threads/src/delegation.rs` | Agent `send` naming another Project; peer frames | peer `call`s `threads.asked/answered/cancel_asked` | `threads_delegations` (Threads) |
| Routes | `platform/routes` (0081 d4) | `dial(host_key)` | a framed session (`Sink`/`Stream` of frames) | route list (client or host) |
| Supervisor | `platform/supervisor` | `Spec`, `Want` | `Lease` (stdio), `unit.changed`, logs stream | `supervisor_units` (supervisor) |
| Automations | `platform/automate` | events by cursor | intent calls as `App(name)` | `<app>_failed` (that App) |
| Export | `kernel/src/export.rs` + `banda export/import` | Project or App | NDJSON bundle | none |

## Plan (each step its own PR; `scripts/check.sh` passes after each)

1. **Kernel Task.** `Ref` and `AppName` in `ids.rs`; `kernel_tasks`; the `Tx` API; `tasks.list/follow/cancel`; the boot rule. Threads writes turns as tasks in `writer.rs`. The bar counts from tasks.
2. **Outbox upgrades.**
   - Per-effect `until` and retry policy (`Outcome::RetryAt`).
   - Leases (`worker_id`, `lease_until`), replacing `boot`.
   - Garbage collection: receipts after 30 days, done rows.
   - `banda mcp` CommandId derived from the MCP request id.
3. **Migrations by hash.** Per-App refusal, upgrade snapshot, backfill.
4. **`banda-supervisor`.**
   - Extract `hosts.rs` and rename "host" to Unit, which removes the clash with "host" the machine.
   - The Harness pool runs on it.
   - `servers.rs` becomes its observer (origin `observed`).
   - `units.*`, and `units.start` for Agents gated by the Thread's mode.
5. **Moves to the host.** The git commit run leaves `chain.ts` and becomes a git App table plus a Task. Project move and App install become Host-scope Tasks (with 0062 step 4).
6. **Export/import** NDJSON; `app remove` keeps data; `purge`.
7. **After 0081 steps 2–6: cross-Project and cross-host delegation.**
   - The `peer` mark in `methods!` and the peer session scope.
   - `threads_delegations`, `asked_by`.
   - `threads.allow`, the grant.
   - Within one host first (route `local`), then over iroh.
8. **With 0062 step 9 (SDK road).** `Participant::App`, `kernel_cursors`, the `automate` runtime, F6 replace through WIT `import`, and MCP gateway servers and host Chromium as Units.

## Deferred

- Host-driven cancel cascade deeper than one hop. Today the client fans out cancels; each is independent and idempotent.
- Mirroring a remote child's progress into the delegation (D shows only "delivered", then the end).
- An Agent reading or polling a remote Thread.
- The Project→host directory on the home host (v1 asks peers).
- Adopting an `observed` Unit as `managed` ("keep it running").
- Importing outside Claude or Codex sessions as Threads.
- Unit lifetimes tied to a Task (`lifetime = task`).
- Reaping idle `program` Units.
- Automations across hosts, timers, joins, and filters richer than equality.
- Agent templates (persona, settings, skills).
- Trace IDs beyond the parent chain.
- Compacting reply deltas out of the log.
- Namespacing App names (`author.name`) for third-party prefixes.
- Per-App snapshots beyond the last two.

## What this changes in other ADRs (for 0082's Changes section)

- **ADR 0006:** stands. A standing Thread is a Threads feature.
- **ADR 0019 d2 and d4:** "only its own Space" becomes "its own Project, or one that allows it, by delegation". **d5:** stopping a chain becomes possible one hop at a time, through `delegation.cancel`.
- **ADR 0002 d3:** effects keep coming only from the outbox. Retry until a deadline is added.
- **ADR 0040 d3:** the wall for machine modules stands. `tasks.follow` is the kernel's, served only to Person sessions.
- **ADR 0044:** the scanner becomes the supervisor's observer.
- **0062 d4:** "workers started again" becomes the supervisor. **d5:** the strict prefix authorizer stays, and replace goes through export and import.
- **0081 d13:** unchanged. Delivery is the engine's, never the Agent's CLI.

## Main risks

- **The Task row duplicates the App's own state** (a Turn written twice). This is safe because both are written in one transaction, but every producer must write both. A test should check that every App with `[tasks]` in its manifest ends what it opens.
- **A peer session is a new attack surface.** It is kept to `peer`-marked methods plus the target Project's grant. The default grant is none.