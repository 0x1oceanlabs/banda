# Banda

Banda is a hackable, tiling workspace for working with Agents, made first
for enthusiasts and AI-native people. Terms are English everywhere: in code, in docs, and in speech
in any language. A word belongs here only when some visible behaviour needs
it.

## Work

**Space**:
One body of work and its folder on disk (`~/Banda/<name>/` by default). It
holds the files that the Person and the Agents work on, plus `.bandaso/`,
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
The list of every Space with its Threads, docked at the window's left edge.
Each Thread shows its own Mark.

**Bar**:
The line across the window's top: the Mark, which is the sidebar's button,
and the numbers of the workspaces.

**Mark**:
Banda's sign: three tiles, the top one an Agent with eyes. Its shape and
colour say what the work calls the Person for: it rests, works, asks them,
finished, failed, or the engine is offline. In the bar it shows the loudest
of every Thread; in the sidebar, each Thread's own. A finished or failed
turn settles once the Person has looked at its Thread; a Question asks until
it is answered.

**Watch**:
What a module draws for each Space, showing nothing, to tell the window what
its work there calls the Person for. The bar's Mark shows the loudest, and a
call that comes now plays a sound.

**Call**:
Something that calls for the Person now: a Thread finished while they were
away, asks them, or failed. The window plays its sound, unless the Person is
looking at it.
