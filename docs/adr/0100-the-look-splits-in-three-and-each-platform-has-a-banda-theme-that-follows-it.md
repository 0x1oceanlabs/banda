---
status: accepted
date: 2026-11-09
---

# The look splits in three, and each platform has a Banda theme that follows it

_It amends ADR 0080 (decisions 1, 4, 8, 9 and 10, and its steps), ADR 0089
(its deferred list: where the look is worked out for the web) and ADR 0007
(decision 10: one `banda look` for everything). Code is cited from main at
`f855adde`._

ADR 0080 was accepted on 2026-11-06, before Banda ran on several machines
(ADR 0081) and before the window split (ADRs 0087 to 0089). None of its
steps has begun. Roma, 2026-11-09, asked how the themes sit in the new
architecture and said they need a refactor too.

**Where it stands.**

- "The look" is one thing, made by one program. The window's child runs
  `banda look --follow --with-parent` on the window's machine
  (`client/desktop/src/look.ts`) and takes each line as the whole look.
- That one `Look` holds the theme (`mode`, `schemes`, `vars`, `desk`) and
  everything else the Person set: `keys`, `sidebar`, `notify`, `sound`,
  `motion`, `columns`, `bar`, `drawer`, `overview`, `groups`, and each
  module's own file in `files` (`platform/look/src/lib.rs`, `struct Look`).
  `look.toml` mixes both: `theme`, `[colors]`, `[desk]` beside `[columns]`,
  `[bar]`, `[drawer]`.
- The `look` crate is about 7,000 lines; the theme is a small part of it.
  Four files on the window's side read it: `client/desktop/src/look.ts`,
  `client/desktop-kit/src/look.ts`, `client/ui/src/lib/look.ts`,
  `client/web/src/look.ts`.
- So a Mac that opens arc's Threads takes its keys, sidebar and calls from
  the Mac's files, while ADRs 0062 and 0081 put the Person's files on their
  home machine and only what the device knows on the device.
- ADR 0089 deferred "the look resolver on the device (E5 resolves it on the
  host for v1)", while ADR 0080 says the device works the theme out. A host
  does not know a Mac's accent.

