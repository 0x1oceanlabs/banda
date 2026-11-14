# Architecture

This is the shape Banda is built to. The decisions and their reasons are in
[ADR 0001](adr/0001-one-engine-a-small-kernel-and-modules.md) and
[ADR 0002](adr/0002-how-the-engine-writes-and-keeps-the-work.md), and the
words are in [`GLOSSARY.md`](../GLOSSARY.md). This page changes when the code
does.

Where it is going, accepted on 2026-11-06: [the architecture
vision](research/2026-11-06-architecture-vision.md). Its decisions become ADRs
and then code, step by step; this page follows the code.

## Three levels

```
Processes            window · engine · Harness · CLI     UNIX: one job each, text protocols
Kernel and modules   kernel + bounded contexts           strategic DDD
Inside a module      rules · store · operation           tactical DDD where invariants are real
```

## Processes

```
banda (Electron)    window: tiling, Panes (React + shadcn/ui)
      │ engine API: JSON over WebSocket, types generated from Rust
banda serve         the engine: one process per machine; owns the data
      │ ACP over stdio              ▲ MCP: modules' tools for Agents
Harness (Claude Code, Codex, …) ────┘
banda call/follow   the CLI: the same API, for people, scripts and Agents
```

- Each process does one job, speaks an explicit protocol, and can be
  replaced. The window may be Electron or a browser. The engine may run on
  this computer or on a server. The Harness may be any ACP agent.
- Everything the window can do, the CLI can do.
- Inside the engine there are no services: it is one process, with one
  SQLite writer per Project. Modules are crates in one binary.

What `banda` does as each of them, the engine's door, how the engine
outlives the window and how an Agent reaches Banda are in
[`engine/README.md`](../engine/README.md).

## Kernel

The kernel holds only what every module needs, and it names no module.
Each part, with its rules, its methods and its ADRs, is in
[`kernel/README.md`](../kernel/README.md).

| Part | What it does | Code in `kernel/src/` |
| --- | --- | --- |
| Project | A folder on disk and its data in the engine's; `projects.*` make, add, rename and forget one | `project.rs`, `projects.rs` |
| Trust | A Project is trusted or not, and only the Person changes it | `projects.rs`, `foreign.rs` |
| Event log | Append-only typed facts, one log per Project, which windows and the CLI follow | `events.rs` |
| Durable listeners | A module hears a log by a named listener, and a restart resumes where it had heard | `cursors.rs` |
| Access decision | One function says whether a Participant may do an action, before any module code runs | `access.rs` |
| The Project wall | An Agent's pass calls only in its own Project | `access.rs` |
| This machine | One more store, for the modules whose data holds every Project's | `scopes.rs`, `kernel.rs` |
| Tables by prefix | A module's SQL reaches only the tables of its own name | `tables.rs` |
| Identity | A port: which Participant a connection's token names | `api.rs` |
| Devices | A port for the door: this machine's host key and the devices it paired | `devices.rs` |
| Environment | A port: where a Project's programs run, and the handle that stops them | `environment.rs`, `started.rs` |
| The fence | What a Harness's programs run behind on Linux, and what its probe found | `fence.rs`, `platform/fence` |
| Passes | An Agent's token: its Project, its Thread and when it ends | `passes.rs` |
| Module registry and API | Routes commands to their module, delivers events, and says what the engine has | `registry.rs`, `api.rs` |
| Streams | Live pieces that are not facts, as what a terminal prints | `router.rs` |
| The window's road | A module asks the window for work that is the window's | `window.rs` |
| An action from anywhere | `banda act ID` and an Agent's `act` run any action by its id | `platform/keys/engine` |
| Receipts and outbox | Every command keeps a receipt, and its side effects run in order | `store.rs`, `outbox.rs` |

Every command goes one way, the command path: its session's queue, a
receipt, the access decision, the module's operation, one transaction,
the answer, the publish, the outbox.

## Where data lives

