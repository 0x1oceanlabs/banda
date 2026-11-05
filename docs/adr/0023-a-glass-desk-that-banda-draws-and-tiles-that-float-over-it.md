---
status: accepted
date: 2026-11-01
---

# A glass desk that Banda draws, and tiles that float over it

Roma, on 2026-11-01:

> the bottom part the windows ride on should be glass with blur, showing the wallpaper, and the windows should fly over it as a second layer
>
> the overall concept is the new macOS style and Linux ricing with glass terminals: a modern modular workspace, light and flying

Seeing a mock of three sidebars over the wallpaper (on the desk, a floating glass panel, a rail that slides out), Roma liked the first two, both: "we can make both". The tiles: "I'd lower the opacity of all of them". And how: "go the way of the config, so the Person can tune it; we just give them a beautiful default".

**What is there now.**

- The window is opaque. The page paints `--background`, and the desk under the Strip is `bg-muted/40` over it.
- Under Hyprland, Roma's config puts `banda-desktop` into Omarchy's `o.transparent_window`, as terminals are. That rule makes the whole window translucent: the tiles, the text and the code too, not the desk alone.

**Where glass can come from.** CSS's `backdrop-filter` blurs only what is inside the page; the wallpaper is outside it. Real see-through glass is the system's, and it is not the same anywhere:

- Linux: only the compositor blurs. Hyprland blurs every translucent window by one strength, for the whole system; GNOME and most others do not blur at all. Electron cannot ask a compositor for a blur of its own.
- macOS has vibrancy and Windows 11 acrylic and mica: ready materials, whose blur an app does not choose.

The first build made the glass Hyprland's. Roma, seeing that its blur is Hyprland's setting: "stop, we won't use it on Hyprland only. There must be Banda's look of glass."

## Decision

1. **Two layers** (_built_).
   - The desk is the bottom layer: the bar and the space between and around the tiles. It is glass, and it shows the blurred wallpaper.
   - The tiles are the second layer. They float over the desk with a hairline, and they are a little translucent. Only the sidebar's panel casts a shadow by default (decision 3).
   - The focused tile keeps its border in the focus colour (ADR 0007).

2. **Banda draws its glass itself, from the wallpaper** (_built_). Roma chose it over the system's glass, which stays a choice (`material = "system"`).
   - The picture is the desktop's wallpaper: Omarchy's current background, its link followed, so a new background is new glass. `desk.wallpaper` names a picture of one's own. Without a picture Banda knows, the desk is solid.
   - The window stays opaque. The page draws the picture under everything, blurred by `desk.blur` and saturated by `desk.saturation`, with a fine grain (`desk.grain`) so it reads as a material and not as a blurred photo. The desk's tint, `--background` at `desk.opacity`, lies over it.
   - The desktop serves the picture to the page at `app://banda/desk/wallpaper`: the look's picture and no other file, whatever the address asks. The path in the address only tells a new picture from the old one.
   - It looks the same on every desktop, and every part of it is a key.
   - What it gives up: other windows behind Banda do not show, only the wallpaper; and on Wayland a window does not know where it is on the screen, so the picture covers the window, rather than lining up with the wallpaper around it. Banda is mostly a whole screen or a tile of one, with only wallpaper behind it.
   - `material = "system"` is the first build's glass: the window is made transparent (`transparent: true`), and the compositor blurs what is behind it. Electron chooses that once, when it makes the window, so turning it on shows from the next start; a page shows the system's glass only where its own window lets the desktop through.
   - The three surfaces are tokens, `--desk`, `--panel` and `--tile`: solid by default, and made glass in one place (`html[data-glass]`). The next glass surface takes a token rather than new classes.

3. **The keys, in `look.toml`** (_built_). Everything a Person tunes is a key, and Banda's defaults are the beautiful ones:

   ```toml
   [desk]
   glass = true          # solid without a wallpaper Banda knows
   material = "banda"    # "system": the compositor's glass, from the next start
   # wallpaper = "~/Pictures/wall.jpg"   # unset: the desktop's own
   blur = 40             # how frosted: the blur, in pixels
   saturation = 1.4      # the wallpaper's colours: 1 as they are, 0 grey
   grain = 0.04          # a fine grain over the glass: 0 none
   opacity = 0.4         # the desk's tint over the blurred wallpaper: 0 clear, 1 solid
   sidebar = "panel"     # "panel": a floating glass panel; "desk": its rows right on the glass
   sidebar-shadow = 0.45 # the panel's shadow: 0 none, 1 the darkest

   [tile]
   opacity = 0.95        # a tile over the desk, with glass on; 1 is solid
   shadow = 0            # a tile's shadow on the desk: 0 none, 1 the darkest
   ```

   - `desk.glass` is on by default everywhere: Banda's glass needs no compositor, only a picture.
   - `desk.blur` frosts the sidebar's panel too: the tiles that go under it blur as the wallpaper does.
   - `tile.opacity` works only with glass on. Without glass, a translucent tile would only change its colour.
   - Roma, seeing the tiles at 0.85: "the windows are too transparent". The default is 0.95: the glass shows at their edges and under the tint, and the text sits on an almost solid tile.
     - _Changed on 2026-11-06, by ADR 0075._ The tiles and menus are solid over glass (`[tile] opacity = 1`), as a Mac's windows are; the desk, the bar and the sidebar's panel are the glass.
   - Shadows are keys too, and glass casts them only. Roma: "the panels can do without, keep it on the sidebar only by default". The tiles stand out by their density and hairline. The panel, which floats over the tiles, keeps a shadow to show it is on top.
   - The Strip clips what goes past its edge, so a tile's shadow shows only as far as the outer gap.
   - The panel sidebar sits between the two: its opacity is halfway between the desk's and the tiles'. That way the order holds: the desk is the clearest, the panel is frosted, and the tiles are the densest.
   - Over glass the tiles float, so the air between them is Banda's `[gaps]`, 12 pixels by default. Hyprland's `gaps_in` is for windows that touch the screen; Banda takes it only on a solid desk.
     - _Changed on 2026-11-06, by ADR 0075._ The glass changes the background, never the shape: the gaps are the theme's, and Hyprland's are taken, glass or not, only under the `omarchy` theme.

