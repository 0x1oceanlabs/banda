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

- **The page reaches the engine only through the API.** Electron main gives
  it one thing: the engine's address, through `window.banda.engine()` in
  a sandboxed preload. That address is the engine's door (ADR 0124,
  decision 5): main pairs the window with its own machine each time the
  engine starts, by this device's key, kept in `device.key` in Banda's
  state for its owner alone (`client/desktop/src/key.ts`), and hands the
  page the door, the device and the host key. It signs the page's `hello`
  to that door (`window.banda.sign`) and nothing else, so the page holds
  no key, and no owner secret where its engine has a door and paired the
  window. An engine with no door yet, or one that would not pair, is
  reached by the secret, as before, and main's log says so. The page is served from `app://banda` with a
  strict Content Security Policy. It cannot navigate, open windows or get
  permissions, and links open in the browser. It may run WebAssembly
  shipped with it, which Ghostty draws terminals with.
- **The window reaches the engine; it does not own it** (ADR 0086,
  decisions 1 and 3). Main runs `banda start --with-parent`, which starts
  the engine when it does not run, prints where it listens, and follows
  it while the window is open; where the engine is the window's child,
  it is the engine, `serve --with-parent`, and its stdin closing stops
  it. When Quit Banda stops the engine, here or by `banda stop`, the
  program ends with code 0 and the window quits. Stopped as asked by
  anything else, as its unit stopped by hand, it ends with code 3: the
  window stays, its Panes say Banda is stopped on this machine, and
  Start starts it again (ADR 0124, decision 9). When it crashed, main
  starts it again (waiting up to 10 s between tries). Closing the last
  window only closes it: the engine and its Agents go on. Quit Banda
  (`banda.quit`, Ctrl+Q, but for a terminal's program, whose key it is
  there) asks first while Agents work, then main runs `banda stop
  --force`. Quit asks in one set of words everywhere, the page, macOS's
  dialog, the menu bar and `banda stop` alike: "2 Agents work on this
  Mac" (this computer, off macOS) / "Quitting Banda stops them too." /
  "Quit anyway" or "Cancel", Cancel the default; with one Agent, "An
  Agent works on this Mac" / "Quitting Banda stops it too."
  (`engine/src/quit.rs` writes them for the contract's `quitAsks`). On
  macOS the app stays, and its engine, a launchd job, outlives it
  (`client/desktop/src/closing.ts`): closing the main window hides it,
  its page left to call the Person and sound, and its Panes' own windows
  close; the menu bar's Open Banda or a row of its menu, or Banda opened
  again, shows it. In the page ⌘Q is Quit Banda's own key. The menu
  bar's Quit Banda, the app menu's and the Dock's Quit, and ⌘Q where the
  page leaves the key (in a terminal, over a dialog, with the window
  hidden), run `banda stop`, which stops the engine where no Agent
  works; where some do, the page's Quit Banda asks first while its
  window shows, or a system dialog does when no window shows, the page
  crashed or loads, or the Person quits again within 10 s. A logout,
  restart or shutdown quits without asking.
- **On macOS Banda lives in the menu bar** (ADR 0086, decision 4; the
  accepted mock, mac-menubar-v1). With no window open, Banda.app keeps
  running with no Dock icon, only its icon in the menu bar: the Dock's
  icon is there only while a window is open, shown or minimized, and
  stays as it is while Banda is hidden (⌘H). The icon is Banda's mark, a
  template in the menu bar's own colour: its hat a square at rest, a
  circle while Agents work, a triangle lit in orange while one asks the
  Person or failed, happy eyes while what waits is done, asleep and dimmed
  while the engine does not answer; beside it one number, how many wait
  for the Person, else how many work. Its menu, a plain macOS menu built
  again as its items change, never while it is open, lists this Mac's
  Threads, what waits first, then
  what works, each row opening its Thread in the window (the page's
  `pane.pick`); then Open Banda, the version, and Quit Banda (⌘Q while
  it is open). All of it comes from one child of main, `banda status
  --follow --with-parent`, started again when it dies (`status.ts`,
  `menubar.ts`, `tray.ts`; its icons drawn by
  `client/desktop/icons/menu-bar/draw.mjs`). An engine with no app opens
  Banda.app hidden, by its path (`open -g -j <app> --args --hidden`),
  which then shows no window and no Dock icon, only the menu bar's; it
  never opens an app that runs, nor one the Person quit or ended with
  Force Quit, which leaves no crash dump newer than the app's lock and
  than the engine's last look that saw it run (a page's or the GPU's
  dump from before is not the app's), and
  stops trying after three opens with no app that ran five minutes
  (`engine/src/service/app.rs`). Linux and Windows have no menu bar icon
  yet (`hasMenuBar`). `banda look --follow --with-parent` stays the window's
  child. Both are Effect services in main (`Engine`, `Look`; ADR 0020),
  started by one runtime and stopped when it is disposed. The client
  then reconnects and follows on from the last event it delivered, so a
  Pane sees no gap.
- **A packed Banda runs its own copy of `banda`** (ADR 0086, decision
  2), never the one inside its AppImage or its app, whose folder may go
  while the program runs. Main copies it into `<data>/engine/<version>/`,
  beside what its `--version` said, its line tables (`banda.dSYM` on
  macOS, `banda.pdb` on Windows), the ACP adapters the app carries, and on
  Windows the Node they run on there (`node/`), runs the copy once with
  `--version`, and renames it into place only when it says the same
  version and build id (`program.ts`). A copy in place is run again while
  it and what it carries are as long as the packed ones and it says the
  same, and one that goes while the window runs is made again before the
  next run. The last two versions are kept. On Windows, where nothing
  tells what runs, an old copy is renamed aside and removed there, its
  programs first; one Windows will not move, or whose program will not
  go, stays (ADR 0090, decision 5). A copy that cannot be made leaves the
  engine where it was packed, and a Problem says why. A `banda` that a
  package manager owns, as the AUR's, says so in `package-type` beside it
  and runs where it was put; a checkout's runs where cargo built it.
- **The engine updates itself** (ADR 0119), with or without a window:
  the machine-scope module `updates` (`platform/updates/engine`) looks
  at its channel's releases a minute after the engine starts, then
  hourly, and on `updates.check` (`banda update --check`). Each look
  and each take runs in `banda-update`, the updater's own program
  beside the engine's (ADR 0131, decision 2): the engine runs
  `banda-update check` or `take <v>` with the Banda it is for, and takes
  each line of JSON it prints, an `UpdateState`, into its own; a copy
  that carries none looks in the engine's process. Where the engine is
  its machine's service (its systemd user unit or launchd job) and takes
  updates, it starts `banda-update run` as a service of its own beside
  it, `<folder>-update` on Linux (`systemd-run`, `Restart=always`),
  `<app id>.update` on macOS (`launchctl submit`), in place of one that
  ran: that service looks a minute after it starts, then hourly, keeps
  each look's state in `<data>/engine/state.json`, which the engine
  follows, and guards a move (`daemon.rs`, `guard.rs`). A copy the engine
  moved onto that does not answer on its version, in `engine.json`,
  within two minutes is listed in `<data>/engine/bad`, never taken or
  moved onto again, and the copy it moved from starts again with its
  `banda start`, after `systemctl --user reset-failed` of a unit that
  gave up. Banda Dev
  reads every Dev, Banda only a Stable (`feed.rs`); the window's app
  reads the release it found newest. A release carries an engine feed,
  `<dev|latest>-engine-<linux|mac>.yml`, naming one bundle,
  `<folder>-<version>-engine-<os>-<arch>.tar.gz`, with its size and
  SHA-512. The module downloads the newest above the running and the
  ready one, following GitHub's one redirect only to its storage hosts
  (the HTTPS client follows none), checks size and hash, unpacks it into
  `<data>/engine/.<version>.new/`, runs its `banda --version`, which must
  say that version, writes `version`, and renames it into
  `<data>/engine/<version>/`, the window's layout. The two newest copies
  stay, and the running one. It takes nothing for Banda Local, where
  `package-type` sits beside the program, with `BANDA_UPDATES=off`, or
  with `updates = "off"` in machine.toml (default `when-idle`). The
  stream `updates.state` says what it runs, the newest found, a take's
  progress, what is ready, what that waits for and why not (`banda
  update --follow`).
- **The engine moves onto a ready copy once nothing runs** (ADR 0119,
  decision 3; `platform/updates/engine/src/restart.rs`): no Turn runs
  (the kernel's `Working`), no terminal is open, as a restart still ends
  them (#462), and no key reached one for ten minutes (the kernel's
  `Hands`, which the terminal module tells: the keys typed into this
  machine's terminals are the Person's one input the engine receives).
  One pure function, `restart::next`, decides from those, machine.toml's
  `updates` and how the engine moves; `when-idle` moves by itself, `ask`
  waits for the Person, `off` neither takes nor moves. `updates.state`'s
  `waits` says for what: `turns`, `terminals`, `typed_until`, `person`, or
  `restart`, why it does not move by itself. Restart now
  (`updates.restart`, `banda update --now`) asks first while Turns run,
  in Quit's words (`quit::restart_asks`), and moves anyway with `force`;
  open terminals and keys hold it not. The mechanism is the engine's
  (`engine/src/moving.rs`): the module asks through `Restart`, the engine
  stops as a TERM stops it, and once its runtime and the children that
  die with it are gone, ends what is left in its unit's cgroup (TERM, then
  KILL after 15 s, as systemd's `KillMode=mixed` does) and `exec`s the
  copy's `banda` with its own arguments: the same process, so the same
  unit or launchd job and one holder of the state's lock throughout. A
  transient unit's program cannot change, so a crash starts the copy the
  unit was started with, which moves again once idle; a unit from its
  file names the new copy once it runs, as the engine rewrites the file
  as it starts, so a crash or a boot starts that. The window's child,
  and Windows, do not move: they restart with Banda.
  `banda update --version <v>` (`updates.take`, Manage) puts that
  version in place, an older one too, keeps it in `<data>/engine/chosen`,
  and the engine moves onto it by the same rule; the looks take nothing
  above a version chosen, and `--version newest` drops the choice. A copy
  older than this step neither reads `chosen` nor moves by itself.
- **The window only swaps its own app** (ADR 0119, decisions 2 and 4;
  `platform/updates/desktop`, `@banda/updates-desktop`). It follows its
  engine's `updates.state` and, at each look the engine made, reads the
  release the engine found newest with electron-updater: that release's
  app update file, naming only this app's files, and the notes since the
  running version (`releases.ts`). It downloads at once and installs on
  Restart, or at the quit while a look at most an hour old still offered
  it. "Check now" is the engine's `updates.check`. Where the engine
  takes nothing (`off`), the app takes nothing. The restart stops no
  engine: the engine and its Agents go on, as when the window closes,
  and a window's packed copy put in place beside the running engine
  (`program.ts`) is ready to it at its next look, which the window asks
  for at once when the engine runs another version than the app. One
  rule, the engine's: the newest copy in place wins, whoever put it
  there, and the engine moves onto it once nothing runs. An engine older
  than step 3, which answers no `updates.state`, leaves the app as it is.
- **A machine with no Banda is set up by `scripts/install.sh`** (ADR
  0119, decision 8), one POSIX sh script, published with each release
  and packed in the app's resources: it puts the engine bundle of a
  version in place as the module does, as the Person, and says each step
  on a line whose first word is what it is. Add → Connect runs the app's
  copy over ssh (`hosts.ts`, `installCommand`, the script in base64 so
  any login shell takes it), `--check` first, then for real, and draws
  its lines as steps.
- **What still runs from inside the AppImage** is Electron's, and, for an
  engine that is the window's child, the Node the ACP adapters run on,
  the window's Electron. An engine started as the session's service from
  an AppImage is not told that Electron, which goes as the AppImage
  stops. The adapters' files run from
  the engine's own copy, which carries them. A macOS app's copy also has
  `electron` beside it, which names the app's Electron, so an engine
  started with no window runs the adapters on it; an AppImage's copy
  names none, as its Electron goes when it stops, and such an engine
  looks for a `node` on PATH. On Quit nothing of it is left. When main is
  killed, `chrome_crashpad_handler` and the network service die with
  SIGBUS as the AppImage's folder goes; `banda` does not. That is
  Electron's helper, kept apart from the engine (seen on 2026-11-07).
- **A Pane** is a `PaneKind`: a kind, the module it needs, a title, an
  icon, optional start args, what its module lets go of when it leaves
  every workspace (`closed`), and a component. The component gets the
  engine, its Project, its args, whether it has the focus, `open`,
  `update`, and `close` for its own tile. `open` opens a Pane of the same
  Project unless it names another. A Pane's args are all its state; the
  workspaces keep them, each Pane with its Project.
- **A Pane reads a view, then follows.** `useLive` reads the view once,
  applies each event after its `at`, and reads again when the engine says
  so. Events that arrive within one frame render once.
- **The Window** (`client/web/src/window/`, its root `Shell.tsx`) puts the
  areas together: the Bar on top, the Sidebar docked on the left, the Top
  layer over them (the Banda menu, the Drawer, Quick Look, dialogs and
  toasts), and the middle, which it gives to the Tiling
  (`client/web/src/tiling/`): the workspaces, or the overview over them
  (ADR 0005, decisions 7–9; ADR 0087). A popped-out Pane's window is the
  Window's too (`window/Popped.tsx`). The Window routes the keys
  (`window/keys.ts`). What lies over what in the Top layer, which part
  an Esc takes away and where the keys go back as it goes is one stack,
  `window/top/` (ADR 0110, step 3). The Window reaches the desktop only
  through the device's desktop adapter, `boot/desktop.ts`, by
  `boot/index.ts`; at last the adapter is the only reader of
  `window.banda` (ADR 0089, decisions 2 and 11). What every client shares is `client/core` (`@banda/core`,
  and `@banda/core/react` for what reads it from React): Here and the
  store the Window keeps it in, the store read by selector, what an
  action runs with, the words the page and the desktop say to each
  other, and the machines the Window reaches (`KeptHosts`, with the
  machines a new Thread starts on), which take the names this device
  remembers from the Window. This machine is one of them, with the
  same rule while its engine is out of reach (ADR 0124). It has no DOM, reads no device and names
  no App (decision 1); an App or a platform part takes it only as
  `@banda/core/react`.
  The Window may import the Tiling; what the Tiling still imports of the
  Window, the architecture test lists, and the list only falls.
- **The workspaces** follow niri (`client/web/src/tiling/model.ts`); every
  change to them is a pure function.
  - They sit one under another, and there is always one empty workspace
    at the bottom; an empty one in the middle goes once the Person leaves
    it. Each one is a Strip: columns a third, half, two thirds or all of
    the screen wide, scrolling sideways, each holding Panes one above
    another. The focused column always comes fully into view.
  - A workspace holds Panes of any Projects; a Pane's header names its
    Project when the workspace mixes them.
  - Opening a Pane that is already shown goes to its workspace and focuses
    it. Opened with no place, a Pane takes the place of one of its kind on
    the opener's workspace, or a new column right of the opener.
    Ctrl-click (⌘ on a Mac) always opens a new column.
  - Every workspace stays drawn, so its Panes keep running; only the
    current one takes clicks and keys.
  - A touchpad's swipe is read as niri reads one (`tiling/swipe.ts`).
    Each swipe goes one way, picked as it starts. Up and down belongs to
    the Pane under the pointer, and the Strip never drifts sideways under
    it. A sideways swipe moves the Strip with the fingers. Where it ends,
    the column most in view takes the focus and comes whole into view.
    Over something that scrolls sideways itself, such as a wide table,
    the swipe is that Pane's unless Alt is held. With Alt held, the wheel
    is the window's, and one swipe up or down moves one workspace.
  - A Pane leaves when it closes or its place shows another Pane, or the
    same with other args; moving it to another column or workspace draws
    it again without that.
  - The workspaces live in the engine (ADR 0005, decision 3; ADR 0025):
    the `workspaces` module of this machine (`platform/workspaces/engine`)
    keeps the arrangement and its rules, and says each change in one
    event that holds it whole. The window keeps only the view, in its
    storage (`$BANDA_STATE/window` when that is set), and draws the two
    together (`tiling/arrange.ts`). Solo is part of that view, and so is
    the row `Alt+M` shows for a while: neither writes a file or the
    arrangement (ADR 0127, decision 3). An empty workspace the Person
    left goes by `workspaces.tidy`, which a window sends by itself only
    while it is in front, so a window behind never takes away the one
    the Person looks at on another device. A key works out its change with
    `model.ts` and sends it as one command; the window draws the event
    that comes back. Changes go one after another through one queue
    (`tiling/useTiling.ts`), each worked out from what the last one drew,
    so keys pressed quickly act as they would slowly. A Pane's new args
    are drawn at once and kept over the arrangement until their event is,
    since a Pane works out its next args from the ones it drew. What a
    window kept before moves over once (`tiling/store.ts`). A Pane an
    Agent opened is marked until the Person has it in focus; the window
    keeps which of them they have looked at (`banda.looked`).
- **One list of actions** (`client/web/src/window/actions.ts`) holds what the
  window does, each with a name, its key sheet section and a default key,
  by its physical place. Each is declared by its owner: an App's in its
  `defineModule`, the Tiling's in `client/web/src/tiling/actions.ts`,
  which take only what the Tiling's interface names (`Tiling`), and the
  Window's own beside the list. What opens, closes, picks and puts away a
  Pane is the Tiling's too (`client/web/src/tiling/opening.ts`): it says
  what is wanted and the engine places it. `window.json` copies each owner's for the
  engine, the Tiling's to `platform/workspaces/window.json`, and
  `banda keys` names the owner of each (ADR 0087, decision 13).
  Alt is the mod: Arrows focus, Shift+Arrows move, Ctrl+Left and Right
  step the width and Ctrl+Up and Down the Pane's height, Shift+R its next
  height, Ctrl+R even ones, Ctrl+F the room left, C the middle, Home and
  End the first and last column (with Shift, moved there), Shift+F the
  zoom, Return opens a new Thread, Shift+Return a new browser, N a new
  Pane (then a letter picks it), W closes, O the overview,
  PageUp and PageDown the workspace above or below, 1…9 go to one,
  Shift+1…9 move the Pane there, A shows or hides the sidebar. The window
  takes these keys before any Pane hears them; a terminal gets every other
  key, Ctrl+W among them. `keys.toml` binds and frees keys over them (ADR
  0005, decision 11); Ctrl+Alt+Shift+K (`keys.reset`) is no file's, and
  brings the window's own keys back until the file changes. The settings Pane's
  Keys section shows the file's lines, and opens the key sheet in the
  window for the rest. `runAction` runs each by its id, from a key, a
  menu, a widget, a Pane, and from outside the window: `banda act` and an
  Agent's `act` tool, through the engine (`window/asked.ts`; ADR 0127,
  decision 2).
- **The sidebar** lists every Thread of every Project, arranged as the
  Person's keys say (ADR 0008, as ADR 0098 amends it): grouped by Project
  or not at all; Your turn oldest or newest first; Open and the Working
  shelf in the Inbox or not; every card of three lines.
  `order.ts` is the one order, from the rows of `rows.ts`, laid out by
  `inbox.ts`. `banda look` resolves the keys from `sidebar.toml`
  (`platform/look/src/sidebar.rs`; a file that still names a preset, a
  card's lines or `group = "machine"` reads as one list of three-line
  cards, and is told so), and the view menu writes them into the file, keeping the Person's other keys and
  comments. The sidebar
  knows nothing of Threads: each module's Watch reports a `Listed` per
  row (its title, mark, times, what calls the Person, what it was last
  asked, and the Pane a click opens). A new Thread opens as a Thread
  Pane with no Thread yet; its first message starts one (ADR 0006).
  - Each Thread shows its Agent's Mark (ADR 0005, decision 8). The engine
    lists each Thread with its latest turn that began (when, and why it
    ended as it did), its Questions that wait (with their titles) and the
    start of its latest message; the list follows them from
    `message.posted`, `turn.started`, `turn.ended` and the `question.*`
    facts. The pane's rules (`marks.ts`) say what that
    means: a Question asks, a failed or interrupted turn failed, a turn
    that finished is done, a running one works, and anything else rests.
  - A turn that finished or failed settles once the Person has seen it: a
    Thread Pane with the focus marks its latest ended turn seen, in the
    window's storage (`seen.ts`). The engine never hears of it.
- **The bar's Mark** shows the loudest of what every Project calls the Person
  for, with how many things wait for them when more than one does. A
  module offers a `Watch` for this: a component the window draws for
  each Project while the engine runs the module, which shows nothing and
  reports a Mark state, a count and the Project's rows for the sidebar
  (`Report` in `client/ui/src/pane.ts`). The bar and the sidebar read the same
  report, so they never disagree, and the bar knows even while the sidebar
  is hidden. The window combines them (`client/web/src/bar`) and knows
  nothing of Threads.
- **Calls** (ADR 0011, ADR 0056). A row whose Mark is done, asking or
  failed calls the Person (`callsOf` in `client/ui/src/pane.ts`). The window
  knows what calls, for the Marks, the rings and `Alt+U`; and where the
  Person looks (`client/web/src/calls`). What calls has one order, the
  sidebar's as the Person arranged it (`order` in
  `client/web/src/sidebar/order.ts`): the sidebar list draws it, `Alt+U`
  walks it, and the bar's counts list follows it (ADR 0079, ADR 0087).
  The window knows nothing of Threads: a Pane kind's `shows` names the
  thing it shows, so the window knows when the Person looks at it (its
  Pane has the focus and the window is in front), sees it on screen, or
  is elsewhere.
  - The `notifications` module tells of it (`platform/notifications/pane`),
    from its `start`, asking the window only what it knows (`WindowApi`:
    `items`, `here`, `sight`, `look`, `projects`, `run`). It compares each
    list with the one before: what starts calling is news, what stops is
    taken back, and a Project's first list is what already was. A toast's
    button goes to its Thread by the Window's `pane.pick`, the one way to
    go to an Agent, which a sidebar row, the counts list and `Alt+U` run
    too (ADR 0087, decision 7).
  - It gathers the news for a tenth of a second and tells of each where
    the Person looks (`tell.ts`): nothing while they look at it; the sound
    when it is on screen; the sound and a toast when it is elsewhere in
    the window (Sonner's, `toast.tsx`, gone by itself after 5 to 12 s); the sound
    and a system notification when the window is behind (`system.ts`).
  - Another part tells the Person in plain data, by running
    `notifications.tell` with a `Told` (`told.ts`): a key, a kind, the
    words and buttons that are actions by id, and the Project and thing it
    is of, which name the Project and tell nothing while the thing is on
    screen. The Problems do (ADR 0039), and git when a run ends with no
    card of its Project in sight.
    A call's toast is one too (`toldOfCall`), so every notice told is
    data: the last five are kept in the window's storage (`recent.ts`),
    and the bell on the bar shows them again, across a restart.
  - A system notification is the desktop's, through the module's desktop
    part (`platform/notifications/desktop/src/notices.ts`):
    the module asks for it through `window.banda.notifications`, its bridge, with the mark
    still in its state as its icon (`stillMark`, drawn to a PNG), and the
    desktop shows it silent, takes it back once the Person sees the
    Thread, and says when they click it; the window comes to the front and
    goes there. More than two at once make one. While Omarchy's Do Not
    Disturb is on (`omarchy-shell notifications isDnd`), only the Marks
    change. On Windows, whose Do Not Disturb Banda cannot read, the
    notification carries Windows' own sound instead of Banda's, unless
    `[sound]` or what told it gives it none, so Do Not Disturb silences
    and holds it (ADR 0090, decision 7). The end-to-end tests run with a recorded desktop
    (`BANDA_DESKTOP=recorded`), so nothing reaches the screen.
  - Every step of this is the Person's to choose: `[notify]` in
    `look.toml` (`platform/look/src/notify.rs`) turns the system notifications to
    always or off and the toasts to always or off, drops the words, keeps
    no quiet but its own, or leaves done, asking or failed to the Marks.
    The window holds Banda's defaults till the look comes
    (`calls/settings.ts`).
  - A Thread Pane marks its turn seen only with the focus in the window in
    front, so a Thread that finishes behind another window calls.
- **Sounds** (ADR 0009). Of the news, the window plays the loudest, and
  for 1.5 s after plays only a louder one.
  - The sounds are made in code with Web Audio, in `client/ui/src/sound`: a
    few instruments (a bell, a marimba bar, a bubble, a string), five
    families that play the three calls on them, and the level of each
    sound, measured so done is the softest and asking the clearest in
    every family. Their noise is seeded, so a sound is the same every
    time.
  - What the Person chose is `[sound]` in `look.toml` (`platform/look/src/sound.rs`):
    the family, the volume, the room, and each call on, off or borrowed
    from another family. The page takes it with the look
    (`useLookSound`); until the first look comes, the defaults play.
    Electron lets the page play sound before the first click.
- **Only `window.banda` ties the page to the desktop.** It names no
  Electron API, so a browser can host it later; for now the engine lets in
  only `app://banda` and pages on localhost. Its channels are one table,
  `BRIDGE` in `client/desktop/src/bridge.ts`, each named by its path (ADR 0028):
  the preload builds `window.banda` from it, and in main each channel
  answers Banda's page alone, decodes its arguments with a `Schema` and
  runs one effect (`serve` in `@banda/desktop-kit`, ADR 0020). A module
  brings its part of the table and of main; `client/desktop/src/modules.ts`
  is the one file in main that names one.
- **The browser's pages** (ADR 0013) are Electron `<webview>`s in the
  window's layer over its workspaces (`PANE_LAYER`), which never moves:
  Electron destroys a `<webview>` that moves in the DOM. The browser Pane
  draws an empty slot, and its page follows the slot on every frame, cut
  to what the workspace shows of it (`apps/browser/pane/src/pages.ts`).
  - The desktop attaches a page only in one of the browser's profiles:
    the Person's, `persist:browser`, or a Project's Agents',
    `persist:agents-<project>`, where the tabs they open load (ADR 0083,
    decision 4). A tab keeps whose it is in its Pane's args, and a page
    opens its new tabs in its own profile. Every page is sandboxed,
    context-isolated and without Node. A fixed sandboxed preload
    supplies synchronous `prompt` (ADR 0060); in each profile alike a site
    asks before it uses the camera, the location or another program, and
    downloads go to the Person's Downloads
    (`apps/browser/desktop/src/profile.ts`). An Agents' profile loads
    the web alone, no file by any way, and shows a site none of the
    Person's client certificates. The extensions live in the Person's
    profile alone (`Extensions`, ADR 0020): an Agents' page is no
    extension's tab, and its menu has no extension's items.
  - Page dialogs are owned by `Dialogs` in main and drawn at the center of
    their page. Native callbacks, the prompt shim, the Person's bridge and
    Agent actions share a dialog ID; the first answer wins (ADR 0060).
  - Banda's Alt keys and the browser's Ctrl keys are taken from the page in
    `before-input-event` and pressed again in the window, so the actions
    and the Pane hear them as their own. A key a page hears while
    Banda's hands act in it (`Tabs.hands`) stays the page's, and the
    window hears none. An Agent's press of one of Banda's keys in force
    there is refused before the hands touch the page: they send its key
    once, held back from the page, and main reads it in
    `before-input-event`, which Electron tells of a key sent with
    `sendInputEvent` before that returns, as Electron makes it
    (`apps/browser/desktop/src/keys.ts`; ADR 0083, decision 3). A key
    of theirs the page leaves unhandled goes on to the window as the
    Person's does, where only the app menu's keys act: Linux and Windows
    have no menu, and a Mac's hears a key only with its native event,
    which a key sent with `sendInputEvent` has not. A key added to the
    menu is checked against this rule.
  - A page takes the keys as an iframe does, with no focus event of its
    own; its tile takes the focus once the window blurs.
  - A Pane keeps its tabs in its args, and holds their pages while it
    has them: only the shown tab's page follows the slot, and a tab is
    made a page the first time it shows. A page's new tabs, its icon and
    the downloads come from the desktop as `browser.listen`, by the page's
    web contents ID; Banda's page shows no remote image, so the desktop
    fetches the icon in the page's profile.
  - Agents drive tabs with Banda's tools (ADR 0029): the engine part asks
    main, and each request names the call's Project and its Agent. Main
    answers only about the tabs in that call's reach
    (`apps/browser/desktop/src/asked.ts`, `Tabs.seen`): those its
    Project's Agents opened, and those the Person lent its Thread (ADR
    0083, decision 4). A tab outside its reach is refused as one there is
    not. The workspaces' `panes` tool shows an Agent a browser's args with
    its Project's Agents' tabs alone.
  - The Person lends one of their tabs to a Thread of the Pane's Project
    by a gesture in the tab: the mark at the address's end, or the
    action `browser.lend` (Alt+Shift+L), pressed in the Pane or in the
    page it shows; the page tells main on the bridge's channel of the
    same name. An Agent's press of it is refused, as of each of Banda's
    keys (above). `Tabs` keeps each lend, which ends as the Person takes it
    back, the tab closes, or the Thread's session ends: its Project lists
    it no more (the bridge's `ended`), or the engine starts again, as the
    boot its `welcome` says changes. As one ends, `Drive` ends the
    Thread's hold on the tab at once, a call that runs there too, and a
    call whose tab left its reach meanwhile answers as for a tab there is
    not. On a lent tab an Agent goes, reads and acts only at an http or
    https address, and never at a site the Person denied every Agent.
    Each lend and each end goes to the engine as `browser.lent`, whose
    fact the agents module posts in the Thread as a notice its Agent
    reads before its next message, the page's title quoted
    (`apps/browser/desktop/src/lends.ts`).
  - Main's hands are Playwright, over each tab's own CDP socket
    (`apps/browser/desktop/src/cdp.ts`): an Effect HTTP server on
    127.0.0.1 whose sockets each see one tab, at an address with a
    secret of its own that opens once, within seconds, and is never
    written down. No endpoint drives the whole browser. A tab's `webContents.debugger` is
    attached while a client uses it, and each client's session on it is a
    Chromium session of its own; a client is a scope, so one that leaves
    detaches. A tab with a client's session is told `driven`: it shows the
    Agent's mark and keeps drawing while hidden; a click on the mark sends
    `browser.stop`, which ends every session on it. A tab asked for with
    no browser Pane opens a new one without the focus, through the
    browser module's `start`.

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
