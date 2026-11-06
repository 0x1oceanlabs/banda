---
status: accepted
date: 2026-11-06
---

# The Flow is free, a row or solo, and Alt+U follows the sidebar

Roma runs ten Agents in a Project at once, sometimes more. ADR 0065 put
a Project's Agents on its workspace, in a row, and a picked one at the
left. With ten of them, what shows beside the picked Agent is whichever
Group happens to stand next on the Strip: a piece of another Agent's
work, which pulls the eye and says little. And a picked Agent comes to
the left only when the Strip overflows; while its columns fit, it stays
where it stands (seen in a trial on 2026-11-06).

Roma's idea, on 2026-11-06: a switch in the sidebar for how the Agents'
windows stand, with a name, and an Agent that can take the whole width
alone, so nothing else is in view when he goes to it. The research
behind this (`artifacts/agent-flow/research-products.md` and
`research-human.md` in the brand workspace) found most agent apps keep
two named views over the same Agents, one of them an Agent alone on the
screen, and that fixed places with a moving view beat lists and windows
that reorder themselves. Roma chose from mockups `flow-v1.html` and
`flow-v2.html` the same day.

His Agents run with full access and rarely ask. A turn ends, he reads
what it did, and the session goes on: work moves through "done". So
"done" keeps its toast (ADR 0057), and the order of what calls is the
sidebar's to keep, not a second order of the window's.

## Decision

1. **The Flow is how an Agent's windows stand: free, in a row, or
   solo.** It is `flow` in `agents.toml`:
   - `"free"`: Banda leaves the windows where they are. A Thread opens
     beside the Pane in front, and a pick goes to wherever its Pane is.
     It is what `workspaces = "off"` was.
   - `"row"`, the default: ADR 0065, decision 9, as it is. A Project's
     Agents sit side by side on its workspace, and a pick brings its
     Group to the left.
   - `"solo"`: as the row, and the Agent you are at fills the screen
     (decision 2).
   - `workspaces` is still read, as `flow`: `"off"` as `"free"`,
     `"project"` as `"row"`, and the file is told the new name (ADR 0069
     grace).

2. **Solo: the Agent you are at fills the screen, as `Alt+M` does, and
   stays so.**
   - When the focus comes to another Agent's Group on a Project's
     workspace, that Group fills the screen, its columns keeping their
     shares, and the one before gives the room back. It comes there by a
     pick in the sidebar, the bar, a toast, `Alt+U`, or by the arrow
     keys past a Group's edge. The Strip slides to it, so where it went
     shows by the way it moved.
   - A Thread with no Panes of its own fills it alone: since ADR 0065's
     change of 2026-11-06, an Agent's Thread opens as a Group of its own.
     A Thread the Person took out of its Group stays as it is.
     _Changed_ in step 2: the engine's `fill` was first to make a Group
     of a column in none, which would have put back a Thread the Person
     took out.
   - `Alt+M` still gives the room back by hand. The next Agent the focus
     comes to fills the screen again.
   - Going from solo to the row gives the room back on the workspace you
     look at.

3. **The sidebar's header switches the Flow.**
   - An icon beside "New Thread" draws the Flow it is in. A click opens
     a menu of the three, each with its picture, its words and its key.
     Picking one writes `agents.toml`, as the theme menu writes
     `look.toml` (ADR 0067).
   - `Alt+Shift+M` goes from the row to solo and back, from free to solo.
     The action is `flow.solo`, in the Banda menu and `keys.toml`.

4. **`Alt+U` goes to the next row that calls, in the sidebar's own
   order.**
   - Done, asking and failed all call, as now. `Alt+U` takes the first
     of them below the Thread you are at, as the sidebar lists them, and
     from the end goes back to the top. It sorts nothing itself: how the
     calls are ordered is the sidebar's (ADR 0008), and what the sidebar
     shows is what `Alt+U` walks.
   - With the sidebar hidden, its order still holds: it is worked out
     the same way.
   - This changes ADR 0011, decision 5, for `Alt+U`: it no longer takes
     the loudest call first.

## Out of scope

Roma set these aside on 2026-11-06, to remember and not build yet:

- A new sidebar, the Inbox and the Projects together. It takes a session
  of its own.
- A Project's own windows (a dev server, a preview) in a Group of their
  own at the start of its Strip, or pinned at the right edge.
- Peeking at a row and answering it without going there.
- A line in the Thread at the place the Person last read.
- "Wall": every Thread of a Project in a grid.

## Consequences

- ADR 0065, decision 9: `[agents] workspaces` becomes `flow`, with a
  third value.
- ADR 0011, decision 5: `Alt+U` follows the sidebar's order.
- GLOSSARY gains **Flow**.
- The work comes in PRs, in order:
  1. `flow` in `agents.toml`, the icon and its menu, `Alt+Shift+M`.
  2. Solo.
  3. `Alt+U` in the sidebar's order.
