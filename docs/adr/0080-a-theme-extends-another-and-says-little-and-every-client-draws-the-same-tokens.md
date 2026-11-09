---
status: accepted
date: 2026-11-06
---

# A theme extends another and says little, and every client draws the same tokens

ADR 0075 shipped three themes (macos, omarchy, banda) and showed where the
look's seams are:

- Banda's colours and shape are written twice: in Rust and the themes, and
  again by hand as fallbacks in `globals.css`. The radius ladder is in both.
- Over glass, CSS rewrites six shadcn tokens with `!important` (ADR 0036),
  so a theme's `[tokens]` for them are ignored.
- The omarchy theme's `hyprland = true` and its missing focus shadow are
  set in `theme.rs`, not in a file. The platform default is an `if`.
- No shipped theme says its shape; it all comes from the defaults. In a
  light and dark pair the dark one's shape is ignored.
- About 230 corners: the `×--radius` ladder, `min(…, 10px)` in buttons,
  `calc(var(--radius) - 5px)` in inputs, px in a few places, and the
  overview working radii out in JS.
- A theme cannot say "macos, with another accent". There is only the
  four-layer chain: defaults, theme, Hyprland, `look.toml`.
- The macos accent is `var(--system-accent)`: a CSS expression in a
  palette, which only a web page can read.

Roma, 2026-11-06: macos looks like the Mac before Tahoe, whose corners are
larger now; "the radii need a hierarchy, as shadcn has, so that everything
is whole"; bring the themes to one shape; a Person writes their own theme
with an Agent, and we make colour themes later; platform themes, with
inheritance, for macOS, Omarchy, GNOME, KDE, Windows, Hyprland and niri;
"simple and minimal on the surface, depth inside, where it is needed".

ADR 0062 (proposed) puts the look in the platform. An App draws with
shadcn through the client (Level 1), so the Person's theme is the only
thing that styles any App, and a phone draws the same tree with
react-native-reusables. Roma, the same day: the theme is the client's,
each display its own; a phone is not a Mac.

## Decision

1. **The look has two levels.** Which theme, and the Person's own theme
   files, are the Person's: for now on the home machine (ADR 0062), later
   with the rest of their data. Resolving the theme is the device's: only
   the device knows its system's mode, accent, font, material and window
   manager. So a Mac and a phone show one Person's theme, each on its own
   platform.
   _Amended 2026-11-09 by
   [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md), through
   ADR 0100: there is no home machine. The Person's theme folders are
   shared, a copy on every machine; which theme is each device's._

2. **One resolver, a pure function.** Theme files and the device's inputs
   go in, tokens come out. It stays the `look` crate. The desktop runs it
   as now (`banda look --follow`); a web or phone client runs the same code
   as WebAssembly. Nothing in a page or a component works out a colour or a
   radius.

3. **A theme is one file.** `themes/<name>/theme.toml`, light and dark
   inside:

   ```toml
   name    = "Ocean"
   extends = "platform"

   [colors]                 # seeds; the rest is derived
   accent     = "#2a9d8f"
   background = { light = "#f7fbfb", dark = "#0e1a1c" }
   foreground = { light = "#102326", dark = "#e3f1f2" }

   [shape]                  # only when it differs
   roundness = 1.2          # times the base's radii
   density   = "cozy"

   [tokens]                 # the way into the depth: any token
   attention = "#ff8a3d"
   ```

   - `[colors]`, `[shape]`, `[font]`, `[glass]` and `[tokens]` are the
     sections. Every key is optional; a value may be one, or
     `{ light, dark }`.
   - An Omarchy theme folder (`colors.toml`) still reads as it is, as a
     theme of colours only.
   - Banda's own themes move to `theme.toml`, as examples.
   - It is a theme's own file, in its folder. Picking a theme is still
     `theme` in `look.toml` (ADR 0007, decision 2).

4. **A theme extends another.** `extends` names a theme, or `"platform"`:
   the base of the device it shows on. Unset, `theme` is `"platform"`.

   ```
   banda              the root: every token, the whole shape
   ├─ macos           Tahoe's shape, the system's font and accent
   ├─ windows         Segoe UI, Mica, the system's accent
   └─ linux           the portal's mode and accent
      ├─ gnome        Adwaita
      ├─ kde          Breeze
      ├─ hyprland     rounding, gaps and border from Hyprland
      │  └─ omarchy   + Omarchy's palette and wallpaper
      └─ niri         gaps, focus ring and radii from niri
   ocean, moss…       extends = "platform", colours only
   ```

   - The device picks its platform base: `macos` on a Mac, `omarchy` where
     Omarchy is, `hyprland` or `niri` under them, `gnome` or `kde` by the
     desktop, `windows`, else `banda`. (ADR 0075, decision 2, grown.)
   - A theme that extends `"platform"` and says no `[shape]` looks at home
     on every platform: colours from it, shape from the base.
   - `look.toml` stays the Person's last layer over every theme.

5. **A theme says seeds, and the resolver derives the rest.** Accent,
   background and foreground are enough; surfaces, lines, quiet text,
   rings and the sidebar follow from them, as `tokens::derive` does now.
   `[tokens]` sets any token by name, and `banda theme check` refuses a
   name that is not one.

