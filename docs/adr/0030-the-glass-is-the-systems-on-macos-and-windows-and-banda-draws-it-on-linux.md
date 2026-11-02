---
status: accepted
date: 2026-11-02
---

# The glass is the system's on macOS and Windows, and Banda draws it on Linux

ADR 0023 made the desk glass that Banda draws itself: the desktop's wallpaper, blurred in the page. It knows the wallpaper in two ways only: `[desk] wallpaper`, or Omarchy's current background. Anywhere else the desk is solid until the key is set (#190).

Every desktop keeps its wallpaper its own way:

- **GNOME** and its family: a setting, `org.gnome.desktop.background picture-uri`, another for dark (`picture-uri-dark`). Cinnamon and MATE keep the same under their own schemas. The picture may be an XML slideshow.
- **KDE Plasma**: `Image=` in `~/.config/plasma-org.kde.plasma.desktop-appletsrc`, a file or a wallpaper package (a folder of sizes, and of dark ones).
- **XFCE**: `last-image` in its `xfce4-desktop.xml`.
- **Hyprland** without Omarchy: `hyprpaper.conf`, or `swww`; swaybg keeps it only in its command line.
- **Windows**: a JPEG copy, `TranscodedWallpaper`, rewritten in place.
- **macOS**: `Index.plist` of `com.apple.wallpaper`; its own pictures are HEIC, which the page cannot draw, and its moving ones are no file at all.

The other way to glass is the window's: transparent where the desk is, the system blurring what is behind it (`material = "system"`, ADR 0023). Asked whether that would be simpler, it was weighed:

- It needs no wallpaper, shows what is really behind (other windows, a wallpaper per screen, a moving one), and lines up with the screen by itself (#193).
- Only the system can blur behind a window. Hyprland does, by its own setting for every window. GNOME does not, and KDE only for an app that asks, which Electron does not: there it would be a hole, not glass. macOS (vibrancy) and Windows 11 (acrylic, mica) have materials of their own, and the window asks for them.

Roma, 2026-11-02: "let's combine: on Mac and Windows take it natively, on Linux draw it ourselves".

## Decision

1. **Where the glass comes from goes by the platform.**
   - **Linux**: Banda draws it (`material = "banda"`), from the desktop's wallpaper (decision 2). Linux keeps its wallpaper in plain files and settings, and its compositors mostly do not blur.
   - **macOS and Windows**: the system's (`material = "system"`), as a material the window asks for (decision 4). Their wallpapers are hard to read, and their materials are the look of their own apps.
   - Unset, `[desk] material` takes the platform's. Set, it wins: `"system"` on Hyprland for its blur of what is behind, `"banda"` on a Mac with `[desk] wallpaper`.

2. **On Linux, each desktop is a reader of its wallpaper.** A reader says where the picture is, and which small files to follow: one of them changing means asking again. The look follows them as it follows Omarchy's link now, so a new wallpaper is new glass, with no daemon, D-Bus or native code.
   - The order: `[desk] wallpaper`, then Omarchy, then the desktop `XDG_CURRENT_DESKTOP` names.
   - **GNOME** (and Ubuntu's, Budgie, Pantheon), **Cinnamon** and **MATE**: their schema's key, through `gsettings`, which knows the schema's default too; it follows `~/.config/dconf/user`. An XML slideshow gives its first still picture.
   - **KDE Plasma**: `Image=` of the first desktop in `plasma-org.kde.plasma.desktop-appletsrc`, which it follows. A package gives its largest picture.
   - **XFCE**: the first screen's `last-image` in `xfce4-desktop.xml`.
   - **Hyprland's own tools**: `hyprpaper.conf`'s first `wallpaper`. swaybg and swww, kept in a process or a cache, come later if asked.
   - Several screens: the first one's. A picture per screen is #193's.
   - The look tells where it took the picture from (`desk: the wallpaper, from GNOME: …`), as `banda look` shows.

3. **A picture is known by its path and its time.** The page asks for it at `app://banda/desk/wallpaper?of=<path>&at=<modified>`, so a picture rewritten in place shows: KDE and others do it. A picture is followed by its size and time, not its bytes, which the look hashes every quarter second for its small files.

4. **macOS and Windows ask for their material** (with `material = "system"`): the window is transparent, with `vibrancy: "under-window"` on macOS and `backgroundMaterial: "acrylic"` on Windows 11. The page's tint and grain lie over it, as on Banda's glass. Windows 10 has no material: the desk is solid there. `blur` and `saturation` are the system's on these.

5. **What the page cannot draw stays solid, and says so.** It draws JPEG, PNG, WebP, AVIF, JPEG XL (GNOME's own wallpapers are JPEG XL; Electron 45 draws it, tried), GIF, BMP and SVG. A HEIC picture, or a desktop's solid colour, leaves the desk solid with a problem naming it. A small blurred copy made once by the desktop (ADR 0023, later) would draw them all.

## Steps

1. **Linux readers** (#190): GNOME's family, KDE, XFCE, hyprpaper; the picture's time in its address; where it came from.
2. **Dark wallpapers**: GNOME's `picture-uri-dark` and a KDE package's dark pictures, when Banda is dark. The look carries a second picture, as it carries both schemes when the system decides, and the page picks by the mode it shows. `[desk] wallpaper-dark` names one by hand; set, either key is the picture for both and the desktop's are not asked.
3. **macOS and Windows** (#192): the platform's material by default, vibrancy and acrylic, and Banda's grain over any glass. It is built here on Linux and has to be tried on a Mac and on Windows before it is called done; until then its PR waits.

## Consequences

- Banda looks like its platform: frosted by Banda on Linux, by the system on macOS and Windows. `blur`, `saturation` and `wallpaper` shape Banda's own glass only.
- A new Linux desktop is one reader, a few lines, and a test with a sample of its file.
- `gsettings` runs when the dconf file changes, which is when any setting changes; reading the binary database ourselves would miss the schemas' defaults.
- #193 (lining the picture up with the screen) is left to Linux, where Banda draws; macOS and Windows line up by themselves.
- ADR 0023's "a picture rewritten in place shows from the next change of the look" no longer holds: it shows at once (decision 3).
