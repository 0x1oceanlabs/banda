# Bandaso

Bandaso is a tiling workspace for working with Agents, made for people who do
not write code. Terms are English everywhere: in code, in docs, and in speech
in any language. A word belongs here only when some visible behaviour needs
it.

## Work

**Space**:
One body of work and its folder on disk (`~/Bandaso/<name>/` by default). It
holds the files that the Person and the Agents work on, plus `.bandaso/`,
which keeps the Space's data and event log. Copying the folder moves the
Space.
_Avoid_: project, workspace (that is the whole app).

**Participant**:
Anyone who acts in a Space: a Person or an Agent. Every record names its
author, who is always one of the two.

**Person**:
A human Participant. On one computer, the Person is that computer's user, who
owns every Space there.
_Avoid_: user (outside code that talks to the operating system).

**Agent**:
An AI Participant that does work in a Space through a Harness. It has a name,
and its Threads stay its own across Harness switches.

**Harness**:
The agent program an Agent runs on, for example Claude Code or Codex. The
engine reaches it through an adapter, ACP first. It reads what a Harness can
do from the Harness's declared capabilities.

**Thread**:
One conversation between a Person and an Agent. It shows items: messages, the
Agent's thoughts, tool calls, its plans, notices and Questions.
_Avoid_: chat, session.

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
The one process on a machine that owns Spaces, Agents and every module's
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

**Desk**:
A Space's Panes in the window, and how they split it. Each Space keeps its
own Desk on this computer.