6. **Radii have five levels.**

   | Level | What | From |
   |---|---|---|
   | `window` | the window, the desk | the theme (on a Mac, as the system's) |
   | `tile` | a Pane, the sidebar's panel | `window` − the outer gap |
   | `card` | cards, a Thread's blocks, menus | `tile` − its padding |
   | `control` | button, input, select | the theme (shadcn's `--radius`) |
   | `small` | chip, checkbox, badge | `control` × 0.6, or a pill |

   - A theme says two numbers, `window` and `control`, and whether
     controls are pills (`[shape] pill = true`, as Tahoe's are). Nested
     corners are concentric, so tiles inside the window, cards inside
     tiles, never look pinched.
   - Components round only with `rounded-window`, `rounded-tile`,
     `rounded-card`, `rounded-control`, `rounded-small` and
     `rounded-full`. shadcn's ladder maps onto them: `sm` is `small`,
     `md` and `lg` are `control`, `xl` and up are `card`. A check refuses
     px, `calc()` and `min()` in a rounding class.
   - `[shape] roundness` scales both numbers, so a Person turns the whole
     look rounder or sharper with one slider.

7. **The tokens are the contract, and they travel.**
   - Every token resolves to a value: a colour (hex or `oklch()`), a
     length, a number. No `var()` or `color-mix()` crosses the contract,
     so a phone can draw it.
   - The token list lives once, in the `look` crate. From it the build
     writes the CSS the page reads (the fallbacks in `globals.css`
     included) and a TypeScript object for other clients. Nothing writes
     them by hand.
   - The system's accent comes into the resolver as an input (decision
     9), not as a CSS variable. ADR 0075, decision 6, keeps its behaviour
     and loses `var(--system-accent)`.

8. **Glass is a variant the resolver works out.** With glass on, it derives
   the glass tokens (desk, panel, tile, and the fills, quiet text and lines
   as the text colour thinned) and a theme may set them under `[glass]`.
   The `!important` overrides under `html[data-glass]` go; ADR 0036's
   values stay, as the derive's defaults.

9. **Each platform has an adapter, and the adapters are the only
   special cases.** An adapter reads what the device says and hands it to
   the resolver:

   | Platform | Reads |
   |---|---|
   | macOS, Windows | `systemPreferences`: accent, mode; the material |
   | GNOME, KDE | xdg-desktop-portal's Settings: `color-scheme`, `accent-color` |
   | Hyprland | `hyprctl`: rounding, gaps, border, dimming |
   | niri | `config.kdl`: gaps, focus ring, corner radius |
   | Omarchy | its current theme folder: palette, wallpaper, font |

   - A base theme names its adapter in its file
     (`[shape] from = "hyprland"`), so `theme.rs` loses its omarchy
     branch and the omarchy theme says "no focus shadow" in its own file.
   - The Hyprland layer of ADR 0007 is now the `hyprland` theme's
     adapter, and applies only under it and the themes that extend it, as
     ADR 0075, decision 3, said.

10. **The surface stays small.**
    - The theme menu shows each theme as a small preview card, the mode
      (system, light, dark) and the accent (the system's or the theme's).
    - Settings → Appearance adds two sliders, roundness and density, and
      "Open the theme's file" and "Make a theme with an Agent".
    - `banda theme list | show <name> | check | new`. `show` prints the
      resolved tokens, so an Agent sees what its file did.
    - A Banda skill topic says how a theme is written, with the token
      list. An Agent writes `theme.toml`, Banda reloads it live, the Agent
      runs `check`.

## Steps

Each step is an issue and a PR. They start after ADR 0062's first step
(the folders' new names), so no file moves twice.

1. `theme.toml`, `extends` and `"platform"`; the built-in themes move to
   it. Nothing on screen changes.
2. The token list in `look`; the CSS and TypeScript written from it; the
   hand-written fallbacks go; every token a value (the accent included).
3. The five radius levels: tokens, Tailwind utilities, every component
   moved, the check.
4. Glass as a variant of the tokens; the `!important` rules go.
5. Adapters: the portal on Linux; Hyprland and niri as base themes' files;
   the omarchy branch leaves `theme.rs`.
6. The surface: preview cards, the two sliders, `banda theme`, the skill
   topic.
7. The themes: banda tuned; macos on Tahoe's shape (radii measured on
   Roma's Mac); omarchy.

## Later

- `gnome`, `kde`, `windows` and `niri` themes of their own.
- Colour themes (Ocean, Moss…) extending `"platform"`.
- The Person's theme choice and files synced across their machines.
  _Amended 2026-11-09 by
  [ADR 0101](0101-machines-are-peers-and-there-is-no-home-host.md): the
  theme folders are copied with the other shared files (its E14); the choice
  stays each device's._
- The resolver as WebAssembly, with the web client (ADR 0062).

## Changes

- ADR 0007: the four layers become the `extends` chain, and decision 8's
  Hyprland layer is the `hyprland` theme's adapter.
- ADR 0036: its values become the glass derive's defaults; the CSS
  `!important` rules go.
- ADR 0075: decision 2 grows into the platform base (decision 4 here);
  decision 6's accent comes in as the resolver's input; decision 7's
  `banda.toml` becomes `theme.toml`.
