---
status: accepted
date: 2026-11-01
---

# A turn's life is one state machine

A turn is queued, runs, and ends as Done, Stopped, Failed, Interrupted or
Withdrawn (`TurnState`, ADR 0003). ADR 0014 put what a Person may do with
a turn in one function, `rules::can`. A read of the code on 2026-11-01
showed that the turn's life itself has no such place. Its moves are made
in five places:

- the commands in `lib.rs` (send, stop, withdraw, send now, retry);
- `turn.rs`, which starts a turn, runs it on the Harness and ends it, and
  settles what a restart cut short;
- `between.rs`, which opens and ends a turn the Agent starts by itself;
- the kernel's outbox, through `settle`;
- the flags `live.rs` keeps in memory (stopping, steered, asking).

What that costs:

- **Some moves skip the rules.** `send` builds a queued turn by hand,
  apart from `turn::add`. `between::open` writes a running turn without
  asking whether the queue is held or another turn runs, so nothing stops
  two running turns at once. `turn::end` checks nothing, and each caller
  guards it its own way. Steering decides between joining, a new turn and
  a stop in the middle of its network calls.
- **One fact is derived in several ways.** Whether the Agent started a
  turn by itself is read three ways: from the database (`turn::by_itself`),
  from the notices in `rules::can`, and in the Pane's `withCan`. Which turn
  is first is read two ways (`rules::position` and `store::turns_of` in
  `start`), and whether a turn is still going three ways (`rules::ongoing`,
  `store::set_turn`, the SQL of `last_begun`).
- **Holding the queue is decided case by case.** A Harness that dies
  holds the queue behind a Person's turn but not behind the Agent's own. A
  Person's stop holds it; the stop Banda makes when a Harness cannot steer
  does not. Each is a line in a different function, and only some have a
  test.
- **The decisions sit inside the I/O.** `turn::start` and `turn::run` ask
  the rules, write, call the Harness and read the flags in one function,
  so a rule can only be tested through the fake Agent.

T3 Code (upstream `3fd2b855`, `apps/server/src/orchestration-v2`) has
no such place either, and shows what that costs as it grows. A run's
status is a field that eight files write, with no table of moves; which
runs are "active" is written four times and the copies differ; the hold
is a flag on each queued run, set and cleared in six places; the window
derives its buttons from its own copy of the rules; `Orchestrator.ts` is
14,000 lines, its handlers up to 2,200 each. What it does well, and Banda
already has or takes here: events, projection, receipt and outbox in one
transaction; command and effect IDs derived, so a retry is the same
command; a stop is a request, and the end comes from the Harness; a write
from the Harness lands only if the run is still the one it was
(`writeIfRunCurrent`); after a restart the queue waits for its Person.

Roma chose to fix this after ADR 0014 and before the MCP module, whose
Agents start, steer and stop turns too ("давай по порядку c d e").

**Decision.**

1. **One pure function moves a turn.**
   - `rules::next(turn, event) -> Result<Step, Refusal>` is the turn's
     state machine. `turn` is what the engine knows of it: its state, who
     opened it and how, its place in the queue, whether the Thread is held,
     whether another turn runs. `event` is what happened: a Person queued,
     stopped, changed, took back or sent a message now; the outbox started
     it; the Harness ended it; a restart cut it short.
   - A `Step` says the new state, the facts to emit, the effects to start
     (START, STOP, STEER, REPLY) and whether the queue is now held. A
     `Refusal` says why not, in the words a Person reads.
   - It reads no database, calls no Harness and keeps no flag. Every
     (state, event) pair is in one table test.
   - A late event is refused like any other move: a Harness that ends a
     turn already ended, or a steer into a turn that stopped, gets a
     `Refusal`, not a special case (T3 Code's `writeIfRunCurrent`, here
     the same function as the rest).
   - `can`, `may_start`, `stop`, `waits`, `may_change`, `retry` and
     `steers` become questions to `next`: a turn can be stopped when `next`
     accepts a stop. `can` stays on `TurnView` as ADR 0014 made it.

2. **One writer applies a step.**
   - The module's commands, the outbox's handlers and the between-turn
     listener do the same three things: read the turn, ask `next`, give
     the step to the writer. The writer writes the turn, emits the facts
     and enqueues the effects in the one transaction the kernel gives the
     call (ADR 0002).
   - A turn is made in one place, the writer, whoever opens it: a Person's
     message, a retry, a message a turn could not take, or the Agent
     between turns. How it was opened is kept on the turn, so "by itself"
     is read from one column, not from its message.
   - A Thread runs one turn at a time. A START that finds a turn running
     waits for its end, as a START waits behind the turns before it.

3. **The I/O only runs effects and reports what happened.**
   - `turn.rs` becomes `effects.rs` (run START, STOP, STEER, REPLY on the
     Harness) and `writer.rs`. `between.rs` keeps listening to the Harness
     between turns, and turns what it hears into events.
   - `live.rs` keeps only what cannot be written: the open connections and
     the channels a Question's answer goes back on. Whether a Person asked
     a stop is part of the turn's state (a stop asked while running), so
     the machine reads it, not a flag in memory.
   - A restart is one event, `cut short`, given to every turn that is
     still going, whoever started it. The outbox's `settle` and
     `between::cut_short` both send it.

4. **When the queue is held is one rule, written down.**

   | What ended the turn | Holds the queue |
   |---|---|
   | A Person stopped it | yes |
   | The Harness stopped (its process died) | yes, whoever started the turn |
   | Banda restarted while a Person's turn ran or was starting | yes |
   | Banda restarted while the Agent's own turn ran | no |
   | Banda stopped a turn because its Harness cannot steer | no; the message gets a turn of its own |
   | Anything else | no |

   The second row changes what happens now: an Agent's own turn whose
   Harness dies holds the queue too, as a Person's turn does, so a message
   that waits does not start on a Harness that just died without the
   Person seeing it.

5. **The window does not change.** The facts, their payloads and
   `TurnView` stay as they are, apart from the change in decision 4. The
   checkpoints (ADR 0014, decision 3) must all still match, which shows
   the Pane's projection did not move.

**Plan.** Each step is its own PR, and `scripts/check.sh` passes after
each.

1. `rules::next` beside the rules it replaces, with the table test; the
   old rules ask it, and the tests still pass.
2. Who opened a turn kept on the turn (a column, filled for the turns
   already there); "by itself" read from it in the engine and in `can`.
3. The writer: every command, `turn.rs` and `between.rs` make, move and
   end turns through it. One running turn per Thread.
4. `turn.rs` split into `effects.rs` and `writer.rs`; the decisions leave
   the I/O; the stop flag leaves `live.rs`; one `cut short` on restart;
   the hold table of decision 4, with a test for each row.
5. `docs/architecture.md` says how a turn moves.

**Consequences.**

- A new way to move a turn, such as an Agent stopping another Agent's
  turn over MCP, is one event in `next` and one row in its table test.
  The MCP module's tools ask the same function as the Person's commands.
- A rule is tested as a pure function, without the fake Agent; the
  scenario tests stay as they are and check the whole path.
- Moving the code touches the agents engine's largest files. The steps
  keep the behaviour the same, apart from decision 4, and the checkpoints
  and scenario tests guard that.
