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
and mark: a dot in its colour and the first letter of its name (ADR 0078).
A Harness's own entry is its first account. An environment sign-in is one
too, made for boxes (ADR 0084).
_Avoid_: profile, instance.

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
_Avoid_: chat.

**Entry**:
One thing a Thread shows, one for each kind of its body: a message, a
thought, a call, a plan, a Question, a notice, an Issue, a Visual. Each
kind is drawn by a file of its own (ADR 0091).
_Avoid_: item (that is `item@1`), event.

**Line**:
What a Thread's timeline adds between its entries: the work line, a fold,
the live line, a turn that ended, a turn's changes, a proposed plan (ADR
0091).
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

## Shape

**Engine**:
The one process on a host, `banda serve`, that owns the host's Projects,
their Threads and every App's data there. It is the machine's service and
outlives the window (ADR 0086). Clients reach it through its API.
_Avoid_: server (that is a machine), backend.

**Host**:
A machine where `banda serve` keeps Projects and runs their work: this
computer, a server, a devbox, or a machine in Banda Cloud. Clients only
show the work (ADR 0062, ADR 0081).
_Avoid_: server, node; "host" for the Harness process pool (`Hosts<H>`),
which is the process pool.

**Home host**:
The host that keeps the Person's documents: the always-on host when the
Person has one, else the laptop (ADR 0082).

**Client**:
What shows the hosts' work and asks for changes: the desktop app, a
browser tab, a phone, the CLI. One client works with several hosts, and
only a client joins them (ADR 0062, ADR 0082). Every client but the CLI
shares one core, and only its Window knows the device (ADR 0089).
_Avoid_: frontend.

**Device**:
The machine a client runs on, and what only it has: notifications, sound,
the clipboard, a file picker, opening outside Banda, its webviews. It tells
its hosts whether the Person is in front of it (ADR 0082).

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
`app.toml` (`module.toml` until the rename, ADR 0062) for what no code
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
Thread's details or the Pane header (ADR 0082).

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
A process on the host that runs an App from elsewhere, with its App's
pass. In v1 it runs only Apps the Person made or trusts (ADR 0062).

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
The one writer of a record. A Project's moves between hosts; the Host's
(its programs, accounts, installed code and settings) never moves; the
Person's is a few documents on the home host (ADR 0082). A session's
scopes, an Agent's tools, are another thing.
_Avoid_: machine scope (it split into Host and Person).

**Person document**:
One of the Person's few versioned files on the home host: the
arrangement, keys, the sidebar, themes, `[notify]`, seen marks, Web Apps'
manifests. Each is read whole, and clients cache it; no other host keeps
one (ADR 0082).
_Avoid_: sync, replica.

**Query**:
A read, answered with how fresh it is ("as of"), and safe to repeat (ADR
0082).
_Avoid_: call (its old name).

**Published fact**:
An event other Apps may hear, named `app.noun.past-verb@major` and
declared by its App. Every other event is its App's own (ADR 0082).

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
A host that stopped answering. Its rows dim and say "as of", reads come
from the client's copy, and commands fail at once (ADR 0082).

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
from a folder that looks foreign is not (ADR 0083, ADR 0084).

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
holds; elsewhere the default is Supervised (ADR 0083).

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
What sits over the tiles: the Banda menu, the launcher, the Drawer, Quick
Look, dialogs, menus and toasts. There is one of each at a time, but
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
An action that takes one Item, such as renaming or snoozing a Thread. The
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
it: one Rust model, with its authority on the home host and a copy in each
client that draws a key at once, and on each client the view, the Tiles
and the motion. It knows Panes, never what they show (ADR 0062, ADR 0087).
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
The workspaces, columns, Groups and widths, kept by the tiling on the home
host. The client's view is not part of it (ADR 0062, ADR 0082).

**Overlay**:
The changes to the arrangement a client keeps, marked "not yet saved",
while the home host is away: an hour and 200 changes at most (ADR 0062).
_Avoid_: overlay for what sits over the tiles (that is the Top layer).

