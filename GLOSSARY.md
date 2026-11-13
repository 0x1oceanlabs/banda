# Banda

Banda is a hackable, tiling workspace for working with Agents, made first
for enthusiasts and AI-native people. Terms are English everywhere: in code, in docs, and in speech
in any language. A word belongs here only when some visible behaviour needs
it.

## Work

**Project**:
One body of work and its folder on disk: any folder, a git repository too,
or a new one in `~/Banda/<name>/`. The folder holds the files that the
Person and the Agents work on, and nothing of Banda's: the Project's data
and event log are in the engine's data, `~/.local/share/banda/projects/<id>/`
(ADR 0026, ADR 0069). A Thread started without one is in **No Project**,
in a small Project of its own under `~/Banda/scratch/` (ADR 0046).
_Avoid_: space (its name before ADR 0069; the ADRs before it say Space),
workspace (that is a screen of Panes).

**Sign**:
What stands for a Project beside its name, or alone where there is no
room: a picture found in its folder or picked, an emoji, an icon or one
or two letters, on a quiet tile (ADR 0070). No Project's is a dashed
empty tile.
_Avoid_: badge, icon (a Pane's is its App's).

**Participant**:
Anyone who acts in a Project: a Person or an Agent. Every record names its
author: one of the two, or an App that acts as itself (ADR 0082).

**Person**:
A human Participant: one Person across all their hosts, known by the
Person key (ADR 0081, ADR 0083). On one computer, the Person is that
computer's user, who owns every Project there.
_Avoid_: user (outside code that talks to the operating system).

**Agent**:
The AI at work in one Thread, through that Thread's Harness. Each Thread has
its own Agent, with no name or settings of its own (ADR 0006).

**Harness**:
The agent program a Thread runs on, for example Claude Code or Codex. The
engine reaches it through an adapter, ACP first. It reads what a Harness can
do from the Harness's declared capabilities.

**Account**:
One sign-in of a Harness: a subscription, an API key or a gateway. In
`harnesses.toml` it is an entry `of` its Harness, with its own name, folder
and Emblem (ADR 0078, ADR 0093). Its name is its Harness's until the Person
renames it. A Harness's own entry is its first account. An environment
sign-in is one too, made for boxes (ADR 0084). A new Thread starts on the
default account, or on the fallback while the default is out (ADR 0093).
_Avoid_: profile, instance, provider.

**Emblem**:
An account's icon drawn in its colour, which the Person picks: Banda shows
it wherever the account is, its name beside it where there is room. One of
fifteen icons, the Harness's own and neutral ones, in one of five colours,
the Harness's own and four more (ADR 0093).
_Avoid_: mark, logo, badge, avatar.

**Limit**:
How much of a Harness's subscription a window of time allows, such as
Claude Code's week. Banda shows the share spent of each, and when it resets
(ADR 0043). The bar shows the room left of the best account of each Harness
(ADR 0055).
_Avoid_: quota, rate limit.

**Usage**:
The tokens a Harness's sessions spent on this computer, in Banda or not,
and what they would cost through the API. The Usage Pane counts them from
the Harnesses' own journals (ADR 0043).

**Sign-in**:
How a Person lets a Harness work under their account, in a way the Harness
offers: in a terminal, as Claude Code does, or by itself in the browser, as
Codex does. The Harness keeps the credentials; Banda holds none. It reads
Claude Code's token only to ask for its limits (ADR 0043).
_Avoid_: login, auth.

**Terminal**:
A program the engine runs on a PTY for a Person, such as their shell or a
Harness's sign-in. Every window that opens it shows the same screen; it ends
when it is closed or the engine stops. An Agent runs programs through its
Harness, never in a terminal. In an isolated Project it runs in the box
(ADR 0084).
_Avoid_: console, shell (that is one program a terminal runs).

**Thread**:
One session with a Harness in a Project: starting one is all it takes. Its
Harness is chosen when it starts and stays with it. It shows entries:
messages, the Agent's thoughts, tool calls, its plans, Visuals, notices,
Issues and Questions.
A Harness keeps a session of its own for it, which a Thread holds as
evidence.
Its Person may move it to another Project, on its machine or another's:
it goes whole, and is in one Project (ADR 0098, ADR 0116).
_Avoid_: chat.

**Entry**:
One thing a Thread shows, one for each kind of its body: a message, a
thought, a call, a plan, a Question, a notice, an Issue, a Visual, a
sub-agent's row where it started (ADR 0103). Each kind is drawn by a file
of its own (ADR 0091).
_Avoid_: item (that is `item@1`), event.

**Line**:
What a Thread's timeline adds between its entries: the work line, a fold,
the live line, a turn that ended, a turn's changes, a proposed plan (ADR
0091), the group of sub-agents one message started (ADR 0103).
_Avoid_: row (that is how the sidebar list draws an Item).

**Plan**:
The steps an Agent means to take in a turn, each to do, doing now or done.
Plan mode is something else: a setting under which the Agent only plans and
changes nothing.
_Avoid_: todos.

