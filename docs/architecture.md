# Architecture

This is the shape Banda is built to, as a map: each part in a line or
two, with a link to where its detail is. The detail lives beside the
code, in the `README.md` of the kernel, the engine, each App, each part
of the platform and each client. Read this page whole, then the pages of
the parts you change. This page changes when the shape does; a part's
page changes with its code, in the same PR.

The words are in [`GLOSSARY.md`](../GLOSSARY.md), the decisions in
[`adr/`](adr/README.md), whose index says which still bind. Where it is
going, accepted on 2026-11-06: [the architecture
vision](research/2026-11-06-architecture-vision.md). Its decisions
become ADRs and then code, step by step; this page follows the code.

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

What an event, a migration and an ID are is in
[`kernel/README.md`](../kernel/README.md#events-migrations-and-ids).

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

Its contract is everything it shows outward: the methods it accepts,
the events it publishes, its tables, the tools it offers Agents, and its
Panes. Modules connect only by commands and events, so one removed
leaves the others working
([`apps/README.md`](../apps/README.md#a-modules-contract)).

| Module | What it is | Its page |
| --- | --- | --- |
| agents | Threads, turns, Questions, Visuals, sub-agents, and the ACP adapter | [`apps/agents`](../apps/agents/README.md) |
| browser | Chromium in a Pane, for the Person and every Agent | [`apps/browser`](../apps/browser/README.md) |
| clock | The day and the time on the bar | [`apps/clock`](../apps/clock/README.md) |
| files | Any folder as a Finder shows it, a file in its Pane, and Quick Look | [`apps/files`](../apps/files/README.md) |
| git | The Project's folder as git sees it: its changes, diffs and commits | [`apps/git`](../apps/git/README.md) |
| pulls | The pull requests linked to a Project's Threads | [`apps/pulls`](../apps/pulls/README.md) |
| terminal | A program on a PTY, run as the Person, drawn by Ghostty | [`apps/terminal`](../apps/terminal/README.md) |
| apps | The Apps on this machine, and those installed from a folder | [`platform/apps`](../platform/apps/README.md) |
| bytes | A file's bytes by a token, from the machine that has the file | [`platform/bytes`](../platform/bytes/README.md) |
| devices | The devices this machine lets in at its door, and its host key | [`platform/devices`](../platform/devices/README.md) |
| harnesses | The machine's Harnesses, their Accounts and their usage | [`platform/harnesses`](../platform/harnesses/README.md) |
| keys | Every action with its keys, and the one writer of settings for an Agent | [`platform/keys`](../platform/keys/README.md) |
| machines | A machine's name and icon, its battery, and no idle sleep while Agents work | [`platform/machines`](../platform/machines/README.md) |
| notifications | Toasts, the desktop's notifications, and the bell on the bar | [`platform/notifications`](../platform/notifications/README.md) |
| problems | What broke in Banda itself, kept on this computer | [`platform/problems`](../platform/problems/README.md) |
| sharing | The one part that sends anything anywhere, and only what the Person turned on | [`platform/sharing`](../platform/sharing/README.md) |
| updates | Each machine updates its own Banda, with or without a window | [`platform/updates`](../platform/updates/README.md) |
| workspaces | How this machine's Panes are arranged, and where a Pane opens | [`platform/workspaces`](../platform/workspaces/README.md) |

Chat (Room, Message, Mention) and Databases (Database, Field, Record,
View) come later.

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
  apps/               each App's module, one folder each (ADR 0062, decision 11): the table under Modules
  platform/           what the Apps stand on; it names no App (ADR 0062): its modules are in that table, and beside them
    skill/            Rust: the Banda skill, its core and the topics it gathers (ADR 0012)
    look/             Rust: banda look, the look, the sidebar's arrangement and the browser's; skill/ its topics
    settings/         Rust: Banda's settings files, each described once, and the one writer that changes them (ADR 0016)
    git-cli/          Rust: how Banda starts git: its own bookkeeping, which runs no program a repository names, and the acts the Person asks for
    environments/     Rust: where a Project's programs run, the adapters of the kernel's Environment port: local (ADR 0084)
    fence/            Rust: the fence a Harness's programs run behind on Linux, and `banda fence`, its launcher and probe (ADR 0083)
  client/             the window: its folders are under Window, above
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
