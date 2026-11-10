---
status: accepted
date: 2026-11-09
---

# In the row and solo, a Project has its own workspace, and free workspaces hold the rest

Roma, on 2026-11-09: "how grouping by Project works in the tiling is a
mess." Roma wants every window grouped by Project in the row and in solo.

Here is how the window places Panes today (ADR 0065, decision 9; ADR
0079):

- Only a Thread knows its Project's workspace (`PaneKind.home`). A
  terminal, a browser, Files, Git or Settings that the Person opens goes
  right of the Pane in front, on whatever workspace is on screen. A
  terminal of Project B lands on Project A's workspace.
- A workspace becomes a Project's when a Thread of that Project opens.
  The Thread goes to the first workspace that already shows a Pane of the
  Project and belongs to no other, so a mixed workspace gets claimed by
  whichever Project opens a Thread there first.
- A pick goes to wherever the Thread stands. If the Person moved it to
  another Project's workspace, it stays there.
- Solo fills only a Group with an Agent, and only on a Project's
  workspace. A focused terminal fills nothing, so solo seems to work at
  random.

Roma went through mockups `desks-v1.html` and `desks-v2.html` (brand
workspace, `artifacts/project-desks/`) and chose these rules the same
day.

## Decision

1. **In the row and solo there are two kinds of workspace: a Project's
   and a free one.**
   - A Project's workspace holds only that Project's Panes. The one
     exception is a Pane in an Agent's Group (decision 3).
   - A free workspace holds anything, as the Flow `free` does: Panes of
     any Project, and Panes of no Project. A new Pane there opens right
     of the Pane in front.
   - There can be any number of free workspaces. The empty workspace at
     the bottom becomes free when a Pane is put on it. A free workspace
     lasts while it holds a Pane.
   - A Thread of no Project (ADR 0046) opens on the first free
     workspace. With none, the bottom workspace becomes one.
   - In the Flow `free`, nothing changes: every workspace is free, as
     now.

2. **A Project's workspace keeps its place.**
   - Workspaces stand in the order they were first opened. The Person
     reorders them in the overview, as now (ADR 0025).
   - A Project's workspace lasts while the Project has a Thread, even
     after its last Pane closes. Then `Alt+N` keeps leading to the same
     workspace. It goes only when the Person closes it, or when the
     Project has no Threads left.
   - The bar shows a Project's workspace by its Sign alone, and a free
     one by its number (changed in #1127: no call dot, no Group map).

3. **Where a Pane opens, in this order:**
   1. A Pane an Agent opens goes into the Agent's Group, even when it is
      another Project's (ADR 0065, decision 7). Its tab bears that
      Project's Sign.
   2. A Pane opened from inside a Group joins that Group. A terminal
      opened at an Agent's Thread is most likely for that Agent's
      worktree.
   3. Any other Pane of a Project goes into the Project's own Group, at
      the start of its workspace, and the window goes there. That covers
      a Pane opened from the sidebar, the Banda menu, or from another
      workspace.
   4. A Thread of a Project opens as a Group of its own on its Project's
      workspace, as now.
   5. A Pane of no Project goes to the Sheet (decision 5).

   _Built_ in step 1: a Pane opened on a free workspace stays there,
   right of the Pane in front (decision 1); step 2 put the rest into the
   Project's own Group. A Pane that joins a
   Group from inside it goes last into the Deck right of the Pane it is
   opened from, as what an Agent opens does. A Pane of no Project other
   than a Thread opens right of the Pane in front until the Sheet comes.

4. **The Project's own Group.**
   - It holds the Panes the Person opened for the Project and not for an
     Agent: a terminal, a dev server, Files, Git. It stands first on the
     Project's workspace, so a pick that brings an Agent to the left
     slides it out of view without moving it.
   - It exists only while it holds a Pane. The first Pane makes it.
   - Its plate is neutral, as a Group with no Agent's (ADR 0065,
     decision 6), with the Project's name as its tag.
   _Built_ in step 2: the engine's `own` place puts a Pane last into the
   workspace's `own` Group, made first on the Project's workspace when it
   is gone; the Group's handle says the Project's name. A Pane opened from
   inside the own Group goes last into it. What an Agent opens while its
   Thread is not shown goes last on its Project's workspace. Moved off
   the Project's workspace, the own Group is a Group like any other, and
   the next Pane starts a new one.

