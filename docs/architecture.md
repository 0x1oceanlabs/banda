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
  the Space itself, decide what an Agent asked a Person, nor run programs
  as the Person in a terminal (an Agent runs them through its Harness);
  nobody else may do anything. Members and roles arrive here later.
- **Identity.** A port: it says which Participant a connection's token names.
  On one computer, whoever holds the engine's secret is the owner. Later it
  is OIDC, or our accounts, and Agents get tokens of their own.
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
| Text files | the Harnesses, in the config folder. Layouts, keys and themes join them later |
| The Harness | its session, context and sign-in. We keep only its session ID, as evidence |
| The OS keychain | secrets you give Bandaso. Its database never holds them |
| The engine's state folder | the owner's ID; while the engine runs, its port and per-run secret |
| The window's storage | the workspaces: their columns, each Pane with its Space, the widths and the focus; whether the sidebar shows; what Enter does while an Agent works; which finished turn of each Thread the Person has seen |
| `.bandaso/` SQLite | Threads, Questions and answers, the Agents' queue, Databases' records, receipts, events, outbox |
| `.bandaso/images/` | the bytes of the images messages carry, one file per image; the SQLite says what each is and which message carries it |

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
| agents | Thread, Harness, Agent, Turn, Question | first |
| terminal | Terminal | first |
| browser | Page; an Agent drives it through MCP (CDP) | first |
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
    `.bandaso/agents/<name>.toml`. Opening the module reads those files
    once to learn each older Thread's Harness, and leaves them as they are.
    Older Threads keep the Agent ID they had, so one old Agent's Threads
    still share it.
- **The Harness list is a text file** of the machine. It says how to start
  each Harness. Without one, the engine knows Claude Code and Codex through
  their ACP adapters on npm, at exact versions. Reading the ACP Registry
  comes next.
  - An entry may name the Person's own CLI the adapter runs (`[harness.cli]`
    with `program` and `variable`): `claude` through
    `CLAUDE_CODE_EXECUTABLE`, `codex` through `CODEX_PATH` (ADR 0003,
    decision 3). Each start finds it on PATH and asks its version; a CLI
    that is not installed stops the start, so no bundled copy runs in its
    place.
  - Its `minimum` is the oldest version the adapter supports, the one it
    was built for: Claude Code 2.1.312, Codex 0.165.0. An older CLI runs,
    and the Harnesses Pane and its Threads warn. Checking the Harness again
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
  two, Send now unless the window chose Queue in the Harnesses Pane, and
  Ctrl+Enter the other. A
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
  opens a turn of the Agent's own, whose message is a notice from Bandaso.
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
  credentials: Bandaso holds none and reads none of its files.
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
  - The Harnesses Pane, like T3 Code's provider settings, shows each entry
    with its CLI and adapter versions, who is signed in, Sign in, and Sign
    out where a logout ends the sign-in: an account's, not a key's. Check
    again asks the Harness anew.
- **The Harness's notices**, such as warnings, join the Thread as lines of
  their own.
- **A Thread has settings: a mode, Plan, and the Harness's options.** The
  modes are Supervised, Auto-accept edits, Auto and Full access, the
  default. Only a Person changes them, under the message box
  (`agents.configure`, which needs the Decide right): how freely an Agent
  acts decides what it asks. Each message keeps the settings its Thread
  had when it was sent, and its turn sets them on the session when it
  starts. The options come from the Harness, as it last offered them in
  the Thread (`thread.offered`); Bandaso keeps no model list of its own.
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
  form Bandaso cannot show goes unanswered, with a notice.
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
- **A restart interrupts** the turn it cut short and closes that turn's
  open Questions. Turns that waited stay queued, and the queue is held. A
  message sent into a turn that never got it waits for a turn of its own.
- Its methods and their rights are listed in
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
- Its methods are listed in `modules/terminal/engine/src/lib.rs`.
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