4. **The sidebar floats over the Strip** (_built_). Roma, seeing tiles cut off at the sidebar's edge: "the sidebar must be on top".
   - The Strip runs the whole width of the window, under the sidebar. Its columns start past the sidebar, and their widths and scrolls count only the room that shows beside it.
   - A column scrolled to the left goes on under the sidebar, which blurs it (`backdrop-filter`), rather than being cut off at an edge.
   - Hidden, the sidebar leaves the Strip the whole width.

5. **Banda's window leaves Hyprland's whole-window transparency** (_built for Roma's config_).
   - `o.transparent_window` fades everything: the tiles, the text and the code. Banda's glass is in the page, only where it should be.
   - Roma's `looknfeel.lua` drops `banda-desktop` from it.

6. **What floats over the window is glass too** (_built_, 2026-11-02). Roma, asked what the window still lacks, chose this first.
   - Menus, dialogs, the Banda menu, the composer's suggestions and toasts are all `bg-popover`. Their surface is a fourth token, `--floating`: the popover's colour, solid, and on glass as clear as the sidebar's panel (halfway between the desk and the tiles), frosted by `desk.blur` and `desk.saturation`.
   - One rule frosts the sidebar's panel and every `bg-popover` under `html[data-glass]`, by the same blur and saturation, so a new menu is glass without a class of its own. A popover inside another is frosted by it, not twice.
   - The current row in the sidebar, and the chosen Space, are drawn as tiles (`bg-tile`), not as the background: on glass a block of solid black in the panel was the one heavy thing in it. On a solid desk they look as before.
   - No new key: a floating surface takes the panel's glass, so `desk.opacity` and `tile.opacity` tune it too.

7. **Every Pane is the same glass: the terminal and the browser too** (_built_, 2026-11-02). Roma: "make all the windows a little see-through by default, so nothing stands apart, even the browser; exceptions can come later in the config".
   - A terminal leaves its default background clear (a canvas with alpha, cleared where Ghostty would paint the default background), so its tile shows through as under a Thread. Cells of another colour still fill. On a solid desk the tile is the background, so it looks as before. The cost: a canvas with alpha draws its text with greyscale antialiasing, not subpixel, on a solid desk too.
   - A browser's page lives in the window's layer, over its slot (ADR 0013). Over a tile it would be a glass over a glass, almost solid; so a Pane that holds a page leaves its tile clear (`[data-tile]:has([data-holds])`) and paints the tile itself on its row, its tabs and its notices. On glass the page takes the tile's opacity (`[data-held-by]`); the whole page fades, its text too, as a webview gives no other way, so it reads a shade softer than a Thread.
   - The settings Pane no longer paints a background of its own over its tile.
   - Exceptions, a Pane kind kept solid (a video, say), are a key for later.

8. **Not here, next.**
   - The rail sidebar (the mock's third one).
   - The wallpaper on other desktops: ADR 0030 reads it on Linux, and takes the system's glass on macOS and Windows.
   - Lining the picture up with the wallpaper around the window, where the window knows its place on the screen (X11, macOS, Windows).
   - The system's glass on macOS and Windows: vibrancy, acrylic (ADR 0030).

## Consequences

- Banda's glass costs the page one blur of a still picture, drawn once and kept; the panel's blur is drawn again only when what is under it moves. The system's glass costs the compositor a blur pass behind the window.
- The look follows the wallpaper by where its link goes, not by the picture's bytes, so a new background is new glass; a picture rewritten in place shows from the next change of the look.
- The page decodes the whole picture to blur it. A small picture, blurred once by the desktop, would cost less memory and nothing on resize: a step for later, if the blur shows in use.
- Readability is a tile's: the text sits on the tile, at 95% by default, over a desk that is already blurred.