**Slash command**:
What a Harness runs when a message starts with `/` and its name, such as
`/compact`. Each Harness has its own; the window adds `/plan` and `/default`,
which switch plan mode.
_Avoid_: command (that is a request to an App).

**Visual**:
One finished HTML page an Agent shows its Person in its Thread: a mockup,
a chart, a diagram, an animation, a sound. It wears the look and runs apart
from Banda; it opens larger as a preview or as a Pane of its own (ADR 0037).
_Avoid_: page (that is the browser's), artifact, render.

**Turn**:
One stretch of an Agent's work in a Thread. It begins at a message to the
Agent, or when the Agent goes on by itself, and ends when the Agent stops
or is stopped.

**Queue**:
The messages of a Thread that wait for their turns, in order, after the
turn that runs. A Person can change one, take it back or send it into the
turn that runs. A stop, a restart or a Harness that stopped holds the queue
until the Person continues.
_Avoid_: backlog, pending.

**Steering**:
Sending a message into the turn that runs, which the Agent reads as it
works, instead of queuing it. A Harness that cannot take one stops its turn,
and the message waits for a turn of its own. A turn the Agent went on with
by itself takes none: the message goes at once in a turn of its own, which
the Harness takes into what it does, or once the Person answers what the
Agent asks.
_Avoid_: interrupt (that is a stop), injection.

**Question**:
An Agent's request for the Person to decide something. Most often it asks for
permission to run an action. The Harness writes the choices, and the Person's
answer goes back to the Harness unchanged.
_Avoid_: prompt, approval request.

**Sub-agent**:
A Harness's helper at work inside a Thread, such as Claude Code's Agent
tool or Codex's `spawn_agent`. It is part of the Thread's Agent, with no
name, settings or pass of its own, and no card: its Thread's host keeps it
with the Thread, which shows it as a row and as a satellite of its Mark,
and opens it beside, read only. The Person reaches it through the Agent:
Ask Claude about it (ADR 0103).
_Avoid_: subagent, task, child Thread (that is a Thread another Agent
started, ADR 0019).

**Crew**:
The sub-agents one Thread set to work together in **phases**, the steps
its script names, such as Scan, Fix and Verify: what Claude Code calls a
workflow. Its title is the Harness's name for it. It shows as one card in
the Thread and as the Crew Pane in the Thread's Group (ADR 0103).
_Avoid_: workflow (that is steps across Apps), task, swarm, team.

## Shape

**Engine**:
The one process on a host, `banda serve`, that owns the host's Projects,
their Threads and every App's data there. It is the machine's service and
outlives the window (ADR 0086). Clients reach it through its API.
_Avoid_: server (that is a machine), backend.

**Host**:
A machine where `banda serve` keeps Projects and runs their work: this
computer, a server, a devbox, or a machine in Banda Cloud. Clients only
show the work (ADR 0062, ADR 0081). The Person calls it a **machine**
(ADR 0095).
_Avoid_: server, node; "host" for the Harness process pool (`Hosts<H>`),
which is the process pool.

**Machine**:
What the Person calls a host. It names itself, in its `machine.toml`: a
name of up to 16 characters and one of ten icons, drawn in the text's
colour and never in a colour of its own, and every window shows the same.
Another machine is named after the Project wherever its work shows; this
one only when the Person asks (ADR 0095). In code, the Welcome's
`machine` field is the Host scope's ID, an older name.
_Avoid_: host, in the window's words; mark or emblem, for its name and
icon.

**Client**:
What shows the hosts' work and asks for changes: the desktop app, a
browser tab, a phone, the CLI. One client works with several hosts, and
only a client joins them (ADR 0062, ADR 0082). Every client but the CLI
shares one core, and only its Window knows the device (ADR 0089).
_Avoid_: frontend.

**Device**:
Where a client runs and where the Person sits, with what only it has:
notifications, sound, the clipboard, a file picker, opening outside Banda,
its webviews. It may have no machine of its own, as a phone has none. It
tells the machines it reaches whether the Person is in front of it, and
reaches them by its own key (ADR 0082, ADR 0124). A machine is where the
work runs: when the Person walks away, the work goes on.

**Kernel**:
The small part of the engine that every App needs: scopes and their
stores, the event log, receipts, the outbox, cursors, access, identity and
passes, the registry, devices and the API (ADR 0062, ADR 0082). It names
no App.

**Platform**:
Banda's shared services on a host, between the kernel and the Apps:
projects, the tiling, settings, keys, the look, calls, harnesses, the
gateway, bytes, environments. It may hold rights no App gets, and it names
no App (ADR 0062).

**Module**:
A unit in the code: a bounded context with its own words, data and
contract, such as the commands it accepts, the events it publishes, its
own tables, its MCP tools and its Panes. A module can be removed without
breaking the others. What a Person installs is an App.
_Avoid_: plugin (an App from elsewhere is an App), feature.

**App**:
What a Person installs, opens and arranges, built on the Banda App SDK:
Threads, Browser, Git, Files, Terminal, Usage, and Apps from elsewhere. A
host installs it, a Project turns it on, and the Project keeps its data
(ADR 0062, ADR 0085).
_Avoid_: plugin; module (a unit in the code); extension (that is a Chrome
one).

**Host part**:
An App's code on its host: its handlers, its views, and for an App from
elsewhere, its worker (ADR 0062).

**Capability**:
What an App declares it needs from Banda (`files`, `run`, `net`,
`sessions`, `device`…). The kernel checks it on every call, Banda's own
Apps included (ADR 0062).
_Avoid_: permission (that is a Harness's mode).

**Manifest**:
What an App offers and needs, as it declares it (ADR 0022): its engine
part's `methods!` table, its window part's `defineModule`, and its short
`app.toml` (`module.toml` before the rename, ADR 0062) for what no code
says, such as what it hears, calls and asks of a device (ADR 0082).
`banda modules` prints all three.

**Source**:
Where the Banda menu finds a module's rows: Files, or New Thread with the
words typed (ADR 0022, decision 4).

**Unstable mark**:
A path one of Banda's Apps takes that an App from elsewhere would lack,
named in its `app.toml` with why. Their count only falls (ADR 0062).

**Intent**:
A verb with a version and typed args, such as `show.diff@1`, asked for
without naming who handles it. In v1 one App handles each (ADR 0082).

**Slot**:
A place in one App's thing that other Apps fill with Items, such as a
Thread's details or the Pane header (ADR 0082). Until an App's view
answers a Tree (V2), a module fills one with code of its own, its `slots`
(ADR 0087).

**Item**:
A thing an App lists, `item@1`: an Address, a title, a Mark, when it
changed, what is new to see, its owner and the Pane to open. Any App lists
its things as Items, and the sidebar list, the bar and push read them; a
Slot holds Items too. A row is how the sidebar list draws an Item (ADR
0082, ADR 0087).
_Avoid_: row and card for what an App lists or puts in a Slot (a card is
a Thread's block).

**Web App**:
A site as an App, in a webview of its own with its own sign-in. Its
manifest is the Person's (ADR 0062).

**MCP App**:
An MCP server whose tools bring `ui://` pages, shown in a Frame in a
Thread or as a Pane (ADR 0062).

**Catalogue**:
The fixed set of components in Banda's client release that every App is
drawn with: shadcn's, Banda's own, and the live components (ADR 0062).

**Live component**:
A catalogue component that needs every frame or a fast stream: a Thread
with its message box, a terminal, a browser's page, a file's view (ADR
0062). It obeys its Tile's Configure (ADR 0088).

**Tree**:
What an App's view answers: catalogue components and their props, as
data, drawn by each client (ADR 0062).

**Frame**:
A sandboxed iframe on an origin of its own, for HTML a spec walls in, such
as an MCP App's page. It acts as itself, never as the Person (ADR 0062,
ADR 0083).
_Avoid_: frame for an animation frame (say tick).

**Site**:
Where a Web App runs: a webview on the device, in a partition of its own
(ADR 0062).

**Level 1, Level 2**:
Level 1 is an App drawn by the client from a Tree. Level 2, later, is an
App's own page in a Frame (ADR 0062).

**View**:
An App's read method that answers a Tree (`view today(…) -> Tree`), read
again on the App's events (ADR 0062). The client's view is another thing:
what only that client keeps of where the Person looks, such as the focus,
the scroll, the zoom and the workspace on screen (ADR 0025). Say "an App's
view" or "the client's view".

**Worker**:
A process on the host that runs an App an Agent or anyone else wrote. The
engine starts it and talks to it in lines of JSON, and does its writing
(ADR 0126). In v1 it runs only Apps the Person made or trusts (ADR 0062).

**Tracer App**:
The first App on the worker road: a small one an Agent builds for the
Person, installs, changes and tests (ADR 0062).

**Gateway**:
The one MCP server every Harness session gets, on its host: Banda's tools
and the listed servers' tools in one place (ADR 0062).
_Avoid_: MCP module.

**Command**:
A request to an App or the platform to change something. It passes the
access rule and is answered by a receipt with its place in the log, or by
a refusal. A resend runs nothing twice (ADR 0082).

**Event**:
A fact an App writes with a change, with a version. It is its App's own
unless the App publishes it. Clients follow events; other Apps hear only
published facts, and never read another App's tables (ADR 0082).

**Stream**:
What an App says to a client for one call while it lasts, such as what a
terminal prints. It sends only as many pieces as the client has room for,
and `cancel` ends it. Unlike an event it is not logged: a client that
connects again hears it again from the start (ADR 0082).

**Access rule**:
The one rule the kernel checks at every hop: the actor's rights, cut down
to the App's capabilities, the session's scopes and the Project's wall.
Only a gesture acts as the Person, who may still do everything on their
host (ADR 0082, ADR 0083).
_Avoid_: access decision (its name before ADR 0082).

**Problem**:
Something that broke in Banda itself, not in the Person's work: an error in
the window or the engine, or a crash. Banda keeps it on the computer with a
fingerprint, and shares it only when the Person turned that on (ADR 0039). A
Turn that failed is not a Problem.
_Avoid_: bug, crash report.

**Sharing**:
What Banda sends to its makers, and only when the Person chose it: Problems,
usage counts, or both. Nothing else in Banda sends anything anywhere
(ADR 0039).
_Avoid_: telemetry, analytics.

## Scopes and messages

**Scope**:
The one writer of a record. There are two: a Project's moves between
hosts on command; the Host's (its programs, accounts, installed code,
settings and arrangement) never moves. There is no Person scope: the
Person's files are files on each machine (ADR 0101). A session's scopes,
an Agent's tools, are another thing.
_Avoid_: machine scope (it is the Host's); Person scope.

**Peer**:
What each of the Person's machines is to the others: none is central, and
none must be on. Each starts and works with no network and no other
machine (ADR 0101).
_Avoid_: home host (there is none).

**Shared file**:
A settings file that means the same everywhere: the sidebar, key binds,
`[notify]`, themes. Every machine keeps a full copy, and a device uses
only its own machine's. Copying them between machines is the sync, not
built yet (ADR 0101, decision 3). Seen marks are not among them: they are
the Thread's (ADR 0096).
_Avoid_: Person document; replica.

**Machine file**:
A settings file that says what one machine has: its Harnesses, its name,
its sharing. It is read and written through that machine's engine and
never copied (ADR 0101, decision 3).

**Device file**:
A settings file that says how one device works: how this screen looks, the
`mod` key. It stays on its device and is never copied (ADR 0101, decisions
3 and 4).

**Query**:
A read, answered with how fresh it is ("as of"), and safe to repeat (ADR
0082).
_Avoid_: call (its old name).

**Act**:
A method that changes or runs something: a command, or a call or a stream
whose right is not Read and whose line in `methods!` does not say `read`.
It goes at most once, and fails at once while its machine is away, never
to run later by itself; one on its way as the link breaks may have run
(ADR 0106, law 4). The Person never reads the word.
_Avoid_: write (a right says who may, not what a method does).

**Read**:
A method that only reads: its right is Read, or its line says `read`, as
`terminal.watch` does. It may wait for the link, and go again after it
(ADR 0106, law 4). A Query is a read that says how fresh it is.

**Owner**:
The machine or device a value belongs to: a Project's file is its
Project's machine's, a machine's own file that machine's, a link the
device's that opens it (ADR 0106, law 2). It is not the Owner socket,
the way the Person's own window and CLI reach their computer's engine.

**Published fact**:
An event other Apps may hear, named `app.noun.past-verb@major` and
declared by its App. Every other event is its App's own (ADR 0082).

**Listener**:
A module's named reader of a log. The kernel keeps how far it has heard,
its cursor, beside that log, so after a restart it hears on from there and
misses no fact. A reaction that writes in the store acks each fact in the
same transaction, so it runs once. One that cannot, its work outside the
store or what it follows spanning several facts, acks once its work is
done, and looks before it acts (ADR 0082).

**Receipt**:
The kernel's record of a command under its CommandId, with its place in
the log, so a resend gets the same answer and runs nothing twice (ADR
0082).

**Outbox**:
Work outside the store (a push, a post, starting a turn), written with the
change and run after it commits (ADR 0002, ADR 0082).

**Lease**:
How long a worker holds an effect of the outbox it runs. The worker
renews it; one that runs out is cut short, and the effect is taken again
under a new claim, whose token refuses the worker that comes late (ADR
0082).

**Projection**:
A table worked out from published facts, such as the Inbox. It can be
rebuilt, and it writes nothing back (ADR 0082).

**Gate**:
A short wait a publisher declares, so a listener can act first, as git
takes its checkpoint before a turn runs (ADR 0082).

**Device request**:
A command an App sends to a device through its host, such as a
notification or a link to open. It runs at most once, with a deadline (ADR
0082).

**Workflow**:
Steps across Apps, such as a commit then a push, run on the host as its
App's runs (ADR 0082, ADR 0085).
_Avoid_: task.

**Task**:
Reserved, as `task@1`. Until it exists, the turn is the unit of work (ADR
0085).
_Avoid_: job.

**Address**:
How a thing is named anywhere: its scope (a Project, the Person or a
Host), its App and its id. It never names a Project's host (ADR 0082).

**Directory**:
The client's map from each Project to the host that has it now (ADR
0082).

**Epoch**:
A count that goes up each time a Project moves. The higher wins, so the
host that gave a Project away cannot keep writing it (ADR 0082, ADR
0085).

**Stale**:
A host that stopped answering though its link looks up: two pings missed,
or an act's ping unanswered in 3 seconds. The Person sees it as away: its
rows dim, its label says once what they are "as of", reads wait for it,
and acts fail at once (ADR 0082, decision 11 and its note; ADR 0106,
law 4).

**Visible queue**:
Commands the Person chose to "send when back", shown with when they will
be dropped: 10 minutes by default, 7 days at most (ADR 0082). A Thread's
Queue is another thing.

**Route**:
One way a client reaches a host: `local`, `ssh` and `direct` in v1; iroh
later (ADR 0081, ADR 0082).

## Trust

**Fence**:
Operating-system walls around every Harness Banda starts. They hide
Banda's state, keys and owner access from an Agent's shell, and make
Banda's config read-only there (ADR 0083).
_Avoid_: sandbox (that is an environment).

**Pass**:
What an Agent's or an App's session shows Banda: who it is (its Agent,
Thread and Project, or its App), its tools, its audience and its expiry
(ADR 0083).
_Avoid_: token (ADR 0019's word).

**Audience**:
Where a pass is taken: `ws` (the API), `gateway` or `door` (ADR 0083).

**Owner socket**:
How the Person's own window and CLI reach the engine on their computer,
checked by which user runs the program at the other end (ADR 0083).

**Gesture**:
A click, a key or an answer the Person gives on one of their devices.
Only a gesture acts as the Person (ADR 0083).

**`via`, `on_behalf`**:
Whose code acts, and the Person it acts for. `on_behalf` is recorded and
gives no rights (ADR 0082, ADR 0083).

**Proposal**:
A change an Agent asks to make to the Person's data or to the host's list
of MCP servers. It reaches the Person as a Call, and changes nothing until
they accept (ADR 0083).

**Lend**:
The Person gives a Thread one of their tabs to drive, until they take it
back, the tab closes or the session ends (ADR 0083).

**Trusted**:
A Project flag only the Person changes. While a Project is not trusted,
its Harnesses load only the Person's own settings, not the settings, hooks
and MCP servers its folder names. Unsaid, a Project is trusted; one added
from a folder that looks foreign is not (ADR 0083, ADR 0084). Only a
Project the Person said they trust, as they added it or later
(`trust_said`), gives its Agents the Person's GitHub token and SSH agent;
every Project trusted before the fence was said so once, as Banda
upgraded.

**Foreign**:
A folder that looks like code the Person did not write: cloned from a URL,
a remote whose owner is not the Person, or `.claude/`, `.codex/`,
`.mcp.json` or a devcontainer in it. Add Project asks about it (ADR 0084).

**Bookkeeping**:
Banda's own reads of a Project: git status, diffs, checkpoints, Files.
They never run the Project's hooks or helpers (ADR 0083).

**Person key**:
The Person's root of trust, made on their first device. It signs which
devices and hosts are theirs, and which host is home (ADR 0083).

**Recovery code**:
Shown once. It brings the Person key back when every device is lost (ADR
0083).

**Wall**:
A Project's bound: what acts for a Project reaches only that Project (ADR
0019, ADR 0032). Only a box walls a Project's files from the others (ADR
0083, ADR 0084).

