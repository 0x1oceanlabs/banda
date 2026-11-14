# Agents

The agents App: Threads, turns, Questions, Visuals, sub-agents, and the
adapter that speaks to every Harness. Its engine part is `engine/`, its
Panes are `pane/` ([their files](pane/README.md)), and what it runs in
the window's main process is `desktop/`.
[The architecture](../../docs/architecture.md#agents) is the map this
page is one part of. A change to this App changes this page in the same
PR.

## What it does

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
  their ACP adapters, at exact versions. On Omarchy, the engine also reads
  Omarchy's display-safe Account registries and discovers installed
  OpenCode, Oh My Pi and Pi's ACP adapter (ADR 0105). Explicit entries win,
  duplicate profile folders are skipped, and `[omarchy] enabled = false`
  turns this off. No credentials are copied or settings written. Reading
  the ACP Registry comes next.
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
- **A Harness's sub-agents work in lanes of their Thread** (ADR 0103):
  Banda declares sub-agents to each Harness it starts. Each sub-agent
  says what it does on a child session of its own, which the session's
  lanes channel carries apart from its turns, so nothing a sub-agent says
  opens a turn (`lanes.rs`, one task per lane, in the order the Harness
  said it). Its start is written where its parent said it, after what
  came before: by the turn that heard it, or by its parent's lane for a
  nested one, in the root's launch turn; one child session is one lane
  (`agents_subagents`, by its evidence), so a child announced again or
  replayed goes on in its own.
  Its words are the lane's entries (`agents_items.sub`), written by a
  Transcript of the lane, and never move the Thread; its Question is the
  Thread's, which names the lane, is answered by the Thread's mode as it
  asks, and closes as the lane ends, not with the turn. Its record changes
  in the same write as its fact: `subagent.started`, `subagent.changed`
  (only what changed) and `subagent.ended`, with its report, its last
  words to its parent. A lane at work keeps its process and the machine
  from going idle, and stops a folder moving; one Banda cut off as it let
  the process go, or that was at work at a restart, ends Lost in words
  that say why. As a Thread's next turn starts on another entry, its
  lanes still at work in the old process are stopped, and the Questions
  they wait on let go, before the old session closes.
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
    Project: subscription Accounts use the engine's sign-in flow; a custom
    Harness's terminal way shows its command when there is no Project.
    What a new Thread starts with, which a Project offers, does not show
    without one. Entry settings use the existing writer (ADR 0016);
    subscription setup and removal use the Account contract (ADR 0104).
    An entry with a known ID, `claude` or `codex`, takes each key it leaves
    out from Banda, so a new Banda
    moves its adapter; the window shows what is wrong in the file as in
    the look's. What a new Thread on each starts with, its mode, plan and
    options, as the composer's bar shows them (`agents.defaults`), is
    `agents.toml`'s `[start.<id>]`, set from the same bar in the settings,
    which writes it through the engine as the Person (ADR 0083):
    `harnesses.toml` says only how the Harnesses start (ADR 0040). Which
    account a new Thread starts on, `[start]`'s `account` and `fallback`,
    is each machine's own (ADR 0106, step 5a): the window takes the default
    and the fallback from that machine's `harnesses.accounts`, which names
    them (ADR 0108, decision 4).
- **Accounts has one lifecycle owner**, `platform/harnesses/engine/src/accounts`.
  Its `Accounts` service owns profile discovery and connection, duplicate
  folder checks, the provider process pool, bounded sign-in sessions and
  account-change publication. The machine API preserves its `harnesses.*`
  methods and rights and delegates to this service. Its `AccountStore`
  boundary saves one prepared connection; Settings implements it through
  the existing comment-preserving writer, with no account discovery or
  folder policy of its own. Omarchy discovery lives inside this boundary;
  the Harness list still owns the effective list and explicit overrides.
  Thread defaults, fallback and moving Threads stay with Agents. Account
  presentation keys continue through the validated settings writer.
- **Agents connect Accounts through the engine** (ADR 0104).
  `banda account` uses the caller's pass. `account_profiles` discovers
  folders without reading credentials; `connect_account` adopts an
  existing folder or creates a private one under the engine's data,
  through the one settings writer. It accepts no command or arbitrary
  environment. A managed profile opens only its own folder in its
  Harness's fence. `account_status` omits sign-in programs and their
  environments. `login_account`, `login_status`, `login_input`,
  `login_cancel` and `login_finish` hold the Harness's sign-in in the
  engine for at most ten minutes; the Person completes the provider's
  browser or interactive step. Settings uses this same contract for its
  three-step subscription setup: a private or existing profile, name and
  emblem, then sign-in. A copied link lets a Person finish on another
  computer; provider status confirms the identity. The new Account appears
  in mounted pickers as soon as it is connected. A new Thread uses its
  fallback only after that Account reports a sign-in and available limits.
  Finishing emits the same account change
  as the window's sign-in, and a fresh status confirms the identity.
  `remove_account` records the destination and caller, hides the Account
  and refuses new starts on it. Each Project moves idle Threads through
  its own store, and moves a running Thread after its Turn ends. A queued
  Turn checks again before opening its Harness. Reopened Projects apply
  the same instruction. The source entry and profile remain for session
  resumption; removal never signs out or deletes an adopted profile.
  The default cannot be removed until another enabled default is chosen.
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
  Another machine's Visual is drawn the same (ADR 0106, step 4d): as its
  frame comes near showing, the Pane's session asks that machine's engine
  for a token for the page (`agents.visual_link`, an hour's, given to no
  Agent), and the frame loads `app://visuals/of/<machine>/<token>`, which
  main relays to that engine's `/p/<token>` as it does the sandbox host's
  pages, then dresses and sandboxes as this machine's.
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
  whose prompt it answers, or to whoever hears it between turns. A
  turn's route ends as its prompt's answer is dispatched, before any
  later frame of that connection is routed, and what listens between
  turns starts before the prompt goes, so what the Harness says right
  after its answer is between turns. A sub-agent is mapped only as a
  session someone hears announces it, to the Thread's session it is of,
  its root: what its child session says, and what it asks, go to the
  root's lanes channel, and its start also goes in place on the root's
  route, or on its parent lane's for a nested one. A load's replay, or an
  aside's session, maps none. A child stays mapped after it ends, as late
  frames and a resumed child still come on it, until its root's session
  closes.
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

The bytes behind those URLs are in
[`platform/bytes/README.md`](../../platform/bytes/README.md).

## Checks

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