| Where | What |
|---|---|
| The Project's folder | the files of the work |
| Text files | the Harnesses, in the config folder; the look (`look.toml`, themes) and the sidebar (`sidebar.toml`, presets), the browser (`browser.toml`), how Threads start and messages to an Agent are sent (`agents.toml`) and how the Tiling behaves (`tiling.toml`) in `~/.config/banda/`. Layouts and keys join them later |
| The Harness | its session, context and sign-in. We keep only its session ID, as evidence |
| The OS keychain | secrets you give Banda. Its database never holds them |
| The engine's state folder | the owner's ID; how its last run went (`run.json`); the passes, hashed (`passes.sqlite3`); while the engine runs, its port and per-run secret |
| The window's storage | the view of the workspaces: the one on screen, each one's focused column and each column's shown Pane, and Solo as this device chose it; whether the sidebar shows; which finished turn of each Thread the Person has seen; which Panes an Agent opened the Person has looked at |
| `machine/` SQLite, in the engine's state | this machine's, in no Project: the workspaces, their columns, each Pane with its Project and the widths (ADR 0025) |
| `projects/<id>/` SQLite, in the engine's data | Threads, Questions and answers, the Agents' queue, Databases' records, receipts, events, outbox |
| `projects/<id>/images/` and `files/` | the bytes of the images messages carry, one file per image, the SQLite saying what each is and which message carries it; the files a message keeps (a dropped file, a long paste), which each Thread's session gets as an extra root |

Events are facts with a version, and the log is never rewritten. Each module
keeps its own ledger of migrations. A module whose tables do not come up to
date in a Project (a step that fails, a step that reaches past its prefix,
or data a newer version of it wrote) is turned off in that Project alone:
the Project opens, its other modules go on, the module's methods there
answer `app_unavailable` with why, and its effects wait as they are. A step
that failed left nothing, so the next start runs it again, put right or
not. The machine's own modules are not turned off: the engine starts with
all of them or does not start (ADR 0085, decision 8). Our IDs are UUIDv7, but those derived
from another, as UUIDv5: a command's ID from what sent it, and what a
workspaces command makes from its command's ID (ADR 0088, decision 11). A
Harness's IDs are stored as references.

## Modules

A module is a bounded context with its own words, its own data and its own
contract. It is one folder: an App's in `apps/`, the platform's in
`platform/` (ADR 0062, decision 11).

```
<name>/
  engine/      Rust crate: rules · store · operation · adapters
  pane/        React package: its window part, one defineModule
  app.toml     id, kind, name, version, api, from Banda, settings files,
               legacy table prefixes, needs (empty yet), unstable marks
  window.json  its window part as the engine reads it, written by the window's tests:
               what `banda modules` prints, and the Pane kinds that open as
               a Group of their own, stand on their Project's workspace,
               or are lists
```

A module declares itself in its code and a short `app.toml`: its engine
part is the `Module` it gives the kernel, its window part one
`defineModule` exported from its Pane package. What each field means,
what `app.toml` holds and how the engine gathers the one list of Apps
are in [`apps/README.md`](../apps/README.md).

**Its contract** is everything it shows outward:

- **Methods it accepts**, each a call, a command or a stream with typed
  params and answer: one line in its `methods!` table, which makes the
  right, the dispatch and the module's methods as TypeScript, so the
  window's `engine.call`, `engine.command` and `engine.stream` take only
  those (ADR 0014). Each is a read or an act (ADR 0106, law 4): a command
  acts; a call or a stream reads when its right is Read, or when its line
  ends `, read`, as `terminal.watch` does, and acts otherwise. The tests
  write which each is to `sdk/contract/src/generated/does.ts`, and the
  window's client fails an act at once while its machine is away, or
  while that machine's engine answers nothing (ADR 0082, decision 11).
- **Events it publishes.** These are its published language, and they carry a
  version.
- **Its tables.** Only this module writes them, and no other module reads
  them: the kernel refuses any table outside its prefix (Tables by
  prefix, above).
- **Tools** it offers Agents: a `methods!` line marked `tool "<name>"`
  is one, with its `///` as its description and the JSON Schema of its
  params, from `schemars` (ADR 0019, decision 3). The agents module's
  `threads`, `thread` and `send` are `threads`, `read` and `send`.
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
| agents | Thread, Harness, Agent, Turn, Question | first |
| harnesses | Harness, account; the machine's (ADR 0040) | first |
| terminal | Terminal | first |
| browser | Tab; the pages are the window's; an Agent reaches its Project's tabs through its tools (ADR 0013, ADR 0029, ADR 0083) | first |
| files | any folder, a file in its Pane (ADR 0073) | first |
| chat | Room, Message, Mention | later |
| databases | Database, Field, Record, View | later |

