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
  It names the module, subject and kinds it shows, so it hears only those.
  The engine replays the log a page at a time, and a subscriber that falls
  behind catches up from the log.

## Where data lives

| Where | What |
|---|---|
| The Space's folder | the files of the work |
| Text files | Agents, in the Space's `.bandaso/agents/`; the Harnesses, in the config folder. Layouts, keys and themes join them later |
| The Harness | its session, context and sign-in. We keep only its session ID, as evidence |
| The OS keychain | secrets you give Bandaso. Its database never holds them |
| The engine's state folder | the owner's ID; while the engine runs, its port and per-run secret |
| The window's storage | each Space's Desk: its tiles, their Panes and the focus |
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
  holding its ID and its Harness. The file's name is the Agent's name. It
  may also say what its new Threads start with: a mode, Plan, and the
  Harness's options such as its model.
- **The Harness list is a text file** of the machine. It says how to start
  each Harness. Without one, the engine knows Claude Code and Codex through
  their ACP adapters on npm. Reading the ACP Registry comes next.
- **A message queues a turn.** The outbox runs one Thread's turns one at a
  time, in order (`turn.start`, keyed by the Thread). Threads run side by
  side, an Agent's own Threads too. A stop (`turn.stop`) and an answer
  (`question.reply`) have keys of their own, so neither waits behind the
  turn it is for.
- **One Harness process per Space and Harness entry.** Every Thread on it is
  a session in that process. The engine starts it on the first turn, one
  start at a time; starts it again after a growing pause if it keeps dying;
  and lets it go after 30 minutes with nothing to do. It runs in its own
  process group and dies with the engine.
- **A session belongs to its Thread.** The Thread keeps the Harness's
  session ID as evidence. A Thread whose process went resumes its session,
  or loads it; when the Harness can do neither, the Thread starts a new one
  and says so.
- **A turn runs until its Harness ends it or a Person stops it.** Starting
  a Harness and opening a session have time limits; a turn has none. A turn
  the Harness cancels when no Person asked fails, so nobody reads a stop
  that no Person made.
- **A failed turn says why, and what can be done.** Its class is one of:
  sign-in needed, usage limit (with when it resets, if the Harness says),
  Harness stopped, or provider error. The Thread's latest turn that failed
  or was cut short can be tried again (`agents.retry`): its message goes
  in a new turn, and the failed one stays as it ended.
- **The Harness's notices**, such as warnings, join the Thread as lines of
  their own.
- **A Thread has settings: a mode, Plan, and the Harness's options.** The
  modes are Supervised, Auto-accept edits, Auto and Full access, the
  default. A Person changes them under the message box
  (`agents.configure`), and a turn sets them on the session when it
  starts. The options come from the Harness, as it last offered them in
  the Thread (`thread.offered`); Bandaso keeps no model list of its own.
  When the Harness leaves a plan by itself, the Thread's settings follow.
- **A Question is answered by a Person.** It shows every answer the
  Harness offers, its "always" answers too. A Harness without modes of its
  own does not ask: the engine answers its Questions by the Thread's mode,
  allowing once where the mode allows, and asks the Person otherwise.
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
- **Claude Code and Codex go through ACP too**, through their official
  adapters (ADR 0003). A native adapter is added only where ACP blocks
  something users need; a native Codex adapter comes later, for its rate
  limits.
- **Capabilities.** The engine declares what the window can show (notices,
  and options that are on or off), and the adapter reads what the Harness
  declares (sessions that resume or load, and their options). The rest of the engine reads those capabilities and
  never the Harness's name. A failure's class comes from ACP's error codes
  and the data the adapters attach to an error.
- **Modes.** Each mode becomes the Harness's own where it has Claude
  Code's or Codex's modes, never freer than the one chosen when the Harness
  lacks it; the Harness then decides when to ask. Plan is Claude Code's
  plan mode and Codex's collaboration mode. Any other Harness's modes are
  options like the rest. The table is in `acp.rs`.

## Window

```
app/desktop      Electron main: starts the engine, serves the page, hands it the address
app/web          the page: Spaces, the Desk and its keys, the Pane registry
app/ui           shadcn/ui (preset b0, on Base UI) and the Pane contract
modules/*/pane   each module's Panes
```

- **The page reaches the engine only through the API.** Electron main gives
  it one thing: the engine's address, through `window.bandaso.engine()` in
  a sandboxed preload. The page is served from `app://bandaso` with a
  strict Content Security Policy. It cannot navigate, open windows or get
  permissions, and links open in the browser.
- **The engine is the window's child.** Main starts
  `bandaso serve --with-parent`, starts it again when it dies (waiting up
  to 10 s between tries), and closes its stdin on quit. The client then
  reconnects and follows on from the last event it delivered, so a Pane
  sees no gap.
- **A Pane** is a `PaneKind`: a kind, the module it needs, a title, an
  icon, optional start args, and a component. The component gets the
  engine, the Space, its args, whether it has the focus, `open` and
  `update`. A Pane's args are all its state; the Desk keeps them.
- **A Pane reads a view, then follows.** `useLive` reads the view once,
  applies each event after its `at`, and reads again when the engine says
  so. Events that arrive within one frame render once.
- **The Desk** is a tree of splits whose leaves are tiles
  (`app/web/src/layout.ts`); every change to it is a pure function.
  - Opening a Pane that is already shown focuses it.
  - Opened with no place, a Pane takes the tile that last showed its kind,
    or splits to the right. Ctrl-click (⌘ on a Mac) always splits.
  - Keys: Alt+Arrows move the focus, Ctrl+\ splits right, Ctrl+Shift+\
    splits down, Ctrl+W closes.
  - Each Space keeps its own Desk in the window's storage
    (`$BANDASO_STATE/window` when that is set).
- **Only `window.bandaso` ties the page to the desktop.** It names no
  Electron API, so a browser can host it later; for now the engine lets in
  only `app://bandaso` and pages on localhost.

## Repository

```
bandaso/
  kernel/             Rust: Space, event log, access, registry, API
  modules/
    agents/engine/    Rust: Agents, Threads, turns, Questions, the ACP adapter
    agents/pane/      React: the Agents list and the Thread
    browser/pane/     React: the browser Pane (next)
  engine/             the bandaso program: serve (the kernel and its modules), call, follow
  app/ui/             shadcn/ui and the Pane contract
  app/web/            React: the Desk, the Space picker, the Pane registry
  app/desktop/        Electron: the window and the engine's start; e2e tests
  contract/           the engine's API for TypeScript: generated types and the client
  tools/fake-agent/   a scripted ACP agent for tests and window checks
  scripts/check.sh    every check a change must pass
  docs/               adr/ · architecture.md · research/
  GLOSSARY.md
```

## Checks that hold the shape

- **Architecture tests.** The kernel names no module, no module reads
  another's tables, and a Pane imports only the API, `@bandaso/ui`, React
  and its icons.
- **Module tests** run through the module's interface: commands go in and
  events come out. Nothing past the interface is mocked.
- **Adapter tests** run the real engine. Only the Harness's transport is
  replayed, from recorded conversations: ours, and T3 Code's recorded
  scenarios (MIT, with their notice).
- **End to end.** Playwright drives the Electron window against a scripted
  fake ACP agent. Screenshots let Agents check the UI themselves.
- **Speed budget.** A window test measures start-up time, memory and input
  latency, and writes them to `app/desktop/test-results/speed.json`. Its
  budgets are loose: they catch a regression.
- **`scripts/check.sh`** runs every check in the order a failure is
  cheapest to find. It also fails when `cargo test` rewrites the generated
  TypeScript types, so the window never builds against stale ones.
