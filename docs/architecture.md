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
- **One program, `banda`.** `banda serve` runs the engine. It listens
  on 127.0.0.1 only, on the port it listened on last when that is free,
  and writes its port, a fresh secret, its build id, version, channel,
  process and since when it runs to `engine.json` in its state folder, a
  file only this user can read. A second engine with the same state
  folder refuses to start. `banda --version` names the build id too (ADR
  0086, decision 2).
- **The engine's door** (ADR 0124). Beside the API it listens on a second
  port of 127.0.0.1, where a device comes in by its own key
  (`kernel/src/devices.rs`, below): 22632 for Banda and 22633 for Banda
  Dev, so a pipe set up to it finds it after a restart, or any free one
  when that is taken, and any for a build from a checkout.
  `engine.json` and `banda status` say the port, `door`, and the host
  key, `host_key`. The door serves a file's bytes and a page as the API's
  port does, and answers a plain `GET /` with one line, this machine's
  name and its host key, for a person who checks a pipe with `curl`.
  The API takes no request a proxy carried: one with `Forwarded`,
  `X-Forwarded-*` or `Tailscale-*`, or whose `Host` is not this
  machine's loopback, is refused, so the owner's secret is taken from no
  network. The devices module (`platform/devices`) keeps the host key in
  `host.key` and the devices in `devices.json`, in the engine's state,
  each readable only by its user, and is the kernel's devices port.
  `banda devices list | add | remove` is this machine's console:
  `add --self --key …` pairs this machine's own window, and `remove`
  ends a device's sessions at once.
- **The engine is the machine's, and outlives the window** (ADR 0086,
  decisions 1 and 3). On Linux it is a systemd user unit of the Person's
  session, `<folder>-engine` (`banda-engine`, `banda-dev-engine`; a state
  folder other than the default adds a short hash of it). Any client
  starts it when no engine answers: the window, and every command that
  reaches the engine, then waits for it while its unit runs, for up to
  two minutes, as it opens its Projects first. While "Start Banda at
  login" (`machine.toml`'s `start-at-login`, on by default) is on, the
  default state folder's unit is a file,
  `~/.config/systemd/user/<folder>-engine.service`, enabled with a link
  in `default.target.wants`, so the user manager starts it at login, and
  from boot where linger is on (ADR 0086, step 8); a client writes it and
  starts it with `systemctl --user start`, and the engine rewrites it with
  its own program each time it starts, and takes it away once the setting
  goes off (`engine/src/service/unit_file.rs`). Otherwise, and for a
  test's, a trial's or a checkout's engine, it is started with
  `systemd-run --user`, a transient unit. What the starter's session
  lends it, below, goes in a drop-in under the runtime folder, never in
  the file, so a boot never hands it a display or ssh agent that has
  gone. `banda stop` stops the unit and leaves it enabled. It gets the user manager's environment, never its
  starter's, but for Banda's own `BANDA_*` variables (never an Agent's
  pass or Project), the places its starter set or its XDG folders moved,
  the session's display and ssh agent where the manager lacks them, and
  PATH from the login shell, asked with the manager's PATH, before the
  manager's. The unit has `OOMPolicy=continue` and `KillMode=mixed`:
  SIGTERM goes to the engine, which stops its Harnesses and Terminals,
  and what is left is killed after 15 s. An engine that crashed starts
  again (`Restart=on-failure`), but not after three crashes in a minute.
  The engine raises its soft limit on open files to the hard one, as the
  window's child had it (`engine/src/service.rs`). On macOS it is a
  launchd job in the Person's gui domain, `<bundle id>.engine`
  (`so.banda.dev.engine`), whose plist is in `~/Library/LaunchAgents`
  while "Start Banda at login" (`machine.toml`'s `start-at-login`, on by
  default) is on, so launchd starts it at login, and in the state folder
  while it is off; a client writes the plist where the setting says and
  loads it, and the engine moves it as the setting changes. launchd
  starts it again unless it exited 0; it has `ProcessType` Interactive
  and 15 s to stop on SIGTERM, and raises its soft limit on open files
  from launchd's 256 to 10240. Its plist names no PATH: started by
  launchd, the engine asks the login shell for one and starts itself
  again with it, without launchd's `XPC_SERVICE_NAME`. It stops with
  exit 0 where another engine holds its lock, or at the third start
  after a crash within a minute, as launchd has no limit of its own
  (`engine/src/service/launchd.rs`). Another machine's window starts the
  job too, over ssh, while the Person is logged in at the Mac's screen,
  locked or not, so the engine runs in that session as if started there;
  with nobody logged in, it starts none and exits 75, and that window
  tries again (`engine/src/control.rs`).
  Where neither answers (a Mac with nobody logged in at its screen;
  Windows, until its own; a container; CI), or the unit or the job does
  not start, the engine is this machine's window's child, as before, and
  the log and `banda status` (`child`) say why; so is a checkout's,
  Banda Local, unless `BANDA_ENGINE_AS=service`. Off Linux, another
  machine's window never gets the engine as its child. `banda status`
  says whether it runs, since when and its build; it names its unit, or
  job, only as that unit's own process. `banda stop` is Quit Banda: it asks first while
  Agents work (`--force` does not), refuses an Agent's pass, and stops
  an engine that does not answer too. An engine of another build, whose
  protocol this one does not speak, says so, and runs until Banda quits;
  an update stops the engine as it restarts the window, until the engine
  updates by itself (plan step 6).
