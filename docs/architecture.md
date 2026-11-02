# Architecture

This is the shape Banda is built to. The decisions and their reasons are in
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
  SQLite writer per Space. Modules are crates in one binary.
- **One program, `banda`.** `banda serve` runs the engine. It listens
  on 127.0.0.1 only, and writes its port and a fresh secret to
  `engine.json` in its state folder, a file only this user can read. A
  window starts it with `--with-parent`: the engine then prints the same
  JSON as its first line, and stops when its stdin closes. A second
  engine with the same state folder refuses to start.
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
  the desktop's ad blocker (`app/desktop/src/blocker.ts`) on and off.
  The agents module's
  `agents.toml`, what Enter does in the composer, comes with it the same
  way (ADR 0016). The settings Pane writes every file through `banda
  settings set` too; nothing else the page asks of Node writes a file. A Pane reads its part of the look
  through `@banda/ui/lib/look`.
- **The Banda skill is text for Agents** (ADR 0012). `banda skill`
  prints its core, `banda skill <topic>` a topic, and
  `banda skill --export <folder>` writes an Agent Skills folder. Each
  part of Banda writes its topics in a `skill/` folder beside its code,
  and `modules/skill` gathers them when it is built; a topic may include a
  file the part ships, such as `look/sidebar.toml`.
- **An Agent reaches Banda through `banda mcp`** (ADR 0019). The agents
  module hands it to every ACP session it opens (`session/new`, `load`
  and `resume`), as a stdio MCP server named `banda`, with two
  variables: `BANDA_TOKEN`, a new pass for the session's Agent, and
  `BANDA_ENGINE`, where the API listens. It is a pipe: MCP on stdio, one
  JSON-RPC message per line, written on `serde_json`, and the engine's API
  on the other side. Its calls name no Space, so they run in the pass's.
  Its tools are `spaces.tools`, read once as it connects: the module
  methods marked `tool` in their `methods!` tables. It adds `skill`,
  which it answers itself from the Banda skill. Its
  `instructions` are the skill's core. A refused or malformed call is a
  tool result marked `isError`, with the refusal and that nothing was
  done; only an engine that does not answer is a JSON-RPC error.
- **The CLI prints JSON.** `banda call <method>` prints `{"ok": …}`.
  `banda follow` prints events, one per line. When the engine refuses
  the call, the hello or the follow, the CLI prints
  `{"error": {"code", "message"}}` and exits 1. When no engine answers,
  or the CLI cannot do its part, it says so on stderr and exits 2; a call
  that broke off names the command ID that repeats it safely.

## Kernel

The kernel holds only what every module needs, and it names no module.

- **Space.** A folder on disk (a new one goes in `~/Banda/<name>/`) and
  its data in the engine's data folder, `~/.local/share/banda/spaces/<id>/`
  (ADR 0026): `space.json`, which names the folder, the Space's SQLite with
  the modules' migrations and the event log, and the modules' files. The
  folder holds the work alone. One engine at a time opens a Space: it holds
  a lock on `spaces/<id>/space.lock` while the Space is open. Spaces from
  before ADR 0026 move their `.banda/` there the first time an engine
  starts.
- **Event log.** Append-only, with typed events, one per Space. Windows and
  the CLI subscribe to it. A subscription sends only what its view needs.
  The database itself refuses to change or delete an event.
- **Access decision.** One function decides whether a Participant may perform
  an action on a target. Every method and every subscription passes through
  it, before any module code runs. On one computer it answers: the owner may
  do everything; an Agent may read and change the work, but neither change
  the Space itself, decide what an Agent asked a Person, nor run programs
  as the Person in a terminal (an Agent runs them through its Harness);
  nobody else may do anything. Members and roles arrive here later.
- **The Space wall** (ADR 0019, decision 2). A caller with an Agent's
  pass calls, subscribes and streams only in that pass's Space. The
  kernel checks it where it finds the Space, before the access decision
  (`access::within`), for the API and for callers in the engine alike. A
  call that names no Space runs in the pass's; any other Space is
  refused. `spaces.list` shows it only its own.
