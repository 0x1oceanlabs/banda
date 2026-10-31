# Architecture

This is the shape Bandaso is built to. The decisions and their reasons are in
[ADR 0001](adr/0001-one-engine-a-small-kernel-and-modules.md), and the words
are in [`GLOSSARY.md`](../GLOSSARY.md). This page changes when the code does.

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
bandaso-engine        one process per machine; owns the data
      │ ACP over stdio              ▲ MCP: modules' tools for Agents
Harness (Claude Code, Codex, …) ────┘
bandaso CLI           the same API, for people, scripts and Agents
```

- Each process does one job, speaks an explicit protocol, and can be
  replaced. The window may be Electron or a browser. The engine may run on
  this computer or on a server. The Harness may be any ACP agent.
- Everything the window can do, the CLI can do.
- Inside the engine there are no services: it is one process, with one
  SQLite writer per Space. Modules are crates in one binary.

## Kernel

The kernel holds only what every module needs, and it names no module.

- **Space.** A folder on disk (`~/Bandaso/<name>/` by default): the work's
  files plus `.bandaso/`. The latter holds the Space's SQLite, the modules'
  migrations and the event log.
- **Event log.** Append-only, with typed events, one per Space. Windows and
  the CLI subscribe to it. A subscription sends only what its view needs.
- **Access decision.** One function decides whether a Participant may perform
  an action on a target. Every command passes through it. On one computer it
  answers "the owner may do everything". Members and roles arrive here later.
- **Identity.** A port. On one computer it is the operating-system user.
  Later it is OIDC, or our accounts.
- **Module registry and API.** The registry routes commands to their
  module, delivers events to subscribers, and serves the API.

## Modules

A module is a bounded context with its own words, its own data and its own
contract. It is one folder:

```
modules/<name>/
  engine/      Rust crate: rules · store · operation · adapters
  pane/        React package: its Panes
  module.toml  name, commands, events, tables, tools, Panes
```

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
  kernel/          Rust: Space, event log, access, registry, API
  modules/
    agents/
    browser/
  app/             Electron: the window, tiling, platform
  cli/
  docs/            adr/ · architecture.md
  GLOSSARY.md
```

## Checks that hold the shape

- **Architecture tests.** The kernel names no module, no module reads
  another's tables, and a Pane imports only the API and the shell.
- **Module tests** run through the module's interface: commands go in and
  events come out. Nothing past the interface is mocked.
- **End to end.** Playwright drives the Electron window against a scripted
  fake ACP agent. Screenshots let Agents check the UI themselves.
- **Speed budget.** Tests check start-up time, memory and input latency.
