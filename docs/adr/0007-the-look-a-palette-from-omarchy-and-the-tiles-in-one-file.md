---
status: accepted
date: 2026-11-01
---

# The look: a palette from Omarchy, and the tiles' gaps, borders and motion in one file

ADR 0005 promised a theme file (decision 11) and "one look, and honest motion" (decision 16): one theme recolours every Pane, it can follow Omarchy's, and motion follows niri. On 2026-11-01 Roma asked to build it: light and dark, the theme taken from Omarchy, and a config for the tiling itself: accents, windows, gaps and animations. Start small, but on an architecture that can go deep. Inspired by niri, Hyprland and Omarchy, and everything can be changed through an Agent.

**Today.**

- `app/ui/src/styles/globals.css` holds shadcn's neutral tokens for `:root` and `.dark`, plus `--attention` (PR #31), `--added` and `--removed`.
- The window turns dark with `prefers-color-scheme`. The desktop paints its first frame `#0a0a0a` or `#ffffff`.
- `Strip.tsx` has `GAP = 4`. A tile is `rounded-lg border`, and the focused one is `border-ring/60`.
- A workspace slides in 300 ms `ease-out`. The Strip scrolls with the browser's `smooth`.
- The terminal reads only `--foreground` and `--background`. Its 16 colours are Ghostty's.

**What the three teach.**