- **This machine** (ADR 0025, decision 1). A module whose data holds
  every Space's, as the workspaces do, is the machine's
  (`Module::scope`). The kernel keeps one more store like a Space's for
  those modules, in the engine's state folder (`machine/`), with its own
  receipts, event log and outbox; a Space's modules never open there, nor
  the machine's in a Space. Their methods name no Space. The machine is
  no Space in `spaces.list`; `welcome` names its ID, which a window
  follows and streams by. An Agent's pass stops at it, until the
  workspaces give Agents their tools.
- **Identity.** A port: it says which Participant a connection's token names.
  On one computer, whoever holds the engine's secret is the owner. Later it
  is OIDC, or our accounts.
- **Passes.** A module asks its `ModuleSpace` for a new pass of an Agent
  (`pass(agent)`), 32 random bytes in hex; the agents module asks as a
  session opens. The kernel keeps passes in memory, so they end with the
  engine. A `hello` with a pass connects as that Agent, in that Space.
- **Module registry and API.** The registry routes commands to their
  module, delivers events to subscribers, and serves the API. `welcome`
  lists the engine's modules, so a window shows only what the engine has.
- **Streams.** A module can answer a window with live pieces that are not
  facts, such as what a terminal prints: the window asks for a stream
  (`stream`) and hears its pieces (`piece`) until it ends (`ended`) or the
  window lets it go (`unsubscribe`). The access decision runs when it
  starts. Each stream has one piece on its way at a time, so a window that
  reads slowly holds the module back, which sends more in the next piece.
  Nothing of a stream is logged; a window that connects again asks again
  and hears it from the start.
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
| Text files | the Harnesses, in the config folder; the look (`look.toml`, themes) and the sidebar (`sidebar.toml`, presets), the browser (`browser.toml`) and how messages to an Agent are sent (`agents.toml`) in `~/.config/banda/`. Layouts and keys join them later |
| The Harness | its session, context and sign-in. We keep only its session ID, as evidence |
| The OS keychain | secrets you give Banda. Its database never holds them |
| The engine's state folder | the owner's ID; while the engine runs, its port and per-run secret |
| The window's storage | the workspaces: their columns, each Pane with its Space, the widths and the focus; whether the sidebar shows; which finished turn of each Thread the Person has seen |
| `spaces/<id>/` SQLite, in the engine's data | Threads, Questions and answers, the Agents' queue, Databases' records, receipts, events, outbox |
| `spaces/<id>/images/` and `files/` | the bytes of the images messages carry, one file per image, the SQLite saying what each is and which message carries it; the files a message keeps (a dropped file, a long paste), which each Thread's session gets as an extra root |

Events are facts with a version, and the log is never rewritten. Each module
keeps its own ledger of migrations. Our IDs are UUIDv7. A Harness's IDs are
stored as references.

## Modules

A module is a bounded context with its own words, its own data and its own
contract. It is one folder:

```
modules/<name>/
  engine/      Rust crate: rules · store · operation · adapters
  pane/        React package: its window part, one defineModule
  module.toml  id, name, version, from Banda, settings files, unstable marks
  window.json  its window part as the engine reads it, written by the window's tests
```

A module declares itself in its code and a short `module.toml` (ADR 0022).
Its engine part is the `Module` it gives the kernel, with its `methods!`
table. Its window part is one
`defineModule({ id, engine, panes, watches, actions, sources, start })`
exported from its Pane package; the window lists these in
`app/web/src/modules.ts`, the one place that names a module, and builds its
registries from them. `start` runs once with the window API, for a module
that acts on the window when the desktop tells it something. `module.toml` holds only what no code says.
`banda modules` prints the three as one JSON per module
(`engine/src/modules.rs`), and the skill's `modules` topic is written
from it. A path a module takes that the contract lacks is an unstable mark
in its `module.toml`, with why; the tests hold the count at a ceiling that
only falls, and `scripts/check.sh` prints them.

**Its contract** is everything it shows outward:

- **Methods it accepts**, each a call, a command or a stream with typed
  params and answer: one line in its `methods!` table, which makes the
  right, the dispatch and the module's methods as TypeScript, so the
  window's `engine.call`, `engine.command` and `engine.stream` take only
  those (ADR 0014).
