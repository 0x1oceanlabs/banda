---
status: accepted
date: 2026-11-11
---

# The fence is off until it is designed whole

On 2026-11-11 Roma asked to turn the fence off for everyone until it is
designed whole, and to turn it back on once it is. Banda is written in
Banda, and behind the fence the work stops where the fence does not yet
open what it should: Suggest a title fails for Claude because its folder
in the Project's data is not one of the fence's holes (#1536), and an
Agent's shell has no `systemctl --user`, display, keyring or signed
commits.

This suspends ADR 0083, decision 1, that every Harness runs behind the
fence where it holds. The rest of ADR 0083 stands: trust still decides
who gets the Person's GitHub token and SSH agent, and only the Person's
gesture acts as the Person.

## Decision

1. The engine starts every Project's programs with no fence, in every
   build, as `Fence::Missing { why: Off }`. Settings and the Thread's
   mode menu say it is off until it is designed whole.
2. `BANDA_FENCE=on` in the engine's environment turns it on as before,
   for the work on the fence and for its tests.
3. With no fence, a new Thread starts as ADR 0083 has it where the fence
   does not hold: Supervised, unless the Person chose another mode.

## Turning it back on

Once the fence is designed whole, a new ADR turns it on again by default,
and this one is superseded: `engine/src/fence.rs`'s `found` checks
`BANDA_FENCE=on` today, and gives that back to what it checked before.

## Consequences

- An Agent reads Banda's state and keys, and every Banda's settings,
  as the Person does; ADR 0083's protection is gone meanwhile.
- `docs/fence.md` and Settings say the fence is off and why.
- The fence's own tests (`engine/tests/fence.rs`) run the fence directly
  and are unchanged; the end-to-end test of a fence that holds starts
  its window with `BANDA_FENCE=on`.
