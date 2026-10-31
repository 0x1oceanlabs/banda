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
One conversation between a Person and an Agent, kept as a log of events:
messages, tool calls, Questions and answers.
_Avoid_: chat, session.

**Turn**:
One stretch of an Agent's work in a Thread. It begins at a message to the
Agent and ends when the Agent stops or is stopped.

**Question**:
An Agent's request for the Person to decide something. Most often it asks for
permission to run an action. The Harness writes the options, and the Person's
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