- **The bar outside the window reads `banda status`** (ADR 0086,
  decision 4; `engine/src/status.rs`). It prints one JSON line,
  `EngineStatus` in the contract: whether the engine runs, its version,
  build and channel, what this machine is, and `agents`, who works and
  who waits on this machine alone, by the agents module's rule
  (`apps/agents/engine/src/counts.rs`), the bar's counter (ADR 0035) as
  the window has it, over the Projects the window shows: a Thread asleep
  under a Later or archived is not counted. `working`, `waiting`,
  `asking` and `done` are the bar's counts of those names (`[bar]
  counts`): `asking` is what asks its Person or failed, `failed` is how
  many of those failed, which turns it red, and `waiting` is `asking`,
  `done`, and what woke from Later by itself while its Person has not
  seen it wake, which has its own row `state`, `woke`, and no count of
  its own. `threads` are the rows of the panel, what waits first, the one
  that waited longest first, then what works by when it began. Where it
  cannot read what the engine lists, as from an engine of another build,
  it leaves `agents` out rather than say nobody works. It starts no
  engine: with none, `{"running":false}` and what the machine is, exit 0.
  `--follow` prints the line again on each change, the current one first:
  it reads a Project's list again on each fact that may change it, and
  the Projects every 2 s, and counts again as a Later's time comes. It
  runs until its reader goes, or with `--with-parent` until its stdin
  closes, as the window's children do:
  a bar that starts it so keeps stdin open (Quickshell's `Process`:
  `stdinEnabled`). With no engine, and once one goes, it says so and
  looks for one each second, so a widget keeps one process, shows no
  icon, and picks Banda up as it starts. Under an Agent's pass, `banda
  status` leaves `agents` out, and `--follow` is refused. A line, folded:

  ```json
  {"running":true,"protocol":1,"version":"0.4.0-dev.131","build":"dfbad2fa…",
   "channel":"dev","since":1794266364499,"pid":3565498,"unit":"banda-dev-engine",
   "fence":{"fence":"holds","layers":["namespaces","landlock"]},
   "system":"Omarchy 4.5.0","named":{"name":"arc","icon":"laptop"},
   "agents":{"working":1,"waiting":2,"asking":1,"failed":0,"done":1,"threads":[
     {"thread":"01a1c29c-…","title":"Run the tests?","project":"01a1c29c-…","project_name":"banda","state":"asking"},
     {"thread":"01a1c29c-…","title":"Tidy the docs","project":"01a1c29c-…","project_name":"No Project","state":"done"},
     {"thread":"01a1c29c-…","title":"Port the menu","project":"01a1c29c-…","project_name":"banda","state":"working"}]}}
  ```

- **It keeps its machine from idle sleep while its Agents work**
  (ADR 0097): from the first Turn that starts, in any Project, until 10
  minutes after the last one ends, and while on power if the Person set
  `machine.toml`'s `awake-plugged-in`. Each running Turn holds one of the
  kernel's counted guards (`kernel/src/working.rs`), and the engine holds
  one hold by the system's own means: a power assertion on macOS,
  logind's `idle` and `sleep` locks on Linux, none yet on Windows
  (`platform/machines/engine/src/awake.rs`). It never changes the
  system's power settings, and the system lets the hold go as the engine
  ends.
- **It knows how the last run left, and is whole before clients find it**
  (`engine/src/run.rs`). `run.json` in its state says on which port the
  engine listens, and how it left: `stopping` as soon as it is asked to
  stop, as it opens too, and `stopped` once it has. An engine that finds
  neither word keeps a crash as a Problem before it opens anything; one
  killed while it stopped as asked left as asked. On macOS, where no unit
  stops what an engine leaves, the engine keeps a note of each Harness's
  program and Terminal while it runs (`children.json`), and the next
  one, unless the run before said `stopped`, stops what is left of them
  before it starts anything: what is still in their process groups (a
  Terminal's: its session) and under them, never the window, and none of
  a note whose number another process has taken. TERM, up to 3 s, then
  KILL (`engine/src/children.rs`). An `engine.json` it
  finds is the run before's, and goes as soon as it takes the lock. It
  opens every Project, with its modules' migrations and the outbox's
  recovery, and only then writes `engine.json`, so no client finds it
  half started. A client waits 3 s at most for the engine it names to
  say welcome.
- **The look is the window's machine's** (ADR 0007). `banda look`
  reads Omarchy's theme, Hyprland's windows and `~/.config/banda/look.toml`
  and prints the CSS variables as JSON, with no engine; `--follow` prints
  each change, and `check` names a broken file's line. The theme is
  `platform/theme`'s: where a theme is found and what it extends, its
  palette worked into tokens, its fonts, the wallpaper and Hyprland's
  windows; `platform/look` reads a theme's shape and lays the Person's
  files over it (ADR 0100). A theme is a `theme.toml`, light and dark
  inside (ADR 0080); Omarchy's `colors.toml` still reads as colours.
  The look's `[sound]` says which sounds the window plays (ADR 0009) and
  its `[notify]` where the window tells of a call (ADR 0011); the look's
  layers apply to them as to every other key. The sidebar's arrangement
  comes with it (ADR 0008): `~/.config/banda/sidebar.toml` over the
  defaults. The view menu writes its keys into the file through
  `banda settings set`. The browser's
  `~/.config/banda/browser.toml` comes with it too (ADR 0013), and the
  browser's switch and its pins ask the desktop to write `tabs` and
  `pinned` into it, through `banda settings set`; its `blocker` turns
  the desktop's ad blocker (`apps/browser/desktop/src/blocker.ts`) on and off.
  The agents module's
  `agents.toml`, what Enter does in the composer, comes with it the same
  way (ADR 0016), and so does the Tiling's `tiling.toml` (ADR 0127,
  decision 4): the Flow, a column's widths (`[columns]`: a new column's,
  one alone, the steps, a Pane's heights, stack or Deck), and rules by
  kind of Pane, each a new column's
  width and where the kind opens when no one named a place. The
  `workspaces` module reads that file as a Pane opens, so `placing`
  decides by it for the window, an Agent and `banda` alike; the page
  takes the same file from the look for what it draws ahead. The file's
  `flow` says how the engine places, `free` or `row`; Solo is a view of
  the row and each device's own, kept in the window's storage and written
  to no file, and `flow = "solo"` is the Person's default, for a device
  that has not chosen (ADR 0127, decision 3; `tiling/flow.ts`). The Flow
  was `agents.toml`'s: what that file still says is read while
  `tiling.toml` does not say it, and the writer writes it in the
  Tiling's file under either name (ADR 0069 grace). The widths were
  `look.toml`'s `[columns]` and moved the same way; `look.toml` keeps
  what is a screen's and a mouse's, `center`, `min` and `snap`, and the
  page draws by the two joined (`columnsOf`, `client/web/src/look.ts`). The settings Pane writes every file through `banda
  settings set` too; nothing else the page asks of Node writes a file. A Pane reads its part of the look
  through `@banda/ui/lib/look`. Each file says whose copy it is, and each
  of its top-level keys that is another's (ADR 0101, decision 3), in its
  `SettingsFile` and as `x-class` in its schema: the shared, the device's,
  or the machine's. Settings says it under a file's rows, with where the
  file is (`client/web/src/settings/whose.ts`).
  The machine's part (`machine.toml`, `harnesses.toml`, `sharing.toml`,
  `agents.toml`'s `[start]`, `browser.toml`'s `[agents]`, `files.toml`'s
  `pinned`) is read through that machine's engine, `keys.settings_read`,
  and `keys.settings_changed` says as it changes, so a window of another
  device shows that machine's; nothing else of a file leaves its device
  (ADR 0106, decision 7). Settings shows it under "Settings for: This Mac
  / arc", a switch under the crumb in each section with a part of the
  machine's but Machines, set to the machine of the Pane it was opened
  from (`SettingsArgs.on`). General, Projects and Problems switch too:
  they show what a machine's engine keeps, in no file (`Section.machine`,
  `switches`; ADR 0124). The machine's rows read through
  `useMachineSettings` and write through that engine (`keys.settings_set`,
  `throughEngine`), the section's own Body and Foot take that engine and
  act for that machine through the router, and the rest say "on this
  Mac": so Look into it on arc's Problem starts its Thread on arc, and
  Locate, which picks with this device's picker, says "Not on arc yet".
  While that machine is away its pill shows
  and a change is refused at once; its file shows its path there, with
  Copy, in place of Open file. Files on arc reads and pins arc's
  `pinned` the same way (`apps/files/pane/src/pins.ts`).
- **The Banda skill is text for Agents** (ADR 0012). `banda skill`
  prints its core, `banda skill <topic>` a topic, and
  `banda skill --export <folder>` writes an Agent Skills folder. Each
  part of Banda writes its topics in a `skill/` folder beside its code,
  and `platform/skill` gathers them when it is built; a topic may include a
  file the part ships, such as `platform/look/sidebar.toml`.
- **An Agent reaches Banda through `banda mcp`** (ADR 0019). The agents
  module hands it to every ACP session it opens (`session/new`, `load`
  and `resume`), as a stdio MCP server named `banda`, with two
  variables: `BANDA_TOKEN`, a new pass for the session's Agent, and
  `BANDA_ENGINE`, where the API listens. It is a pipe: MCP on stdio, one
  JSON-RPC message per line, written on `serde_json`, and the engine's API
  on the other side. Its calls name no Project, so they run in the pass's.
  Its tools are `projects.tools`, read once as it connects: the module
  methods marked `tool` in their `methods!` tables. It adds `skill`,
  which it answers itself from the Banda skill. Its
  `instructions` are the skill's brief (`platform/skill/BRIEF.md`), under
  the 4,096 characters Claude Code keeps of them; the core and its topics
  come through `skill` (ADR 0037, decision 7). Each tool call carries a
  command ID derived from the session, new each time `banda mcp` starts
  or its client says `initialize`, and the request's ID
  (`CommandId::derive`). A tool whose method is a command keeps a receipt
  under it: a request sent again, by its client or by `banda mcp` as it
  connects again once to an engine that broke off, gets the first answer
  and runs nothing again (ADR 0082, decision 4). Any other tool, a
  `call`, keeps no receipt, so `banda mcp` never sends it again: one the
  engine broke off on is answered that it may have run, and the Agent
  looks before it calls again. Each tool's kind comes in
  `projects.tools`, from its line in `methods!`. A refused or malformed
  call is a tool result marked `isError`, with the refusal and that
  nothing was done; only an engine that does not answer is a JSON-RPC
  error.
- **An Agent's `banda` acts under its pass.** The shells an Agent runs
  commands in get `BANDA_TOKEN` and `BANDA_ENGINE` too. Each Harness
  process carries a pass its Agents share, of an Agent no one Thread
  names, made once per Project and Harness entry in a run of the engine
  (it outlives the processes, until the Project closes): in its
  environment, and for Codex in `CODEX_CONFIG` as
  `shell_environment_policy.set`. A Harness that takes variables for each
  session's shell gives a Thread's session its own pass over it, the one
  its `banda mcp` has: Claude Code's adapter, through
  `_meta.claudeCode.options.env`. The kernel walls each pass in its
  Project. With `BANDA_ENGINE` set, every CLI command that connects to the
  engine says hello there with the pass in `BANDA_TOKEN`; it does nothing
  without one, nor when `BANDA_STATE` names another engine, and a pass the
  engine does not know is refused in words that say so. A pass outlives
  an engine restart (below), and the engine listens where it did, so the
  address in `BANDA_ENGINE` stays. The pass says who
  calls, and is no wall: what runs in the shell runs as the Person (ADR
  0019, decision 2), as the mode menu says of Full access.
- **The CLI prints JSON.** `banda call <method>` prints `{"ok": …}`, as
  `banda project add <path>` does with the Project it added.
  `banda follow` prints events, one per line. When the engine refuses
  the call, the hello or the follow, the CLI prints
  `{"error": {"code", "message"}}` and exits 1. When no engine answers,
  or the CLI cannot do its part, it says so on stderr and exits 2; a call
  that broke off names the command ID that repeats it safely.

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

## Links in a Thread

An HTTP(S) Markdown link opens in Banda through `browser.open`, in the
source Thread's Project (ADR 0051). Ctrl+click uses the existing desktop
route to the system browser. The Thread supplies the opener to the UI's
Markdown renderer; it names no browser module. A Thread in its own window
relays the action through the existing window bridge. Named links show
their destination's host; bare URLs are ellipsized visually, keeping the
full text and `href` for copying. Local-file links are a separate contract.

## Media in a Thread

Markdown in a Thread shows local images, video and audio (ADR 0037,
step 6). The agents Pane supplies the markdown renderer a resolver for
its Project. It asks its session, the engine of the machine that has the
Project, for a token for that path (`bytes.issue`, `media`), which the
engine gives only for a picture, a video or a sound: a reply's paths are
an Agent's to write. The URL is made as every byte URL is (`fileMint`),
so an arc Thread's pictures are arc's (ADR 0106, step 4c). Nothing plays
automatically. Images open larger on a
click; a missing or unsupported file stays a link.

The bytes behind those URLs are the engine's (`platform/bytes`; ADR
0106, decision 6). A Pane asks the engine of its session for a token,
`bytes.issue {path, use}`, with the right and the reach `files.read`
asks, and one function in `@banda/ui/hooks/use-file-url` makes the URL
that names it: `app://files/<token>`, or `app://preview/<token>` for a
page. Main relays those two hosts to the engine's `GET /b/<token>` and
`GET /p/<token>` (`relay` in `@banda/desktop-kit`), passing on only the
range and what tells a frame's navigation from a page's fetch, and
gives back the engine's answer as it came: main reads no file and finds
no Project's folder (`client/desktop/src/architecture.test.ts` holds it
to that). A token serves the one file it was given for, by its real
path, device and inode, through no link, for an hour or until the
engine restarts; `useFileUrl` keeps the Pane's path, never the URL, and
asks again before the hour ends and once the engine's boot changes.
Byte ranges let players seek without reading the whole file. The engine
serves any file, typed by its extension: text as plain text, so an HTML
file never runs, and what it does not know as bytes, each never sniffed
and sandboxed. No frame shows the byte host. The page reads its ranges
with `fetch`, as a PDF is read: the `app` scheme allows CORS, the engine
answers any origin, and the page's `connect-src` names the host.

