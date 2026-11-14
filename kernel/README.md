# The kernel

What every module needs, and nothing a module owns: `kernel/` names no
module. [The architecture](../docs/architecture.md#kernel) is the map
this page is one part of. A change to the kernel changes this page in
the same PR.

## Its parts

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
  becomes `<id>.gone` and is deleted, and its folder is not touched. Each
  change is said in this machine's log (ADR 0127): after a command of
  `projects.*`, the kernel writes one fact `changed` as `projects`, a name
  no module takes, for each Project whose line in the list reads
  otherwise than the log last said, its subject the Project's ID and its
  payload which Project and what happened to it, `added`, `updated`,
  `located` or `removed` (`ProjectChanged`); a sign found as the engine
  starts is said so too. A command that changes nothing, or is sent
  again, says nothing. `projects.listed` gives the list with its place in
  that log, `at`, and who follows the Projects reads it again on each
  fact after it: every list of them in a window does (`useProjects`,
  `client/ui/src/hooks/use-projects.ts`), each machine's from its own
  engine, so a Project added by `banda project add`, by an Agent or from
  another window shows at once, and nothing is read again as a window
  comes to the front. What an engine finds as it starts, as a folder gone
  while it was stopped, no fact says: a window reads the list again when
  its engine says a new boot. A kernel with no module of the machine's
  has no log, and says none. A
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
- **Devices** (ADR 0124). A port beside Identity, for the door: this
  machine's host key and the devices it paired, which the engine keeps
  and hands to the door's router (`kernel/src/devices.rs`,
  `devices::router`). The door is a second way in beside the API, over
  the same session, for the Person's devices on any pipe; the API stays
  for the programs on this machine, with the owner's secret and their
  passes, and the door takes neither. Both ends prove a key on every
  connection:
  - the door speaks first, a `challenge` with a nonce, the host key, the
    time and the protocols it speaks, signed by the host key;
  - the device answers `hello` with the range of protocols it speaks, its
    ID, a nonce of its own, and its key's signature over the door's
    nonce, the host key, the origin its page came from and its own
    nonce, so it opens no other connection, no other machine, and no
    page elsewhere uses it;
  - the door answers `welcome` with the protocol it picked and, as
    `door`, the host key, the device and the host key's signature over
    the device's nonce, which no pipe that repeats an old challenge can
    make; or `goodbye`: `forbidden`, and to a device that proved itself,
    `revoked` once this machine removed it, or `protocol`. A `goodbye`
    to a `hello`, and the one that ends a session, is signed by the host
    key over that `hello` as the door heard it and the reason: a client
    marks it `signed`, the machine's own word to what it sent, and acts
    on no other.

  A device's session acts as the Person who paired it, and a module reads
  the device as `Call::device`. Removing a device ends its sessions at
  once, each told `revoked`: the port says each removal
  (`Devices::removals`), and a session asks whether its own is still
  paired.
  The door also serves the window's page to a browser that asks for
  one, from the page's build beside the engine's program
  (`engine/src/page.rs`; SE5): itself only, by a policy that lets it load
  nothing from elsewhere, and never on the API's port.
  A device this machine has not paired asks at the door with `ask`, by
  its own key, and waits there under a code both screens show; the
  devices module keeps the askings in memory, and `devices.allow` or
  `banda devices allow <code>` pairs one (decision 6).
  The contract's client speaks both ways in (`sdk/contract/src/engine.ts`,
  `door.ts`): its `Address` says the owner's secret, for the API, or a
  `DoorKey`, for the door: the device, the host key it paired with, and
  what signs for the device, which never hands the client its key. At the
  door it answers only a challenge that host key signed, takes what the
  door says one frame at a time until the `welcome` proved the key over
  its own nonce, and says a door that is another machine's as a refusal.
  Either way it sends what it follows and hears right after its `hello`,
  before the `welcome`, so a connection costs one round trip less.
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
  (`trust_said`, `Place::said` in `Harness::launch`), and no GitHub token or
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
  something an Agent ran listening under it is not let go for idling. Until
  the fence is designed whole it is off, for every build, and
  `BANDA_FENCE=on` turns it on (ADR 0115). An Agent's `banda settings` and `banda keys bind` go
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
  that hears a new one knows every session of the last ended. It lists
  the engine's Apps too, `apps`, each with its version and the major of
  the App API it is written to, as their manifests say, and the apps
  module's `apps.describe` gives each App's methods (ADR 0082, decisions
  2 and 14); `banda status` prints the list. The protocol's version is the
  kernel's `PROTOCOL`, which the contract takes from its generated files.
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
- **An action runs from anywhere** (ADR 0127, decision 2). `banda act ID`
  and an Agent's `act` tool run any action of the window or of an App by
  its id, as its key does. Both call `keys.act` (`platform/keys/engine`),
  which checks the id and the args against what the manifests declare, as
  a line of `keys.toml` is checked, and refuses an Agent what acts as the
  Person (`runsAsPerson`, ADR 0083, decision 3) and what a field's scope
  does, as the Composer's Send; every other action is an Agent's to run.
  An action that declares no args is given none. It asks the window by the road, and main hands the
  action to its page and awaits the page's answer
  (`client/desktop/src/acts.ts`, the one road by which main asks the page
  to run an action; its menu bar goes by it too). The page runs it where
  the Person is now and says it ran, or why not
  (`client/web/src/window/asked.ts`): it has no such action, the focus is
  not in the action's scope, or the router did not run it there.
- **Receipts and outbox.** These carry every command along one path (below).

## The command path

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
  A module's calls that say so (`Module::in_order`) wait the same way in
  a queue of their own for each thing they act on, behind no command: a
  terminal's writes and sizes, so a key lands after the key before it,
  its Pane sends each as it is typed, its echo is one round trip away,
  and a program that reads nothing holds up no other terminal. The
  terminal's snapshot says so (`in_order`); for an engine that does not,
  the Pane sends one at a time (`apps/terminal/pane/src/input.ts`).
  Queues run beside each other, and other calls and streams wait in none,
  nor does a command its module says runs on past one write
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
- Those seven days are a convention of Banda's clients for a command
  that carries no `not_after`: `banda mcp` sends a command again at once,
  within its session. A command may carry `not_after`, in ms since the
  epoch by the host's clock, as a message that waited for its machine
  does, seven days at most from when it was sent (ADR 0105). Its receipt
  is looked up first, so one that ran gets its answer however late. One
  not run yet is refused `expired` past it, before its module sees it,
  and `expired` is kept as its answer, so a resend gets it too
  (`Kernel::answer_until`; ADR 0082, decisions 4 and 16).
- Outbox rows are the kernel's bookkeeping, not records of the work. What a
  Person sees of an effect is the events its module writes.
- A window loads a snapshot at sequence N, then streams the events after N.
  It names the module, subject and kinds it shows, so it hears only those.
  The engine replays the log a page at a time, and a subscriber that falls
  behind catches up from the log.
