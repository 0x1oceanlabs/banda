---
status: accepted
date: 2026-10-31
---

# One engine owns the work; a small kernel and modules; windows only show

Roma decided on 2026-10-31 to start Bandaso in a new repository. Bandaso is an
app for working with Agents, built as a tiling workspace for people who do not
write code. It starts on one computer. Later it runs on your own server or in
our cloud, and after that it serves teams.

The previous product, Banda, started from a multi-user Server: Caddy, Auth on
Better Auth, Device codes, Docker workstations, and Chat in a terminal. Of
about 206 thousand lines in that repository, around 14 thousand fit the new
app. The rest serves the Server, multi-user work and the TUI. Banda keeps
running for our own team until Bandaso can replace it. What we learned there
(Harness quirks, permissions, steering) moves over as knowledge, not as
code.

**Decision.**

1. **One engine owns the work, and windows only show it.** The engine is
   one Rust process per machine. It owns Spaces, Agents, their Threads and
   every module's data. The window talks to it through one API: JSON over
   WebSocket, with TypeScript types generated from Rust. The window on your
   computer and, later, a browser tab on our cloud are the same kind of
   client of the same API. Everything a window can do, the `bandaso` CLI can
   do too, so people, scripts and Agents can drive the app.

2. **The window is Electron, React and shadcn/ui.** Claude, Codex and
   T3 Code are on Electron. shadcn/ui and its AI components (conversation,
   message, tool call, confirmation, plan, queue) cover most of a chat with
   Agents. The same React code later runs in a browser for the cloud, and
   module authors already know React. GPUI, the stack of Zed, Herdr and
   Banda's Desktop, was the runner-up. It is lighter and faster, but it has
   no components for agent work and no browser client. Speed is a budget
   that tests check: start-up time, memory and input latency.

3. **A small kernel, and modules as bounded contexts.** The kernel holds
   only what every module needs. That is the Space, the Space's event log,
   the one place that decides "may this Participant do this", identity as a
   port, the module registry and the API. The kernel names no module. Each
   module has its own words, its own data and its own contract. Modules talk
   only through commands and events, and any module can be removed without
   breaking the others. `docs/architecture.md` describes the contract.

4. **Inside a module: rules, store, operation.** `rules` holds pure
   decisions and state machines, with no database, clock or randomness.
   `store` holds the SQL, and each table has one writer. `operation` is the
   way in: a command goes through the rules and the store, and the events
   come out in one transaction. Adapters (ACP, a Harness's native protocol,
   the clock, IDs) stay at the edge. Tactical DDD goes only where a real
   invariant lives: an Agent's turn, a permission Question, a Database's
   schema revision. There are no layers for their own sake, no repository
   interfaces with one implementation, and no event sourcing except where
   the work already is a stream of events (an Agent's Thread).

5. **A Space is a folder you can see.** It is `~/Bandaso/<name>/` by default:
   the files the Agents and the Person work on, plus `.bandaso/` with the
   Space's SQLite and event log. Copying the folder moves the Space, to
   another computer or a server. No vendor holds your work.

6. **Our model is at the centre, and ACP is the first adapter.** Threads,
   turns, tool calls and Questions are Bandaso's own model. ACP is the
   first and default way to reach a Harness, and the Harness list comes
   from the ACP Registry. A native adapter (for example Codex's app-server)
   is added only where ACP blocks something users need. The rest of the
   engine reads a Harness's capabilities, never its name.

7. **The Harness decides when to ask; Bandaso relays.** A Harness asks for
   permission by its own settings. Bandaso shows the Question in plain words,
   passes the Harness's own options through unchanged, and returns the
   Person's answer. It writes no command rules of its own. It never offers a
   Harness's own "always" answer, because that answer is written to files
   the Agent itself can change.
   _Changed by ADR 0003, decision 9: a Question shows the "always" answers
   too, and modes follow T3 Code._

8. **Teams come later, but four rules hold from the start.** Every record
   has a global ID (UUIDv7) and an author, a Person or an Agent. Every
   action passes the kernel's access decision, which on one computer answers
   "the owner may do everything". A Thread is a log that any window can
   subscribe to, local or remote. Only the engine writes, so there is
   nothing to sync between copies. Accounts, Auth, Members, invitations,
   relays and sync are not built now.

9. **Sign-in later stays ours to check and the user's to choose.** The
   engine always checks rights itself, wherever it runs. An identity
   provider only says who someone is: nobody on one computer, built-in
   accounts or a company's OIDC on your own server, our accounts in the
   cloud. Our cloud is one OIDC provider and one relay, with no special
   path in the code. A relay only connects and never signs anyone in.
   Bandaso holds no model provider's credentials.

10. **The first step is the agents and browser modules.** One Person works
    with one Agent in a Thread, with a browser beside it. Chat (Rooms with
    several Agents and people) and Databases come after. Only our own
    modules exist until the module contract settles. Third-party modules
    come after that.

**Consequences.**

- The repository starts with `GLOSSARY.md`, this ADR and
  `docs/architecture.md`. A word enters the glossary and the code only when
  some visible behaviour needs it.
- Architecture tests guard the seams from the first module. The kernel names
  no module, no module reads another's tables, and a Pane imports only the
  API and the shell.
- Before the first module, a short check proves the window. Electron opens
  two tiled Panes: an ACP chat on a fake model and a browser. We measure
  start-up, memory and input latency. If the window feels heavy in the
  hand, GPUI comes back as the alternative.
- Running on a server, our cloud and teams each get their own ADR when
  their turn comes.
