---
status: accepted
date: 2026-11-11
---

# The desk's density is measured over the wallpaper Banda draws

_It amends ADR 0100 (decision 8: how dense glass is made so that its text
reads) and adds to ADR 0030 (decision 1: on Linux, Banda draws the glass
from the wallpaper)._

ADR 0100 decision 8 measured the text on glass over the worst backdrops,
white, black and a mid grey, because the wallpaper was not known. Step 4b
built that, and it took most of the glass away: the desk under the
tokyo-night theme went from 40% to 86% solid, Banda's own from 40% to 57%
light and 67% dark. Of the options put to Roma in #1393, Roma chose on
2026-11-11 to measure over the wallpaper Banda really draws. Until this is
built, 4b leaves the desk's text and the sidebar panel's text out of the
check over Banda's glass, and makes no tint denser.

## Decision

1. **Only on Linux, where Banda draws the glass** (`material = "banda"`,
   ADR 0030). On macOS and Windows the system's material is under the
   desk, tinted by the system to read in its mode. The desk there keeps
   its `opacity`, and nothing here changes.

2. **The desk's density is the first that reads over the wallpaper.**
   The resolver searches in thousandths, from the theme's `[desk]
   opacity` up, for the first density at which the desk's text reads over
   every pixel of the wallpaper as Banda draws it. "Reads" is decision 8's:
   4.5:1 for text, 3:1 for quiet text and the accent's marks.
   - **Floor:** the theme's `opacity`. A wallpaper that agrees with the
     theme leaves the desk as clear as the theme says.
   - **Ceiling:** the density the worst backdrops would ask for, the old
     rule. So the desk is never denser than before, and its text never
     reads worse.

3. **The panel follows the same rule, over the desk as it ends.** The
   sidebar's panel keeps its share, halfway between the desk and the
   tiles. Only where its text does not read over the measured wallpaper,
   under the desk, is it made denser by the same search, with the same
   floor and ceiling.

4. **The whole picture is measured, blurred as the page draws it.** The
   window can sit anywhere on the screen, any size, and the desk shows in
   the bar, the gaps, around the tiles and under the sidebar. So every
   pixel of the picture counts:
   - blurred by `[desk] blur` and saturated by `[desk] saturation`, as the
     page does;
   - at the picture's own size, as the resolver does not know the screen's;
   - without the grain, which is ±4% and evens out under text;
   - the light picture for the light scheme, the dark one, when there is
     one, for the dark (ADR 0030, step 2).

5. **It is measured again when the picture changes.** The look already
   follows the wallpaper by its path and time (ADR 0030, decisions 2 and
   3), so a new picture is a new density. What a picture measures is kept
   by its path and time, so a look resolved again for any other reason
   does not read the picture again.

6. **A picture the resolver cannot read takes the ceiling.** The page
   draws more kinds of picture than the resolver decodes: JPEG XL, AVIF
   and SVG, for now. Over those, as over any picture it fails to read, the
   desk takes the old rule's density. It is never less readable than
   before.

7. **`check` measures over what the resolver measured.** Over Banda's
   glass it checks the desk's and the panel's text over the wallpaper's
   pixels, and the rest over the worst backdrops as before. A theme is
   still refused only for its own text on its own grounds.

## Rejected

- **Only the pixels under the top bar.** It asks less: tokyo-night on
  Roma's `cafe-at-night` would be 0.772, not 0.809. But the desk is not
  only the bar. Its gaps, the ground around a narrow tile and the sidebar's
  panel lie over the rest of the picture, wherever the window is. Text
  there would not read.
- **A density per part of the desk**, dense over the bright parts of the
  picture and clear elsewhere. It would change as tiles move, and needs
  the window's place on the screen, which Banda does not know on Linux
  (#193).
- **The worst backdrops, as decision 8 had it.** It reads everywhere,
  and leaves little glass: what 4b showed.

## What it gives

Measured with decision 8's thresholds:

| wallpaper | theme | the old rule | this |
|---|---|---|---|
| Roma's `cafe-at-night` (dark, with bright lights) | banda light | 0.571 | 0.526 |
| | banda dark | 0.673 | 0.565 |
| | omarchy, tokyo-night | 0.857 | 0.809 |
| a light wallpaper | banda dark | 0.673 | 0.673 |
| | omarchy, tokyo-night | 0.857 | 0.857 |
| a dark wallpaper | banda light | 0.571 | 0.571 |
| | banda dark | 0.673 | 0.40 |
| | omarchy, tokyo-night | 0.857 | 0.40 |

In plain words: **the desk stays at 0.40 only where the wallpaper agrees
with the theme**, dark under a dark theme, light under a light one.
Elsewhere it is nearly as dense as the old rule. A dark theme over a
wallpaper with one bright spot gets little glass back: tokyo-night on
Roma's wallpaper is 0.809, not 0.857. This rule keeps the text readable;
it does not bring the glass back.

## Consequences

- The resolver reads pictures (`image`, already in the workspace, for
  JPEG, PNG, WebP, GIF, BMP and TIFF), blurs them and keeps what it
  measured: the look's first read of a picture's pixels, where it
  followed only its path and time.
- A Person who wants more glass than this gives sets `[desk] opacity`
  and `[glass.tokens]` by hand. The resolver never makes a desk clearer
  than the theme says.
- The shots in CI (ADR 0100, step 4c) use a fixed backdrop of white, mid
  grey and black, so their desk is at the ceiling. A test with a picture
  that agrees with the theme shows the floor.

## Changes

- ADR 0100, decision 8: over Banda's glass, the desk and the panel are
  measured over the wallpaper Banda draws, not over the worst backdrops.
  Over the system's material and on the tiles, decision 8 holds as it is.
- ADR 0030, decision 1: on Linux, Banda draws the glass from the
  wallpaper and also measures it, to set the desk's density.

## Steps

1. The density over the wallpaper: read the picture, blur and saturate
   it, search; the panel; `check` over it. A visible change: shots first,
   no auto-merge.
