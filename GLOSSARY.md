# Banda

Banda is a hackable, tiling workspace for working with Agents, made first
for enthusiasts and AI-native people. Terms are English everywhere: in code, in docs, and in speech
in any language. A word belongs here only when some visible behaviour needs
it.

## Work

**Space**:
One body of work and its folder on disk (`~/Banda/<name>/` by default). It
holds the files that the Person and the Agents work on, plus `.banda/`,
which keeps the Space's data and event log. Copying the folder moves the
Space.
_Avoid_: project, workspace (that is a screen of Panes).

**Participant**:
Anyone who acts in a Space: a Person or an Agent. Every record names its
author, who is always one of the two.

**Person**:
A human Participant. On one computer, the Person is that computer's user, who
owns every Space there.
_Avoid_: user (outside code that talks to the operating system).

**Agent**:
The AI at work in one Thread, through that Thread's Harness. Each Thread has
its own Agent, with no name or settings of its own (ADR 0006).

**Harness**:
The agent program a Thread runs on, for example Claude Code or Codex. The
engine reaches it through an adapter, ACP first. It reads what a Harness can
do from the Harness's declared capabilities.

**Sign-in**:
How a Person lets a Harness work under their account, in a way the Harness
offers: in a terminal, as Claude Code does, or by itself in the browser, as
Codex does. The Harness keeps the credentials; Banda holds none.
_Avoid_: login, auth.

**Terminal**:
A program the engine runs on a PTY for a Person, such as their shell or a
Harness's sign-in. Every window that opens it shows the same screen; it ends
when it is closed or the engine stops. An Agent runs programs through its
Harness, never in a terminal.
_Avoid_: console, shell (that is one program a terminal runs).

**Thread**:
One session with a Harness in a Space: starting one is all it takes. Its
Harness is chosen when it starts and stays with it. It shows items: messages,
the Agent's thoughts, tool calls, its plans, notices and Questions.
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
The one process on a machine that owns Spaces, Threads and every module's
data. Windows and the CLI are clients of its API.
_Avoid_: server (that is a machine), backend.

**Kernel**:
The small part of the engine that every module needs: Spaces, the event log,
the access decision, identity, the module registry and the API. It names no
module.

**Module**:
A bounded context with its own words, data and contract: the commands it
accepts, the events it publishes, its own tables, its MCP tools and its
Panes. A module can be removed without breaking the others.
_Avoid_: plugin (that is a module written by someone else, later), feature.

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

## Window

**Window**:
A client of the engine that shows Spaces as tiled Panes. The first window is
the Electron app.

**Pane**:
One tile in the window that shows a module's view, such as a Thread or a
browser page. A Pane reaches the engine only through the API.

**Tab**:
One page of a browser Pane, with its own address and history. A Pane
keeps its tabs on top of its row or on the left beside the page, as
`browser.toml` says.

**Extension**:
A Chrome extension in the browser's one profile, added from the Chrome
Web Store. Its button sits in every browser Pane's row when it is pinned,
and behind the Extensions button when it is not.

**Workspace**:
One screen of Panes. It can hold Panes of any Spaces; it only lays out the
screen, and the Space stays the boundary. Workspaces sit one under another,
and there is always one empty workspace at the bottom.
_Avoid_: Desk.

**Strip**:
How a workspace lays out its Panes: columns side by side that scroll
sideways, each holding Panes one above another.

**Overview**:
Every workspace zoomed out at once, to pick a Pane or a workspace.

**Sidebar**:
The list of every Thread of every Space, docked at the window's left edge.
Each Thread shows its own Mark. A preset arranges it, and the Person's own
keys change any part of it.

**Banda skill**:
What an Agent needs to know to work in Banda and to change it for its
Person: a short core, read first, and topics read when needed, one per
area such as `look` or `sidebar` (ADR 0012).

**Topic**:
One page of the Banda skill, written beside the code it describes, in its
part's `skill/` folder.

**Preset**:
A named arrangement of the sidebar: `inbox`, `spaces` or `places`, or a file
of the Person's own in `~/.config/banda/sidebars/`. It sets how Threads are
grouped and sorted and what a row shows; the Person's keys in
`sidebar.toml` win over it.

**Shelf**:
A section at the bottom of the sidebar, folded or open, with its count,
as a Person's `group.bottom` asks; none of Banda's presets has one.

**Bar**:
The line across the window's top: the Mark, which is the sidebar's button,
and the numbers of the workspaces on its left; widgets on its right
(ADR 0024).

**Widget**:
A module's item on the bar's right: an icon, maybe a number, that shows
only while it has something to say. A click runs one of its module's
actions. The look's `[bar]` says which widgets stand where.

**Mark**:
Banda's sign: three tiles, the top one an Agent with eyes. Its shape and
colour say what the work calls the Person for: it rests, works, asks them,
finished, failed, or the engine is offline. In the bar it shows the loudest
of every Thread; in the sidebar, each Thread's own. A finished or failed
turn settles once the Person has looked at its Thread; a Question asks until
it is answered.

**Watch**:
What a module draws for each Space, showing nothing, to tell the window what
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
not on screen. It goes away by itself; the Mark remembers.
