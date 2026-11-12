---
status: accepted
date: 2026-11-12
---

# A new Thread is named once, after its first turn

On 2026-11-12 Roma asked for an automatic title at the start of a
conversation. A Thread's title is its first message cut to 60
characters, which says little, and Suggest a title has to be pressed for
every new Thread.

This amends ADR 0077, decision 2 ("Nothing renames a Thread by
itself"). What that decision guarded against stays: a title that keeps
changing as the work moves on, and leaves the Person unsure which
Thread is which.

## Decision

1. **Once, after the first turn** (Roma: after the first reply). As a
   Thread's first turn ends done, the engine asks its Harness's small
   model for a title, as `agents.suggest_title` does (ADR 0077, decision
   4), and names the Thread with it. It never runs again for that Thread.
2. **Never over the Person's title.** A Thread its Person renamed before
   its first turn ended, or while the title was being written, keeps that
   title.
3. **Quietly** (Roma). No toast: the title changes in the sidebar and
   the header. "Previous title" in the Thread menu brings back the first
   message's title.
4. **Every new Thread** (Roma): the Person's, and those an Agent starts.
5. **The engine does it**, as an effect of the outbox (`thread.title`)
   queued with the turn's end, under a key of its own so the Thread's
   next turn does not wait for it. It is written as the Person's rename
   (`thread.renamed`), as Banda acts for its Person in keeping a Thread
   Supervised (ADR 0083). A title that does not come (the Harness fails,
   or is gone) is no failure: the Thread keeps its own.

## Consequences

- Every new Thread costs one short run on the small model, a sliver of
  the Person's usage, once.
- The title changes once, a few seconds after the first reply.
- Suggest a title stays, for the title of a Thread whose work moved on.