**Full access**:
The mode where an Agent has the Person's files, programs and network,
never Banda's state or keys. It is the default only where the fence
holds whole, with Landlock's scopes and for a user outside the `docker`
group; elsewhere the default is Supervised, and Full access the Person
chooses there acts as them (ADR 0083).

## Isolation

**Environment**:
Where a Project's programs run: `local`, `sandbox` or `container` (ADR
0084).

**Box**:
An isolated Project's running sandbox or container (ADR 0084).
_Avoid_: VM.

**Isolated**:
The one switch per Project that runs its Agents, terminals and scripts in
a box (ADR 0084).

**Door**:
A box's one way back into Banda: Banda's tools, opening a link,
credentials, secrets (ADR 0084).

**Door pass**:
A pass for the door only. It ends with the box (ADR 0084).

**Environment sign-in**:
An account of a Harness made for boxes: the same subscription with its own
token, revoked alone (ADR 0084).

**Project profile**:
A device browser profile of one Project. It is on by default when the
Project is isolated (ADR 0084).

**Definition**:
What a box is made from (devcontainer.json or Banda's default image), with
its approved hash. It moves with the Project (ADR 0084).

**Network mode**:
How a box reaches the network: `shared`, the host's (v1), `private` or
`allowlist` (ADR 0084).

## Data

**Unavailable**:
An App refused in a Project because its code is missing or its data is
newer. The Project still opens (ADR 0085).

**Uninstall**:
Stopping an App on a host or in a Project. Its data stays, read-only (ADR
0085).

**Purge**:
Dropping an App's tables and files in a Project, after exporting them to
the Project's trash. Its events stay (ADR 0085).

**Export**:
One App's events and tables, written out. It is not a backup (ADR 0085).

**Backup**:
A Project as one artefact: its store, a git bundle and its data folders. A
move ships the same (ADR 0085).

## Window

**Window**:
Banda's program on one client screen: the desktop app's window, a browser
tab, the phone's PWA, a popped-out Pane's window. It holds what its form
has of the Bar, the Sidebar and the Top layer (a popped-out Pane's window
has only the Top layer), gives the middle to the Tiling where there is
one, keeps Here and routes the keys. It names no App (ADR 0087).
_Avoid_: shell (that is a program a terminal runs); window for a Pane.

**Area**:
One of the Window's regions: the Bar, the Sidebar, the Top layer, and the
middle, which is the Tiling's. Each device's form maps them: on a phone the
sidebar list is the home screen (ADR 0087, ADR 0089).
_Avoid_: place (in code, where a Pane opens), dock.

**Top layer**:
What sits over the tiles: the Banda menu, the launcher, the Drawer, the
Sheet, Quick Look, dialogs, menus and toasts. There is one of each at a time, but
toasts, which stack up to three. The Drawer and Quick Look each hold one
Pane; the Window draws the toasts (ADR 0011, ADR 0087).
_Avoid_: overlay (that is the tiling's unsaved changes), float.

**Here**:
Where the Person is in one Window: the workspace, the Pane in focus, its
Project and the one thing it shows, whether the Sidebar shows, and whether
the device is in front. It is the context Widgets and every action read,
as a program reads its working folder; only the Window writes it, and no
host keeps it. A Pane never reads it to draw (ADR 0087).
_Avoid_: focus (the keyboard's, and the focused Pane).

**Pane**:
An App's view opened for one Project, such as a Thread or a browser page,
with what it shows kept in the arrangement. It stands in a Tile, the
Drawer, Quick Look or a window of its own, and looks the same on every
client. It names its Project and the one thing it shows, never a host, and
reaches the host only through the API (ADR 0062, ADR 0087).
_Avoid_: window (that is Banda's program), tile (that is its box).

**Mod**:
The keys held for every Banda key and the mouse's moves: Alt, unless the
Person picks another in `keys.toml`'s `mod`, as Ctrl+Alt where the desktop
holds Alt. With Shift, or with one key more, it makes Banda's other keys.
Banda writes keys as they are pressed, never "Mod" (ADR 0068).
_Avoid_: main key, except as Settings' label for it.

**Action**:
One thing the Person can do, by id, with a JSON Schema of what it takes:
keys, buttons, menus, widgets, the CLI and Agents all run the same one
(ADR 0005, ADR 0071).
_Avoid_: command (that is a request to an App).

**Pane menu**:
What the Person can do to a Pane and its column with the mouse, each row
with its key: widths and heights, full width, zoom, the Deck, another
column or workspace, its own window, close. Its button at the header's
right end and a right click on the header open it.
_Avoid_: window menu, layout menu.

**Thread menu**:
What the Person can do to a Thread: rename it, suggest a title, mark it
unread, archive it. A click on the title in its Pane's header and a right
click on its row in the sidebar open it (ADR 0077). The Pane menu is
another: it acts on the Pane, not the Thread. Its rows are item actions:
the Threads App's, then Banda's own (ADR 0087).

**Item action**:
An action that takes one Item, such as renaming a Thread or putting it off until Later. The
Item's App gives its own; Banda gives marking it unread and archiving it
(ADR 0087).

**Message box**:
Where the Person writes to an Agent, at a Thread's foot (ADR 0062).
_Avoid_: composer (that is the tiling).

**Tab**:
One page of a browser Pane, with its own address and history. A Pane
keeps its tabs on top of its row or on the left beside the page, as
`browser.toml` says.

**Extension**:
A Chrome extension in the Person's browser profile, added from the Chrome
Web Store (ADR 0084). Its button sits in every browser Pane's row when it is pinned,
and behind the Extensions button when it is not.

**Tiling**:
How Banda lays out Panes, and the program in the Window's middle that does
it: one Rust model, with its authority on the engine of the machine whose
window shows it and a copy in each client that draws a key at once, and on
each client the view, the Tiles and the motion. It knows Panes, never what
they show (ADR 0062, ADR 0087, ADR 0101).
Its other name is the composer.
_Avoid_: composer for anything else.

**Tile**:
The Tiling's box for one Pane on the screen: where it is, what of it shows,
and its state: shown, moving or hidden. The look's `tile` is its glass
(ADR 0088).
_Avoid_: Pane (that is what an App draws in it).

**Configure**:
What the Tiling tells a Pane: its settled size, its scale and its Tile's
state, as a Wayland compositor configures a window. A Pane draws nothing
while hidden, and measures and resizes nothing while moving (ADR 0088).
_Avoid_: resize.

**Arrangement**:
The workspaces, columns, Groups and widths, kept by the tiling on the
machine whose window shows it, and never copied to another. The client's
view is not part of it (ADR 0062, ADR 0101).

**Overlay**:
The changes to the arrangement a client would keep, marked "not yet
saved", while the engine that holds it is away: an hour and 200 changes
at most (ADR 0062). Not built: a desktop's engine is its own machine's, so
it needs none, and whether a browser tab gets one is decided with the web
(ADR 0101, decision 5).
_Avoid_: overlay for what sits over the tiles (that is the Top layer).

**Workspace**:
One screen of Panes. It can hold Panes of any Projects; it only lays out the
screen, and the Project stays the boundary. Workspaces sit one under another,
and there is always one empty workspace at the bottom. In the row and solo,
a Project has one workspace that holds its Panes only, and every other
workspace is a free one (ADR 0065, ADR 0102).
_Avoid_: Desk (in speech, «стол» is a workspace; the look's desk is the
glass under the tiles).

**Flow**:
How an Agent's Panes stand, as its icon on the bar switches it (ADR
0098): free, where they are; in a row, each Project on its own
workspace; or solo, as the row, what has the focus filling the screen
(ADR 0079, ADR 0102). Free and the row are where the Tiling places a
Pane; solo is each client's own view, so a phone and a desktop open at
once do not fight over it (ADR 0087).

**Strip**:
How a workspace lays out its Panes: columns side by side that scroll
sideways, each holding Panes one above another.

**Deck**:
A column that shows one of its Panes at a time, with the others' names
in a row over it (`Alt+T`); the other way is stacked, one above another.
_Avoid_: tabs, tabbed column (a Tab is a browser page's).

**Group**:
Columns side by side on one workspace, held together, so they move and
look as one: a plate behind them, in the colour of their Agent's state
(ADR 0065). `Alt+G` starts one; an Agent's Thread is a Group from its
opening, and the Panes its Agent opens join it. The mod and a drag of
any of its Panes move it whole. It lays out only, and gives no access.

**Zoom**:
One Pane over the whole window, with no gaps and no sidebar, until the
Person zooms it back or looks at another (`Alt+Shift+F`). Only the window
knows it; the arrangement stays as it was.

**Overview**:
Every workspace zoomed out at once, to pick a Pane or a workspace.

**Quick Look**:
A file shown in a Pane that floats over the tiles, in the Top layer, as
Space shows the row picked in Files: the tiling stays, the tree keeps the
keys and the Pane follows its arrows, ↵ opens the file as a Pane of its
own (ADR 0073, decision 7; ADR 0087). One per Window.
_Avoid_: preview Pane, peek (that is its code's word).

**Columns, Gallery**:
Two of the ways a Files Pane shows its folder, beside its tree: Miller
columns, each folder from the Pane's to the row picked a column, the file
picked drawn in the last; and a Gallery, the row picked big over a
filmstrip of its folder's small pictures (Ctrl+1, 2, 3; ADR 0073, as
amended in step F6). One pick serves the three.
_Avoid_: column view (a column is the Strip's), grid.

**Previewer**:
What draws a kind of file wherever a file is shown, a module's: code, a
PDF, a video. The one that matches a file best draws it, unless the
Person picked another for its extension with "Open with…" (ADR 0073,
decision 6).
_Avoid_: viewer, renderer.

**Free workspace**:
A workspace that holds Panes of any Project and of none, as the Flow
`free` does. In the row and solo there can be any number of them; the
empty one at the bottom becomes one when a Pane is put on it, and a
Thread of no Project opens on the first (ADR 0102).

**Project's own Group**:
The Group first on a Project's workspace that holds the Panes the Person
opened for the Project and not for an Agent: a terminal, a dev server,
Files, Git. It is there while it holds a Pane (ADR 0102).

**Sheet**:
Settings, Usage or the notifications, come in from the right edge over
the workspace, in the top layer. The row stays as it is, and `Esc`
takes it away (ADR 0102).

**Drawer**:
A quick Thread that drops from the top over the workspace (`` Alt+` ``)
and is lifted again as it was. It is in no workspace until its pin makes
it a column of the one on screen.

**Sidebar**:
The Window's area at its left edge, and Banda's list that fills it, the
sidebar list: every Thread of every Project, and whatever else an App
lists as an Item. Each row shows its own Mark. It is the Person's inbox:
tabs Inbox, Working, Later and Archive, grouped by nothing, Project or
machine, and the Person's own keys change any part of it (ADR 0098). The list is a part of Banda,
not of the Threads App: it reads only what Apps list (ADR 0087). On a
phone it is the home screen. Where the two must be told apart, say "the
Sidebar" for the area and "the sidebar list" for the list.
_Avoid_: panel. Inbox is its first tab.

**Archive**:
Where the Threads the Person put away wait, folded at the sidebar's
bottom. Only the Person archives a Thread; anything new in it brings it
back to the list (ADR 0069). The Thread's host keeps the mark, beside its
Later, so a Thread archived on one machine is archived on all (ADR
0096). A Project is archived too, which hides it from the pickers until
the Person brings it back (ADR 0026).
_Avoid_: settled (its name before ADR 0069).

**Later**:
A Thread put away until a time, until its turn ends, until its usage limit
resets, or Someday, with no time; on the sidebar's Later tab. A new call
wakes it early; a Thread that asks may be put off, and comes back with the
same question. The engine keeps it, so every window, machine and Agent
sees it; an Agent may put its own Thread off (ADR 0074, ADR 0098).
_Avoid_: snooze, remind.

**Seen**:
The Person's mark that they saw how a Thread's latest turn ended: that
turn's ID, never a time. A finished or failed turn calls until it is
seen. The Thread's host keeps it, beside its Later, so every window and
machine agrees; a window marks it only while the Person is there, and
"Mark as unread" takes it back. Only the Person marks it (ADR 0096).
_Avoid_: read (the menu's word for the action, not the mark).

**Banda skill**:
What an Agent needs to know to work in Banda and to change it for its
Person: a short core, read first, and topics read when needed, one per
area such as `look` or `sidebar` (ADR 0012).

**Topic**:
One page of the Banda skill, written beside the code it describes, in its
part's `skill/` folder.

**Preset**:
A named arrangement of the sidebar: `inbox`, `projects` or `places`, or a file
of the Person's own in `~/.config/banda/sidebars/`. It sets how Threads are
grouped and sorted and what a row shows; the Person's keys in
`sidebar.toml` win over it.

**Shelf**:
A section at the bottom of the sidebar, folded or open, with its count,
as a Person's `group.bottom` asks; none of Banda's presets has one.

**Bar**:
The Window's line across its top: the Mark, which opens the Banda menu
(ADR 0098, decision 21), at its left edge, then widgets on its left, in
its middle and on its right, the Pager among them (ADR 0024, ADR 0064).
On a phone it is a header with at most two compact widgets (ADR 0089).
It is a program that holds others: it draws the Mark and places the
widgets, each a program of its own, as `[bar]` says; what it takes and
gives is written at the top of `client/web/src/bar/Bar.tsx`.

**Widget**:
A small view on the Bar, an App's or one of Banda's own parts', as the
sidebar list's counts: an icon, maybe a number, that shows only while it
has something to say. It reads Here for where the Person is, and a click runs an action or
opens its own list. The look's `[bar]` says which widgets stand on the
left, in the middle and on the right, and in what order; with Alt held,
the mouse moves one there and writes it (ADR 0064, ADR 0087).

**Pager**:
The Tiling's widget on the Bar that shows the workspaces, one cell each,
and takes the Person to one: a free workspace by its number, a Project's
by its Sign, faint while it is emptied and keeps its place, and the empty
one at the bottom as `+`. A number is the workspace's place, its `Alt+N`.
It takes what the Tiling holds and the Projects the window knows, gives
a cell for each workspace, and runs `workspace.go` on a click, nothing
else (`client/web/src/tiling/pager/`; ADR 0024, ADR 0102). Its id in
`[bar]` is `workspaces.list`.
_Avoid_: pager for a program that shows text a page at a time, as `less`;
a switcher (that was the agents widget, ADR 0065).

**Update**:
A newer Banda of the same channel, which Banda downloads by itself and
installs when it quits. The bar shows one that downloads or is ready,
and names it once it is ready. While Threads work or a program runs in
one of this machine's terminals, Banda restarts into it once they stop,
and the new Banda says it updated (ADR 0041, ADR 0072, ADR 0106).

**Mark**:
Banda's sign: three tiles, the top one an Agent with eyes. Its shape and
colour say what the work calls the Person for: it asks them (a triangle),
failed (an octagon), finished, woke from Later, is open, sleeps until
later, or the engine is offline; while it works it shows what its Agent
does: reads, edits, runs `>_`, waits on sub-agents, which circle it as
satellites, red for one that failed (ADR 0099, ADR 0103). In the bar
it shows the loudest of every Thread, on its top tile only; in the
sidebar, each Thread's own. A finished or failed
turn settles once the Person has looked at its Thread; a Question asks until
it is answered.

**Watch**:
What a module draws for each Project, showing nothing, to tell the window what
its work there calls the Person for and what the sidebar lists for it. The
bar's Mark shows the loudest, and the window tells the Person of each thing
that starts calling. It is going: an App's host part lists Items and raises
Calls instead, and the Watches go once calls are worked out on the host
(ADR 0082, ADR 0087).

**Call**:
Something that calls for the Person now: a Thread finished while they were
away, asks them, or failed. Its host works it out, so it calls with no
window open (ADR 0081). A client tells them where they look: nothing while
they look at it, its sound, a toast in the window, or a system
notification when the window is behind. `Alt+U` goes to it.

**Inbox**:
The sidebar's first tab: what is the Person's turn, the Threads open with
no turn, and a shelf of those at work (ADR 0098). Its calls are every Call
of every host, merged by the client. Each row keeps its host,
so an answer goes back there (ADR 0081, ADR 0082). It is a part of Banda,
not of an App; `Alt+U` walks it in the sidebar's order (ADR 0079, ADR
0087).

**Quiet**:
A while in which nothing calls the Person: no sound, toast, system
notification or calling Mark, while the inbox still fills; set from the
sidebar's foot (ADR 0098).

**Toast**:
A short card at the window's top right that tells of a Call whose Thread is
not on screen, less than half of its Tile in view (ADR 0087), of a new
Problem, of an action that does not run where its values are, as "Not on
arc yet: Open in a browser" (ADR 0106), or of how a commit, push or pull
from a Thread's card ended out of its sight; Sonner's, stacked (ADR 0048). It goes away by itself; the Mark
remembers, and the bell shows the last ones again.

**Pull request**:
A GitHub pull request linked to a Thread: by Create PR, by the Agent's
`gh pr create` or its tool, or by the Person. Banda never guesses it from a
branch. The `pulls` module reads a Project's linked PRs, works out what each
needs and whose turn it is, and the bar's `pulls.status` shows them (ADR
0076).

**Auto-fix**:
Banda watching a Thread's pull request and telling the Thread that works on
it what is new: checks failed or passed, a review, a conflict, a merge. On
for a PR made in a Thread; the Agent never polls GitHub itself (ADR 0076).
