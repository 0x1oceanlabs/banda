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
author, who is always one of the two.

**Person**:
A human Participant. On one computer, the Person is that computer's user, who
owns every Project there.
_Avoid_: user (outside code that talks to the operating system).

**Agent**:
The AI at work in one Thread, through that Thread's Harness. Each Thread has
its own Agent, with no name or settings of its own (ADR 0006).

**Harness**:
The agent program a Thread runs on, for example Claude Code or Codex. The
engine reaches it through an adapter, ACP first. It reads what a Harness can
do from the Harness's declared capabilities.

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
Harness, never in a terminal.
_Avoid_: console, shell (that is one program a terminal runs).

**Thread**:
One session with a Harness in a Project: starting one is all it takes. Its
Harness is chosen when it starts and stays with it. It shows items: messages,
the Agent's thoughts, tool calls, its plans, Visuals, notices and Questions.
A Harness keeps a session of its own for it, which a Thread holds as
evidence.
_Avoid_: chat.

**Plan**:
The steps an Agent means to take in a turn, each to do, doing now or done.
Plan mode is something else: a setting under which the Agent only plans and
changes nothing.
_Avoid_: todos.

**Slash command**:
What a Harness runs when a message starts with `/` and its name, such as
`/compact`. Each Harness has its own; the window adds `/plan` and `/default`,
which switch plan mode.
_Avoid_: command (that is a request to a module).

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
The one process on a machine that owns Projects, Threads and every module's
data. Windows and the CLI are clients of its API.
_Avoid_: server (that is a machine), backend.

**Kernel**:
The small part of the engine that every module needs: Projects, the event log,
the access decision, identity, the module registry and the API. It names no
module.

**Module**:
A bounded context with its own words, data and contract: the commands it
accepts, the events it publishes, its own tables, its MCP tools and its
Panes. A module can be removed without breaking the others.
_Avoid_: plugin (that is a module written by someone else, later), feature.

**Manifest**:
What a module offers, as it declares it (ADR 0022): its engine part's
`methods!` table, its window part's `defineModule`, and its short
`module.toml` for what no code says. `banda modules` prints all three.

**Source**:
Where the Banda menu finds a module's rows: Files, or New Thread with the
words typed (ADR 0022, decision 4).

**Unstable mark**:
A path a module of Banda's takes that a module from elsewhere would lack,
named in its `module.toml` with why. Their count only falls.

**Command**:
A request to a module to change something. It passes the access decision and
returns a result or a refusal.

**Event**:
A fact a module publishes after a change, in its published language and with
a version. Other modules and windows subscribe to events. They never read
another module's tables.

**Stream**:
What a module says to a window for one call while it lasts, such as what a
terminal prints. Unlike an event it is not logged: a window that connects
again hears it again from the start.

**Access decision**:
The one place where the kernel decides whether a Participant may perform an
action on a target. On one computer, the owner may do everything.

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

## Window

**Window**:
A client of the engine that shows Projects as tiled Panes. The first window is
the Electron app.

**Pane**:
One tile in the window that shows a module's view, such as a Thread or a
browser page. A Pane reaches the engine only through the API.

**Mod**:
The keys held for every Banda key and the mouse's moves: Alt, unless the
Person picks another in `keys.toml`'s `mod`, as Ctrl+Alt where the desktop
holds Alt. With Shift, or with one key more, it makes Banda's other keys.
Banda writes keys as they are pressed, never "Mod" (ADR 0068).
_Avoid_: main key, except as Settings' label for it.

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
another: it acts on the Pane, not the Thread.

**Tab**:
One page of a browser Pane, with its own address and history. A Pane
keeps its tabs on top of its row or on the left beside the page, as
`browser.toml` says.

**Extension**:
A Chrome extension in the browser's one profile, added from the Chrome
Web Store. Its button sits in every browser Pane's row when it is pinned,
and behind the Extensions button when it is not.

**Workspace**:
One screen of Panes. It can hold Panes of any Projects; it only lays out the
screen, and the Project stays the boundary. Workspaces sit one under another,
and there is always one empty workspace at the bottom. A Project has one
workspace where its Agents' Groups open, in a row (ADR 0065).
_Avoid_: Desk.

**Flow**:
How an Agent's windows stand, as the sidebar's header switches it: free,
where they are; in a row on its Project's workspace; or solo, the Agent
you are at filling the screen (ADR 0079).

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
(ADR 0065). `Alt+G` starts one; an Agent's Thread and the Panes it opens
are its Group. It lays out only, and gives no access.

**Zoom**:
One Pane over the whole window, with no gaps and no sidebar, until the
Person zooms it back or looks at another (`Alt+Shift+F`). Only the window
knows it; the arrangement stays as it was.

**Overview**:
Every workspace zoomed out at once, to pick a Pane or a workspace.

**Drawer**:
A quick Thread that drops from the top over the workspace (`` Alt+` ``)
and is lifted again as it was. It is in no workspace until its pin makes
it a column of the one on screen.

**Sidebar**:
The list of every Thread of every Project, docked at the window's left edge.
Each Thread shows its own Mark. A preset arranges it, and the Person's own
keys change any part of it.

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
The line across the window's top: the Mark, which is the sidebar's button,
at its left edge, then widgets on its left, in its middle and on its right,
the workspaces' numbers and their `+` among them (ADR 0024, ADR 0064).

**Widget**:
A module's item on the bar, or the window's own: an icon, maybe a
number, that shows only while it has something to say. A click runs one
of its module's actions. The look's `[bar]` says which widgets stand on
the left, in the middle and on the right, and in what order; with Alt held,
the mouse moves one there and writes it (ADR 0064).

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
that starts calling.

**Call**:
Something that calls for the Person now: a Thread finished while they were
away, asks them, or failed. The window tells them where they look: nothing
while they look at it, its sound, a toast in the window, or a system
notification when the window is behind. `Alt+U` goes to it.

**Toast**:
A short card at the window's top right that tells of a Call whose Thread is
not on screen, of a new Problem, or of how a commit, push or pull from a
Thread's card ended out of its sight; Sonner's, stacked (ADR 0048). It goes
away by itself; the Mark remembers, and the bell shows the last ones again.

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
