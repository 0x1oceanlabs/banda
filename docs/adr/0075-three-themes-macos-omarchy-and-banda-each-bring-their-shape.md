---
status: accepted
date: 2026-11-06
---

# Three themes, macOS, Omarchy and Banda, each bring their shape

On a Mac the glass works since #241, but Banda does not look at home there. Its shape (2 px borders, 14 px corners, 12 px gaps, Inter 14, a grey accent) is the one made for Hyprland's tiles. And the shape depends on the glass. Under Hyprland a solid desk takes Hyprland's gaps (5 px on Omarchy). A glass desk resets them to Banda's 12 (ADR 0023). Turning the glass on moves every tile.

A theme today is a palette (ADR 0007), and its `banda.toml` may carry shape, but none does. So the shape comes from defaults, Hyprland and the glass, and nobody chose it as a whole.

Roma, 2026-11-05: "let's think the themes through: macOS's own dark and light, tuned for the Mac; the Omarchy theme takes Omarchy's; there is no unity yet". On the mock, Roma kept the macOS theme as shown, with the sidebar as a floating glass panel. Colour themes wait. Roma picked blue as Banda's accent.

## Decision

1. **A theme is colours and shape.** Banda ships three, each light and dark:

   | | colours | shape |
   |---|---|---|
   | `macos` | the system's: window, text, separators, and the accent from System Settings | the Mac's: the system font at 13, 1 px lines, gaps 8, tiles rounded 10, bar 38 |
   | `omarchy` | Omarchy's current theme (ADR 0007) | Hyprland's rounding, border, gaps and dimming (ADR 0007, decision 8), Omarchy's font and wallpaper |
   | `banda` | neutral greys with a blue accent (decision 4) | Inter at 14, 1 px lines, gaps 8, tiles rounded 10, bar 36 |

   Banda's and the Mac's shape are the same, except for the font and the bar. So the three look like one family.

2. **Each platform starts on its own theme.** Unset, `theme` is `"macos"` on macOS, `"omarchy"` where Omarchy is, and `"banda"` everywhere else (Windows, other Linux). Any of the three can be picked anywhere. On a Mac, `macos` reads its colours from the system; elsewhere it shows its defaults.

3. **The glass changes the background, never the shape.** Gaps, corners and borders are the theme's, glass or not. Hyprland's settings are a layer only under the `omarchy` theme: the `hyprland` key's default is whether the theme is `omarchy`. ADR 0023's reset of the gaps over glass goes. Over glass the tiles and menus stay solid (`[tile] opacity = 1`); the desk, the bar and the sidebar's panel are the glass.

4. **Banda's colours.**

   | | light | dark |
   |---|---|---|
   | desk | `#f4f4f5` | `#111113` |
   | tile | `#ffffff` | `#19191c` |
   | sidebar, menus | `#fafafa` | `#202024` |
   | text, quieter | `#18181b`, `#71717a` | `#ededef`, `#a1a1aa` |
   | lines | black 8 % | white 8 % |
   | accent | `#0b6fe0` | `#4ea3ff` |

   The accent marks the focus, the selection and links. The main buttons take the text's colour, as shadcn's do, so the accent stays rare and shows. "Needs you" keeps its orange, the `attention` colour.

5. **The focused tile is outlined, not framed.** One pixel of the accent and a soft shadow, where the border was 2 px. The `omarchy` theme keeps Hyprland's border as the focus, as its windows show it.

6. **The Mac's accent follows the system.** The window reads the accent (`systemPreferences.getAccentColor()`) and tells the page when it changes. The `macos` theme's accent is the system's, with Apple's blue when there is none. `[colors] accent` in `look.toml` still wins.

7. **A theme's shape is its `banda.toml`.** `macos` and `banda` say theirs in their own files in `look/themes/`, as examples for a Person's theme. Keys in `look.toml` still win over every theme.

## Steps

Each step is an issue and a PR.

1. #601 The glass does not change the gaps, and Hyprland's layer comes only with the `omarchy` theme (decision 3).
2. #602 Banda's shape: gaps 8, tiles 10, 1 px lines, solid tiles, the focus outlined (decisions 1, 3 and 5).
3. #603 Banda's colours, light and dark, with the blue accent (decision 4).
4. #604 The `macos` theme: its colours and shape, the default on a Mac (decisions 1 and 2).
5. #605 The Mac's accent, live (decision 6).

## Later

- Colour themes on top of the platform's shape (Ocean, Moss and so on), when Roma wants them.
- A Windows theme of its own: Segoe UI, its title bar (`titleBarOverlay`).