Main also relays `app://files/<machine>/<token>` and
`app://preview/<machine>/<token>` to the engine of the machine they
name, `<machine>` being this device's name for it in `hosts.toml`,
through its forward as it listens now, so a link goes on working when
ssh comes back on a new port (`client/desktop/src/bytes.ts`). Such a
request waits while its machine is away, as a read may, and goes once
it is back; it never has a refused machine tried again, which only the
Person opening it does. The page knows which machine each session is:
`KeptHosts` hands each host's engine to `relayBytesFrom` with its name
as it makes it, and `bytesUrl` puts that name in the URL, which is never
kept (ADR 0106, law 2). So Files' previewers, Quick Look and a Thread's
media draw another machine's files from that machine. "Save a copy to
this Mac" is the window's `file.save-copy`, on a row of another
machine's in Files: the file's session gives the token, and the device's
`save_file` (`files.save` on the bridge) shows the system's save
dialog, then fetches the bytes by that URL and writes them whole where
the Person picked. It goes now or says why not, so a machine that is
away is told at once.

A page among the Person's files, HTML or an SVG document, is shown by
the sandbox host, `app://preview` (ADR 0073, decision 5), by a token
given for a page. The engine answers a frame's navigation only, never a
page's fetch nor a picture (Electron's handler hears no `Sec-Fetch-*`,
so a navigation is what asks to be upgraded and names no origin), and
its response sandboxes the page whatever the frame says: `sandbox
allow-scripts`, never `allow-same-origin`, with `default-src 'none'`,
pictures inline or from the byte host, inline styles and scripts. The
page's `frame-src` names it beside the modules' hosts.