**Workspace**:
One screen of Panes. It can hold Panes of any Projects; it only lays out the
screen, and the Project stays the boundary. Workspaces sit one under another,
and there is always one empty workspace at the bottom. A Project has one
workspace where its Agents' Groups open, in a row (ADR 0065).
_Avoid_: Desk (in speech, «стол» is a workspace; the look's desk is the
glass under the tiles).

**Flow**:
How an Agent's Panes stand, as the sidebar's header switches it: free,
where they are; in a row on its Project's workspace; or solo, the Agent
you are at filling the screen (ADR 0079). Free and the row are where the
Tiling places a Pane; solo is each client's own view, so a phone and a
desktop open at once do not fight over it (ADR 0087).

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

**Drawer**:
A quick Thread that drops from the top over the workspace (`` Alt+` ``)
and is lifted again as it was. It is in no workspace until its pin makes
it a column of the one on screen.

**Sidebar**:
The Window's area at its left edge, and Banda's list that fills it, the
sidebar list: every Thread of every Project, and whatever else an App
lists as an Item. Each row shows its own Mark. A preset arranges it, and
the Person's own keys change any part of it. The list is a part of Banda,
not of the Threads App: it reads only what Apps list (ADR 0087). On a
phone it is the home screen. Where the two must be told apart, say "the
Sidebar" for the area and "the sidebar list" for the list.
_Avoid_: panel; Inbox (that is the merged Calls).

**Archive**:
Where the Threads the Person put away wait, folded at the sidebar's
bottom. Only the Person archives a Thread; anything new in it brings it
back to the list (ADR 0069). A Project is archived too, which hides it
from the pickers until the Person brings it back (ADR 0026).
_Avoid_: settled (its name before ADR 0069).

**Snooze**:
A Thread put away until a time, until its turn ends, or until its usage
limit resets, on its shelf above Archive. Anything that calls the Person
wakes it early, and a Thread that asks cannot be snoozed. The engine keeps
it, so every window, machine and Agent sees it; an Agent may snooze its
own Thread (ADR 0074).
_Avoid_: remind, later.

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
The Window's line across its top: the Mark, which is the sidebar's button,
at its left edge, then widgets on its left, in its middle and on its right,
the workspaces' numbers and their `+` among them (ADR 0024, ADR 0064). On a
phone it is a header with at most two compact widgets (ADR 0089).

**Widget**:
A small view on the Bar, an App's or one of Banda's own parts', as the
sidebar list's counts: an icon, maybe a number, that shows only while it
has something to say. It reads Here for where the Person is, and a click runs an action or
opens its own list. The look's `[bar]` says which widgets stand on the
left, in the middle and on the right, and in what order; with Alt held,
the mouse moves one there and writes it (ADR 0064, ADR 0087).

**Update**:
A newer Banda of the same channel, which Banda downloads by itself and
installs when it quits. The bar shows one that downloads or is ready,
and names it once it is ready. While Threads work, Banda restarts into it
once they stop, and the new Banda says it updated (ADR 0041, ADR 0072).

**Mark**:
Banda's sign: three tiles, the top one an Agent with eyes. Its shape and
colour say what the work calls the Person for: it rests, works, asks them,
finished, failed, or the engine is offline. In the bar it shows the loudest
of every Thread; in the sidebar, each Thread's own. A finished or failed
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
Every Call of every host, merged by the client. Each row keeps its host,
so an answer goes back there (ADR 0081, ADR 0082). It is a part of Banda,
not of an App; `Alt+U` walks it in the sidebar's order (ADR 0079, ADR
0087).

**Toast**:
A short card at the window's top right that tells of a Call whose Thread is
not on screen, less than half of its Tile in view (ADR 0087), of a new
Problem, or of how a commit, push or pull from a Thread's card ended out of
its sight; Sonner's, stacked (ADR 0048). It goes away by itself; the Mark
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