- **Omarchy.** One palette per theme, `colors.toml`: `mode` (`light` or `dark`), `accent`, `selection`, `muted`, four backgrounds, four foregrounds, eight colours and their bright twins. Every app's file is generated from it by a template, with helpers such as `mix a b 6%`. A theme can ship an app's file of its own to replace the generated one, as `shell.toml`. The current theme sits in `~/.local/state/omarchy/current/theme/`, with `theme.name` and `theme.generation` beside it. T3 Code takes its theme through a template, `t3code.json`.
- **Hyprland.** `general` holds the gaps (`gaps_in`, `gaps_out`), `border_size` and the border colours, a gradient too. `decoration` holds `rounding` (Omarchy ships 0; Roma's is 12), `dim_inactive`, shadow and blur. `animations` names curves (`bezier`) and gives each event a curve, a speed and a style (`popin 87%`). Omarchy's defaults: `easeOutQuint`, windows 3.79, border 5.39.
- **shadcn/ui.** One number, `--radius`, and a ladder made from it: `sm` ×0.6, `md` ×0.8, `lg` ×1, `xl` ×1.4, up to `4xl` ×2.6, and `full` for circles. Controls take `lg`, small ones `md` or `sm`, cards and dialogs `xl`. A small control caps its step (`min(var(--radius-md), 10px)`), and a control tight inside another takes the outer radius less the padding (`calc(var(--radius) - 3px)`), so corners stay concentric.
- **niri.** `layout` holds `gaps`, `struts`, `preset-column-widths`, `default-column-width`, `center-focused-column` and two distinct frames: the `focus-ring` outside a window and the `border` around it. `animations` has a global `slowdown` and `off`. Each animation is either a spring (`damping-ratio`, `stiffness`, `epsilon`) or an easing (`duration-ms`, `curve`).

**Decision.** Roma decided the points marked _decided_. On 2026-11-01 he accepted the rest as our defaults and asked to build; each stays his to change.

1. **Three layers: palette, tokens, components.**
   - **The palette** is what a theme says: Omarchy's `colors.toml`, key for key. So every Omarchy theme is a Banda theme as it is, and a Banda theme works in Omarchy.
   - **The tokens** are what components use: today's CSS variables (`--background`, `--primary`, `--border`, `--attention`, …), the terminal's 16 colours and the window's own (focus ring, gaps). One pure function derives them from the palette (the table below).
   - **Components** use only tokens, as they do now. No component reads the palette.
   - The tokens are shadcn/ui's own names, and every Pane is built from `@bandaso/ui` (ADR 0005, decision 12). So a Person who wants to restyle further changes a token, and every component of every module follows. A token set made for shadcn elsewhere carries over as it is.

2. **One schema, four layers** (_decided_). The look comes from four places, each over the one before:
   1. Banda's built-in defaults;
   2. the theme: a folder with Omarchy's `colors.toml` and, if its author wants, a `banda.toml`, which may set anything the Person's file sets, square corners or wide gaps too;
   3. the desktop: Hyprland's own settings, when Banda runs under it (decision 8);
   4. the Person's `~/.config/banda/look.toml`.
   - `banda.toml` and `look.toml` have the same keys. A Person and an Agent learn one schema.
   - The Person's file always wins, so switching the theme never undoes their gaps or motion.
   - There is no separate `theme.toml` (ADR 0005, decision 11, named one): picking a theme is two lines of `look.toml`, and the colours live in the theme's folder. `keys.toml` stays its own file.
   - Omarchy splits the same way: a theme switches whole, and the Person's Hyprland settings stay theirs.

3. **Where a theme comes from.** `theme` in `look.toml` names it:
   - `omarchy` follows Omarchy's current theme, live. The engine watches `theme.generation` and repaints on a change. This is the default when Omarchy is installed (_decided_).
   - `banda` is ours: today's neutral look, with the orange `--attention`, light and dark. The default elsewhere.
   - Any other name is a folder: `~/.config/banda/themes/<name>/` first, then Omarchy's `~/.config/omarchy/themes/<name>/`. So any installed Omarchy theme can be picked by name without switching the whole desktop.

4. **Light and dark.**
   - `mode = "system"` (the default), `"light"` or `"dark"`.
   - A palette has one mode. `omarchy` takes the mode of Omarchy's theme.
   - For `system`, a theme pair may follow the system: `theme = { light = "tokyo-night-light", dark = "forest-dusk" }`. `banda` carries both.
   - The desktop sets Electron's `nativeTheme.themeSource` to match, so scrollbars, menus and the first frame agree with the page.

5. **The accent is the Person's too.** `[colors]` in `look.toml` replaces palette entries over any theme: `accent = "orange"` (a palette name) or `accent = "#e07a3f"`. The same goes for `attention`, which is Banda's one signal colour (the mark, a Question) and defaults to the palette's `orange`.

6. **The tiling look, named as Hyprland and niri name it.** In `look.toml`, in pixels:
   - `[gaps]`: `inner` between tiles and `outer` around the Strip (Hyprland's `gaps_in` and `gaps_out`).
   - `[tile]`: `radius` (a step of the ladder or pixels, decision 7), `border` width, `dim-inactive` (0 to 1).
   - `[focus]`: how the focused tile stands out (_decided_), as in Hyprland by default: its `border` takes the accent, the others keep `inactive-border`. niri's focus ring is a switch: `ring` draws a ring of that width outside the focused tile, in the gap, so nothing moves; `0`, the default, draws none. Colours are palette names or hex. A gradient comes later, written as Hyprland writes it.
   - `[columns]`: `presets` (`[1/3, 1/2, 2/3, 1]`), `default` (`1/2`) and `center` (`never`, `always`, `on-overflow`), as niri's.
   - `[bar]`: `height`. `[font]`: `sans`, `mono`, `size`. With `theme = "omarchy"` the fonts follow Omarchy's too.

7. **Corners follow shadcn/ui's ladder** (_decided_).
   - One number, `radius` in `look.toml`, is shadcn's `--radius`. Every corner in Banda is a step of its ladder, so one number rounds or squares the whole window. `radius = 0` makes everything square, as Omarchy's Hyprland is.
   - **The outer is never rounder than the inner's container** (_decided_): what holds something is at least as round as what it holds. The tile holds cards, so the tile is the top step, `xl` (14 px at the default 10). `[tile] radius` takes a step (`"lg"`, `"xl"`) or pixels.
   - Components take steps, never pixels of their own. A small one caps its step, and one tight inside another takes the outer radius less the padding, as shadcn's do.
   - `full` is a shape, not a corner: a dot, an avatar or a radio stays round when `radius = 0`.

8. **Under Hyprland, Banda follows Hyprland** (_decided_).
   - When Banda runs under Hyprland, it takes the window settings the Person already chose there: `decoration:rounding` becomes the tile's radius, `general:border_size` the tile's border, and `general:gaps_in` both gaps. The tiles inside Banda then look like the windows around it.
   - The tile is the `xl` step, so `radius` becomes `rounding / 1.4`, and every control keeps its place on the ladder. Roma's 12 gives tiles of 12 px and fields of 8.6 px; Omarchy's 0 makes everything square.
   - The engine asks Hyprland over its socket (`j/getoption`, what `hyprctl getoption` prints), so any Hyprland config works, Lua or not. It listens for `configreloaded` and repaints.
   - `look.toml` still wins key by key. `hyprland = false` turns it off.
   - Only these three: Hyprland's colours come through the Omarchy theme, and its gaps around the screen (`gaps_out`) belong to the desktop, not to the tiles in Banda's window.

9. **Motion, as niri says it.**
   - `[motion]`: `off`, `slowdown` (2 is twice as slow).
   - Each event has its own table: `workspace`, `strip` (scrolling to a column), `open`, `close`, `resize`, `overview`, `focus`.
   - Each is a spring (`damping-ratio`, `stiffness`, `epsilon`) or an easing (`duration-ms`, `curve`). Curves are named: Omarchy's `easeOutQuint`, `easeInOutCubic`, `linear` and a `cubic-bezier(…)`.
   - The system's reduced motion turns it off, as `off` does.
   - Springs run in the window, so a move that is interrupted carries its speed on, as niri's do.

10. **The look is the engine's `look` module, like any other module.**
   - It reads `look.toml` and the theme's files, checks them, and resolves one value, the `Look`: tokens, gaps, tiles, focus, columns, fonts and motion, every value already filled in.
   - It watches the files. A saved file applies at once. A broken one leaves the last good `Look` in force, and a notice names the file and the line (ADR 0005, decision 11).
   - Its contract: a stream `look` that starts with the whole `Look` and sends a new one on every change; a command `look.set` that writes keys into `look.toml` and keeps the Person's comments; `look.themes` lists the themes it can find; `bandaso check` validates the file.
   - Its manifest declares MCP tools for the same, so an Agent changes the look as a Person does: "make the gaps bigger", "take Omarchy's theme", "no animations".
   - The look belongs to the machine the window runs on, not to a Space. A Space on another machine is drawn in the local look.

11. **The window only applies it.**
   - It writes the tokens and the sizes as CSS variables on `:root`: `--gap-inner`, `--gap-outer`, `--tile-radius`, `--tile-border`, `--focus`, `--focus-inactive`, `--focus-ring`, `--bar-height`.
   - The Strip, the frame and the bar take sizes from those variables, not from constants.
   - The terminal takes all 16 colours, the cursor and the selection from the tokens.
   - Until the engine answers, the window draws the `banda` defaults, the same values the module ships.

**Tokens from a palette.** Omarchy's `accent` is the theme's colour, and it goes to shadcn's `--primary` and `--ring`. shadcn's `--accent` is something else: the background of a row under the pointer.

| Token | From the palette |
|---|---|
| `--background`, `--card` | `background` |
| `--foreground`, `--card-foreground`, `--popover-foreground` | `foreground` |
| `--popover` | `lighter_background` |
| `--primary`, `--ring`, `--focus` | `accent` |
| `--primary-foreground` | `background` |
| `--secondary`, `--muted`, `--accent` | `mix background foreground 8%` |
| `--muted-foreground` | `dark_foreground` |
| `--border`, `--input` | `mix background foreground 12%` |
| `--destructive`, `--removed` | `red` |
| `--added` | `green` |
| `--attention` | `orange` |
| `--sidebar` | `dark_background` |
| `--sidebar-accent` | `mix dark_background accent 18%` |
| `--selection` | `selection` |
| terminal 0–15 | Omarchy's: `background`, the six colours, `foreground`, `muted`, the bright twins, `bright_foreground` |

**`look.toml`, the defaults written out.**

```toml
theme = "omarchy"          # "banda", a name, or { light = "…", dark = "…" }
mode = "system"            # "light" or "dark"

[colors]                   # over the theme's palette
# accent = "orange"
# attention = "#e07a3f"

radius = 10                # shadcn's --radius: every corner follows; 0 is square
hyprland = true            # under Hyprland, take its rounding, border and gaps

[gaps]
inner = 4
outer = 4

[tile]
radius = "xl"              # a step of the ladder, or pixels
border = 2
dim-inactive = 0

[focus]
border = "accent"          # the focused tile's border
inactive-border = "border" # every other tile's
ring = 0                   # niri's ring outside the focused tile; 0 draws none
ring-color = "accent"

[columns]
presets = ["1/3", "1/2", "2/3", "1"]
default = "1/2"
center = "never"

[bar]
height = 36

[font]
sans = "Inter Variable"
mono = "monospace"         # the system's, Omarchy's font on Omarchy
size = 14

[motion]
off = false
slowdown = 1

[motion.workspace]
spring = { damping-ratio = 1.0, stiffness = 800, epsilon = 0.0001 }

[motion.strip]
spring = { damping-ratio = 1.0, stiffness = 800, epsilon = 0.0001 }

[motion.open]
easing = { duration-ms = 150, curve = "easeOutQuint" }

[motion.close]
easing = { duration-ms = 120, curve = "linear" }
```

**Consequences.**

- `--attention` and the tokens' list move from CSS into the module's defaults. `globals.css` keeps only the mapping to Tailwind (`@theme inline`).
- Words for `GLOSSARY.md`, once built: the look, the theme, the palette.
- The app is called Banda (_decided_ 2026-11-01). The look lives in `~/.config/banda/`, as ADR 0005 named it. The other places (`~/.config/bandaso/`, `~/.local/state/bandaso/`, `BANDASO_*`, the window title) move in a rename PR of their own.
- The order of work, each step its own PR:
  1. **The window reads sizes and colours from variables.** The `banda` defaults, `--gap-*`, `--tile-*`, `--focus-*`; the Strip, the frame and the bar take them. The tile becomes the `xl` step with a 2 px border, and the last corners that ignore the ladder take its steps.
  2. **The `look` module.** `look.toml`, the `banda` and `omarchy` themes, the derivation, the stream and the file watch; light and dark; `nativeTheme`; Hyprland's rounding, border and gaps.
  3. **The terminal's 16 colours and the focus ring.**
  4. **Motion**: springs in the window, the `[motion]` tables, reduced motion.
  5. **`look.set`, `look.themes` and the MCP tools**, then a settings page on the same file.
- Later: gradients on the focus ring, shadows and blur, per-workspace gaps, an Omarchy template so a theme can ship `banda.toml` from `colors.toml` alone.
