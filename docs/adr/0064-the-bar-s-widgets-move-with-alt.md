---
status: accepted
date: 2026-11-05
---

# The bar's widgets move with Alt

ADR 0024 put the widgets where the look's `[bar]` lists them, and left
"dragging widgets along the bar" for later (decision 6). The Mark and the
workspaces stood first on the left, not widgets, and could not move.

Roma, on 2026-11-05: "I want to move the bar's plugins and put them where
it suits you." Roma tried a mock with two ways, Alt and drag or a mode
to arrange the bar with a tray of the hidden widgets
(`artifacts/bar-arrange/v1.html` and `v2.html` in the brand workspace),
and decided:

- Alt and drag only, as a Pane moves with Alt (ADR 0025); no mode of its
  own.
- The workspaces move too.
- Banda's Mark stays at the left edge, as the Apple menu stays on macOS.

## Decision

1. **With Alt held, a press on a widget picks it up.**
   - It follows the pointer along the bar. The bar's three parts show
     their outline, and the one under the pointer is marked. The widget
     stands where it would go, and the others make room.
   - On release it stays there, and the window writes the three lists
     of `[bar]` to `look.toml` through `banda settings set` (ADR 0016).
     The file stays the only source, and what reads it hears the change.
     Ids of modules the engine does not run keep their place in their
     part's list.
   - `Escape`, or a release away from the bar, puts it back.
   - Without Alt, a widget is clicked as before.
2. **The workspaces are a widget, `workspaces.list`.**
   - Banda's `[bar] left` is `["workspaces.list"]`, so a bar nobody has
     arranged looks as before.
   - When no part lists it, it stands first on the left: a `left` written
     before this ADR, without it, keeps the workspaces where they were.
   - They move as one, the numbers or dots and the `+` together.
3. **Fixed at the edges:** the Mark, the sidebar's button, first on the
   left; Banda's update, the look's problems and the engine's connection
   last on the right. They tell about Banda, not about the work.
4. **Taking a widget off the bar, or back, stays in the file.** Settings
   shows `[bar]` from the schema (ADR 0016).

## Consequences

- ADR 0024, decision 4, changes: the Mark alone is not a widget, and
  `left` holds the workspaces. Decision 6's dragging is done.
- ADR 0005, decision 9: the workspaces may stand anywhere on the bar.
- `GLOSSARY.md`: the Bar.
- Built in one PR with this ADR: `workspaces.list`, the drag, and a test
  that an Alt drag writes `[bar]`.
