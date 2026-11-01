---
name: look
description: Change how Banda looks - its theme, light or dark, colours, corners, gaps, focus, motion and sounds - in ~/.config/banda/look.toml.
---

# The look

`~/.config/banda/look.toml` sets how Banda's window looks and sounds. The
look comes in layers, each over the one before: Banda's defaults, the
theme, Hyprland's own window settings when Banda runs under Hyprland, and
this file. The Person's file always wins, so a new theme never undoes their
gaps or sounds.

Every key, with its default:

<!-- include ../look.toml -->

## Themes

- A theme is a folder with Omarchy's `colors.toml` (the palette) and, if
  it wants, a `banda.toml` with the keys of `look.toml`.
- `bandaso look themes` lists every theme there is, one JSON line each.
- To make one, copy a theme's folder into `~/.config/banda/themes/<name>/`
  and set `theme = "<name>"`.

## Asked for, and what to write

- "Make it dark": `mode = "dark"`.
- "Square corners": `radius = 0`.
- "Orange focus": `[colors]` `accent = "orange"`, or a hex.
- "Less motion": `[motion]` `slowdown = 2`, or `off = true`.
- "No sounds": `[sound]` `family = "off"`. Only when something fails:
  `done = false` and `asking = false`.

## Check it

- `bandaso look check` checks every file the look reads.
- `bandaso look` prints the look it resolves now, as JSON: the CSS
  variables, the layers it came from, and any problems.