### apps

`platform/apps`: the Apps on this machine, what the engine runs and
the Apps installed from a folder, each run by a worker (ADR 0126).
Its rules are in
[`platform/apps/README.md`](../platform/apps/README.md).

### agents

`apps/agents`: Threads, turns, Questions, Visuals, sub-agents, and the
ACP adapter that speaks to every Harness. Its rules are in
[`apps/agents/README.md`](../apps/agents/README.md); its Panes' files are
in [`apps/agents/pane/README.md`](../apps/agents/pane/README.md).

### harnesses

`platform/harnesses`: the machine's Harnesses, their Accounts and
usage, and the crate that speaks to a Harness (ADR 0040, ADR 0108).
Its rules are in
[`platform/harnesses/README.md`](../platform/harnesses/README.md).

### terminal

`apps/terminal`: a program on a PTY in the engine, run as the Person,
and its Pane, drawn by Ghostty (ADR 0047).
Its rules are in
[`apps/terminal/README.md`](../apps/terminal/README.md).

### files

`apps/files`: any folder as a Finder shows it, a file in its Pane, and
Quick Look; `files.find` answers every "which file" (ADR 0073).
Its rules are in
[`apps/files/README.md`](../apps/files/README.md).

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

Threads, turns, tool calls and Questions are Banda's model, and ACP is
the adapter to every Harness: Claude Code and Codex go through it too.
The adapter, its capabilities and the modes are in
[`apps/agents/README.md`](../apps/agents/README.md#harnesses).

## Window

```
client/desktop                      Electron main: starts the engine, serves the page, hands it the address
client/desktop-kit                  what a module's part in main may use of main: its services, dialogs, errors, the bridge's answers, the relay of the byte host to the engine
client/web                          the page: the bar, the sidebar, the workspaces and the overview; the actions; the Pane registry
client/core                         the core every client shares, with no DOM: Here, the stores read by selector, what an action runs with, the device's words, the hosts, what the device keeps of a machine "as of" (`cache.ts`)
client/ui                           shadcn/ui (preset b0, on Base UI), Banda's Mark and sounds, and the Pane contract
client/ghostty                      T3 Code's Ghostty adapter: a terminal on a canvas
apps/*/pane, platform/*/pane        each module's Panes
apps/*/desktop, platform/*/desktop  a module's part in Electron main
```

The detail of each part is beside its code:

| Part | Its page |
| --- | --- |
| Electron's main process: how the window finds the engine, the menu bar on macOS, what a packed Banda runs, `window.banda` | [`client/desktop/README.md`](../client/desktop/README.md) |
| The page: a Pane, the Window, the workspaces, the actions, the sidebar, the bar's Mark, calls and sounds | [`client/web/README.md`](../client/web/README.md) |
| How Banda updates itself, and `scripts/install.sh` | [`platform/updates/README.md`](../platform/updates/README.md) |
| The browser's pages | [`apps/browser/README.md`](../apps/browser/README.md) |

## Repository

```
banda/
  kernel/             Rust: Project, event log, access, registry, API
  engine/             the banda program: serve (the kernel and its modules), call, follow, look, skill, mcp, menu
  apps/               each App's module (ADR 0062, decision 11)
    agents/engine/    Rust: Threads, turns, Questions, the ACP adapter
    agents/pane/      React: the Thread, the settings' Agents, each Thread as the sidebar lists it
                      thread/, entries/ and lines/ with their tables, composer/, asking/, visual/ (ADR 0091; its README)
    agents/desktop/   Electron main: serves the Visuals Agents show (ADR 0037)
    terminal/engine/  Rust: Terminals, their PTYs and what they printed
    terminal/pane/    React: a terminal, drawn by Ghostty
    browser/pane/     React: the browser Pane, its tabs and row (ADR 0013)
    browser/desktop/  Electron main: the browser's pages and profiles, extensions, blocker and tab sockets (ADR 0028)
  platform/           what the Apps stand on; it names no App (ADR 0062)
    apps/             Rust: the Apps on this machine: what the engine runs, described, and the Apps installed from a folder (ADR 0126)
    skill/            Rust: the Banda skill, its core and the topics it gathers (ADR 0012)
    look/             Rust: banda look, the look, the sidebar's arrangement and the browser's; skill/ its topics
    settings/         Rust: Banda's settings files, each described once, and the one writer that changes them (ADR 0016)
    git-cli/          Rust: how Banda starts git: its own bookkeeping, which runs no program a repository names, and the acts the Person asks for
    environments/     Rust: where a Project's programs run, the adapters of the kernel's Environment port: local (ADR 0084)
    fence/            Rust: the fence a Harness's programs run behind on Linux, and `banda fence`, its launcher and probe (ADR 0083)
    harnesses/        Rust: the Harnesses and how each starts; adapters/ the ACP adapters Banda carries and its shim of Claude's Agent SDK, a Node package run on the host (ADR 0059, ADR 0078)
  client/             the window
    ui/               shadcn/ui and the Pane contract
    ghostty/          T3 Code's Ghostty adapter and its WebAssembly, vendored
    web/              React: the Window (window/: the Bar, the Sidebar, the Top layer), the Tiling (tiling/: the workspaces, the overview), the actions, the Pane registry
    desktop/          Electron: the window and the engine's start; e2e tests
    desktop-kit/      what a module's part in main may use of main (ADR 0028)
  sdk/contract/       the engine's API for TypeScript: generated types and the client
  site/               banda.so: static Astro pages drawn with Banda UI, served by Vercel (ADR 0128)
  tools/fake-agent/   a scripted ACP agent for tests and window checks; it replays recordings too
  scripts/check.sh    every check a change must pass
  scripts/try.sh      builds a tree and opens a window of its own from it, to click through
  scripts/local.sh    starts a checkout's window in a systemd unit of its own (ADR 0086)
  scripts/layout.sh   moves the old folders where ADR 0062 puts them, on a branch made before too
  docs/               adr/ · architecture.md · design/ (the look, and the kit for mocks) · research/
  GLOSSARY.md
```

## Checks that hold the shape

A border is real when a check holds it. Each list of what a check still
allows only falls.

| What is held | The test | Its detail |
| --- | --- | --- |
| The kernel names no module; no module reads another's tables; what the platform's Rust and an App still name of another App; which crates depend on an App's | `kernel/tests/architecture.rs`, `engine/src/apps.rs` | [`kernel/README.md`](../kernel/README.md#checks) |
| No code of the engine makes a process but `banda-environments`, and who makes a `Program` | `kernel/tests/architecture.rs` | [`kernel/README.md`](../kernel/README.md#checks) |
| The fence makes real namespaces | the fence's tests, CI's `fence` part | [`kernel/README.md`](../kernel/README.md#checks) |
| A Pane imports only the API, `@banda/ui`, React and its icons | each `apps/*/pane/src/architecture.test.ts` | [`kernel/README.md`](../kernel/README.md#checks) |
| Only `modules.ts` and the bridge's table name a module's package; nothing more animates a size or a place; ADR 0087's ratchets; who reads `window.banda`; what the core imports | `client/web/src/architecture.test.ts` | [`client/web/README.md`](../client/web/README.md#checks) |
| A colour, corner, type size, shadow, layer or length off Banda UI is refused | `client/web/src/look.test.ts` | [`client/web/README.md`](../client/web/README.md#checks) |
| Main runs an effect only in `main.ts` and two listed places | `client/desktop/src/architecture.test.ts` | [`client/desktop/README.md`](../client/desktop/README.md#checks) |
| The adapter says to a Harness what the recordings say | the agents engine's replays | [`apps/agents/README.md`](../apps/agents/README.md#checks) |

- **Module tests** run through the module's interface: commands go in and
  events come out. Nothing past the interface is mocked.
- **Checkpoints** (ADR 0014, decision 3). With `BANDA_CHECKPOINTS` set,
  as `scripts/check.sh` sets it, the agents module's tests write each
  Thread they read: its first view, the facts after it, and its last
  view. The Pane's tests apply those facts to the first view and must get
  the last one, what a Person may do with each turn (`can`) included.
- **End to end.** Playwright drives the Electron window against a scripted
  fake ACP agent. Screenshots let Agents check the UI themselves.
- **Speed budget.** A window test measures start-up time, memory and input
  latency, and writes them to `client/desktop/test-results/speed.json`. Its
  budgets are loose: they catch a regression.
- **`scripts/check.sh`** runs every check in the order a failure is
  cheapest to find. It also fails when `cargo test` rewrites the generated
  TypeScript types, so the window never builds against stale ones.
