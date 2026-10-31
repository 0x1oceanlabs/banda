# Architecture

This is the shape Bandaso is built to. The decisions and their reasons are in
[ADR 0001](adr/0001-one-engine-a-small-kernel-and-modules.md) and
[ADR 0002](adr/0002-how-the-engine-writes-and-keeps-the-work.md), and the
words are in [`GLOSSARY.md`](../GLOSSARY.md). This page changes when the code
does.

## Three levels

```
Processes            window · engine · Harness · CLI     UNIX: one job each, text protocols
Kernel and modules   kernel + bounded contexts           strategic DDD
Inside a module      rules · store · operation           tactical DDD where invariants are real
```

## Processes

```
bandaso (Electron)    window: tiling, Panes (React + shadcn/ui)
      │ engine API: JSON over WebSocket, types generated from Rust
bandaso serve         the engine: one process per machine; owns the data
      │ ACP over stdio              ▲ MCP: modules' tools for Agents
Harness (Claude Code, Codex, …) ────┘
bandaso call/follow   the CLI: the same API, for people, scripts and Agents
```

- Each process does one job, speaks an explicit protocol, and can be
  replaced. The window may be Electron or a browser. The engine may run on
  this computer or on a server. The Harness may be any ACP agent.
- Everything the window can do, the CLI can do.
- Inside the engine there are no services: it is one process, with one
  SQLite writer per Space. Modules are crates in one binary.
- **One program, `bandaso`.** `bandaso serve` runs the engine. It listens
  on 127.0.0.1 only, and writes its port and a fresh secret to
  `engine.json` in its state folder, a file only this user can read. A
  window starts it with `--with-parent`: the engine then prints the same
  JSON as its first line, and stops when its stdin closes. A second
  engine with the same state folder refuses to start.
- **The CLI prints JSON.** `bandaso call <method>` prints `{"ok": …}`.
  `bandaso follow` prints events, one per line. When the engine refuses
  the call, the hello or the follow, the CLI prints
  `{"error": {"code", "message"}}` and exits 1. When no engine answers,
  or the CLI cannot do its part, it says so on stderr and exits 2; a call
  that broke off names the command ID that repeats it safely.

## Kernel

The kernel holds only what every module needs, and it names no module.

- **Space.** A folder on disk (`~/Bandaso/<name>/` by default): the work's
  files plus `.bandaso/`. The latter holds the Space's SQLite, the modules'
  migrations and the event log. One engine at a time opens a Space: it holds
  a lock on `.bandaso/space.lock` while the Space is open.
- **Event log.** Append-only, with typed events, one per Space. Windows and
  the CLI subscribe to it. A subscription sends only what its view needs.
  The database itself refuses to change or delete an event.
- **Access decision.** One function decides whether a Participant may perform
  an action on a target. Every method and every subscription passes through
  it, before any module code runs. On one computer it answers: the owner may
  do everything; an Agent may read and change the work, but neither change
  the Space itself nor decide what an Agent asked a Person; nobody else may
  do anything. Members and roles arrive here later.
- **Identity.** A port: it says which Participant a connection's token names.
  On one computer, whoever holds the engine's secret is the owner. Later it
  is OIDC, or our accounts, and Agents get tokens of their own.
- **Module registry and API.** The registry routes commands to their
  module, delivers events to subscribers, and serves the API. `welcome`
  lists the engine's modules, so a window shows only what the engine has.
- **Receipts and outbox.** These carry every command along one path (below).

### The command path

```
command (with its ID)
  → access decision (one exhaustive map: method → right)
  → module operation: rules decide, store writes
  → one transaction: receipt · events · view tables · outbox rows
  → publish: one ordered lane per Space
  → outbox worker: side effects in order per target, leased, retried
```

- A repeated command returns its first result, a refusal included. A
  receipt names its author: the same command ID from someone else, or for
  another method, is a conflict. A read is not a command and keeps no
  receipt.
- A side effect never starts from a live subscription.
- An effect holds its key while it runs, so its module bounds how long a run
  takes. A restart that cuts an effect short counts as a try: after five,
  the effect fails and its module says so.
- Outbox rows are the kernel's bookkeeping, not records of the work. What a
  Person sees of an effect is the events its module writes.
- A window loads a snapshot at sequence N, then streams the events after N.
  The engine replays the log a page at a time, and a subscriber that falls
  behind catches up from the log.

## Where data lives

| Where | What |
|---|---|
| The Space's folder | the files of the work |
| Text files | Agents, layouts, keys, themes, module settings |
| The Harness | its session, context and sign-in. We keep only its session ID, as evidence |
| The OS keychain | secrets you give Bandaso. Its database never holds them |
| The engine's state folder | the owner's ID; while the engine runs, its port and per-run secret |
| The window | focus, scroll, open Panes |
| `.bandaso/` SQLite | Threads, Questions and answers, the Agents' queue, Databases' records, receipts, events, outbox |

Events are facts with a version, and the log is never rewritten. Each module
keeps its own ledger of migrations. Our IDs are UUIDv7. A Harness's IDs are
stored as references.

## Modules

A module is a bounded context with its own words, its own data and its own
contract. It is one folder:

```
modules/<name>/
  engine/      Rust crate: rules · store · operation · adapters
  pane/        React package: its Panes
  module.toml  name, commands, events, tables, tools, Panes
```

`module.toml` arrives with third-party modules. Until then a first-party
module's `Module` implementation is its manifest.

**Its contract** is everything it shows outward:

- **Commands it accepts**, with typed input and output.
- **Events it publishes.** These are its published language, and they carry a
  version.
- **Its tables.** Only this module writes them, and no other module reads
  them.
- **MCP tools** that it offers Agents.
- **Panes.** They reach the engine only through the API.

**Modules connect only by commands and events.** Here is an example, once
Chat exists:

1. A Person writes "@agent do X" in a Room.
2. Chat publishes an event that a message with a Mention was posted.
3. Agents turns that event into a request for the Agent, and the Agent works
   through a turn.
4. Agents publishes "the Agent answered", and Chat adds the answer to the
   Room.

If Chat is removed, Agents still works through its own Thread.

| Module | Its words | When |
|---|---|---|
| agents | Agent, Harness, Thread, Turn, Question | first |
| browser | Page; an Agent drives it through MCP (CDP) | first |
| files | the Space's files | soon |
| chat | Room, Message, Mention | later |
| databases | Database, Field, Record, View | later |

### agents

- **An Agent is a text file** in its Space: `.bandaso/agents/<name>.toml`,
  holding its ID and its Harness. The file's name is the Agent's name.
- **The Harness list is a text file** of the machine. It says how to start
  each Harness. Without one, the engine knows Claude Code and Codex through
  their ACP adapters on npm. Reading the ACP Registry comes next.
- **A message queues a turn.** The outbox runs one Agent's turns one at a
  time, in order (`turn.start`, keyed by the Agent). A stop (`turn.stop`)
  and an answer (`question.reply`) have keys of their own, so neither waits
  behind the turn it is for.
- **A turn runs until its Harness ends it or a Person stops it.** Starting
  a Harness and opening a session have time limits; a turn has none. A turn
  the Harness cancels when no Person asked fails, so nobody reads a stop
  that no Person made.
- **A Question is answered only by a Person.** It shows the Harness's own
  choices, without the Harness's "always" answers. A Question that offers
  nothing else fails its turn: a Person decides each time.
- **A restart interrupts** the turn it cut short and closes that turn's
  open Questions.
- Its methods and their rights are listed in
  `modules/agents/engine/src/lib.rs`, and its facts in `model.rs`.

## Inside a module

- **rules**: pure decisions and state machines, with no database, clock or
  randomness. Plain tests cover them.
- **store**: SQL, with one writer per table.
- **operation**: the way in. A command goes through the rules and the store,
  and the events come out, all in one transaction.
- **adapters**: at the edge. ACP and native Harness protocols, the clock and
  IDs live here.

A module gets this ceremony only where an invariant lives. Plain records are
plain.

## Harnesses

Threads, turns, tool calls and Questions are Bandaso's model. The agents
module reaches a Harness through an adapter:

- **ACP** is the first and default adapter. It covers any agent in the ACP
  Registry.
- **A native adapter** is added only where ACP blocks something users need.
  Claude Code (through its Agent SDK) and Codex (through its app-server) are
  expected early: ACP lacks rollback, Questions that survive a restart,
  subagents and usage figures.
- **Capabilities.** An adapter declares what its Harness can do. The rest of
  the engine reads those capabilities and never the Harness's name.
- **Permissions.** The Harness decides when to ask, by its own settings.
  Bandaso shows the Question, passes the Harness's options through unchanged,
  and returns the answer.

## Window

```
Electron main   the window, updates, starting the engine, browser views
renderer        React: the tiling shell · the Pane registry · the API client · shadcn/ui
platform        electron | web: the same React code in a browser later
```

## Repository

```
bandaso/
  kernel/             Rust: Space, event log, access, registry, API
  modules/
    agents/engine/    Rust: Agents, Threads, turns, Questions, the ACP adapter
    agents/pane/      React: the Thread Pane (next)
    browser/pane/     React: the browser Pane (next)
  engine/             the bandaso program: serve (the kernel and its modules), call, follow
  app/web/            React: the tiling shell and the Pane registry (next)
  app/desktop/        Electron: the window, the engine's start, browser views (next)
  contract/           TypeScript types generated from the Rust
  tools/fake-agent/   a scripted ACP agent for tests and window checks
  docs/               adr/ · architecture.md · research/
  GLOSSARY.md
```

## Checks that hold the shape

- **Architecture tests.** The kernel names no module, no module reads
  another's tables, and a Pane imports only the API and the shell.
- **Module tests** run through the module's interface: commands go in and
  events come out. Nothing past the interface is mocked.
- **Adapter tests** run the real engine. Only the Harness's transport is
  replayed, from recorded conversations: ours, and T3 Code's recorded
  scenarios (MIT, with their notice).
- **End to end.** Playwright drives the Electron window against a scripted
  fake ACP agent. Screenshots let Agents check the UI themselves.
- **Speed budget.** Tests check start-up time, memory and input latency.