Mermaid code fences render as SVG through `@streamdown/mermaid`, with
copy, zoom and fullscreen controls and the look's light or dark scheme.
The plugin keeps Mermaid's strict security mode. KaTeX renders inline
`$…$` and block `$$…$$` math through `@streamdown/math`; its CSS and fonts
ship with the app. Both plugins use Streamdown's streaming parser and
error handling, alongside the existing code and media renderers.

Tool results keep their images as `ToolContent::Image` metadata. The ACP
adapter passes image payloads only to the transcript, which validates
and writes their bytes through the existing image store before committing
the item and its fact. For Codex ACP, which sends MCP images in
`rawOutput.result.content`, the adapter reads that known image envelope
when standard display content is absent. Invalid images become text beside the other
result parts. The tool line fetches images through the Thread's shared
image reader only when expanded and opens the same preview as message
images. Sweeps retain images still referenced by a fork after a rewind.

## Checks that hold the shape

- **Architecture tests.** The kernel names no module, no module reads
  another's tables, and a Pane imports only the API, `@banda/ui`, React
  and its icons, and the core only as `@banda/core/react`; the
  terminal's Pane also Ghostty. Beside the kernel's test
  (`kernel/tests/architecture.rs`), two lists that only fall hold where
  the platform's Rust still names an App and where an App's names
  another, by file and count, and a third, in `engine/src/apps.rs`, the
  App crates another crate still depends on, all of them the settings'
  (ADR 0062). The count reads names as written; a word that only looks
  like an App's, as the program `git`, is listed apart with its reason.
  No code of the engine makes a process
  but `banda-environments`, and the places named in its test, each with
  how many and why, that ask the host about itself or keep Banda's books
  and run nothing of a Project's (ADR 0084, decision 4); no code uses
  ACP's agent that starts its own. Each place that makes a `Program` is
  named there too, with whose it makes and why (ADR 0083, decision 1).
  In the window (`client/web/src/architecture.test.ts`), only
  `modules.ts` and the bridge's table name a module's package, and
  nothing more animates a size or a place (ADR 0088). Its tests find the
  Apps' and platform parts' folders by their `app.toml` through `parts`
  (`@banda/ui/testing/architecture`), which fails when it finds none. The
  look check (`client/web/src/look.test.ts`) reads the same files that
  draw, stylesheets too, with `look` (`@banda/ui/testing/look`): a
  colour, corner, type size, shadow, layer or length off Banda UI is
  refused, but for the cases its list holds by group, each with its rule
  and its reason, a list that only falls (ADR 0113). Of
  ADR 0087's checks, three ratchets that only fall hold what the Tiling
  imports of the Window, the App strings in the Window, the Tiling and
  the sidebar list, and a line ceiling on the Window's root (decisions 1
  and 5); what the sidebar list's components still take as code is
  listed, none of it a Project's or a Thread's verb, and the list pins
  no Project and writes no `agents.toml` or `tiling.toml`, as it runs
  the actions by id
  with the `run` only the Window gives (decision 11); a mark's
  rank is read only to pick the loudest, on the lines listed (decision
  8); and the calls part reads no page and, of the Tiling, imports only
  its model (decision 9). The parts the Window draws on every move, each
  Tile and its Pane, each Strip and the widgets, stay memoized (ADR 0088,
  decision 7). The Window and the Tiling read `window.banda` only in
  `boot/desktop.ts`, and what else in the page reads it, its own code,
  the core's, `@banda/ui`'s and the modules' Pane parts, the test lists
  by file, a list that only falls (ADR 0089, decisions 2 and 11). The
  core imports only itself, the contract and, in its bindings, React,
  reads no device, names no App and keeps no state at a module's top
  level but the constants listed; only the Window makes and gives the
  hosts and gives the machines; the desktop imports nothing of the page,
  which takes the bridge's table only as a type (decisions 1, 4 and
  11). Main runs an effect only in `main.ts`, on its runtime, and in the
  two places `client/desktop/src/architecture.test.ts` lists with their
  count and reason (ADR 0020).
