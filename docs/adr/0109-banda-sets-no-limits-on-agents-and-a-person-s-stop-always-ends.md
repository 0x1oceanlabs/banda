---
status: accepted
date: 2026-11-11
---

# Banda sets no limits on Agents, and a Person's Stop always ends

_It closes what ADR 0019 left open (decision 5: "Limits on depth or count,
budgets, ... stopping a whole chain at once"), and says what ADR 0018 did
not: what a Stop does when the Harness does not answer._

A review of the kernel and its borders, on 2026-11-11, found two things
at the Agents' border. A turn has no bound: a Harness that hangs keeps its
Thread working until the engine restarts, and a second Stop only asks
again. A chain of Threads that write to each other has no bound either: no
depth, no count, no budget.

A proposal followed, from how others do it
([the research](../research/2026-11-11-turn-and-chain-bounds.md)): hold a
chain after twenty turns it took by itself, five Threads deep, and a turn
after thirty silent minutes, each until its Person says go on.

Roma refused the limits (translated): "No, because my Agents work for
days, with a heap of tasks. Long-running agents. I do not want to limit
the user with what I made up. We are not a Harness, we are an adapter of
Claude Code and other Harnesses: a good interface, you connect your
Agents and work in one place. What we do is this: you can fence Agents in,
if you do not trust the code or the files of a Project."

## Decision

1. **Banda sets no bound of its own on a turn or on a chain of Threads.**
   No cap on a turn's time or steps. No cap on how deep a chain goes, how
   many Threads it holds, or what it spends. No pause that asks the Person
   to go on. No approval of what one Agent writes to another. The circle
   ADR 0019 refuses stays refused: it is a deadlock, not a limit.
2. **Limits are the Harness's and the provider's.** A Harness bounds what
   it runs: its sub-agents' depth and number, its own watchdogs, its
   usage limit. Banda does not copy them, widen them or narrow them. It
   shows what they do: a usage limit already shows on the Mark (ADR 0099,
   decision 2).
3. **The wall is the fence** (ADR 0083), for a Project whose code or files
   the Person does not trust. How the fence and the mode chosen in the
   composer become one thing to choose is its own ADR, to come. Until
   then, nothing new is refused to an Agent's pass.
4. **A Person's Stop always ends.** Banda asks the Harness to stop, as
   today. A Harness that has not ended the turn a minute later is no
   longer waited for: Banda ends the turn as stopped, says in the Thread
   that the Harness did not answer, and closes that session, so the
   Thread is free and its next message opens a session again. A Harness
   process no other Thread works in is ended too. The minute is twice the
   thirty seconds after which the Claude Code adapter itself gives up a
   cancel.
5. **Banda ends no turn nobody stopped.** Silence is shown, by the Mark's
   stuck look (ADR 0099, decision 2), and what to do about it is the
   Person's.

## Why not limits

- **The work is long by design.** A chain that runs for days is the use,
  not the fault. Any number Banda picks is wrong for someone, and the one
  it stops is the one who trusted it overnight.
- **The Harness already has them.** Claude Code holds its sub-agents to
  three levels and twenty at once, and closes a stream that is silent for
  five minutes; Codex holds its own to one level and six threads. A
  second set of limits above them is a second thing to learn and to tune.
- **Nobody bounds a whole turn by the clock.** Not Claude Code, not Codex,
  not Gemini CLI. The step caps that were defaults are being raised or
  removed.
- **What others add for trust, Banda has as the fence.** A wall the
  system keeps is stronger than a rule about messages.

The Stop is not a limit. It is the Person's own act, and today it can
fail: the fix makes it do what it says.

## Consequences

- Reviews and research stop proposing caps, budgets and holds for Agents.
  What they find at this border goes one of three ways: the Person's own
  act does not work (fix it), the Person cannot see what happens (show
  it), or a Project is not trusted (the fence).
- A turn whose Harness hangs can be ended without restarting the engine.
- A Stop that Banda had to end itself may leave the Harness mid-work:
  what it did up to then stays done, as with any Stop.
- ADR 0019's decision 5 no longer waits: limits and budgets are not
  coming. Stopping a whole chain at once is not decided here.

## Plan

1. The Stop that ends: the engine's timer after `session/cancel`, the
   turn's end as stopped with its note, the session closed, the process
   let go when it is idle. A test with a Harness that ignores the cancel.