- **Events it publishes.** These are its published language, and they carry a
  version.
- **Its tables.** Only this module writes them, and no other module reads
  them.
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
| terminal | Terminal | first |
| browser | Tab; the window's, with no engine part; every Agent reaches it over CDP (ADR 0013) | first |
| files | the Space's files | soon |
| chat | Room, Message, Mention | later |
| databases | Database, Field, Record, View | later |

### agents

- **A Thread is a session with a Harness** (ADR 0006). The first message
  starts it: `agents.send` with a `harness` and no `thread`. Its Harness is
  its own from then on, and each Thread gets an Agent ID of its own. A new
  Thread starts with full access and the options its Harness last offered,
  such as its model (`agents.defaults`). Defaults a Person sets per Harness
  entry (ADR 0006, decision 3) are not built yet.
  - Spaces from before ADR 0006 kept their Agents in
    `.banda/agents/<name>.toml`, now `spaces/<id>/agents/` (ADR 0026). Opening the module reads those files
    once to learn each older Thread's Harness, and leaves them as they are.
    Older Threads keep the Agent ID they had, so one old Agent's Threads
    still share it.
- **The Harness list is a text file** of the machine. It says how to start
  each Harness. Without one, the engine knows Claude Code and Codex through
  their ACP adapters on npm, at exact versions. Reading the ACP Registry
  comes next.
  - The engine follows the file: each look at the list reads it again once
    it changed, so a changed entry starts its next process as the file now
    says, and a file that no longer reads leaves the list before it in
    force (ADR 0016). An entry with `enabled = false` stays in the list,
    and no Thread starts on it.
  - An entry may name the Person's own CLI the adapter runs (`[harness.cli]`
    with `program` and `variable`): `claude` through
    `CLAUDE_CODE_EXECUTABLE`, `codex` through `CODEX_PATH` (ADR 0003,
    decision 3). Each start finds it on PATH and asks its version; a CLI
    that is not installed stops the start, so no bundled copy runs in its
    place.
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
  stop, a restart and a Harness that stopped hold the queue
  (`thread.held`) until the Person continues (`agents.resume`), sends
  another message or tries the failed turn again, which goes first.
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
- **A Person signs in to a Harness in a way it offers** (ACP's auth
  methods; `agents.account`; ADR 0004), and the Harness keeps the
  credentials: Banda holds none and reads none of its files.
  - The engine declares that it runs terminals, so Claude Code's adapter
    offers ways in a terminal: the Harness entry's program with the way's
    arguments and environment, so an entry's own config folder gets the
    account. The Thread runs it in a terminal Pane in a tile below. Once
    its program ended with code 0, that Pane sends the sign-in with the
    turn that needed it (`agents.sign_in {harness, way, turn}`), and the
    turn goes again in the same command. The workspace keeps that Pane, so the
    sign-in lands after a reload or with the Thread closed. The line stays
    to run by hand, after which the Person says so.
  - Codex's adapter signs in by itself in the browser when the engine asks
    (`agents.sign_in`).
  - A sign-in writes nothing to the Space, and its receipt keeps the
    answer. Every process of that Harness entry is let go, so each reads
    the account when it next starts.
  - A turn that failed for a sign-in offers the ways, and goes again once
    the Person signed in.
  - Who is signed in comes from the Harness itself: Claude Code's and
    Codex's adapters push it (`_auth/status_update`, their extension, until
    ACP has it). `agents.account` gives it with the program's name and
    version; it waits a few seconds for a Harness that reports it but has
    not yet. A Harness that does not report it shows no one.
  - A Harness that declares ACP's logout signs out when asked
    (`agents.sign_out`), and its processes are let go as after a sign-in.
    The adapter signs its CLI out, so the Person's own terminal too.
  - The settings Pane's Agents, like T3 Code's provider settings, shows
    each entry with its CLI and adapter versions, who is signed in, Sign
    in, and Sign out where a logout ends the sign-in: an account's, not a
    key's. Check again asks the Harness anew. It turns an entry on or off,
    changes its command, and adds or removes one, writing `harnesses.toml`
    through `banda settings` (ADR 0016).
