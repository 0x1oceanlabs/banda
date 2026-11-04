---
status: accepted
date: 2026-11-04
---

# The overview takes the desk's material and theme

ADR 0025, decision 7, put the live workspaces over a dark backdrop.
Roma, on 2026-11-04, disliked that dark ground, compared light grounds,
and chose glass when the desk is glass, otherwise the theme's ground.

## Decision

1. **On a solid desk, the overview follows the theme.** Its ground is
   the desk's colour mixed with 6% of the text colour, so the miniature
   workspaces stand apart gently in either a light or a dark theme.
   Labels and frames take the theme's text colour.
2. **On a glass desk, the overview keeps that glass.** The shell already
   draws the desk's tint over the wallpaper or the system's material
   (ADRs 0023 and 0030). The overview's backdrop and miniature workspace
   grounds are clear, so they add neither an opaque sheet nor another
   layer of tint. The Panes keep their own surfaces.
3. **The search hint, close buttons and Thread badges take the popover's
   surface.** It already follows the theme and frosts what is behind it
   on glass (ADR 0023, decision 6). Labels stay readable without a new
   material or a blur of their own.
4. **The desk's existing choices decide.** No new overview setting:
   `desk.glass`, its material and the chosen theme are enough. Without
   available glass, the solid theme ground applies as usual.

## Consequences

- The dark backdrop in ADR 0025, decision 7, is replaced by this surface.
- The existing zoom and its focus, search and drag rules stay as they are.
- Glass is tinted once, and the existing material owns its blur.
