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
  and writes its port, a fresh secret, its build id, version, process and
  since when it runs to `engine.json` in its state folder, a file only
  this user can read. A second engine with the same state folder refuses
  to start. `banda --version` names the build id too (ADR 0086, decision
  2).
- **The engine is the machine's, and outlives the window** (ADR 0086,
  decisions 1 and 3). On Linux it is a systemd user unit of the Person's
  session, `<folder>-engine` (`banda-engine`, `banda-dev-engine`; a state
  folder other than the default adds a short hash of it). Any client
  starts it when no engine answers: the window, and every command that
  reaches the engine; it is started with `systemd-run --user`, then
  waited for while its unit runs, for up to two minutes, as it opens its
  Projects first. It gets the user manager's environment, never its
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
  each change, and `check` names a broken file's line. Its `[sound]` says
  which sounds the window plays (ADR 0009) and its `[notify]` where the
  window tells of a call (ADR 0011); the look's layers apply to them as
  to every other key. The sidebar's arrangement comes with it (ADR
  0008): `~/.config/banda/sidebar.toml` over the preset it names, Banda's
  or `sidebars/<name>.toml`, over the defaults. The view menu asks the
  desktop to write the preset into the file. The browser's
  `~/.config/banda/browser.toml` comes with it too (ADR 0013), and the
  browser's switch and its pins ask the desktop to write `tabs` and
  `pinned` into it, through `banda settings set`; its `blocker` turns
  the desktop's ad blocker (`apps/browser/desktop/src/blocker.ts`) on and off.
  The agents module's
  `agents.toml`, what Enter does in the composer, comes with it the same
  way (ADR 0016). The settings Pane writes every file through `banda
  settings set` too; nothing else the page asks of Node writes a file. A Pane reads its part of the look
  through `@banda/ui/lib/look`.
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

- **Project.** A folder on disk (a new one goes in `~/Banda/<name>/`) and
  its data in the engine's data folder, `~/.local/share/banda/projects/<id>/`
  (ADR 0026; Banda Dev's is `banda-dev`, a checkout's `banda-local`, ADR
  0033): `project.json`, which names the folder, the Project's SQLite with
  the modules' migrations and the event log, and the modules' files. The
  folder holds the work alone. One engine at a time opens a Project: it holds
  a lock on `projects/<id>/project.lock` while the Project is open. Projects from
  before ADR 0026 move their `.banda/` there the first time an engine
  starts, each as a foreign Project, not trusted, and only to a folder no
  Project names (ADR 0083, F0-3): what a folder holds is anyone's to
  write. The kernel's own methods manage them: `projects.create` makes a
  new folder, `projects.add` adds any folder (resolved, so one folder is one
  Project), `projects.browse` lists folders as a path is typed,
  `projects.update` renames, pins or archives, and `projects.remove` forgets
  a Project: its modules stop what runs there (`Module::closing`), its data
  becomes `<id>.gone` and is deleted, and its folder is not touched. A
  Thread in No Project has a Project of its own, `scratch` in `project.json`
  (ADR 0046): `projects.create { scratch: true }` makes it, with no name, in
  a new folder `~/Banda/scratch/<date>-<id8>/`, and `projects.update
  { scratch: false, name }` makes a Project of it.
- **Trust** (ADR 0083, decision 5). A Project is trusted or not, `trusted`
  in its summary; its `project.json` says `untrusted` only when it is not,
  so one that does not say is trusted. Only the Person changes it,
  `projects.trust { project, trusted }`, which refuses an Agent's pass and
  tells the Project's modules (`Module::trust_changed`); an Agent reads it
  in `projects.list`. Like every right, it is kept at Banda's API: what an
  Agent's shell runs runs as the Person until the fence (ADR 0083,
  decision 1). The scratch Project of a Thread in No Project is always
  trusted. A new Project is trusted as `projects.add`, `projects.create`
  or `banda project add --trusted` says; when they do not, it is trusted
  unless its folder looks foreign, and a folder the call made looks so
  only by the repository it is in. The window's Add Project asks
  `projects.foreign` of a folder on disk first, there or to be made: one
  that looks foreign asks the Person, in the Banda menu, "Not yet"
  (Enter) or "Trust", and the answer is the call's `trusted`; another, or
  one that already is a Project, says nothing of its trust. A folder that
  already is a Project keeps its own trust, unless the call says. A
  Project not trusted wears a grey dashed circle at its sign's corner, and
  the Person trusts it later from its menu in the sidebar or its
  settings, on a card that lists what will load. Whether the Person said
  they trust it is `trust_said`: in the trust step as they added it, by
  `projects.add` or `projects.create` with `trusted: true`, or by
  `projects.trust`; its `project.json` keeps who said it and when
  (`said`). The first engine with the fence said it once, as the upgrade,
  of every Project trusted then but a scratch one, by the manifest's
  `version` (`old::said_before_fence`; ADR 0083, F0-3), and keeps in its
  data folder that it did (`said-before-fence.json`): no later start says
  it of any. Only a Project whose trust was said gives its Harnesses the
  Person's GitHub token and SSH agent.
  `projects.foreign { folder }` says whether a folder looks foreign and
  why, and which Project it already is, for Add Project to ask (ADR 0084,
  decision 13); a folder not made yet is looked at as it will be. It
  looks foreign when its repository was cloned from a network, or has a
  remote on GitHub of another account than the one `gh` is signed in to,
  or the folder, or one above it up to its repository's top, holds
  `.claude/`, `.codex/`, `.mcp.json`, `.devcontainer/` or
  `.devcontainer.json`. The look reads only regular
  files of the repository, a bounded start of each: its config and HEAD's
  log. It runs no git, and asks `gh` only its account, offline.
- **Event log.** Append-only, with typed events, one per Project. Windows and
  the CLI subscribe to it. A subscription sends only what its view needs.
  The database itself refuses to change or delete an event.
- **Durable listeners** (ADR 0082, decision 6; A5 of the architecture
  vision). A module hears a log only through a `Listener` it names
  (`ModuleProject::listen`, `listen_to_machine`), one name to one
  listener, and the kernel keeps how far each has heard in
  `kernel_cursors`, beside that log, so a restart resumes there and loses
  no fact. A listener new to a log starts at its head. In one scope a
  reaction acks its fact in the transaction it writes in (`Tx::ack`), so
  it runs once, and a second ack is refused. One that cannot, its work
  outside the store (git's checkpoints) or what it follows spanning
  several facts (pulls' shell calls), acks once its work is done
  (`Listener::ack_through`), so it may run again after a crash, and
  looks before it acts. Across scopes, what a reaction writes in its own
  Project goes under the receipt of `CommandId::derive(listener, event)`,
  then the cursor moves (`Listener::once`); work outside any store acks
  by itself (`Listener::ack_through`), as agents lets go of a Harness's
  processes after a sign-in. An effect that waits for the
  reactions (`ModuleProject::reacted`) waits for every listener of its
  log. A Project's cursors in the machine's log go as it is removed, and
  its listeners end as it closes: what a module keeps of a Project past
  one call holds it weakly (`ModuleProject::downgrade`).
- **Access decision.** One function decides whether a Participant may perform
  an action on a target. Every method and every subscription passes through
  it, before any module code runs. On one computer it answers: the owner may
  do everything; an Agent may read and change the work, but neither change
  the Project itself, decide what an Agent asked a Person, nor run programs
  as the Person, in a terminal or as git's acts with their hooks (an Agent
  runs them through its Harness); nobody else may do anything. Members and
  roles arrive here later.
- **The Project wall** (ADR 0019, decision 2). A caller with an Agent's
  pass calls, subscribes and streams only in that pass's Project. The
  kernel checks it where it finds the Project, before the access decision
  (`access::within`), for the API and for callers in the engine alike. A
  call that names no Project runs in the pass's; any other Project is
  refused. `projects.list` shows it only its own.
- **This machine** (ADR 0025, decision 1). A module whose data holds
  every Project's, as the workspaces do, is the machine's
  (`Module::scope`). The kernel keeps one more store like a Project's for
  those modules, in the engine's state folder (`machine/`), with its own
  receipts, event log and outbox; a Project's modules never open there, nor
  the machine's in a Project. Their methods name no Project. The machine is
  no Project in `projects.list`; `welcome` names its ID, which a window
  follows and streams by. An Agent's pass stops at it, but for the
  methods marked `tool` (ADR 0032): the kernel hands each call the pass's
  wall (`Call::wall`: its Project, and whether that Project's `sees_others`
  is on), and the module answers with what the wall shows. The
  workspaces' tools show an Agent its Project's Panes, the others' outline
  when let, and let it open, move and close only its Project's Panes of
  the kinds that run nothing as the Person, given only the args that
  choose what each shows (ADR 0083, decision 3), moving and closing only
  the ones it opened (`Pane.by`).
- **Tables by prefix** (ADR 0062, decision 5; A4 of the architecture
  vision). A module's tables and indexes go by its name and `_`
  (`notes_items`), and a SQLite authorizer on each store's writer and
  reader holds its SQL to them (`kernel/src/tables.rs`): in its
  transactions, its reads and views, and its migrations, which open no
  store once one reaches past. The kernel's own tables, `kernel_*`, a
  module reaches only through the kernel's API (`Tx::emit`,
  `Tx::enqueue`, the log's reads); all the kernel's SQL in a `Tx` goes
  through `Tx::kernel`. A module's SQL reads and writes its own tables
  and reads `json_each`; only its migration steps make tables and
  indexes and change columns, and each foreign key they leave must point
  at its own tables, which the kernel reads after each step. The rest is
  refused until a module needs it: a transaction or a savepoint, another
  database, a pragma, a view, a trigger, a temporary or virtual table,
  dropping a table (its data is kept, ADR 0085), and renaming one, as
  SQLite does not tell the new name (a module rebuilds a table under a
  new name it owns). A module whose id changed keeps its tables' names,
  for data at rest is never renamed: its `app.toml` declares the
  prefixes it kept, `legacy-prefixes`, which its engine part tells the
  kernel (`Module::legacy_prefixes`), and the kernel refuses one that is
  another module's name or reserved (`kernel`, `sqlite`, `pragma`,
  `json`) (ADR 0085, decision 12). Entering a module empties its
  connection's statement cache, so it is never handed a statement
  decided for someone else, and both connections run with
  `trusted_schema = OFF`. What a module's SQL reaches past is refused as
  it is prepared, logged with the module and the table, and reaches its
  caller as `internal`.
