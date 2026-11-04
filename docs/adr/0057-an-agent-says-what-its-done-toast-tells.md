---
status: accepted
date: 2026-11-04
---

# An Agent says what its Done toast tells

A Thread calls its Person when its turn ends (ADR 0011). The toast and the system notification of a `done` call said the Thread's title and the start of the message it was last asked: what the Person already knew. Only a failed turn's reason or a Question's title said something new. An Agent had no way to say anything to its Person outside its reply.

On 2026-11-04 Roma asked for the notifications to be "useful", and for an Agent to send its Person a notification of its own. He agreed to keep it quiet: one a turn, the rules of where it shows those of any call.

**Decision.**

1. **An Agent tells its Person with `notify`**, a tool of the agents module (`agents.notify`), in its own Thread's turn that runs.
   - It takes one line, `text`, at most 140 characters: what is done, or what the Agent needs of the Person.
   - The turn keeps it. A second call in the same turn replaces the first: a turn has one note.
   - Only the Thread's own Agent calls it, in a turn that runs; another Participant is refused.

2. **The note is what the turn's call says.** When the turn ends `done`, the Thread's call (`Listed.calls`) is the note, and its toast, its system notification and the bell say it, in place of the message it was asked.
   - A failed turn's call keeps its reason, and a Question's call its title: the note does not hide them.
   - Where and when the call is told stays ADR 0011's and `[notify]`'s: nothing while the Person looks at the Thread, a toast or a system notification, never both, one sound. `notify` makes no toast of its own and no new sound, so a turn calls its Person once, as before.
   - `turn.ended` carries the note, so the sidebar's list has it without reading the Thread again.

3. **Nothing tells in the middle of a turn.** A note waits for its turn to end. An Agent that needs its Person ends its turn, or asks a Question.

**Consequences.**

- `agents_turns` gets a `note` column; `LatestTurn` and `turn.ended` a `note`.
- The agents module's row of a Thread (`rows.ts`) takes the note as what calls when the mark is `done`.
- The Banda skill lists `notify` with the module's other methods.