Research, the same day: `docs/research/2026-11-09-platform-themes.md`
(each platform's inputs, how to read them live, its shape, its glass).

## Decision

1. **The look splits in three.**

   | Part | What | Kept on | Worked out by |
   |---|---|---|---|
   | **The Person's settings** | keys, sidebar, calls (`[notify]`), sound, the Flow, columns, bar, drawer, overview, groups, each module's file | the home host, as the Person's files | the host's engine; a client asks for them |
   | **The theme** | the theme files, which theme each display takes, `[colors]`, `[tokens]`, `[shape]`, glass | the files on the home host | **the device**: one pure function, files and the device's inputs in, tokens out |
   | **The device's own** | zoom, widths, the system's mode, accent, font, material, reduce transparency | the device | the device |

   - `look.toml` keeps only the theme part. The other sections move to
     the Person's settings files, one per subject, as ADR 0016 has them for
     modules. An old `look.toml` still reads; `banda settings check` says
     where each moved key now lives.
   - The `look` crate splits the same way: `platform/theme` (the resolver,
     the themes, the adapters) and the settings, which the engine serves.
   - The window reads all of it through one store in `client/core`; the
     four `look.ts` become one.
   - Where the web works a theme out is decided with the web (stage 4).
     The resolver is a pure function, so it can run on the host with the
     device's inputs sent, or in the page as WebAssembly.

2. **Banda ships one theme of its own and one theme per platform.**

   ```
   banda              Banda's own, light and dark; the root, every token
   ├─ macos           follows the Mac: mode, accent, font, Tahoe's shape
   ├─ windows         follows Windows: mode, accent, Segoe UI Variable, Mica
   ├─ gnome           follows GNOME: the portal, Adwaita's shape and font
   ├─ kde             follows KDE: kdeglobals' palette, Breeze's shape
   ├─ hyprland        follows Hyprland: rounding, gaps, border
   │  └─ omarchy      + Omarchy's palette, wallpaper and font
   └─ niri            follows niri: gaps, focus ring, radius
   ```

   - The menu names them "Banda", "Banda macOS", "Banda Omarchy" and so
     on. In files they are `banda`, `macos`, `omarchy`.
   - Each has light and dark inside. The mode follows the system unless
     the Person sets it.
   - `theme = "platform"` is the default: each device takes its own, so
     one file of the Person's looks right on the Mac and on arc. The
     device picks it in this order: `macos`, `windows`, `omarchy` (only
     under a live Hyprland), `hyprland`, `niri`, `kde`, `gnome`, else
     `banda`. The device the window runs on decides, never a remote
     engine.
   - A display may take another theme than the rest: `[display.<name>]
     theme = "…"`. Which display takes which is the Person's (decision 1).

3. **Banda's look is airy, light and round.** Large radii, as macOS,
   Claude and ChatGPT have them; the `banda` theme sets them, and the
   platform themes keep their own system's numbers inside ADR 0080's five
   levels.

4. **Glass is one switch, on by default, over every theme.**
   - `glass = true` unless the Person turns it off, on every platform,
     GNOME included. It is Banda's look, not a system's.
   - Glass is not a theme. Each theme says its solid colours; the resolver
     derives its glass from them (ADR 0080, decision 8: the surfaces
     thinned, quiet text and lines as the text colour thinned). A theme
     may correct it under `[glass]`.
   - So every theme comes in four: light and dark, each solid and glass.
     `banda theme check` checks all four, contrast of text on each surface
     included, and refuses one that cannot be read. CI keeps a screenshot
     of each built-in theme in all four and compares.
   - Reduce transparency or high contrast, on the system, turns glass off
     by itself while they are on. Reduced motion turns motion off.
   - Who draws the glass stays as ADR 0030 has it: macOS and Windows their
     own material (Windows moves to Mica), Linux Banda's own, from the
     wallpaper.

5. **A theme of the Person's own is a folder; setting it is one line.**
   `~/.config/banda/themes/<name>/theme.toml`, and `theme = "<name>"` in
   `look.toml`. No menu is needed. Depth comes in layers, each optional:

   1. three seeds and `extends`: a whole theme that looks at home on every
      platform;
   2. `[shape]`, `[font]`, `[glass]`, `[tokens]`: any token by name
      (ADR 0080, decisions 3 and 5);
   3. `theme.css`: our shadcn components restyled by their `data-slot`.
      This is its own step, worked out later (decision 7).

   An Agent makes one with `banda theme new <name> --from <theme>`, sees
   the tokens with `show`, checks it with `check` and sees it with
   `banda theme shot`, a picture of a sample page in all four. Banda
   reloads the theme as the file changes. A topic in the Banda skill lists
   the tokens.

6. **The surface stays three things:** the theme, the mode and the glass,
   in the sidebar foot's menu (ADR 0067), each theme as a small preview.
   The rest is in files.

7. **`theme.css` is planned, not built yet.** It gives an Agent a whole
   look of its own, but its `data-slot` names become an API Banda keeps.
   Before it is built, its own short ADR settles the list of slots, how
   they stay stable, and that a theme's CSS loads nothing from the
   network (no `@import`, no remote `url()`), so a shared theme cannot
   watch the Person. It is web and desktop only; a phone takes the
   tokens.

## Steps

Each step is an issue and a PR.

0. **The split** (this ADR, decision 1), as the slice E4/E5 of the
   roadmap's stage 2: on the Mac, arc's keys and sidebar, the Mac's own
   theme.
1. `theme.toml`, `extends` and `"platform"`; the built-in themes move to
   it. Nothing on screen changes. (ADR 0080 step 1.)
2. The token list once, in `platform/theme`; CSS and TypeScript written
   from it; every token a value. (ADR 0080 step 2.)
3. The five radius levels; Banda's larger radii. (ADR 0080 step 3.)
4. Glass as a variant: the four per theme, `check` with contrast, the
   screenshots in CI, glass off under reduce transparency. Before the
   adapters, so each platform theme arrives in four, checked.
5. The adapters, in the research's order: platform detection and the
   portal; Hyprland read in full (`gaps_out`, borders, blur) and Omarchy's
   folder watched; then macOS (Tahoe's radii measured on Roma's Mac);
   then Windows (Mica), GNOME, KDE and niri (`config.kdl`). Each base
   theme names its adapter in its file, and the omarchy branch leaves
   `theme.rs`.
6. The surface and the tools: preview cards, `banda theme
   new | show | check | shot`, the skill topic.
7. Each theme tuned on its hardware: arc, the Mac, Win11; GNOME and KDE
   when a machine runs them.

Later: `theme.css` (its own ADR, decision 7); colour themes (Ocean,
Moss…); where the web works a theme out.

## Changes

- ADR 0080: decision 1's two levels become this three-way split; decision
  4's tree is decision 2 here, with `banda` as the root of every platform
  theme; decision 8's glass is on by default and checked in four; decision
  9's adapters keep their table, in the research's order; decision 10's
  surface is three things, and `theme.css` is added as a later layer. Its
  steps are replaced by the steps here.
- ADR 0089: the deferred "E5 resolves it on the host for v1" becomes
  "decided with the web".
- ADR 0007: decision 10's one `banda look` splits into the theme, worked
  out on the device, and the Person's settings, served by the engine.