- **Identity.** A port: it says which Participant a connection's token names.
  On one computer, whoever holds the engine's secret is the owner. Later it
  is OIDC, or our accounts.
- **Environment** (ADR 0084, decision 1). A port beside Identity: where a
  Project's programs run. A module starts each through its Project's
  (`ModuleProject::environment`), never itself: a `Program` (its
  arguments, never a shell line; what it adds to and takes from the
  environment it starts in; its folder, `cwd`) on pipes (`spawn`), where
  it leads a process group of its own and is killed once let go of, or on
  a terminal (`pty`), where it leads a session of its own. Either hands
  back the kernel's `Started`, the handle that asks it and what it started
  to stop and kills them (ADR 0090, decision 3): TERM and KILL to its
  group on Unix, with HUP first on a terminal; on Windows, where each is
  born in a Job Object that none of it may leave, both end the Job
  Object, and a Harness's adapter is asked by its stdin closing. On
  Windows `local` starts only a program it found itself, on the host's
  PATH as it is now (below), so Windows' own search never reaches
  `WindowsApps`. A terminal comes back as the port's own `Pty`: what the
  program prints, what is typed, its size and what runs in front. A module signals none of the programs it started: the git
  module's bookkeeping git starts as a `Started` too. The engine gives
  the kernel its adapter: `local`, the platform's `banda-environments`,
  which runs the program on the host as Banda always has; a kernel given
  none starts nothing. Harness processes, terminals and the git acts the
  Person asks for start there, and with them all they start: an Agent's
  tools, the MCP servers its Harness runs, dev servers. What keeps
  Banda's books (git's status, diffs, checkpoints and watch through
  `banda-git-cli`, Files' reads) runs on the host and
  executes nothing of a Project's. The machine's scope has the same
  environment, for the Harness process its `harnesses` module asks and
  Codex's app-server that reads its limits. A `Program` says whose it is
  (`Whose`, ADR 0083, decision 1), and only the constructor of whose it is
  makes one, so it has holes in the fence (`Holes`) exactly when it is one
  to start behind it. A Harness's process (`harness`) and its CLI asked
  about itself (`harness_probe`) are ones to start behind the fence: a
  Project's Harness process with the holes its Project has, such as its
  Claude Code sessions and the files it keeps for messages, and in its
  folder once the Person trusts it; the machine's and a probe with none. A
  terminal the Person opened (`terminal`) and a git act they asked for
  (`act`) are the Person's own, outside it. `local` reads whose a program is
  to start it where it belongs: a terminal's only on a terminal, and one to
  fence never on one.
- **The fence** (ADR 0083, decision 1). `platform/fence` on Linux: the
  engine is its own launcher, `banda fence`, which an environment starts
  from the engine's running program (`/proc/self/exe`) with the program
  after `--` and what to do, a `Spec`, on a sealed memfd only that child
  keeps; it refuses a spec another build wrote, and refuses to run as
  root. On its one thread, before anything else in the engine runs, it
  closes what its starter left open, lets go of the starter's terminal,
  makes a user, a mount and an IPC namespace (the user mapped to itself),
  keeps `/sys` read-only and gives the program a `/dev` of the fence's own
  (the devices a program needs, its own terminals and shared memory), pins
  every folder above what it covers that the user may rename, covers each
  folder the spec hides with an empty one of its own and puts back the
  holes in it, keeps the read-only folders so, sets `no_new_privs` and
  Landlock's scopes where the kernel has them (scopes only, so the
  sandboxes Harnesses make inside still work), and then starts the program
  in a PID namespace whose first process mounts its own `/proc`, reaps and
  passes signals on, each signal reaching the program once. It writes
  nothing on stdout, exits as the program did (a signal `n` as `128 + n`),
  takes the fenced tree along when its starter goes, however it went
  (it watches the starter's process, not the thread that started it), and
  stops with `125` before running anything when a step fails. With
  `--status-fd` it says how the start went on a pipe of its own, which
  closes as the program runs, so a program that is not there is an error
  of the spawn, not an exit. `banda fence --probe` does
  all of it for real over Banda's own folders (every Banda's state and data
  hidden, every Banda's config read-only, the session's runtime folder
  hidden; a folder reached through a link the user could move refused),
  checks from inside what it covered, and prints one JSON line: `holds`
  with its layers, or `missing` and why (`no_user_namespaces`, `refused`
  by the system, `setup_failed`). The crate makes no process of its own:
  `platform/environments` stays the one place that does.
  `banda serve` builds the base and probes it once
  (`engine/src/fence.rs`), and its `local` environment is
  `Local::fenced`: a Harness's programs start through `banda fence` with
  the base and their holes, the Person's terminals and acts as they are;
  where the probe found no fence, every program starts as `local` starts
  it. The base hides the session's runtime folder, and the other
  sessions' and the container and machine managers' sockets where they
  are. The SSH agents are no part of the base (`fence::ssh_agents`,
  `SshAgents`): a program whose `Holes` say `ssh_agent` reaches the one
  `SSH_AUTH_SOCK` names, through a hole where it is the user's socket in
  a hidden folder, reached through no link the user could move, and as it
  is where it is in sight, and keeps the variable then. Any other loses
  `SSH_AUTH_SOCK`, and starts with every agent's socket in sight hidden:
  that one, those the Person's ssh config names as `IdentityAgent`, the
  well-known agents' (1Password's folder, Bitwarden's, GnuPG's), and
  ssh-agent's folders (`/tmp/ssh-*`). A program behind the fence gets no `BANDA_STATE`,
  `BANDA_DATA`, `BANDA_ROOT` or `BANDA_CACHE`; a Harness's gets `GH_TOKEN`
  and the SSH agent only in a Project the Person said they trust
  (`trust_said`, `Harness::set_trust_said`), and no GitHub token or
  `SSH_AUTH_SOCK` in any other, fence or none (`Credentials`, which make
  no other process).
  The kernel holds what the probe found (`Fence`): `welcome` carries it,
  `banda status` prints it, and the agents module starts a new Thread in
  Full access only where it holds whole, with Landlock and no `docker`
  group (`full_access.rs`); elsewhere Supervised. A Thread's Full access
  is marked as chosen where the fence held or not, and a turn of one the
  fence does not keep now runs Supervised and says why in
  `thread.configured` (`supervised`). Full access in `agents.toml`'s
  `start.<id>.mode` counts only as the Person chose it in Settings →
  Agents, which writes the file through the engine (`keys.settings_set`),
  where the engine keeps their choice in its state (`modes-chosen.json`,
  `chosen_modes.rs`); found only in the file, it is no one's, and a new
  Thread starts as the fence has it. A host whose Harness's process has
  something an Agent ran listening under it is not let go for idling. A
  debug build's `BANDA_FENCE=off` leaves the fence out, for the
  end-to-end tests. An Agent's `banda settings` and `banda keys bind` go
  through the engine (`keys.settings_set`, `settings_reset`,
  `settings_rename`), which refuses under a pass what only the Person
  changes (`banda_settings::only_the_person`).
