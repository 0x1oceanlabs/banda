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

- A theme is a folder with a `theme.toml`, light and dark inside. Every
  key is optional; a value is one for both, or `{ light = …, dark = … }`:

  ```toml
  name = "Sea"
  extends = "banda"          # a theme's name, or "platform", this device's own
  [colors]                   # the palette, by Omarchy's names: the seeds
  accent = "#2a9d8f"         # or "system": the Mac's or Windows' accent
  background = { light = "#f7fbfb", dark = "#0e1a1c" }
  [tokens]                   # a colour token: a palette name, a token's name or a colour
  card = { dark = "#101418" }
  [shape]                    # look.toml's [shape], gaps, tile, focus, shadow and bar.height
  window = 12                # the window's corner; a tile's and a card's follow
  control = 4                # a button's; a chip's is 0.6 of it
  [font]                     # as look.toml's [font]
  [glass]                    # as look.toml's [desk]
  [glass.tokens]             # a colour token over glass, as [tokens]
  muted = { light = "#0000001a" }
  ```

  With no `extends` the theme extends `"platform"`, this device's own:
  what it leaves out comes from there. Omarchy's theme folders read as
  colours only (their `colors.toml`), and an old folder's `banda.toml`,
  with the keys of `look.toml`, still reads.
- The tokens are one list, `platform/theme/src/tokens.rs`, which Banda's
  page and other clients are written from (`sdk/contract/src/generated/look/tokens.ts`
  names each, its kind and group). A `[tokens]` key is one of its colours
  by name; a value is a colour as it is: hex, `oklch(…)`, `rgb(…)` and
  the like, or a name. `var()`, `color-mix()` and other expressions are
  refused, as is a name that is no token.
- Glass is worked out from the solid colours (ADR 0100, decision 4): the
  desk, the sidebar's panel and the tiles thinned as `[desk]` and
  `[tile]` `opacity` say, and the fills, lines and quiet text the text's
  colour thinned. `[glass.tokens]` corrects one where that does not suit.
- The resolver keeps every theme readable (ADR 0100, decision 8). The
  accent, where it is a line, a link or the focus, is darkened or
  lightened to 3:1 on the background, and the text on it stays the
  theme's while it reads, else white or black. Quiet text, 3:1, and the
  text on a fill worked out from the theme, 4.5:1, are darkened or
  lightened, or made less thin over glass. The theme's own text on its
  own grounds is left alone: `check` names it when it does not read.
- Over Banda's glass, on Linux, the desk and the sidebar's panel are as
  dense as their text needs over the wallpaper, blurred and saturated as
  the page draws it (ADR 0111). `[desk]` `opacity` is the least they
  are. Over a picture the resolver does not read (JPEG XL, AVIF, SVG)
  they are as dense as over the worst. A desk or panel a theme's
  `[glass.tokens]` sets is as it says.
- Glass is off while the system reduces transparency or raises contrast,
  in its accessibility settings, and back once it stops (ADR 0100,
  decision 4); `[desk]` `glass` stays as the Person set it.
- The corners are the theme's (ADR 0100, decision 11): `banda` is round,
  window 30 and control 10; `omarchy` takes Hyprland's rounding as the
  window's and a third of it as a control's, so a square Hyprland makes
  Banda square; `macos` a tile about 10 and a control 7 for now.
- `banda look themes` lists every theme there is, one JSON line each; a
  theme of light and dark as `<name>-light` and `<name>-dark`.
- To make one, write `~/.config/banda/themes/<name>/theme.toml` and set
  `theme = "<name>"`; `banda settings check <its path>` names what is
  wrong in it. Behind Banda's fence the settings folder is read-only to
  you: make the folder in your Project, and give your Person the line
  that copies it there.

## Asked for, and what to set

- "Make it dark": `mode = "dark"`.
- "Square corners": `[shape]` `roundness = 0`; "rounder": `roundness = 1.3`.
  Banda's own round look on any system: `theme = "banda"`.
- "Orange focus": `[colors]` `accent = "orange"`, or a hex.
- "Columns too narrow in a small window": `[columns]` `min = 36`.
- "Dragged sizes stick too much", "not at all": `[columns]` `snap = 4`, or
  `snap = 0`; the presets and heights are where they stick.
- A column's widths are not the look's: they are `tiling.toml`'s
  `[columns]`, the same on every device (`banda settings set tiling.toml
  columns.default 1/3`). "One Pane at a time, the others' names over
  it": `display = "deck"` there (a Deck, `Alt+T`); "other heights for
  Alt+Shift+R": `heights = ["1/4", "1/2", "3/4"]` there.
- "More project between the windows": `[gaps]` `inner = 16`, `outer = 16`.
- "More glass", "see the wallpaper more": `[desk]` `opacity = 0.25`, as
  far as the desk's text reads over the wallpaper on Linux;
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
- "Darker shadows under menus", "no shadow under menus": `[shadow]`
  `float = 0.2` or `float = 0`, which dialogs, toasts, floating bars and
  a switch's thumb share; what is carried, a Pane being moved or a Peek:
  `lift`.
- "Sidebar right on the glass": `[desk]` `sidebar = "desk"`; a floating
  panel is `"panel"`.
- "Hide that on the bar", "put it in the middle": `[bar]` lists each
  part's widgets by id, in order, and a part's list replaces Banda's (the
  defaults above), so leave the id out, or move it to `center`. What each
  module's widget shows is in the `modules` topic and `banda modules`.
  The window's own are `workspaces.list`, `workspaces.aside`, the Flow's
  icon `window.flow` and `sidebar.counts`, in the middle by default:
  with the sidebar hidden, it says whose turn it is and who works, and a
  click opens the small inbox. A `left` of the Person's own written
  before the Flow came to the bar lacks it: add `"window.flow"` after
  `"workspaces.list"`. Alt+Shift+M works either way.
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
