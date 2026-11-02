# How T3 Code and herdr move a turn, and what Banda's turn writer takes

- **Date:** 2026-11-02.
- **For:** Roma, before ADR 0018's step 3 (one writer for a turn's state)
  and the issue about the Agent's own turns.
- **How:** read-only. T3 Code at `ac8dce0c` (`/tmp/t3src/t3code`, a
  shallow clone, so its history since ADR 0018's `3fd2b855` was not
  diffed); herdr-core at `ce87721` (release 0.1.17, `/tmp/herdr-core-src`).
- **Status:** research. What Banda took is in step 3's PR; the rest is
  noted for later steps.

## In short

Neither has what Banda builds: one pure function that moves a turn and one
writer that writes its steps.

- **T3 Code** still has no single decider. A run's status (ten values) is
  written by eight or more files; `Orchestrator.ts` is 14,151 lines;
  whether a run is "active" is worked out in six places; the queue's hold
  is a flag on each run, set and cleared in eight. Its events carry the
  whole run row, and it already patches lost updates field by field
  (`keepRecordedRunField` in `ProjectionStore.ts`).
- **herdr-core** has no turn object at all. A terminal has a lifecycle
  word, a status word the program reports, and `turn: u64`, a counter that
  goes up when the program leaves `working`. Any word may follow any word;
  nothing is refused.

## What each does, and what Banda took

| Question | T3 Code | herdr-core | Banda, step 3 |
|---|---|---|---|
| A late ending | `writeIfRunCurrent` (`EventSink.ts`) re-reads the run in the write and compares its attempt ID and expected status; not on every path (most provider events, checkpoint capture) | none needed: one byte stream per terminal | `rules::next` refuses `End` of a turn that ended; every path goes through the writer, which reads the turn in the same transaction |
| One running turn per Thread | an in-process lock per thread, and a check under it; no database constraint | n/a | `next` refuses a second, and a unique index on the running turn backs it |
| Turns the Agent starts by itself | a wake-up becomes an ordinary message dispatch with `createdBy: "agent"` and a derived command ID; the request lives in memory only | every leaving of `working` is a turn, whatever caused it; who caused it is not kept | `Event::Open` through the same writer; the turn is written at once, and waits for the turn that ran to be written as ended |
| Ending and starting the next | the next queued run starts from an in-memory reactor, in its own transaction | n/a | a START that finds the Agent's own turn running ends it in the same step (`Then::HandOver`) |
| Restart | every unfinished run is cancelled, queued runs held, process-bound effects cancelled, the rest requeued | live records no holder adopted are finished as `stopped_by_restart`; an exit counts as a turn's end | `Event::CutShort`, one event for the outbox's settle and the listener's restart |
| Events | the whole row each time | n/a | typed facts per change, as before; the writer writes only what the step changes |
| Tests | table tests only for policies; races in scenarios | a few pure tests of the turn counter | every (state, event) pair in one table test |

## For later

- **Effects at a restart** (T3 Code): it splits effects into those safe to
  replay and those tied to the provider's process. Banda abandons all of
  its own today; ADR 0018's step 4, "one cut short", is the place.
- **`after_turn`** (herdr): a send returns the turn it landed in, and a
  wait is met only by a turn after it, so an old `idle` never counts.
  Useful when Agents wait on each other over MCP.
- **An attempt ID** (T3 Code) is a cheap generation counter. Banda does not
  need one yet: each run is its own turn, with its own ID, so the turn's ID
  and state already tell a late event.
- **Waiting on a signal, not a poll.** The Agent's own turn waits for the
  turn that ran to be written as ended by looking again every 100 ms, for
  at most 10 s; usually it finds it ended the first time. A signal when a
  turn ends would replace the loop.

## Not to take

- Events that carry a whole row; several writers and no table of moves.
- A status with a hidden second meaning (T3 Code's `waiting`: the provider
  finished, the checkpoint is not taken yet).
- Holds kept as flags where they can be worked out from the rest.
- Correlation kept only in memory (both projects), which a restart loses.