- **Passes** (ADR 0083, decision 2). A module asks its `ModuleProject` for
  a new pass of an Agent (`pass(agent, thread)`), 32 random bytes in hex;
  the agents module asks as a session opens, naming the session's Thread,
  and for each Harness process's shells, naming none. The kernel keeps
  passes in the host's own store, `passes.sqlite3` in the engine's state,
  until the Host scope has its store: hashed, so the store holds no pass,
  each with its Agent, its Project, its Thread, its audience (`ws`, the
  API, today) and when it expires. What a module gets is a `Pass` its
  session holds: dropped, as the session ends, it is revoked. The agents
  module's process holds a session's pass while the session is open in
  it, and the module holds each process's pass while its Project is
  open. A pass a session holds is renewed an hour ahead every quarter of
  an hour; one no session of this run holds, as one of the run before,
  lasts until the hour its last holder gave it ends, and a use does not
  renew it. As the engine stops it revokes none, and gives every pass
  its sessions hold a whole hour, so a restart keeps the passes of the
  sessions that go on. A Project removed takes its passes with it. A
  store that does not open is put aside, and a new one made. A `hello`
  with a pass connects as that Agent, in that Project, and a module
  reads the pass's Thread as `Call::thread`: the module that asked for
  the pass named it, never the Agent.
- **Module registry and API.** The registry routes commands to their
  module, delivers events to subscribers, and serves the API. `welcome`
  lists the engine's modules, so a window shows only what the engine has,
  and names the engine's boot, which another start changes: a window
  that hears a new one knows every session of the last ended.
- **Streams.** A module can answer a window with live pieces that are not
  facts, such as what a terminal prints: the window asks for a stream
  (`stream`) and hears its pieces (`piece`) until it ends (`ended`) or the
  window lets it go (`unsubscribe`). The access decision runs when it
  starts. Each stream has one piece on its way at a time, so a window that
  reads slowly holds the module back, which sends more in the next piece.
  Nothing of a stream is logged; a window that connects again asks again
  and hears it from the start.
- **The window's road** (ADR 0029, decision 2). Some work is the
  window's, such as its pages. A module's method asks the window
  (`Call::ask_window`) and awaits the answer, within a time it gives.
  The window hears every module's requests on one stream that names no
  Project, `window.requests`, and answers each by `window.answer`; both
  need the right to run as the Person, so no Agent holds or answers
  them. The latest window to ask holds the road, and what the one before
  had not answered is refused. With no window, or none that answers in
  time, the ask is refused, and says whether the work may have run.
  Each request carries that time, and the window stops its handler past
  it, so what the handler holds goes.
- **Receipts and outbox.** These carry every command along one path (below).

### The command path

```
command (with its ID)
  → the session's queue for its scope: it starts once the one before answered
  → receipt, begun: a resend gets the answer kept, or waits for the run
  → access decision (one exhaustive map: method → right)
  → module operation: rules decide, store writes
  → one transaction: the change · events · view tables · outbox rows · "written" on the receipt
  → receipt, answered: the value or a final refusal, and `at`
  → publish: one ordered lane per Project
  → outbox: side effects in order per target, run by the engine under this boot,
    or by a worker outside it under a lease; retried as their kind says
  → how one ended: one transaction with what its module writes of it, tried until it commits
```

- A session's commands to one scope, this machine's or a Project's,
  commit in the order sent (ADR 0082, decision 4): the API keeps one
  queue for each scope a connection sends commands to, and runs it one
  command at a time, so a client sends the next before the last answers.
  Queues run beside each other, and calls and streams wait in none, nor
  does a command its module says runs on past one write
  (`Module::runs_on`), as a sign-in that waits for the Person. A command
  still running after thirty seconds, which only one that hangs does,
  gives up its place, and the next starts beside it; the log says so. A
  session is one connection: order holds across a reconnect as the
  client sends its unanswered commands again, in order, first. One sent
  `once`, as a Person's mark (ADR 0096), is not sent again, so it keeps
  no place in that order.

- An effect's end and what its module writes of it, such as how a turn
  ended, commit together. A write that fails is tried again; one that
  keeps failing settles the effect as failed, and a run that panics is
  failed too. So no effect stays running, holding its key, until a
  restart.