- **Module tests** run through the module's interface: commands go in and
  events come out. Nothing past the interface is mocked.
- **Checkpoints** (ADR 0014, decision 3). With `BANDA_CHECKPOINTS` set,
  as `scripts/check.sh` sets it, the agents module's tests write each
  Thread they read: its first view, the facts after it, and its last
  view. The Pane's tests apply those facts to the first view and must get
  the last one, what a Person may do with each turn (`can`) included.
- **Adapter tests** run the real engine. Only the Harness's transport is
  replayed: the fake agent plays a recorded conversation
  (`FAKE_AGENT_REPLAY`).
  - A test has a Harness entry `record` what it and Banda say to each
    other, one ACP frame per line. A Harness list cannot ask for it: a
    recording holds everything said, a secret typed into a form too.
  - Each frame the engine sends takes the next recorded one of its
    method, or the answer with its ID, and must say the same, `initialize`
    aside. The Harness's frames after it follow. A frame that differs
    fails the replay, so a wrong answer to a Question fails its test.
  - Real Claude Code and Codex conversations live in
    `apps/agents/engine/tests/recordings/`. An ignored test records
    them again, a paid run on the Person's own sign-in, when an adapter
    changes.
  - A recording leaves out who is signed in, the Person's home folder,
    and the skills, plugins and agents a Harness lists as its own.
  - T3 Code's Claude and Codex fixtures record other protocols (Claude's
    SDK messages, Codex's app server), so they do not replay here.
- **The fence's tests** make real namespaces. Where the system refuses
  them, as devbox's CI containers do, each says why and skips;
  `scripts/check.sh` outside CI sets `BANDA_FENCE_TESTS=require`, so there
  that skip fails. CI's `fence` part, on GitHub's Ubuntu runner, sets
  `BANDA_FENCE_TESTS=all`: every test runs, and one that would skip for
  anything it lacks (namespaces, Landlock's scopes, bwrap) fails.
- **End to end.** Playwright drives the Electron window against a scripted
  fake ACP agent. Screenshots let Agents check the UI themselves.
- **Speed budget.** A window test measures start-up time, memory and input
  latency, and writes them to `client/desktop/test-results/speed.json`. Its
  budgets are loose: they catch a regression.
- **`scripts/check.sh`** runs every check in the order a failure is
  cheapest to find. It also fails when `cargo test` rewrites the generated
  TypeScript types, so the window never builds against stale ones.
