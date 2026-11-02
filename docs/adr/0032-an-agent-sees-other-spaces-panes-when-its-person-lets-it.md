---
status: accepted
date: 2026-11-02
---

# An Agent sees other Spaces' Panes when its Person lets it

_Numbered 0029 when it was merged, beside two others of that number;
renumbered on 2026-11-02. Code and commits before then say ADR 0029._

ADR 0019 put each Agent behind its Space's wall: its token names its
Thread's Space, and the kernel refuses its call to any other (decision 2).
It left other Spaces for later (decision 5). ADR 0025 gave the workspaces
to the engine and planned an Agent's tools on its own Space's Panes
(step 3).

On 2026-11-02, as that step was planned, Roma asked why an Agent sees only
its own Space: "it would be good if it saw the other Agents". Of the ways
offered, Roma chose to keep the wall and let the Person open it, and named
the use: an Agent sees the other Panes on the screen and can put its own
beside one of them.

**Why the wall stays.** A Space is often a project of its own, with its
files and secrets. An Agent reads web pages, files and programs' output,
and any of them may tell it to look elsewhere and send what it finds; the
wall keeps what that can reach to one Space. And a Pane's args say a lot:
a browser tab's address, a file's path.

## Decision

Roma decided the points marked _decided_ on 2026-11-02; the rest are our
defaults and stay Roma's to change.

1. **The wall stays, and the Person opens it** (_decided_). A Space keeps
   whether its Agents see the other Spaces' Panes: `sees_others`, off
   when the Space is made. Only the Person sets it, with `spaces.update`,
   as the name and the pin; the Space's settings show it (ADR 0026). It
   is the Space's, not an Agent's: every Thread's Agent there sees as
   much.

2. **What an Agent sees.** Its own Space's Panes whole: each one's kind,
   args and place. With `sees_others`, the other Spaces' Panes too, but
   only where they are and what they are: their ID, kind, Space and
   place, never their args. No Space is told what another's Panes show.
   What is on the screen is the window's (ADR 0025, decision 1), so the
   engine says where each Pane is in the arrangement, not whether the
   Person looks at it.

3. **What an Agent does with them.**
   - It opens a Pane of its own Space anywhere a place names: a column of
     a workspace, a column's stack, beside a Pane (_decided_: beside
     another Space's too, which it sees with `sees_others`).
   - It opens only the kinds that show and run nothing as the Person: a
     Thread, a diff, a browser. A terminal runs the Person's shell, and
     the command its `done` names is sent with the Person's rights when
     its program ends, so an Agent that could open one could run
     anything as its Person. Settings and the launcher are the Person's
     too. A kind joins the list when it shows and runs nothing.
   - It moves and closes only the Panes it opened. The Panes its Person
     opened, and other Agents', are theirs; it asks in its Thread.
   - It never moves, sizes or closes another Space's Pane, nor sends to
     another Space's Thread. Talking across Spaces is another decision.
   - What it opens takes no focus and carries a mark until the Person
     looks (ADR 0025, decision 1). The engine keeps who opened each Pane;
     the window keeps what the Person has seen.

4. **The kernel says which Spaces a pass sees.** A pass names one Space;
   at this machine's scope the kernel lets an Agent call only the methods
   marked `tool`, and hands the module the Spaces it may see: its own,
   and every Space when its own `sees_others` is on. The module answers
   with those alone. Any other machine method stays refused, as before.

5. **Not now.** An Agent's `send` to another Space's Thread, a pass for a
   whole machine (a coordinator), the window telling the engine what is
   on the screen. They wait for a use.

## Consequences

- ADR 0019's decision 2 holds for every module of a Space; this ADR opens
  one view, at this machine's scope, and only by the Person's hand.
- ADR 0025's step 3 builds this: the kernel's part, the `workspaces`
  module's tools (`panes`, `open_pane`, `move_pane`, `close_pane`) and
  who opened a Pane, the mark in the window, and `sees_others` on the
  Space. _Built_ 2026-11-02, places by a Pane's side alone (`beside`):
  without one, the engine puts it as it puts a Pane the CLI opens. The
  mark is the tile's border and a dot, in the attention colour, until the
  Person has the Pane in focus with the window in front. The Person sets
  `sees_others` with `banda call spaces.update` until the Space's
  settings come (ADR 0026, step 6).
- A Space made from now on, and every Space today, has it off.