- Every command keeps a receipt, whatever its handler does (ADR 0082,
  decision 4). The method's kind decides, not its right: a `call` keeps
  none, whatever it changes. `Kernel::answer` has the rule in full.
  - The receipt is written before the handler runs. A resend gets the
    answer it keeps and runs nothing again. A resend while the command
    runs waits, and gets what the run answers.
  - It names its author and keeps a hash of the params. The same command
    ID from someone else, for another method or with other params, is
    refused as `conflict`.
  - It keeps a value or a final refusal. A passing refusal, `internal` or
    `protocol`, is not kept, so a resend may go through, unless the
    command's change was written: then a resend gets `may_have_run`.
  - A run cut short, by a crash or by a caller that went away, gets no
    answer. A resend then gets `may_have_run`, and keeps getting it while
    the receipt is kept (below): the command never runs twice. So Files'
    writes and renames, which act on the disk before anything is written,
    are safe to resend.
  - The answer carries `at`, a seq of its scope's log: the last fact it
    wrote. A resend gets the same; a command that wrote no fact, as one
    that changed nothing, has none, so a client waits to hear nothing
    (#880); a refusal has none.
  - The writer syncs with `synchronous = NORMAL`, so receipts hold across
    a crash of the engine. A power cut may lose the last ones, and with
    them the `may_have_run` of a disk change made just before.
  - The kernel's own `projects.*` commands keep no receipt yet; they
    leave the kernel with A1 and A2 of the architecture vision.
- A side effect never starts from a live subscription.
- An effect holds its key while it runs, so its module bounds how long a run
  takes. A restart that cuts an effect short counts as a try. An effect
  that asks to retry waits longer after each try, for as long as its kind's
  `Retry` says (`Module::retry`): five tries by default, for work on the
  host; for work over the network, until a deadline after it was queued,
  then five tries more, so a host that slept through it still tries as it
  wakes. Runs cut short count up to five whatever the deadline. Then the
  effect fails and its module says so.
- A worker outside the engine runs the effects queued for one
  (`Tx::enqueue_for_worker`), under a lease (ADR 0082, A6): it takes one
  with `ModuleProject::lease`, keeps it with `renew` and settles it with
  `finish`. A lease runs on the engine's monotonic clock, never the wall
  clock. One that runs out is cut short at once, as a restart cuts the
  engine's own runs. A restart gives a lease a fresh term once: one its
  worker did not renew through a whole run of the engine is cut short as
  the next starts. Each time an effect is taken, its claim gets a new
  token, checked as the worker renews, as its module writes for it
  (`Tx::holds`) and as it settles: once the effect was taken again or
  settled, its late worker writes nothing. So an effect a worker runs may
  run twice, and its end is written once. The engine's own effects stay
  owned by its boot, which needs no clock.
- A receipt, and the row of an effect that settled, are kept 30 days,
  longer than the seven days within which a client sends a command again;
  then the Project's loop lets them go. A receipt's 30 days run from when
  it was last written, as its command began or was answered, so never
  from before its command first came: every resend finds it,
  `may_have_run` included. A receipt whose command still runs stays,
  however long. A command sent again within them gets its first answer;
  past them, it runs as a new one.
- Those seven days are today a convention of Banda's clients, not a
  check: `banda mcp` sends a command again at once, within its session.
  The host will check them: a command will carry `not_after`, and past it
  the host will refuse it (ADR 0082, decisions 4 and 16).
- Outbox rows are the kernel's bookkeeping, not records of the work. What a
  Person sees of an effect is the events its module writes.
- A window loads a snapshot at sequence N, then streams the events after N.
  It names the module, subject and kinds it shows, so it hears only those.
  The engine replays the log a page at a time, and a subscriber that falls
  behind catches up from the log.

## Where data lives

| Where | What |
|---|---|
| The Project's folder | the files of the work |
| Text files | the Harnesses, in the config folder; the look (`look.toml`, themes) and the sidebar (`sidebar.toml`, presets), the browser (`browser.toml`) and how Threads start and messages to an Agent are sent (`agents.toml`) in `~/.config/banda/`. Layouts and keys join them later |
| The Harness | its session, context and sign-in. We keep only its session ID, as evidence |
| The OS keychain | secrets you give Banda. Its database never holds them |
| The engine's state folder | the owner's ID; how its last run went (`run.json`); the passes, hashed (`passes.sqlite3`); while the engine runs, its port and per-run secret |
| The window's storage | the view of the workspaces: the one on screen, each one's focused column and each column's shown Pane; whether the sidebar shows; which finished turn of each Thread the Person has seen; which Panes an Agent opened the Person has looked at |
| `machine/` SQLite, in the engine's state | this machine's, in no Project: the workspaces, their columns, each Pane with its Project and the widths (ADR 0025) |
| `projects/<id>/` SQLite, in the engine's data | Threads, Questions and answers, the Agents' queue, Databases' records, receipts, events, outbox |
| `projects/<id>/images/` and `files/` | the bytes of the images messages carry, one file per image, the SQLite saying what each is and which message carries it; the files a message keeps (a dropped file, a long paste), which each Thread's session gets as an extra root |

Events are facts with a version, and the log is never rewritten. Each module
keeps its own ledger of migrations. Our IDs are UUIDv7, but those derived
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
               a Group of their own
```

A module declares itself in its code and a short `app.toml` (ADR 0022,
which calls it `module.toml`).
Its engine part is the `Module` it gives the kernel, with its `methods!`
table. Its window part is one
`defineModule({ id, engine, panes, watches, actions, sources, bar, slots, previewers, items, start })`
exported from its Pane package; the window lists these in
`client/web/src/modules.ts`, the one place that names a module, and builds its
registries from them. `start` runs once with the window API, for a module
that acts on the window when the desktop tells it something.
`slots` are what it puts in other Apps' things, each a Slot by its name
(ADR 0082, decision 8; `@banda/ui/slots`): Git's rows in Threads'
`thread.details`, a Thread's details card (ADR 0034), and Threads' Mark of
a Thread in the Tiling's `pane.header`, a Pane's header and its tile's
label in the Overview (ADR 0062, decision 17), where the window names
another machine too. The window gives what the modules that run put in
each (`Slots`), and each Slot's owner reads its own in one place
(`useSlot`), in the modules' order. A Pane's header gives what fills it
the Pane alone: Threads finds the Thread it shows among what the Apps
list, which the window gives them (`useItem`, #943). A Pane puts
its own buttons in the header the frame draws with `InHeader`. Threads'
own action `agents.thread.details{part}` shows the focused Thread's card
with a part of its rows open, as git's Alt+Shift+G runs it for its branch
picker.
`items` are its item actions (ADR 0087, decision 12): what the Person
does to one of the Items it lists, as renaming or snoozing a Thread. Each
is an action, by a key too, with the row it shows for an Item; the Thread
menu lists them, its App's and then the sidebar list's Archive, and the
Pane menu and the Banda menu's Tab those offered there. The window finds
an Item's App by the first word of its Pane kind, and runs each by id.
`previewers` are how it draws kinds of file (ADR 0073, decision 6): each
`definePreviewer({ id, title, match, priority, can, load })`, whose view
`load` imports only once a file of its kind is shown. The window gathers
every module's and gives them to its Panes as `@banda/ui`'s
`Previewers`; `pickPreviewer` takes the Person's pick for the extension,
else the closest match (extension, MIME, MIME family, first bytes), then
the higher priority. A view is keyed by its previewer, so the next file of
its kind updates it rather than drawing it anew.
`app.toml` holds only what no code says. Its `kind` is `app` in
`apps/` and `platform` in `platform/`; `api` is the major of the App
API it is written to, a whole number; `[needs]` stays empty until what
an App needs (ADR 0082, decision 2) is built. The window's own part
declares itself in `client/web/app.toml` too, with no `kind`, `api` or
`[needs]`, as it is neither an App nor a platform part (ADR 0087,
decision 1).
`banda modules` prints the three as one JSON per module
(`engine/src/modules.rs`), and the skill's `modules` topic is written
from it. The serving engine reads the window parts too: the keys in
force take their actions and scopes (ADR 0071, decision 2), and the
workspaces, as they start, the Pane kinds that open as a Group of their
own (`PaneKind.grouped`), so a Thread is a Group from its opening whoever
opens it (ADR 0065, decision 7). For those kinds, a window part it
cannot read it logs and leaves out. A path a module takes that the
contract lacks is an unstable mark in its `app.toml`, with why; the tests
hold the count at a ceiling that only falls, and `scripts/check.sh`
prints them.

**One list of Apps.** `engine/build.rs` scans the folders of `apps/` and
`platform/` with an `app.toml`, Apps first, each bucket by name. It
refuses a manifest whose id is not its folder's name, whose kind is not
its bucket's, or whose `api` or `[needs]` is wrong, and a folder with a
part's files (`engine/Cargo.toml`, `pane/` or `desktop/`'s
`package.json`, `window.json`) but no manifest. It writes the list
`engine/src/apps.rs` includes: each manifest and `window.json`, and the
engine parts `banda serve` builds, in its order, each by its builder
there (one function per App's id: a part with none fails the build, a
builder with no part fails clippy). The engine serves those and no
other, as the contract's tests check against `banda modules`. The lists
still kept by hand are held to it by the engine's tests:
`engine/Cargo.toml`'s crates and the workspace's members, the settings'
window parts (until B2), and the window's `client/web/src/modules.ts`
and `client/desktop/src/modules.ts`; the tests write the contract's
`Methods` (`sdk/contract/src/generated/Methods.ts`) from it.

**Its contract** is everything it shows outward:

- **Methods it accepts**, each a call, a command or a stream with typed
  params and answer: one line in its `methods!` table, which makes the
  right, the dispatch and the module's methods as TypeScript, so the
  window's `engine.call`, `engine.command` and `engine.stream` take only
  those (ADR 0014).
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

### agents

- **A Thread is a session with a Harness** (ADR 0006). The first message
  starts it: `agents.send` with a `harness` and no `thread`. Its Harness is
  its own from then on, and each Thread gets an Agent ID of its own. A new
  Thread starts with full access and the options its Harness last offered,
  such as its model (`agents.defaults`). Defaults a Person sets per Harness
  entry (ADR 0006, decision 3) are not built yet.
  - Projects from before ADR 0006 kept their Agents in
    `.banda/agents/<name>.toml`, now `projects/<id>/agents/` (ADR 0026). Opening the module reads those files
    once to learn each older Thread's Harness, and leaves them as they are.
    Older Threads keep the Agent ID they had, so one old Agent's Threads
    still share it.
- **The Harness list is a text file** of the machine. It says how to start
  each Harness. Without one, the engine knows Claude Code and Codex through
  their ACP adapters, at exact versions. Reading the ACP Registry comes
  next.
- **Banda carries the adapters, and the host runs them** (ADR 0059; ADR
  0062, step S1). The harnesses' host package,
  `platform/harnesses/adapters`, bundles both adapters into one file each,
  Claude Code's with Banda's shim of the Agent SDK, which keeps a Thread's
  sessions in its Project (ADR 0078), and Codex's with Banda's patch.
  `banda serve` finds them and a Node itself, as it starts
  (`platform/harnesses/engine/src/carried.rs`): the adapters in
  `BANDA_ADAPTERS`, else beside its program (a packed app's
  `resources/adapters`, and the engine's own copy's), else what a
  checkout's package built; the Node in `BANDA_NODE`, which the window sets
  to its own Electron, else the Node the app carries in `node/` beside the
  engine's program (Windows', ADR 0090, decision 5: its window then names
  no Electron), else the packed app's Electron beside the engine's
  resources, else the Electron the copy's `electron` file names, else the
  first `node` on PATH of at least Node 22. An Electron runs them with
  `ELECTRON_RUN_AS_NODE`; a `node` needs nothing. So an engine started in
  a shell, with no window, runs Banda's own entries through them too.
  With no adapters or no Node, those entries start through `npx`.
  - The engine follows the file: each look at the list reads it again once
    it changed, so a changed entry starts its next process as the file now
    says, and a file that no longer reads leaves the list before it in
    force (ADR 0016). An entry with `enabled = false` stays in the list,
    and no Thread starts on it.
  - An entry may name the Person's own CLI the adapter runs (`[harness.cli]`
    with `program` and `variable`): `claude` through
    `CLAUDE_CODE_EXECUTABLE`, `codex` through `CODEX_PATH` (ADR 0003,
    decision 3). Each start finds it on the host's PATH as it is now, to
    which Windows adds the user's and the system's from the registry, so
    one installed while the engine runs is found (ADR 0090, decision 3).
    On Windows the vendors' own folders come first (Claude Code's
    installer puts `claude.exe` on no PATH), a program itself comes before
    a `.cmd`, a program under `WindowsApps` is never one, and a `claude`
    that does not say "(Claude Code)" is passed over. It asks its version;
    a CLI that is not installed stops the start, so no bundled copy runs
    in its place.
  - Its `minimum` is the oldest version the adapter supports, the one it
    was built for: Claude Code 2.1.312, Codex 0.165.0. An older CLI runs,
    and the settings Pane's Agents and the Threads warn. Checking the Harness again
    finds the CLI again, so an update ends the warning without a restart.
- **A message queues a turn.** The outbox runs one Thread's turns one at a
  time, in order (`turn.start`, keyed by the Thread). Threads run side by
  side. A stop (`turn.stop`) and an answer
  (`question.reply`) have keys of their own, so neither waits behind the
  turn it is for.
- **While the Agent works, a message goes into its turn or waits**, as in
  T3 Code (ADR 0003, decision 8). Send now puts it into the running turn
  (steering): the engine hands it over through `_session/steering`, which
  Claude Code's and Codex's adapters share (`turn.steer`, keyed by the
  Thread's steering), and what the Agent says of it follows it in the
  Thread. Queue has it wait for a turn of its own. Enter does one of the
  two, Send now unless `agents.toml` says `enter = "queue"` (the settings'
  Agents writes it), and Ctrl+Enter the other. A
  message the turn cannot take, as when it just ended or a Person stopped
  it, waits for its own turn instead; a Harness that cannot steer stops its
  turn for it, and says so. A message sent into a turn whose Harness still
  starts waits for the turn to begin.
- **The queue shows after the Thread.** A waiting message can be changed
  (`agents.edit`), taken back (`agents.withdraw`) or sent now into the
  running turn (`agents.steer`). It reads where its turn starts. A Person's
  stop, a restart while a turn sent to the Agent ran or started, and a
  Harness that stopped, whoever opened its turn, hold the queue
  (`thread.held`) until the Person continues (`agents.resume`), sends
  another message or tries the failed turn again, which goes first. A
  restart while only the Agent's own turn ran, and a stop Banda made for a
  message, hold nothing (ADR 0018, decision 4; `rules::next` holds the
  table, a test a row).
- **The Agent can go on by itself between turns**, as Claude Code does when
  a background task it started ends or a wakeup fires. Each session that
  ran a turn has a listener (`between.rs`): what the session says then
  opens a turn of the Agent's own, whose message is a notice from Banda.
  The turn ends when the Harness says what that cost; when a Person's
  message goes, which the Harness takes into what it does; when a Person
  stops it; or after a minute with nothing said, no tool call of it
  running and nothing asked. A message sent meanwhile gets a turn of its
  own, which waits while the Agent asks a Person; a turn the Agent started
  is not tried again. It keeps its Harness process as any turn does, and
  a restart interrupts it (`opened`). A tool call that changes between
  turns belongs to the turn that ended, as when a command Claude Code sent
  to the background ends, and opens none.
- **One Harness process per Project and Harness entry.** Every Thread on it is
  a session in that process. The engine starts it on the first turn, one
  start at a time; starts it again after a growing pause if it keeps dying;
  and lets it go after 30 minutes with nothing to do. It runs in its own
  process group and dies with the engine.
- **A Project not trusted loads only the Person's own settings** (ADR 0083,
  decision 5). Every Harness process of a Project carries
  `BANDA_UNTRUSTED`, `1` when it is not trusted and empty when it is,
  whatever the engine's own environment says. In a Project not trusted:
  - Each session opens with `_meta.claudeCode.options.settingSources:
    ["user"]`, so Claude Code reads none of the folder's `.claude/`
    settings, hooks, `CLAUDE.md` or `.mcp.json` servers. The Claude Code
    adapter Banda carries resolves the settings it reads itself, for its
    models, effort and modes, from the Person's alone too (its shim of the
    SDK, `claude-sdk.mjs`).
  - The Codex adapter Banda carries is patched
    (`platform/harnesses/adapters/patches/`) to mark no session's folder
    trusted, where it marks every one trusted otherwise, so Codex loads no
    `.codex/` config of the folder. Codex still reads `AGENTS.md`.
  - Another Harness, or a Codex the Person runs from a command of their
    own, is not told: it loads what it loads.

  A change of trust lets every process of the Project go; a turn that runs
  keeps its own, and the next starts one that reads the trust as it is.
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
  in a new turn, and the failed one stays as it ended. A turn whose
  message went again already leaves nothing to do, and the retry answers
  none, as `mkdir -p` does (ADR 0040, decision 5).
- **A Person signs in to a Harness in a way it offers** (ACP's auth
  methods; `harnesses.account`; ADR 0004), and the Harness keeps the
  credentials: Banda holds none and reads none of its files.
  - The engine declares that it runs terminals, so Claude Code's adapter
    offers ways in a terminal: the Harness entry's program with the way's
    arguments and environment, so an entry's own config folder gets the
    account. The Thread runs it in a terminal Pane in a tile below. Once
    its program ended with code 0, that Pane sends the sign-in on the
    machine (`harnesses.sign_in {harness, way}`), then tries the turn that
    needed it again in its Project (`agents.retry`). The workspace keeps that Pane, so the
    sign-in lands after a reload or with the Thread closed. The line stays
    to run by hand, after which the Person says so.
  - Codex's adapter signs in by itself in the browser when the engine asks
    (`harnesses.sign_in`).
  - A sign-in writes nothing to the Project, and its receipt keeps the
    answer. Every process of that Harness entry is let go, so each reads
    the account when it next starts.
  - A sign-in or sign-out that failed in a way that may pass, as a
    Harness that did not start, took too long or answered an error, is
    refused as `internal`, which its receipt does not keep, so the same
    command sent again runs. Only a state that lasts is `conflict`: a CLI
    that is not installed, an ACP version Banda does not speak, a Harness
    that does not sign out from Banda.
  - A turn that failed for a sign-in offers the ways, and goes again once
    the Person signed in.
  - Who is signed in comes from the Harness itself: Claude Code's and
    Codex's adapters push it (`_auth/status_update`, their extension, until
    ACP has it). `harnesses.account` gives it with the program's name and
    version; it waits a few seconds for a Harness that reports it but has
    not yet. A Harness that does not report it shows no one.
  - A Harness that declares ACP's logout signs out when asked
    (`harnesses.sign_out`), and its processes are let go as after a sign-in.
    The adapter signs its CLI out, so the Person's own terminal too.
  - The settings Pane's Agents, like T3 Code's provider settings, shows
    each entry with its CLI and adapter versions, who is signed in, Sign
    in, and Sign out where a logout ends the sign-in: an account's, not a
    key's. Check again asks the Harness anew; a sign-in or sign-out
    anywhere reads it again as `account_changed` arrives. It needs no
    Project: with none, a way in a terminal shows its line to run by hand,
    and what a new Thread starts with, which a Project offers, does not
    show. It turns an entry on or off, changes its command, and adds or
    removes one, writing `harnesses.toml` through `banda settings` (ADR
    0016). An entry with a known ID, `claude`
    or `codex`, takes each key it leaves out from Banda, so a new Banda
    moves its adapter; the window shows what is wrong in the file as in
    the look's. What a new Thread on each starts with, its mode, plan and
    options, as the composer's bar shows them (`agents.defaults`), is
    `agents.toml`'s `[start.<id>]`, set from the same bar in the settings,
    which writes it through the engine as the Person (ADR 0083):
    `harnesses.toml` says only how the Harnesses start (ADR 0040).
- **The Harness's notices**, such as warnings, join the Thread as lines of
  their own.
- **A notice for the Agent** says what another module did for the
  Person, as git's fact `git.acted` after a commit from the Thread's card
  (`notices.rs` hears it): a line of the Thread between turns, which the
  next message to reach the Harness, a turn's or one sent into it, takes
  before it (`agents_notices.taken_by`); every turn of that message sends
  it again, for any Harness. It starts no turn; a slash command the
  Harness runs leaves it for the message after. One prompt step
  (`effects::prompt_of`) puts who wrote a message, its skills as
  commands and its notices together.
- **A Thread has settings: a mode, Plan, and the Harness's options.** The
  modes are Supervised, Auto-accept edits, Auto and Full access, the
  default. Only a Person changes them, under the message box
  (`agents.configure`, which needs the Decide right): how freely an Agent
  acts decides what it asks. Each message keeps the settings its Thread
  had when it was sent, and its turn sets them on the session when it
  starts. The options come from the Harness, as it last offered them in
  the Thread (`thread.offered`); Banda keeps no model list of its own.
  When the Harness starts or leaves a plan by itself, the Thread's settings
  follow; a mode it moves to otherwise, or a stricter one it runs in
  because it lacks the chosen one, is a notice.
- **A Question is answered by a Person.** It shows every answer the
  Harness offers, its "always" answers too. A Harness without modes of its
  own does not ask: the engine answers its Questions by the Thread's mode,
  allowing once where the mode allows, and asks the Person otherwise.
- **A Question may hold a form** when the Harness asks for more than a
  choice, as Claude Code does for its own questions and Codex in a plan
  (ACP's form elicitation). Submit sends what the Person filled in, which
  the engine checks against the form first; Skip declines. No mode answers
  a form. What a Person types in a field the Harness marks secret reaches
  the Harness from memory only: the Thread and the outbox keep a mask. A
  form Banda cannot show goes unanswered, with a notice.
- **A Question closes** when the Harness stops waiting for it, as when it
  times out, when its turn ends unanswered, and when its answer never
  reached the Harness.
- **A Question is one module** (`questions.rs`): asking it, its answer and
  its close, with their rules, writes and facts; `live.rs` holds the
  Harness's wait for the answer and a form's secrets.
- **A tool call shows what it did:** a file change as its diff, and what
  a command printed, with how it ended. Codex sends output as it prints;
  Claude Code sends it once the command is done. The Thread keeps it all,
  up to 4 MB for one command's output, text or diff, which only a runaway
  command reaches; a diff past it says so instead.
- **A Visual is a page the Agent shows** (ADR 0037): `show_visual` keeps
  its HTML in the Project's data, `projects/<id>/visuals/`, and the Agent's
  turn that runs gets an item, `visual.shown`, which no fold hides. The
  window serves it at `app://visuals/<project>/<visual>`, an origin of its
  own, sandboxed by its response and its frame (`apps/agents/desktop`),
  and the frame passes it the look's colours as T3 Code's variables.
- **An Agent's plan** for its turn is one entry whose steps follow the
  Harness: each plan it sends replaces the steps, and an empty one clears
  them. A new turn's plan is a new entry. Codex in plan mode writes its
  plan as a message instead.
- **What the Agent has used**, its context and what it cost when the
  Harness says, belongs to the Thread (`thread.used`) and shows under the
  message box. What it says between turns reaches the Thread at once.
- **A message the Harness names anew** (ACP's `messageId`) starts a new
  entry.
- **Slash commands** come from the Harness with what it offers the
  Thread (`thread.offered`). A message that starts with `/` and one's name
  is sent as it is, and the Harness runs it. Claude Code says them just
  after a session opens: the session keeps them, and the turn writes them
  as it starts or ends. A session that has not said them yet leaves the
  Thread's. A list said between turns reaches the Thread at once, like
  what the Agent has used, and a new Thread's message box offers what the
  Project's Threads on its Harness last learned. The window suggests them as a
  message starts with `/`, and adds `/plan` and `/default`, as T3 Code
  does: they switch plan mode and send nothing.
- **A message can carry images**, as in T3 Code: PNG, JPEG, GIF or
  WebP, at most 10 MB each, 100 per message and 80 MB together. The window
  makes a PNG or JPEG with a side longer than 2000 pixels smaller first.
  Each image goes to the engine as the Person adds it (`agents.attach`),
  in a call of its own, since one WebSocket message holds at most 16 MiB;
  the message then names them. The engine keeps the bytes as a file in
  the Project, and the window reads them back with `agents.image`. An image
  no message took within a day goes when the next one is added. A Harness
  that takes no images (ACP's `promptCapabilities.image`) says so in what
  it offers, and the window offers no images; a message with images gets
  the text alone, with a notice, and one of images alone fails its turn.
- **One function moves a turn** (`rules::next`, ADR 0018): given what the
  engine knows of a turn and what happened (queued, opened by the Agent,
  started, stopped, changed, taken back, steered, tried again, ended,
  cut short by a restart), it says the turn's next state, how it ended,
  whether the queue is held and what the outbox does next, or refuses, a
  late event too, such as a Harness ending a turn that ended. The rules
  the commands ask are questions to it. **One writer applies it**
  (`writer.rs`): the commands, the outbox's effects and the listener
  between turns make and move turns only through `writer::make` and
  `writer::apply`, which write the step in the caller's transaction. The
  I/O only runs effects and says what happened: `effects.rs` runs START,
  STOP and STEER on the Harness and `questions.rs` runs REPLY;
  `transcript.rs` writes what the Harness says, and `between.rs` turns
  what it says between turns into events. Both kinds of turn run through
  one `drive` (`drive.rs`). Memory holds a turn as a `TurnRun` from
  `Live::open`, and lets go of it and its Questions when the run is
  dropped, however its task ended. Whether a turn was asked to stop is its own state
  (`agents_turns.stopping`), which the rules read: a Harness that cancels
  a turn nobody stopped failed it, and the Agent's own turn ends stopped
  once a stop was asked, however its Harness ended it; `live.rs` keeps
  only whether the Harness was told. A restart is one event, `cut short`,
  given by the outbox to the turns its effects ran and by `opened` to
  every turn still running, which a module's `opened` sees before any
  effect runs. A Thread runs one turn at a time (a unique index on its running turn):
  what the Agent does by itself opens its turn once the turn that ran is
  written as ended, and a turn the outbox starts takes the Agent's own
  over. Nothing waits by reading again: what waits on memory (a turn's
  prompt going out, a Question's answer) is told by `Live` when that
  changes, and what waits for a turn to be written as ended follows the
  module's committed `turn.ended` facts about the Thread (the kernel's
  `ModuleProject::committed`). A turn keeps who opened it
  (`agents_turns.opener`): a Person's message, a retry, a message its turn
  could not take, the Agent by itself, or another Thread's Agent that
  asked or answered (`from_thread` names that Thread); "by itself" is read
  from it.
- **Agents talk by writing to each other's Threads** (ADR 0019, decision
  4). The Agent of Thread A calls `send` (the `agents.send` tool, with only
  `thread` or `harness`, and `text`); B gets a message by A's Agent and a
  turn opened as asked, which waits in B's queue as a Person's would, but
  never lets a held queue go on nor joins the turn that runs. The Harness
  reads a first line naming A's title and ID and that it is not its
  Person's word; the Thread keeps the plain text. When that turn ends,
  however it ends (the writer, in the same transaction), its last reply,
  or how it ended and why, goes back into A as a message by B's Agent, in
  a turn opened as answered, which answers nothing back; a Person's retry
  of an asked turn still answers. An Agent writes only from its own
  Thread. Three rules, in `rules::to_thread::may_write`: no circle (an
  Agent cannot write to its own Thread, nor to one up the chain of asked
  turns still going that waits for its answer), not over a Person's
  Question (a Thread with an open Question), and only its own Project (the
  kernel's wall). A message's author is
  the other Thread's Agent, which the Thread list names (`agent`); an
  answer says so (`answers`). The Thread Pane shows that Thread's Harness
  and title over the message, in the queue too ("Asked by …" or
  "Answered by …"), and a click opens it beside.
- **A turn says what a Person may do with it** (`can`, ADR 0014): stop
  it, try it again, change, take back or send its message now, or send a
  message into it. `rules::can` asks `next` what it accepts, and the
  window shows only what it allows.
- **A restart interrupts** the turn it cut short and closes that turn's
  open Questions. Turns that waited stay queued, and the queue is held. A
  message sent into a turn that never got it waits for a turn of its own.
- Its methods and their rights are the `methods!` table in
  `apps/agents/engine/src/lib.rs`, and its facts in `model.rs`.

### harnesses

- **The machine's Harnesses** (ADR 0040): the ones this computer can
  start, and who is signed in to each, with no Project, so a Person signs in
  before making one. `harnesses.list`, `harnesses.account` (with the
  machine's log position it is current at), `harnesses.sign_in {harness,
  way}` and `harnesses.sign_out`. It owns `harnesses.toml`.
- It asks through a Harness process of its own, with no session, in a
  pool keyed by the machine's ID, let go after five minutes with nothing
  asked.
- **A sign-in or sign-out writes `harnesses.account_changed`**, its
  subject the Harness's ID and nothing else. Every holder of that
  Harness's process lets go of it: this module, and each Project's agents
  module, which hears the machine's log (`ModuleProject::listen_to_machine`)
  and lets go of its own hosts of it without waiting. A host that was
  starting then is let go the next time it is asked for (`hosts.rs`
  marks it stale). The command answers once every reaction handled
  the event, so a call after it finds every old process gone.
- **The code that speaks to a Harness is the crate `banda-harnesses`**,
  which knows nothing of Threads: the list and its file, finding the
  Person's CLI, a process (`acp::Process`: starting, recording, agreeing
  on ACP, who is signed in) and the pool of processes. A process starts
  in the environment of the Project the pool is asked for, and ACP speaks
  on its pipes (`acp/pipes.rs`); a short run apart from a Thread runs in
  the Thread's process. That program is the entry's start: a carried
  Harness's is its adapter, on Node, which runs the CLI. The CLI is found
  on the host and asked its version in the environment, and with `local`
  all of it runs on the host. ADR 0084's split, the adapter on the host
  and its CLI in a box, found there, comes with the `container` adapter
  (its decision 5, plan step 3). The agents module wraps a process with
  its sessions' handlers and capabilities. The agents module and
  `harnesses` share one list. The version a CLI says is kept by its path
  as the latest look found it, by any process, and checked against its
  entry's `minimum` at each read: a Thread stops warning once the Person
  updated it and checked again.

- **Usage comes from local journals** (ADR 0043). `harnesses.usage`
  returns tokens and estimated USD API cost for a half-open interval of up
  to 90 days, defaulting to 24 hours, with UTC-day, Harness and model rows.
  `read: true` first scans Claude Code and Codex journals; an open window
  also causes a scan every minute. `[usage] read = false` stops reading;
  previously counted totals remain available. Offsets and parser state
  are committed with counters, and records older than 92 days are pruned.
  Repeated records and entries sharing a folder count once. The store
  retains counters and session identifiers, never conversation text.
  `harnesses.usage_changed` tells a window to ask again. This method is
  not an Agent tool: it describes all local sessions, including those
  outside Banda. Price data ships with the engine; collection makes no
  provider request.

### terminal

- **A Terminal is a program on a PTY** in the engine, run as the Person:
  their shell in the Project's folder, or a program with its arguments,
  never a shell line, such as a Harness's sign-in. It starts in the
  Project's environment (ADR 0084), as does every server run in it. It
  needs the Run right, and it belongs to its Project. The window chooses
  its ID, so a Pane names its terminal before the engine answers
  (`terminal.open`). Opening one whose program ended runs the program
  again.
- **What it printed stays in memory**, the newest 2 MB, never in the log: a
  screen repaints megabytes, and the program ends with the engine anyway.
  The bytes become text as they come, a character split between reads
  whole.
- **A window watches it through a stream** (`terminal.watch`): the screen
  so far first, then what it prints and the size a window gives it, then
  how it ended. Every window that opens it sees the same screen, and a
  window that falls behind gets the whole screen again.
- **Typing waits at most 5 seconds** for a program that does not read.
- **A close stops what the program started too.** The program leads a
  session and a process group of its own. While it runs, a close sends the
  group a hangup and a request to stop, then a kill a second later; a
  shell passes the hangup on to its jobs. A close ends every watch.
- Its methods are the `methods!` table in `apps/terminal/engine/src/lib.rs`.
- **Its Pane** (`apps/terminal/pane`) draws a terminal with Ghostty:
  T3 Code's adapter over `libghostty-vt` compiled to WebAssembly,
  vendored in `client/ghostty`, on a canvas in the window's colours.
  - Opened from the menu, it starts the Person's shell, and starts it
    again when the engine lost it.
  - Another Pane that started a program opens it on that terminal, as a
    sign-in does: `{kind: "terminal.terminal", args: {terminal, title,
    shell: false, done}}`. `done` is a list of commands the Pane sends
    once the program ended with code 0, in order, each only once the one
    before went through, as `a && b` does. Each says where it runs: a
    Project, or with none, the machine (ADR 0040, decision 5). Its ID keeps
    each once only. Then the Pane closes.
  - It sends what the Person types one call after another, as the engine
    runs calls side by side.
  - Closing the Pane closes its terminal. Moving it to another column or
    workspace draws it again and does not.

### files

- **The engine reads the disk, and watches what is shown** (ADR 0073,
  decision 4): `files.list`, `files.stat`, `files.read` (text up to
  1 MiB, or that it is binary), `files.find` (fuzzy, gitignore-aware)
  and the stream `files.watch`, on the kernel's watch service. Each path
  goes through the kernel's path guard, `Reach`: a relative path starts
  at the Project's folder, the Person reaches any, an Agent only its
  Project's. It only reads; writing comes later.
- **It keeps what the Person opened**, in `files_recent` (path, last
  time, count): `files.file` says each file it shows with the command
  `files.opened`, `files.recent` lists them, and `files.find` raises them
  a little among matches of their kind. `files.places` answers home,
  Desktop and Downloads as the system names them (XDG's user dirs on
  Linux).
- **`files.find` answers every "which file"**: the composer's `@` and the
  Banda menu's Files, a source of the files module's own. The menu opens
  `name:42` at line 42; its Tab offers "Show in Files" too.
- **`files.tree`** is any folder as a Finder shows it, one Files Pane per
  Project that the menu's Files (`files.tree`, Alt+E), "Show in Files"
  and `banda files [path]` find again:
  - the places on its left (the Projects with their badges, Home,
    Desktop, Downloads, what `files.toml` pins, Recent), folded to icons
    on a narrow Pane;
  - its path as crumbs, a field on a click or Ctrl+L, Tab completing a
    folder from `files.list`;
  - the tree, `@pierre/trees` behind `@banda/ui`'s `FolderTree`: one
    folder listed as it opens, a folder of one folder as one row, what git
    ignores greyed, dotfiles on Ctrl+Shift+., git's marks from the git
    module's `git.watch` where the folder is in the Project, the open
    folders watched with `files.watch`;
  - typing filters it with `files.find`, the matches under their folders.

  Its keys are its own, with Ctrl (⌘), never the mod; each is also an
  unlisted action (`files.up`, `files.path`, `files.hidden`,
  `files.filter`) that `keys.toml` can bind, until ADR 0071's scopes.
- **`files.toml`** (ADR 0073, decision 13) holds the pinned places,
  whether hidden and ignored files show, and `[previewers]`, the
  previewer an extension shows in; a folder's menu pins it and "Open
  with…" picks one through the settings bridge.
- **Its Pane** (`apps/files/pane`), `files.file`, shows one file, one
  Pane per file. `files.stat` says what it is, and the previewer that
  claims it draws it (`previewers.ts`, each view in `views/`):
  - code and text: `files.read`, drawn by `@banda/ui`'s `CodeFile`, the
    Diff's `@pierre/diffs` view and colours with numbered lines, opened
    at a line centred and lit once; past 1 MiB or 20 000 lines, its start
    with a note. Lines picked in the gutter copy as `path:12-20`;
  - markdown: the Thread's Streamdown, its source a toggle away, its
    pictures through the file host from the file's folder;
  - an image: an `<img>` from the file host, an SVG too, to zoom and pan;
  - a PDF: PDF.js in a module worker, its bytes read from the file host
    in 64 KiB ranges as pages need them, the pages drawn only near the
    view with their text to pick, find on Ctrl+F (⌘F), the zoom, and the
    pages' pictures in a wide Pane;
  - video and sound: Chromium's players on the file host, which seek in
    ranges; one Chromium cannot play shows its facts and its app;
  - a page, HTML or an SVG document: a frame of the sandbox host,
    `app://preview`, its source a toggle away;
  - anything else, and what reads as binary: its facts.

  It follows `files.watch` on the file's folder, reads again as it
  changes, and keeps its scroll.
- **Quick Look** (ADR 0073, decision 7) is `files.file` over the desk:
  Space in the tree runs `files.peek`, which asks the window to show the
  Pane in its one floating tile (`WindowApi.peek`, `PaneProps.peek`);
  the tiling stays, the tree keeps the keys, and as the pick moves the
  tile is given the next file. Esc or Space closes it, ↵ opens the file
  as a Pane, and the Banda menu's key has it fill the desk. A reply's
  path menu and the Banda menu's Files show a file there too.
- **Every link to a file opens it there**: the window's `file.open` runs
  the files module's `files.open`, which opens the file beside the Pane
  it was opened from, or takes the Pane that shows it to the new line
  (`WindowApi.open` with `update`). A reply's paths and a terminal's
  carry their line.

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

Threads, turns, tool calls and Questions are Banda's model. The agents
module reaches a Harness through an adapter:

- **ACP** is the first and default adapter. It covers any agent in the ACP
  Registry.
- **Claude Code and Codex go through ACP too**, through their official
  adapters (ADR 0003). A native adapter is added only where ACP blocks
  something users need; a native Codex adapter comes later, for its rate
  limits.
- **The ACP adapter** is the agents module's `acp.rs` (a Harness's
  sessions, on a process `banda-harnesses` starts, agrees on ACP with
  and asks who is signed in) with a file per concept under `acp/`:
  opening a session, a session, what the Harness says, its options and
  modes, failures, and what it asks. A turn holds a `Session`, its process and session as
  one handle (`prompt`, `steer`, `cancel`, `settle`, `running`); what
  listens between turns holds it weakly, so a process let go stops.
  `acp/routes.rs` alone says where what a session says goes: to the turn
  whose prompt it answers, or to whoever hears it between turns.
- **Capabilities.** The engine declares what the window can show (notices,
  options that are on or off, forms, and a command's output as it comes),
  and the adapter reads what the
  Harness declares (sessions that resume or load, their options, and
  steering, which each message sent into a turn opts into). The
  rest of the engine reads those capabilities and never the Harness's
  name. A failure's class comes from ACP's error codes
  and the data the adapters attach to an error.
- **Modes.** Each mode becomes the Harness's own where it has Claude
  Code's or Codex's modes, told by their two strictest values when the
  session opens; never freer than the one chosen when the Harness lacks
  it; the Harness then decides when to ask. Plan is Claude Code's
  plan mode and Codex's collaboration mode. Any other Harness's modes are
  options like the rest. The table is in `acp/options.rs`.

## Window

```
client/desktop                      Electron main: starts the engine, serves the page, hands it the address
client/desktop-kit                  what a module's part in main may use of main: its services, dialogs, errors, the bridge's answers, the byte host
client/web                          the page: the bar, the sidebar, the workspaces and the overview; the actions; the Pane registry
client/core                         the core every client shares, with no DOM: Here, the stores read by selector, what an action runs with, the device's words, the hosts
client/ui                           shadcn/ui (preset b0, on Base UI), Banda's Mark and sounds, and the Pane contract
client/ghostty                      T3 Code's Ghostty adapter: a terminal on a canvas
apps/*/pane, platform/*/pane        each module's Panes
apps/*/desktop, platform/*/desktop  a module's part in Electron main
```

- **The page reaches the engine only through the API.** Electron main gives
  it one thing: the engine's address, through `window.banda.engine()` in
  a sandboxed preload. The page is served from `app://banda` with a
  strict Content Security Policy. It cannot navigate, open windows or get
  permissions, and links open in the browser. It may run WebAssembly
  shipped with it, which Ghostty draws terminals with.
- **The window reaches the engine; it does not own it** (ADR 0086,
  decisions 1 and 3). Main runs `banda start --with-parent`, which starts
  the engine when it does not run, prints where it listens, and follows
  it while the window is open; where the engine is the window's child,
  it is the engine, `serve --with-parent`, and its stdin closing stops
  it. When the engine stops as asked, by Quit Banda or `banda stop`, the
  program ends with code 0 and the window quits; when it crashed, main
  starts it again (waiting up to 10 s between tries). Closing the last
  window only closes it: the engine and its Agents go on. Quit Banda
  (`banda.quit`, Ctrl+Q, but for a terminal's program, whose key it is
  there) asks first while Agents work ("2 Agents are working. Stop them
  and quit?"), then main runs `banda stop --force`. On macOS the app
  stays until it lives in the menu bar (plan step 7e), though its
  engine, a launchd job, outlives it
  (`client/desktop/src/closing.ts`): closing the main window hides it,
  its page left to call the Person and sound, and its Panes' own windows
  close; the Dock's icon, or Window > Banda, shows it again. In the page
  ⌘Q is Quit Banda's own key. The app menu's and the Dock's Quit, and ⌘Q
  where the page leaves the key (in a terminal, over a dialog, with the
  window hidden), run `banda stop`, which stops the engine where no Agent
  works; where some do, the window comes to the front and its Quit Banda
  asks first, or a system dialog does when the page crashed or loads, or
  the Person quits again within 10 s. A logout, restart or shutdown quits
  without asking. `banda look --follow --with-parent` stays the window's
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
  (`window/keys.ts`), and reaches the desktop only through the device's
  desktop adapter, `boot/desktop.ts`, by `boot/index.ts`; at last the
  adapter is the only reader of `window.banda` (ADR 0089, decisions 2
  and 11). What every client shares is `client/core` (`@banda/core`,
  and `@banda/core/react` for what reads it from React): Here and the
  store the Window keeps it in, the store read by selector, what an
  action runs with, the words the page and the desktop say to each
  other, and the hosts the Window reaches (`KeptHosts`, with the
  machines a new Thread starts on), which take the names this device
  remembers from the Window. It has no DOM, reads no device and names
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
    together (`tiling/arrange.ts`). A key works out its change with
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
  window does, the modules' actions and its own, each with a name, its
  key sheet section and a default key, by its physical place.
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
  window for the rest.
- **The sidebar** lists every Thread of every Project, arranged as a preset
  and the Person's keys say (ADR 0008): grouped by state, by Project or not
  at all; sorted by need, by change or by title; shelves at the bottom;
  a list of Projects above; rows of one, two or three lines. `arrange.ts` is
  the one pure rule. `banda look` resolves the keys from `sidebar.toml`
  (`platform/look/src/sidebar.rs`; Banda's presets `inbox`, `projects` and `places`
  are files in `platform/look/sidebars/`), and the view menu writes the preset
  into the file, keeping the Person's other keys and comments. The sidebar
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
  tools/fake-agent/   a scripted ACP agent for tests and window checks; it replays recordings too
  scripts/check.sh    every check a change must pass
  scripts/try.sh      builds a tree and opens a window of its own from it, to click through
  scripts/local.sh    starts a checkout's window in a systemd unit of its own (ADR 0086)
  scripts/layout.sh   moves the old folders where ADR 0062 puts them, on a branch made before too
  docs/               adr/ · architecture.md · research/
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
its Project. The agents desktop part resolves relative paths against that
Project's folder and gives only supported media a signed `app://files`
URL: a reply's paths are an Agent's to write. Nothing plays
automatically. Images open larger on a click; a missing or unsupported
file stays a link.

The byte host behind those URLs is `FileHost` in `@banda/desktop-kit`
(ADR 0073, decision 5), which main serves. Its signer lives in the main
runtime, never on disk. A URL lasts an hour and names the canonical path,
device and inode; serving checks the identity again through the opened
file, which it opens without following a link. Byte ranges let players
seek without reading the whole file. It serves any file, typed by its
extension: text as plain text, so an HTML file never runs, and what it
does not know as bytes, each never sniffed and sandboxed. A Pane the
Person drives asks for any file through the bridge's `files.url`,
typed in `@banda/ui/desktop`, and `useFileUrl` keeps its URL fresh. No
frame shows the host. The page reads its ranges with `fetch`, as a PDF
is read: the `app` scheme allows CORS, the host answers any origin that
holds a link, and the page's `connect-src` names it.

A page among the Person's files, HTML or an SVG document, is shown by a
second host, `PreviewHost`, `app://preview` (ADR 0073, decision 5),
signed by its own secret and asked through `files.preview`. It answers a
frame's navigation only, never a page's fetch nor a picture (Electron's
handler hears no `Sec-Fetch-*`, so a navigation is what asks to be
upgraded and names no origin), and its response sandboxes the page
whatever the frame says: `sandbox allow-scripts`, never
`allow-same-origin`, with `default-src 'none'`, pictures inline or from
the byte host, inline styles and scripts. The page's `frame-src` names it
beside the modules' hosts.

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
  terminal's Pane also Ghostty. No code of the engine makes a process
  but `banda-environments`, and the places named in its test, each with
  how many and why, that ask the host about itself or keep Banda's books
  and run nothing of a Project's (ADR 0084, decision 4); no code uses
  ACP's agent that starts its own. Each place that makes a `Program` is
  named there too, with whose it makes and why (ADR 0083, decision 1).
  In the window (`client/web/src/architecture.test.ts`), only
  `modules.ts` and the bridge's table name a module's package, and
  nothing more animates a size or a place (ADR 0088). Its tests find the
  Apps' and platform parts' folders by their `app.toml` through `parts`
  (`@banda/ui/testing/architecture`), which fails when it finds none. Of
  ADR 0087's checks, three ratchets that only fall hold what the Tiling
  imports of the Window, the App strings in the Window, the Tiling and
  the sidebar list, and a line ceiling on the Window's root (decisions 1
  and 5); what the sidebar list's components still take as code is
  listed, none of it a Project's or a Thread's verb, and the list pins
  no Project and writes no `agents.toml`, as it runs the actions by id
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
  11).
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
