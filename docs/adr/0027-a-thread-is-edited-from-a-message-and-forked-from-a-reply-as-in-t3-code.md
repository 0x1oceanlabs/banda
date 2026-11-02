---
status: accepted
date: 2026-11-02
---

# A Thread is edited from a message and forked from a reply, as in T3 Code

ADR 0010 made the Thread Pane read as T3 Code's and left two of its parts
for later: editing a message and going on from there, and forking a
Thread. They need the Harness to go back in a session, so they waited for
a check of what Claude Code and Codex offer through ACP (ADR 0010,
decision 9). ADR 0003 counted "a fork at a message" among the shared
extensions. On 2026-11-02 Roma asked for the next step; this is it.

**What T3 Code does** (its source, 2026-11-02):

- **Edit from here.** A pencil on each of the Person's messages, shown on
  hover beside Copy, labelled "Edit from here"
  (`TimelineUserMessageRow.tsx`). It asks first: "Edit from here? Rewind
  chat to before this message. Your prompt and attachments return to the
  composer", with Cancel, "Revert files too" and "Revert and keep
  changes". It rewinds the same thread: the turns from that message on
  leave the conversation (kept as rolled back, not shown), and the
  message's text and images go back into the composer, after what is
  there, the caret at the end. Nothing is edited in place.
- **Fork from this response.** A git-fork icon on each of the Agent's
  finished replies, "Fork from this response"
  (`TimelineAssistantRows.tsx`). It makes a new thread titled
  "<title> fork", with the conversation up to the end of that reply's
  turn (its `run`), and opens it. The fork names its parent ("Forked from conversation", "Open
  source conversation"), and the parent lists its forks.
- Files: "Revert files too" restores T3 Code's git checkpoint of the turn,
  only in a worktree of the thread's own. A fork never touches files.
- Neither works while a turn runs: "Interrupt the current turn before
  reverting checkpoints". Under them, T3 Code drives the Harnesses
  natively: for Claude Code `resumeSessionAt` to rewind and the SDK's
  `forkSession(…, { upToMessageId })` to fork, for Codex `thread/revert`
  and `thread/fork { lastTurnId }`.

**What the Harnesses offer through ACP** (claude-agent-acp 0.99.1 and
codex-acp 2.5.0, the versions Banda runs):

- Neither has a rewind. Both answer `session/fork` (unstable in ACP, the
  `unstable_session_fork` feature of `agent-client-protocol` 3.6): a new
  session with the whole of the old one.
- Both fork at a reply too, given its message ID, as the Harness named it
  in `agent_message_chunk`'s `messageId`, in the request's
  `_meta.jetbrains.air.fork` (`{ version: 1, messageId,
  messageFingerprint?, messageOccurrence? }`), JetBrains AIR's extension.
  Claude Code's then forks with its SDK's `upToMessageId`, Codex's with
  `thread/fork { lastTurnId }`, the turn that holds the reply; neither
  asks the client to declare AIR. A reply's fingerprint, `sha256:` and
  the hex of its text, with how many replies of that text came before
  it, finds it where the ID does not.
- Engine today: it reads `messageId` only to tell one reply from the
  next, and keeps no Harness's ID on an Item.

**Decision.** Roma decided the points marked _decided_ on 2026-11-02;
the rest are our defaults, as T3 Code does, and stay his to change.

1. **Edit from here, on the Person's messages, rewinds the Thread**
   (_decided_), not a new Thread.
   - A pencil on hover beside Copy, "Edit from here", on a message the
     Person sent that a turn ran. It asks, as T3 Code does, but with one
     way on: "Edit from here? The Thread goes back to before this
     message, and its text and images return to the composer. Files the
     Agent changed stay as they are." Cancel, "Edit from here".
   - The turns from that message on leave the Thread's conversation:
     `agents.rewind { turn }`, the message's turn, takes them and their
     items out of the Thread, and the fact `thread.rewound` says so. What
     they said stays in the Space's log, as all of a Thread's history
     does, and the Pane no longer shows them. The images their messages
     carried wait as a draft's do.
   - The message's text and images go into the composer as `↑` puts a
     waiting message back (ADR 0010, decision 6): after the draft, the
     caret at its end.
   - Files are not put back (_decided_). Banda keeps no checkpoint of a Space's files,
     and a Space is a folder that a Person and other Agents share, where
     T3 Code too reverts files only in a worktree of the thread's own
     (ADR 0010, decision 10, leaves out reverting files).
2. **Under it, the engine forks the session at the reply before.** With no
   rewind in ACP, the Thread's session becomes a fork of itself:
   `session/fork` at the last reply of the turn before, by its message
   ID, so the next turn runs in the fork, which knows nothing after it. A rewind to the Thread's first message
   gives it a new session. The old session stays as the Harness keeps it.
   - The engine keeps each reply's message ID, as the Harness said it, on
     its Item, for this; not shown.
   - The fingerprint is left out: the ID finds the reply for both
     Harnesses, and the fingerprint would only stand in where it does
     not.
   - A reply with no ID refuses the rewind, and the Pane says so. A
     Harness that cannot fork says so at the next turn, as a fork's
     does: the engine learns what a Harness can as it connects.
   - The fork goes before the session open in the Harness's process,
     which knows more: the evidence says the next session is a fork.
3. **Fork from this response, on the Agent's replies, makes a new
   Thread.**
   - A git-fork icon on a finished reply, "Fork from this response". The
     new Thread, `agents.fork { turn }`, the reply's turn, is
     "<title> fork", on the same Harness, settings and Space, with a copy
     of the Thread's turns and items to the end of that turn, and a
     session forked at its last reply. A fork is of a whole turn, as T3
     Code's is, since Codex forks only at a turn's end. It opens in
     the Pane, as a Thread picked in the sidebar does.
   - The fork names its parent: a line at its top, "Forked from <title>",
     which opens it; the parent shows nothing of its forks yet.
   - Files are not touched.
4. **Not while a turn runs.** Both wait for the Thread's turn to end, or
   to be stopped: the buttons are disabled while it runs, as in T3 Code.
   A message that waits in the queue is edited as now, with `↑`.
5. **Checked with the Harnesses first** (_decided_, with the paid runs
   it takes). The fork point rides on an
   extension of JetBrains', in an unstable part of ACP. Before the
   engine relies on it, one run each of Claude Code and Codex forks a
   session at a reply and asks what came after it, which the fork must
   not know; ignored tests, as for the plan (ADR 0010).

**Build order.** One PR each: (1) the engine keeping each reply's message
ID and forking a session, `agents.fork`, checked with Claude Code and
Codex; (2) Fork from this response in the Pane; (3) `agents.rewind` and
Edit from here.

**Consequences.**

- The engine turns on `agent-client-protocol`'s `unstable_session_fork`,
  and the fake agent answers `session/fork`.
- A Thread's session changes under it: what ADR 0003 calls evidence of the
  session, not its identity, is now the fork's.
- If the ACP spec gains a fork point or a rewind of its own, the engine
  moves to it and the Pane does not change.
