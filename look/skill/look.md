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
- `banda look themes` lists every theme there is, one JSON line each.
- To make one, copy a theme's folder into `~/.config/banda/themes/<name>/`
  and set `theme = "<name>"`.

## Asked for, and what to write

- "Make it dark": `mode = "dark"`.
- "Square corners": `radius = 0`.
- "Orange focus": `[colors]` `accent = "orange"`, or a hex.
- "Columns too narrow in a small window": `[columns]` `min = 36`.
- "One Pane at a time, the others' names over it": `[columns]` `display = "deck"` (a Deck, `Alt+T`).
- "Other heights for Alt+Shift+R": `[columns]` `heights = ["1/4", "1/2", "3/4"]`.
- "Dragged sizes stick too much", "not at all": `[columns]` `snap = 4`, or
  `snap = 0`; the presets and heights are where they stick.
- "More project between the windows": `[gaps]` `inner = 16`, `outer = 16`.
- "More glass", "see the wallpaper more": `[desk]` `opacity = 0.25`;
  "glassier windows": `[tile]` `opacity = 0.75`. Solid: `[desk]`
  `glass = false`.
- "More frosted", "less blur": `[desk]` `blur = 64` or `blur = 20`;
  "duller colours under the glass": `saturation = 1`; "no grain":
  `grain = 0`. "Glass from this picture": `wallpaper = "~/Pictures/x.jpg"`
  (unset, the desktop's own: Omarchy, GNOME, KDE, XFCE, hyprpaper; the
  look's `desk.wallpaper.from` says which). "My wallpaper doesn't show":
  `banda look` names the problem, such as a format Banda cannot draw.
  "Real see-through, the compositor's blur": `material = "system"` (from
  Banda's next start).
- "Shadow under the windows": `[tile]` `shadow = 0.4`; none under the
  sidebar: `[desk]` `sidebar-shadow = 0`.
- "Sidebar right on the glass": `[desk]` `sidebar = "desk"`; a floating
  panel is `"panel"`.
- "Hide that on the bar", "put it in the middle": `[bar]` lists each
  part's widgets by id, in order, and a part's list replaces Banda's (the
  defaults above), so leave the id out, or move it to `center`. What each
  module's widget shows is in the `modules` topic and `banda modules`.
- "Less motion": `[motion]` `slowdown = 2`, or `off = true`.
- "No sounds": `[sound]` `family = "off"`. Only when something fails:
  `done = false` and `asking = false`.

## Check it

- `banda look check` checks every file the look reads.
- `banda look` prints the look it resolves now, as JSON: the CSS
  variables, the layers it came from, and any problems.

The bar widget `harnesses.limits` is a ring of the fullest account limit.
A click shows every account's windows, resets, even pace, and the last read
or its failure. It is on the right by default; `[limits]` in
`harnesses.toml` controls reading, its interval, the warning threshold,
and `look`: `icon`, `meter`, `number` or `providers`.
