---
status: accepted
date: 2026-11-04
---

# The selected Pane keeps its frame through the overview zoom

ADR 0025, decision 7, shows the live Panes under clear overview tiles.
The selected tile drew a second frame, while the real Pane lost its
focus frame and became dim as soon as the overview took the keys. The
two frames faded at different places during the zoom.

Roma, on 2026-11-04, found the active window disappearing and reappearing
during the zoom unnatural, and asked for an aesthetic, minimal motion.

## Decision

1. **The selected Pane stays visually selected through the whole zoom.**
   It keeps its frame and brightness on opening, in the overview and on
   closing. Taking the keys and looking selected are separate: the
   overview still owns the keys, and the Panes stay inert under it.
2. **One frame follows the real Pane.** It follows the Pane's actual
   position and corners as the workspace scales. Its apparent thickness
   stays steady, using the look's border and focus ring. The overview's
   clear hit tile draws no second selection frame. An unselected Pane
   that calls keeps its attention frame and badge.
   While zooming, the stroke is drawn in the unscaled workspace layer:
   scaling a CSS outline would round its thickness to whole pixels and
   make it pulse. It is placed from the Pane's measured geometry in the
   existing overview draw loop.
3. **Only the existing zoom moves it.** No extra fade, pulse or delayed
   handover for the selection. Labels and controls fade near the
   overview's resting view, from the same progress rather than a second
   timer. The look's motion and reduced-motion choices still apply.

## Consequences

- This replaces the selected overview tile's inset frame in ADR 0025,
  decision 7; the Pane itself owns that frame throughout.
- A Pane's visual selection does not let it take focus from the overview.
- No new setting, animation loop or copy of a Pane is needed.