5. **Settings, Usage and the notifications come as a Sheet over the
   workspace.**
   - The Sheet comes in from the right edge, over the tiles. The row
     does not move, and the Person stays where they were. A change to
     the look shows on the tiles behind it at once.
   - `Esc` or a click outside takes it away. There is one Sheet at a
     time, in the top layer (glossary, Top layer).
   - The Drawer stays the quick Thread from the top (ADR 0025,
     decision 8). The Sheet is its own thing.

6. **Moving a Pane between workspaces.**
   - A Project's Pane, or a whole Group, moves freely between its
     Project's workspace and any free workspace, by `Alt+Shift+N` or by
     a drag, as now.
   - It never goes onto another Project's workspace. During a drag, that
     workspace dims in the bar and the overview and takes no drop. The
     hint under the Pane says where it can go. `Alt+Shift+N` towards it
     does nothing and says why in a toast.
   - On a free workspace, a Pane's header bears its Project's Sign, so
     its owner shows.
   - A Thread the Person moved to a free workspace stays there. A pick
     goes to it, and its sidebar row has a small mark saying that it is
     away from its Project's workspace.
   _Built_ in step 3: the window refuses the move, by keys and by the
   mouse, in the row and solo; a Group moves as its Agent's Thread's
   Project, else as its first Pane's. During a drag the note under the
   Pane's name says why. The Sign shows in the header of every Pane on a
   free workspace, as on a workspace of mixed Projects.

7. **A Thread of no Project that becomes a Project's goes to that
   Project's workspace,** by the row's rules, with its Group. The
   workspace is made at the end, if the Project has none.

8. **Solo fills the width with whatever has the focus, on any
   workspace.**
   - A Group fills it, as now, and so do the Project's own Group and a
     column in no Group. This changes ADR 0079, decision 2, which filled
     only a Group with an Agent on a Project's workspace.
   - `Alt+←` and `Alt+→` past an edge go to the next one, which fills
     the screen. The Strip slides, so where it went shows by the way it
     moved.

9. **From the Flow `free` to the row, nothing jumps.**
   - Panes already open stay where they are, and new ones follow these
     rules.
   - "Arrange by Project", in the Banda menu, puts every Pane where
     these rules would have opened it, in one move that `Ctrl+Z` undoes.
     A Pane of no Project goes to a free workspace.

## Consequences

- ADR 0065, decision 9: a Project's workspace holds its Panes only, and
  it no longer claims a mixed workspace.
- ADR 0079, decision 2: solo fills any focused Group or column, on any
  workspace.
- `PaneKind.home` gives way to the Pane's Project. Every Pane already
  names its Project, and decision 3 places it by that and by where it
  was opened from.
- A workspace says whether it is a Project's or free, in the engine's
  arrangement (ADR 0025), so every client places Panes the same way.
- The glossary gains **Free workspace**, **Project's own Group** and
  **Sheet**, and **Workspace** says that a Project's holds its Panes
  only.
- The work comes in PRs, in order:
  1. A Project's workspace and free workspaces in the engine: the kind,
     the place for a Pane by decision 3, no claiming, the place kept
     while the Project has Threads.
  2. The Project's own Group.
  3. Moving between workspaces: refused to another Project's, the dim
     target and the hint, the Sign in a Pane's header, the sidebar mark.
  4. Solo fills whatever has the focus.
  5. The Sheet for Settings, Usage and the notifications.
  6. A Thread of no Project that becomes a Project's goes to its
     workspace, and "Arrange by Project".