Threads, turns, tool calls and Questions are Bandaso's model. The agents
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
app/ui           shadcn/ui (preset b0, on Base UI) and the Pane contract
app/ghostty      T3 Code's Ghostty adapter: a terminal on a canvas
modules/*/pane   each module's Panes
```

- **The page reaches the engine only through the API.** Electron main gives
  it one thing: the engine's address, through `window.bandaso.engine()` in
  a sandboxed preload. The page is served from `app://bandaso` with a
  strict Content Security Policy. It cannot navigate, open windows or get
  permissions, and links open in the browser. It may run WebAssembly
  shipped with it, which Ghostty draws terminals with.
- **The engine is the window's child.** Main starts
  `bandaso serve --with-parent`, starts it again when it dies (waiting up
  to 10 s between tries), and closes its stdin on quit. The client then
  reconnects and follows on from the last event it delivered, so a Pane
  sees no gap.
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
    (`$BANDASO_STATE/window` when that is set) until they move into the
    engine (ADR 0005, decision 3); `workspaces/store.ts` is the one place
    that changes then.
- **One list of actions** (`app/web/src/shell/actions.ts`) holds what the
  window does, each with a name and a default key, by its physical place.
  Alt is the mod: Arrows focus, Shift+Arrows move, Ctrl+Arrows step the
  width, Return opens a new Thread, N a new Pane, W closes, O the overview,
  PageUp and PageDown the workspace above or below, 1…9 go to one,
  Shift+1…9 move the Pane there, A shows or hides the sidebar. The window
  takes these keys before any Pane hears them; a terminal gets every other
  key, Ctrl+W among them.
- **The sidebar** lists every Space, each with the Pane the agents module
  offers for it (`agents.threads`: its Threads, the one changed last
  first), and a new Thread in it. A new Thread opens as a Thread Pane
  with no Thread yet; its first message starts one (ADR 0006).
  - Each Thread shows its Agent's Mark (ADR 0005, decision 8). The engine
    lists each Thread with its latest turn that began, and its Questions
    that wait; the list follows them from `turn.started`, `turn.ended` and
    the `question.*` facts. The pane's rules (`marks.ts`) say what that
    means: a Question asks, a failed or interrupted turn failed, a turn
    that finished is done, a running one works, and anything else rests.
  - A turn that finished or failed settles once the Person has seen it: a
    Thread Pane with the focus marks its latest ended turn seen, in the
    window's storage (`seen.ts`). The engine never hears of it.
- **The bar's Mark** shows the loudest of what every Space calls the Person
  for, with how many things wait for them when more than one does. A
  module offers a `Watch` for this: a component the window draws for
  each Space while the engine runs the module, which shows nothing and
  reports an `Attention`, a Mark state and a count (`app/ui/src/pane.ts`).
  The agents module's follows the same list as the sidebar, so the bar
  knows even while the sidebar is hidden. The window combines them
  (`app/web/src/bar`) and knows nothing of Threads.
- **Only `window.bandaso` ties the page to the desktop.** It names no
  Electron API, so a browser can host it later; for now the engine lets in
  only `app://bandaso` and pages on localhost.

## Repository

```
bandaso/
  kernel/             Rust: Space, event log, access, registry, API
  modules/
    agents/engine/    Rust: Threads, turns, Questions, the ACP adapter
    agents/pane/      React: the Thread, the Harnesses, a Space's Threads for the sidebar
    terminal/engine/  Rust: Terminals, their PTYs and what they printed
    terminal/pane/    React: a terminal, drawn by Ghostty
    browser/pane/     React: the browser Pane (next)
  engine/             the bandaso program: serve (the kernel and its modules), call, follow
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
  another's tables, and a Pane imports only the API, `@bandaso/ui`, React
  and its icons; the terminal's Pane also Ghostty.
- **Module tests** run through the module's interface: commands go in and
  events come out. Nothing past the interface is mocked.
- **Adapter tests** run the real engine. Only the Harness's transport is
  replayed: the fake agent plays a recorded conversation
  (`FAKE_AGENT_REPLAY`).
  - A test has a Harness entry `record` what it and Bandaso say to each
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