- **The Harness's notices**, such as warnings, join the Thread as lines of
  their own.
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
  times out.
- **A tool call shows what it did:** a file change as its diff, and what
  a command printed, with how it ended. Codex sends output as it prints;
  Claude Code sends it once the command is done. The Thread keeps it all,
  up to 4 MB for one command's output, text or diff, which only a runaway
  command reaches; a diff past it says so instead.
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
  Space's Threads on its Harness last learned. The window suggests them as a
  message starts with `/`, and adds `/plan` and `/default`, as T3 Code
  does: they switch plan mode and send nothing.
- **A message can carry images**, as in T3 Code: PNG, JPEG, GIF or
  WebP, at most 10 MB each, 100 per message and 80 MB together. The window
  makes a PNG or JPEG with a side longer than 2000 pixels smaller first.
  Each image goes to the engine as the Person adds it (`agents.attach`),
  in a call of its own, since one WebSocket message holds at most 16 MiB;
  the message then names them. The engine keeps the bytes as a file in
  the Space, and the window reads them back with `agents.image`. An image
  no message took within a day goes when the next one is added. A Harness
  that takes no images (ACP's `promptCapabilities.image`) says so in what
  it offers, and the window offers no images; a message with images gets
  the text alone, with a notice, and one of images alone fails its turn.
- **One function moves a turn** (`rules::next`, ADR 0018): given what the
  engine knows of a turn and what happened (started, stopped, changed,
  taken back, steered, tried again), it says the turn's next state and
  whether the queue is held, or refuses, a late event too. The rules the
  commands ask are questions to it. A turn keeps who opened it
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
  however it ends (`turn::end`, in the same transaction), its last reply,
  or how it ended and why, goes back into A as a message by B's Agent, in
  a turn opened as answered, which answers nothing back; a Person's retry
  of an asked turn still answers. An Agent writes only from its own
  Thread. Three rules, in
  `rules::may_write`: no circle (an Agent cannot write to its own Thread,
  nor to one up the chain of asked turns still going that waits for its
  answer), not over a Person's Question (a Thread with an open Question),
  and only its own Space (the kernel's wall). A message's author is
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
  `modules/agents/engine/src/lib.rs`, and its facts in `model.rs`.

### terminal

- **A Terminal is a program on a PTY** in the engine, run as the Person:
  their shell in the Space's folder, or a program with its arguments,
  never a shell line, such as a Harness's sign-in. It needs the Run right,
  and it belongs to its Space. The window chooses its ID, so a Pane names
  its terminal before the engine answers (`terminal.open`). Opening one
  whose program ended runs the program again.
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
- Its methods are the `methods!` table in `modules/terminal/engine/src/lib.rs`.
- **Its Pane** (`modules/terminal/pane`) draws a terminal with Ghostty:
  T3 Code's adapter over `libghostty-vt` compiled to WebAssembly,
  vendored in `app/ghostty`, on a canvas in the window's colours.
  - Opened from the menu, it starts the Person's shell, and starts it
    again when the engine lost it.
  - Another Pane that started a program opens it on that terminal, as a
    sign-in does: `{kind: "terminal.terminal", args: {terminal, title,
    shell: false, done}}`. `done` is a command the Pane sends once the
    program ended with code 0; its ID keeps it once only. Then the Pane
    closes.
  - It sends what the Person types one call after another, as the engine
    runs calls side by side.
  - Closing the Pane closes its terminal. Moving it to another column or
    workspace draws it again and does not.

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
  options like the rest. The table is in `acp.rs`.

## Window

```
app/desktop      Electron main: starts the engine, serves the page, hands it the address
app/web          the page: the bar, the sidebar, the workspaces and the overview; the actions; the Pane registry
app/ui           shadcn/ui (preset b0, on Base UI), Banda's Mark and sounds, and the Pane contract
app/ghostty      T3 Code's Ghostty adapter: a terminal on a canvas
modules/*/pane   each module's Panes
```

- **The page reaches the engine only through the API.** Electron main gives
  it one thing: the engine's address, through `window.banda.engine()` in
  a sandboxed preload. The page is served from `app://banda` with a
  strict Content Security Policy. It cannot navigate, open windows or get
  permissions, and links open in the browser. It may run WebAssembly
  shipped with it, which Ghostty draws terminals with.
- **The engine is the window's child.** Main starts
  `banda serve --with-parent`, starts it again when it dies (waiting up
  to 10 s between tries), and sends it SIGTERM on quit; if the window
  dies, the engine sees its stdin close. `banda look --follow` runs the
  same way. Both are Effect services in main (`Engine`, `Look`; ADR
  0020), started by one runtime and stopped when it is disposed. The
  client then reconnects and follows on from the last event it
  delivered, so a Pane sees no gap.
- **A Pane** is a `PaneKind`: a kind, the module it needs, a title, an
  icon, optional start args, what its module lets go of when it leaves
  every workspace (`closed`), and a component. The component gets the
  engine, its Space, its args, whether it has the focus, `open`,
  `update`, and `close` for its own tile. `open` opens a Pane of the same
  Space unless it names another. A Pane's args are all its state; the
  workspaces keep them, each Pane with its Space.
- **A Pane reads a view, then follows.** `useLive` reads the view once,
  applies each event after its `at`, and reads again when the engine says
  so. Events that arrive within one frame render once.
- **The shell** (`app/web/src/shell/Shell.tsx`) puts the parts together:
  the bar on top, the sidebar docked on the left, and the workspaces, or
  the overview over them (ADR 0005, decisions 7–9).
- **The workspaces** follow niri (`app/web/src/workspaces/model.ts`); every
  change to them is a pure function.
  - They sit one under another, and there is always one empty workspace
    at the bottom; an empty one in the middle goes once the Person leaves
    it. Each one is a Strip: columns a third, half, two thirds or all of
    the screen wide, scrolling sideways, each holding Panes one above
    another. The focused column always comes fully into view.
  - A workspace holds Panes of any Spaces; a Pane's header names its
    Space when the workspace mixes them.
  - Opening a Pane that is already shown goes to its workspace and focuses
    it. Opened with no place, a Pane takes the place of one of its kind on
    the opener's workspace, or a new column right of the opener.
    Ctrl-click (⌘ on a Mac) always opens a new column.
  - Every workspace stays drawn, so its Panes keep running; only the
    current one takes clicks and keys.
  - A touchpad's swipe is read as niri reads one (`workspaces/swipe.ts`).
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
  - The window keeps the workspaces in its storage
    (`$BANDA_STATE/window` when that is set) until they move into the
    engine (ADR 0005, decision 3); `workspaces/store.ts` is the one place
    that changes then. The engine's side is built: the `workspaces`
    module of this machine (`modules/workspaces/engine`, ADR 0025) keeps
    the arrangement and its rules, and says each change in one event
    that holds it whole.
- **One list of actions** (`app/web/src/shell/actions.ts`) holds what the
  window does, the modules' actions and its own, each with a name, its
  key sheet section and a default key, by its physical place.
  Alt is the mod: Arrows focus, Shift+Arrows move, Ctrl+Arrows step the
  width, Return opens a new Thread, Shift+Return a new browser, N a new Pane, W closes, O the overview,
  PageUp and PageDown the workspace above or below, 1…9 go to one,
  Shift+1…9 move the Pane there, A shows or hides the sidebar. The window
  takes these keys before any Pane hears them; a terminal gets every other
  key, Ctrl+W among them. `keys.toml` binds and frees keys over them (ADR
  0005, decision 11); Ctrl+Alt+Shift+K (`keys.reset`) is no file's, and
  brings the window's own keys back until the file changes. The settings Pane's
  Keys section shows the file's lines, and opens the key sheet in the
  window for the rest.
- **The sidebar** lists every Thread of every Space, arranged as a preset
  and the Person's keys say (ADR 0008): grouped by state, by Space or not
  at all; sorted by need, by change or by title; shelves at the bottom;
  a list of Spaces above; rows of one, two or three lines. `arrange.ts` is
  the one pure rule. `banda look` resolves the keys from `sidebar.toml`
  (`look/src/sidebar.rs`; Banda's presets `inbox`, `spaces` and `places`
  are files in `look/sidebars/`), and the view menu writes the preset
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
- **The bar's Mark** shows the loudest of what every Space calls the Person
  for, with how many things wait for them when more than one does. A
  module offers a `Watch` for this: a component the window draws for
  each Space while the engine runs the module, which shows nothing and
  reports a Mark state, a count and the Space's rows for the sidebar
  (`Report` in `app/ui/src/pane.ts`). The bar and the sidebar read the same
  report, so they never disagree, and the bar knows even while the sidebar
  is hidden. The window combines them (`app/web/src/bar`) and knows
  nothing of Threads.
- **Calls** (ADR 0011). A row whose Mark is done, asking or failed calls
  the Person. The window reads the calls from the Watches' reports and
  compares each with the one before: what starts calling is news, what
  stops is taken back, and a Watch's first report is what already was
  (`app/web/src/calls`). It knows nothing of Threads: a Pane kind's
  `shows` names the thing it shows, so the window knows when the Person
  looks at it (its Pane has the focus and the window is in front), sees
  it on screen, or is elsewhere.
  - It gathers the news for a tenth of a second and tells of each where
    the Person looks (`tell.ts`): nothing while they look at it; the sound
    when it is on screen; the sound and a toast when it is elsewhere in
    the window (`Toasts.tsx`, gone by itself after 5 to 12 s); the sound
    and a system notification when the window is behind (`system.ts`).
    `Alt+U` goes to what calls, the loudest first.
  - A system notification is the desktop's (`app/desktop/src/notices.ts`):
    the page asks for it through `window.banda.notify`, with the mark
    still in its state as its icon (`stillMark`, drawn to a PNG), and the
    desktop shows it silent, takes it back once the Person sees the
    Thread, and says when they click it; the window comes to the front and
    goes there. More than two at once make one. While Omarchy's Do Not
    Disturb is on (`omarchy-shell notifications isDnd`), only the Marks
    change. The end-to-end tests run with a recorded desktop
    (`BANDA_DESKTOP=recorded`), so nothing reaches the screen.
  - Every step of this is the Person's to choose: `[notify]` in
    `look.toml` (`look/src/notify.rs`) turns the system notifications to
    always or off and the toasts to always or off, drops the words, keeps
    no quiet but its own, or leaves done, asking or failed to the Marks.
    The window holds Banda's defaults till the look comes
    (`calls/settings.ts`).
  - A Thread Pane marks its turn seen only with the focus in the window in
    front, so a Thread that finishes behind another window calls.
- **Sounds** (ADR 0009). Of the news, the window plays the loudest, and
  for 1.5 s after plays only a louder one.
  - The sounds are made in code with Web Audio, in `app/ui/src/sound`: a
    few instruments (a bell, a marimba bar, a bubble, a string), five
    families that play the three calls on them, and the level of each
    sound, measured so done is the softest and asking the clearest in
    every family. Their noise is seeded, so a sound is the same every
    time.
  - What the Person chose is `[sound]` in `look.toml` (`look/src/sound.rs`):
    the family, the volume, the room, and each call on, off or borrowed
    from another family. The page takes it with the look
    (`useLookSound`); until the first look comes, the defaults play.
    Electron lets the page play sound before the first click.
- **Only `window.banda` ties the page to the desktop.** It names no
  Electron API, so a browser can host it later; for now the engine lets in
  only `app://banda` and pages on localhost. In main, each of its
  channels answers Banda's page alone, decodes its arguments with a
  `Schema` and runs one effect (`app/desktop/src/ipc.ts`, ADR 0020).
- **The browser's pages** (ADR 0013) are Electron `<webview>`s in the
  window's layer over its workspaces (`PANE_LAYER`), which never moves:
  Electron destroys a `<webview>` that moves in the DOM. The browser Pane
  draws an empty slot, and its page follows the slot on every frame, cut
  to what the workspace shows of it (`modules/browser/pane/src/pages.ts`).
  - The desktop attaches a page only in the `persist:browser` profile,
    sandboxed, with no preload and no Node; a site asks before it uses the
    camera, the location or another program (the `Browser` service,
    `app/desktop/src/browser.ts`; the extensions are `Extensions`, ADR
    0020).
  - Banda's Alt keys and the browser's Ctrl keys are taken from the page in
    `before-input-event` and pressed again in the window, so the actions
    and the Pane hear them as their own.
  - A page takes the keys as an iframe does, with no focus event of its
    own; its tile takes the focus once the window blurs.
  - A Pane keeps its tabs in its args, and holds their pages while it
    has them: only the shown tab's page follows the slot, and a tab is
    made a page the first time it shows. A page's new tabs, its icon and
    the downloads come from the desktop as `browser:news`, by the page's
    web contents ID; Banda's page shows no remote image, so the desktop
    fetches the icon in the browser's profile.
  - Agents drive the tabs through the window's CDP endpoint
    (`app/desktop/src/cdp.ts`, ADR 0013 decision 7): an Effect HTTP
    server on 127.0.0.1 with a random token in its path, which answers
    as a whole Chrome whose targets are the tabs. A tab's
    `webContents.debugger` is attached while a client uses it, and each
    client's session on it is a Chromium session of its own; a client is
    a scope, so one that leaves detaches. The window writes the endpoint
    to `browser.json` in the state folder, where the engine's first line
    names it, and `banda browser` prints it. A tab with a client's session
    is told `driven`: it shows the Agent's mark and keeps drawing while
    hidden; a click on the mark sends `browser.stop`, which ends every
    session on it. A tab asked for with no browser Pane opens a new one
    without the focus, through the browser module's `start`.

## Repository

```
banda/
  kernel/             Rust: Space, event log, access, registry, API
  modules/
    agents/engine/    Rust: Threads, turns, Questions, the ACP adapter
    agents/pane/      React: the Thread, the settings' Agents, each Thread as the sidebar lists it
    terminal/engine/  Rust: Terminals, their PTYs and what they printed
    terminal/pane/    React: a terminal, drawn by Ghostty
    browser/pane/     React: the browser Pane, its tabs and row (ADR 0013)
    skill/            Rust: the Banda skill, its core and the topics it gathers (ADR 0012)
  look/               Rust: banda look, the look, the sidebar's arrangement and the browser's; skill/ its topics
  engine/             the banda program: serve (the kernel and its modules), call, follow, look, skill, mcp, menu, browser
  app/ui/             shadcn/ui and the Pane contract
  app/ghostty/        T3 Code's Ghostty adapter and its WebAssembly, vendored
  app/web/            React: the shell (bar, sidebar, workspaces, overview), the actions, the Pane registry
  app/desktop/        Electron: the window and the engine's start; e2e tests
  contract/           the engine's API for TypeScript: generated types and the client
  tools/fake-agent/   a scripted ACP agent for tests and window checks; it replays recordings too
  scripts/check.sh    every check a change must pass
  docs/               adr/ · architecture.md · research/
  GLOSSARY.md
```

## Checks that hold the shape

- **Architecture tests.** The kernel names no module, no module reads
  another's tables, and a Pane imports only the API, `@banda/ui`, React
  and its icons; the terminal's Pane also Ghostty.
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
    `modules/agents/engine/tests/recordings/`. An ignored test records
    them again, a paid run on the Person's own sign-in, when an adapter
    changes.
  - A recording leaves out who is signed in, the Person's home folder,
    and the skills, plugins and agents a Harness lists as its own.
  - T3 Code's Claude and Codex fixtures record other protocols (Claude's
    SDK messages, Codex's app server), so they do not replay here.
- **End to end.** Playwright drives the Electron window against a scripted
  fake ACP agent. Screenshots let Agents check the UI themselves.
- **Speed budget.** A window test measures start-up time, memory and input
  latency, and writes them to `app/desktop/test-results/speed.json`. Its
  budgets are loose: they catch a regression.
- **`scripts/check.sh`** runs every check in the order a failure is
  cheapest to find. It also fails when `cargo test` rewrites the generated
  TypeScript types, so the window never builds against stale ones.
