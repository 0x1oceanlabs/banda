---
status: accepted
date: 2026-10-31
---

# How the engine writes and keeps the work

ADR 0001 says that one engine owns the work. This ADR says where each kind
of data lives and how the engine writes it. Most of it comes from a read of
T3 Code (github.com/pingdotgg/t3code, MIT, read at commit 79f1fadf on
2026-10-31). That project is a working app with the same shape: one server
per machine that owns agents, files and SQLite, with desktop, web and mobile
as its clients. Its orchestration was rewritten once already. Side effects
started from live event subscriptions were hard to trace and to recover
after a crash, and the move to the new core kept only the messages. Tool
calls, approvals and agent sessions were lost.

**Decision.**

1. **Data lives with its owner, and the database holds only what needs it.**
   - **Files of the work** (documents, code, downloads) are plain files in
     the Space's folder.
   - **Settings are text files** that people and Agents edit. That covers
     Agents (name, Harness, instructions), layouts, keys, themes and
     module settings.
   - **What a Harness keeps stays with it:** its session, its context and
     its sign-in. The engine stores only the Harness's session ID, so it can
     resume the session.
   - **Secrets** live in the operating system's keychain or in the Harness's
     own sign-in, never in Bandaso's database.
   - **Window state** (focus, scroll, which Panes are open) stays with the
     window.
   - **The Space's SQLite** (`.bandaso/`) holds only what needs search,
     subscriptions or transactions. That means Threads (what the Person
     saw: messages, tool calls, Questions and answers), the Agents' queue
     and state, Databases' records, and later access. A Thread can be
     exported as Markdown or JSONL.

2. **One command, one transaction.** A command carries its own ID. Its
   receipt, its events, the tables its views read and its outbox rows commit
   together. A repeated command returns the first result and runs nothing
   again. A refusal gets a receipt too.

3. **Side effects run from the outbox, never from a live subscription.**
   Starting a turn, interrupting it and answering a Question are outbox
   rows. A worker runs them in order per target (one Agent's rows in
   sequence), under a lease, with retries and backoff. After a crash it
   separates the rows that are safe to run again from the rows that died
   with the Harness's process.

4. **Events are published after commit, through one ordered lane.** Each
   Space has one writer task, and subscribers hear only committed events,
   in order.

5. **A window loads a snapshot at sequence N, then the events after N.** A
   subscription sends only what its view needs. Viewing one Thread does not
   load every Thread.

6. **Events are facts, and the log is never rewritten.** An event says what
   happened. It is not a copy of a row, and the log is not compacted. Every
   event type has a version, and old events stay readable forever: code
   upgrades them when it reads them. Each module keeps its own ledger of
   migrations.

7. **Our IDs are the identity, and a Harness's IDs are evidence.** Our IDs
   are UUIDv7. A Harness's session, thread and turn IDs are stored as
   references, together with how far they can be trusted.

8. **The API carries one protocol version, flags and tolerant reading.** A
   window with the wrong protocol version is refused before anything else.
   New abilities are advertised as flags. Both sides read unknown fields and
   missing optional fields without failing, so the Rust-to-TypeScript
   generation emits tolerant decoders as well as types.

9. **Every API method names the right it needs, in one exhaustive map.** In
   Rust this is one `match` over the method enum, so the compiler rejects a
   method without a right. The map governs the engine's own operations.
   What an Agent does inside its Harness is enforced by the Harness (ADR
   0001, decision 7). Bandaso never fakes a mode a Harness lacks by
   answering its Questions for it: the Harness's own check is stronger.

10. **Native adapters for Claude Code and Codex come early.** T3 Code reaches
    neither through ACP. Claude runs on its official Agent SDK, and Codex on
    its app-server. ACP lacks conversation rollback, Questions that survive
    a restart, subagents and usage figures. The first step uses ACP, because
    the adapters exist today. A native adapter follows as soon as one of
    those gaps blocks a user. We write our own adapters and do not copy
    T3 Code's. Theirs are TypeScript on Effect, wired to their server: the
    Claude adapter alone imports about thirty of its internal modules, and
    the packages are private.

11. **Tests run the real engine and replay only the Harness.** The adapter,
    the rules, the store and the outbox are real. The Harness's transport
    replays a recorded conversation. Our own recordings are joined by
    T3 Code's 91 recorded scenarios (background subagents, compaction,
    resume after a restart, interrupts, MCP tools), used as test input under
    their MIT licence and with its notice.

12. **Updates start as a trial.** A launcher starts the new engine, which
    must report ready before the update counts. Otherwise the launcher
    restores the SQLite snapshot taken before the update. There are no down
    migrations.

**Not taken from T3 Code.**

- Checkpoints as hidden git refs: a Space is not necessarily a git repository.
- Events that copy whole rows, and compaction of the log: the log would stop
  being a history.
- One orchestrator over everything. Theirs is 14 thousand lines in one file,
  with lock-ordering rules. Our modules stay separate, and that holds only
  while modules talk by commands and events.

**Consequences.**

- The kernel has the receipts, the event log and the outbox from the first
  module, so no module starts side effects of its own.
- `docs/architecture.md` describes where data lives and the command path.
