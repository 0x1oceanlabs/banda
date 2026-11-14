# The engine

`engine/` is the one program, `banda`: `banda serve` runs the kernel and
its modules, and every other word of it is a client of that engine, for
people, scripts and Agents.
[The architecture](../docs/architecture.md#processes) is the map this
page is one part of. A change to the program changes this page in the
same PR.

## What it does

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
