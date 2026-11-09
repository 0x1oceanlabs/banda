# Platform themes: what each system says, and how Banda follows it

Research for ADR 0080 (decision 4: platform bases; decision 9: adapters).
Date: 2026-11-09. No code changed. Read first: ADR 0075, ADR 0080,
`platform/look/src/{theme,hyprland,tokens,palette}.rs`, `look.toml`,
`client/desktop/src/main.ts` (accent and material code).

Legend: **checked** = seen on this machine (arc: Omarchy, Hyprland 0.56.2,
xdg-desktop-portal 1.22.1 with the gtk + hyprland backends).
**sourced** = from a cited page. **guess** = my reading, to be checked.

---

## 0. What Banda has today (the starting point)

- `hyprland.rs` asks Hyprland's socket for `decoration:rounding`,
  `general:border_size`, `general:gaps_in`, dim, `animations:enabled`, and
  listens on `.socket2.sock` for `configreloaded>>`. It does **not** read
  `gaps_out` (a CSS-like `"10 10 10 10"` string here), `rounding_power`,
  `blur:*`, `active_opacity` or `col.active_border`.
- `theme.rs` finds Omarchy by `~/.local/state/omarchy/current/theme/colors.toml`
  (then `~/.config/omarchy/current/theme`) and the omarchy branch hard-codes
  `hyprland = true`, `focus.shadow = 0` (ADR 0080 wants this in a file).
- `main.ts` `accentOf()` reads `systemPreferences.getAccentColor()` on
  macOS and Windows only, live via `AppleColorPreferencesChangedNotification`
  (mac) and `accent-color-changed` (win). **Linux returns `null`.**
- Mode: Banda sets `nativeTheme.themeSource` itself from the look; it does
  not read the system's mode on Linux from the portal.
- Material: mac `vibrancy: "under-window"`, Windows 11 22H2+
  `backgroundMaterial: "acrylic"`, Linux a transparent window + Banda's own
  wallpaper glass (ADR 0030).
- Electron is 45.1.0.
- `wallpaper.rs` already shells to `gsettings` for GNOME/Cinnamon/MATE.

Checked on arc right now:

```
XDG_CURRENT_DESKTOP=Hyprland  XDG_SESSION_DESKTOP=Hyprland  DESKTOP_SESSION=omarchy
portal ReadAll org.freedesktop.appearance -> { contrast: 0, color-scheme: 1 }   (no accent-color!)
gsettings org.gnome.desktop.interface: color-scheme 'prefer-dark', accent-color 'blue',
  font-name 'Adwaita Sans 11', monospace-font-name 'Adwaita Mono 11', enable-animations true
hyprctl: rounding 12, rounding_power 2.0 (unset), blur on (size 4), gaps_out "10 10 10 10",
  col.active_border gradient "ff7aa2f7 0deg"
omarchy-font-current -> "JetBrainsMono Nerd Font"
~/.local/state/omarchy/current/{theme/, theme.name, theme.generation, background}
~/.config/omarchy/hooks/{theme-set.d, font-set.d, ...}
Hyprland config is Lua (~/.config/hypr/*.lua)
```

---

## 1. Shared Linux layer: xdg-desktop-portal Settings

This is the one source every Linux base should read first.

**Interface** `org.freedesktop.portal.Settings` on
`org.freedesktop.portal.Desktop` `/org/freedesktop/portal/desktop`
(session bus). Methods `ReadAll(as)`, `ReadOne(ss)` (v2), signal
`SettingChanged(s namespace, s key, v value)` — **live**.
[portal docs]

| key (`org.freedesktop.appearance`) | type | values |
|---|---|---|
| `color-scheme` | `u` | 0 no preference, 1 prefer dark, 2 prefer light |
| `accent-color` | `(ddd)` | sRGB 0..1; out of range = unset |
| `contrast` | `u` | 0 normal, 1 higher |
| `reduced-motion` | `u` | 0 no preference, 1 reduced |

- `accent-color` came in portal 1.17.1 / 1.18 [phoronix].
- What each backend fills differs: **KDE** gives `color-scheme`,
  `accent-color`, `reduced-motion` (from `[KDE] AnimationDurationFactor == 0`),
  **no `contrast`** [kde settings.cpp]. **GNOME** gives color-scheme,
  accent-color (GNOME 47+), contrast from `org.gnome.desktop.a11y.interface
  high-contrast` [gnome commit, gnome #119]. The **gtk backend** used on
  Omarchy gives only color-scheme + contrast (checked: no accent).
- The GNOME backend also relays `org.gnome.desktop.interface` keys
  (`font-name`, `monospace-font-name`, `text-scaling-factor`,
  `enable-animations`) through the same portal — guess based on how
  toolkits use it; verify with `ReadAll ["org.gnome.*"]` on a GNOME box.
  A 2024 Ubuntu bug said the portal reported `enable-animations` wrong
  [ubuntu bug].

**How to read in Rust:** `zbus` directly, or the `ashpd` crate
(`desktop::settings::Settings`, `color_scheme()`, `accent_color()`,
`contrast()`, `receive_*_changed()` streams) [ashpd]. `mundy` and
`system-theme` crates do the same with gsettings fallbacks [mundy].
This fits `banda look --follow`: one more listener beside the Hyprland
socket.

**What Electron already gives on Linux (45.x):**
- `nativeTheme.shouldUseDarkColors` follows the portal's color-scheme
  (Electron #38977 added portal detection), but a July 2026 report on
  Electron 42 / KDE says it did **not** update live [claude issue 79995,
  electron #25925]. Banda overrides `themeSource` anyway, so do not lean on it.
- Accent: Chromium pumps the portal accent into CSS `AccentColor` on Linux
  [chromium change]; Electron lists `accent-color-changed` as _Windows,
  Linux_ and has Linux `getAccentColor` work (#48628, late 2025)
  [electron docs, electron releases]. The doc heading still says "macOS
  10.14+". So `accentOf()`'s Linux `null` is now Banda's choice, not a
  limit — but reading the portal in Rust is better (one source, testable,
  also gives contrast/motion and works on the web client later).
- `nativeTheme.prefersReducedTransparency` has no platform tag; on Linux
  there is no such system setting, so expect `false`. guess
- `getAnimationSettings().prefersReducedMotion` exists on all platforms
  [electron system-preferences]; on Linux Chromium maps it from GTK —
  prefer the portal key.

**Recommendation:** a `portal` adapter in the `look` crate, shared by
`linux`, `gnome`, `kde`, `hyprland`, `niri`, `omarchy`. Fallback when a key
is missing: `gsettings get org.gnome.desktop.interface color-scheme /
accent-color` (checked: gsettings has `accent-color 'blue'` on arc even
though the gtk portal does not export it). GNOME's accent names map to
libadwaita hexes (table in §4).

---

## 2. macOS (Tahoe, 26)

**1. What to follow**
- Mode: Light/Dark/Auto. Accent (8 colours + multicolour) and a separate
  highlight (selection) colour.
- System colours: window background, control background, label, secondary
  label, separator, selected content background, etc.
- Font: SF Pro, body 13 pt; mono SF Mono. guess (Apple HIG; not re-sourced)
- Radii: windows larger in Tahoe; concentric controls; capsule buttons in
  toolbars.
- Accessibility: Reduce transparency, Increase contrast, Reduce motion,
  Differentiate without colour.

**2. How to read (Electron main) and live?**

| input | API | live |
|---|---|---|
| mode | `nativeTheme.shouldUseDarkColors`, `updated` event (with `themeSource = "system"`) | yes |
| accent | `systemPreferences.getAccentColor()` + `subscribeNotification("AppleColorPreferencesChangedNotification")` (already in `main.ts`) | yes |
| selection | `systemPreferences.getColor("selected-content-background")`, `getUserDefault("AppleHighlightColor","string")` | yes, same notification |
| window / text / lines | `getColor("window-background" / "label" / "secondary-label" / "separator" / "control-background")`, `getSystemColor("blue"…)` | re-read on `nativeTheme.updated` |
| increase contrast | `nativeTheme.shouldUseHighContrastColors` | yes (`updated`) |
| reduce transparency | `nativeTheme.prefersReducedTransparency` (old `accessibilityDisplayShouldReduceTransparency` is deprecated) | re-read on `subscribeWorkspaceNotification("NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification")` — guess, check |
| reduce motion | `getAnimationSettings().prefersReducedMotion`; CSS `prefers-reduced-motion` | same workspace notification — guess |
| font | CSS `system-ui` / `-apple-system` → SF Pro; `ui-monospace` → SF Mono | n/a |

Sources: [electron native-theme], [electron system-preferences].
Important for ADR 0080 decision 7: `getColor` returns `#RRGGBBAA`
(a real value), so these can be resolver *inputs*, not `var()`.

**3. Shape (Tahoe)**
- Window radius depends on window style: windows with a toolbar are much
  rounder than title-bar-only windows [lapcat ×2, WWDC25 310]. A hidden
  default setting is said to be 26 for Tahoe, 20 for a beta, 10 before
  [macrumors] — community number, not Apple's.
- Banda hides the title bar and puts traffic lights in its own bar → it
  looks like a "toolbar window", so the larger radius applies. **Measure
  on Roma's Mac** (ADR 0080 step 7 already says so).
- Concentric rule: inner radius = outer − inset [WWDC25 310, kirby].
  Matches ADR 0080 decision 6 exactly.
- Controls: bordered buttons are capsules by default in SwiftUI on 26;
  AppKit gains `NSControl.BorderShape`, `.extraLarge` size [axiom ref,
  1024jp deck]. So `pill = true` for the macos base is right; regular
  controls still ~ rounded rect. guess for exact px.
- Bar 38 (ADR 0075), font 13, gaps 8.

**4. Translucency**
- Native vibrancy (`vibrancy: "under-window"`, or `"sidebar"` for the
  sidebar) — already used. Tahoe's Liquid Glass (`NSGlassEffectView`) is
  not exposed by Electron as far as found. unknown
- Default: glass **on** under the system material, tint 0.1 (Roma tried
  it 2026-11-03).
- Reduce transparency: the system makes vibrancy opaque itself; Banda
  should also force its own `[desk] glass` off and drop the tint. Yes,
  force off.

**5. Detect:** `process.platform === "darwin"` (Rust: `cfg!(target_os = "macos")`, already `Places::mac`).

---

## 3. Windows 11

**1. What to follow**
- Mode: apps light/dark (`AppsUseLightTheme`) and system light/dark
  (`SystemUsesLightTheme`), separately.
- Accent (and "show accent on title bars" `ColorPrevalence`).
- Transparency effects on/off (`EnableTransparency`).
- Contrast themes (forced colours).
- Font: Segoe UI Variable; mono Cascadia Mono/Code (or Consolas). guess
- Text size ("Make text bigger") and animation effects.

**2. How to read and live**

| input | API | live |
|---|---|---|
| mode | `nativeTheme.shouldUseDarkColors` (apps), `shouldUseDarkColorsForSystemIntegratedUI` (system), `updated` | yes |
| accent | `systemPreferences.getAccentColor()` + `accent-color-changed` (already) | yes |
| system colours | `systemPreferences.getColor("window" / "window-text" / "highlight" / "3d-face" …)`, `color-changed` event | yes |
| high contrast | `nativeTheme.shouldUseHighContrastColors`, `inForcedColorsMode` | yes (`updated`) |
| transparency off | `nativeTheme.prefersReducedTransparency` (Chromium maps it from the system's transparency effects — guess); raw: `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency` | re-read on `updated` / `color-changed` — verify |
| reduce motion | `getAnimationSettings().prefersReducedMotion` ("Animation effects") | verify |
| raw registry | `HKCU\...\Themes\Personalize\AppsUseLightTheme`, `HKCU\Software\Microsoft\Windows\DWM\AccentColor` (ABGR DWORD) | needs `RegNotifyChangeKeyValue` — only if Electron lacks something |
| WinRT | `Windows.UI.ViewManagement.UISettings.GetColorValue(Accent…)`, `ColorValuesChanged`, `AdvancedEffectsEnabled`, `TextScaleFactor` | yes, but needs a native helper (Rust `windows` crate) |

Sources: [electron docs], [MS UISettings], [elevenforum ×2].
Electron covers the main needs; a Rust helper is only for
`TextScaleFactor` if wanted.

**3. Shape** [MS geometry]
- Top-level windows, flyouts, dialogs, menus: **8 px** (at 96 DPI, scales
  with DPI). In-page controls (buttons, list rows), tooltips, bars:
  **4 px**. A flyout attached on one side keeps that side square.
- Not pills (except toggle switches). → `window = 8`, `control = 4`,
  `pill = false`.
- Fluent 2 (web) says 4 px default, 8/12 for large — differs; use the
  Windows 11 page.
- Spacing: 4 px grid, cards 8 apart, page margins 24–56. guess
- Title bar: `titleBarOverlay` + `titleBarStyle: "hidden"` for Windows'
  own min/max/close (ADR 0075 "Later").

**4. Translucency**
- Electron `backgroundMaterial`: `"mica"` (main window, cheap, wallpaper
  tint), `"acrylic"` (transient surfaces), `"tabbed"` (Mica Alt).
  Microsoft uses Mica for the main window. Banda uses acrylic today;
  consider **mica** as the windows base default (closer to native,
  cheaper). guess on look; try on Win11.
- Win10: no material → solid.
- Transparency effects off / battery saver: Windows itself turns Mica to
  solid; Banda should force its glass off. Yes, force off.

**5. Detect:** `process.platform === "win32"`; Win11 by build ≥ 22000,
materials need ≥ 22621 (already checked in `main.ts`).

---

## 4. GNOME (GNOME 48/49, libadwaita 1.7/1.8)

**1. What to follow**
- Mode (`color-scheme`: `default` / `prefer-dark` / `prefer-light`),
  accent (9 named colours since GNOME 47), high contrast, reduce
  animations, UI font + mono font + text scaling.
- No user setting for radii; libadwaita fixes them.

**2. How to read and live**

| input | source | live |
|---|---|---|
| mode | portal `color-scheme`; fallback `gsettings org.gnome.desktop.interface color-scheme` | portal signal / `gsettings monitor` |
| accent | portal `accent-color` (rgb); fallback gsettings `accent-color` name → libadwaita hex | yes |
| high contrast | portal `contrast`; `org.gnome.desktop.a11y.interface high-contrast` | yes |
| reduced motion | portal `reduced-motion`; `org.gnome.desktop.interface enable-animations` (inverse) | yes |
| fonts | `org.gnome.desktop.interface font-name` ("Adwaita Sans 11"), `monospace-font-name` ("Adwaita Mono 11"), `text-scaling-factor` | `gsettings monitor org.gnome.desktop.interface` (a long-running child) or GIO/dconf D-Bus `ca.desrt.dconf.Writer` `Notify` signal |

Notes: font size is in **points** (11 pt ≈ 14.7 px at 96 dpi → Banda's
`[font] size` is px; convert ×4/3, then × text-scaling-factor).

libadwaita accent hexes [libadwaita css-variables]: blue `#3584e4`,
teal `#2190a4`, green `#3a944a`, yellow `#c88800`, orange `#ed5b00`,
red `#e62d42`, pink `#d56199`, purple `#9141ac`, slate `#6f8396` (each has
a separate "standalone" text colour for light/dark, e.g. blue `#0461be` /
`#81d0ff` — good seeds for `accent` on text vs fill).

**3. Shape**
- `--window-radius: 15px` in current libadwaita [css-variables]
  (older releases 12). Cards ~12; buttons ~6–9 — **read
  `_common.scss` / check in a GNOME VM**; not found in sources.
- `.pill` class for big pill buttons only; ordinary buttons are not pills.
- High contrast raises `--border-opacity` 15% → 50%, `--dim-opacity`
  55% → 90% [css-variables] — a good model for Banda's contrast derive.
- Fonts: Adwaita Sans (a modified Inter) + Adwaita Mono (a modified
  Iosevka) since GNOME 48 [twig 185]. Banda's Inter is already near.
- Spacing: 6/12/18/24 multiples. guess

**4. Translucency**
- Mutter blurs nothing for clients (no blur protocol; extensions like
  Blur my Shell only blur the shell). Banda's own wallpaper glass works
  (`wallpaper.rs` reads `org.gnome.desktop.background`).
- Native GNOME apps are solid → default glass **off** for the gnome base.
- No reduce-transparency setting; treat high contrast as "glass off".

**5. Detect:** `XDG_CURRENT_DESKTOP` contains `GNOME` (Ubuntu: `ubuntu:GNOME`;
also `GNOME-Classic`, `GNOME-Flashback`). Not Unity/Pantheon/Budgie/COSMIC
(those → plain `linux` base).

---

## 5. KDE Plasma 6

**1. What to follow**
- Colour scheme (full palette, not just mode), accent (manual or from
  wallpaper), fonts (general + fixed + size), animation speed, Breeze
  radii, KWin blur.

**2. How to read and live**

| input | source | live |
|---|---|---|
| mode | portal `color-scheme` (derived from palette) | portal signal |
| accent | portal `accent-color`; raw `~/.config/kdeglobals [General] AccentColor=r,g,b` | portal signal; raw: KConfig notify (below) |
| palette | `kdeglobals [Colors:Window] BackgroundNormal/ForegroundNormal`, `[Colors:View] BackgroundNormal` (tiles), `[Colors:Selection] BackgroundNormal` (= accent), `[Colors:Button]`, `[Colors:Tooltip]`, `ForegroundInactive` (quiet text), `DecorationFocus` (focus ring); values `r,g,b` | KConfig notify |
| fonts | `kdeglobals [General] font=Noto Sans,10,…` and `fixed=Hack,10,…` (Qt font string, size in pt) | KConfig notify |
| reduced motion | portal `reduced-motion` = `[KDE] AnimationDurationFactor == 0` | portal signal |
| contrast | **not provided** by the KDE portal [kde settings.cpp]; guess from palette contrast | — |

**KConfig live changes without Qt:** KConfigWatcher listens to the D-Bus
signal `org.kde.kconfig.notify.ConfigChanged` on object path `/kdeglobals`
(arg: `a{saay}` group → changed keys). A Rust helper can match that signal
with zbus, then re-parse the INI. guess on the exact path/signature —
from KConfig source memory; verify with `dbus-monitor` while changing a
colour. Plain inotify on `~/.config/kdeglobals` also works (file is
rewritten atomically → watch the folder).

Caveats: writing kdeglobals by hand does not recalc the accent [kde
discuss]; accent-from-wallpaper has had bugs [kde 506018, 44134].
Kirigami/Qt apps themselves don't yet read the portal accent [kde 512260]
— not our problem, but shows the portal is the path for non-Qt apps.

**3. Shape**
- Breeze frame/control radius **5 px** since Plasma 6 (was 3) [breeze
  MR 449, kde discuss]. Window decoration top corners ~ same; Plasma 6.5
  KWin rounds the **bottom** corners too by default [omgubuntu].
- Not pills. → `window ≈ 8–10?`, `control = 5`. **Measure** the
  decoration radius on a Plasma 6.5 box.
- Fonts: Noto Sans 10 pt, Hack 10 mono (KDE defaults). guess, not sourced.
- Spacing: Kirigami `largeSpacing` ≈ 8–12. guess

**4. Translucency**
- KWin has a blur effect, but a client asks for it through the KDE-only
  Wayland protocol `org_kde_kwin_blur` (or X11 `_KDE_NET_WM_BLUR_BEHIND_REGION`).
  Electron/Chromium does not speak it as far as found. So Banda keeps its
  own wallpaper glass (ADR 0030) — KDE wallpaper reader exists.
- Breeze apps are solid by default → glass **off** by default.

**5. Detect:** `XDG_CURRENT_DESKTOP` contains `KDE`; also
`KDE_SESSION_VERSION=6`, `KDE_FULL_SESSION=true`.

---

## 6. Hyprland

**1. What to follow** (Hyprland has no colours/fonts of its own; it is
shape + effects)
- `decoration:rounding`, `decoration:rounding_power` (2 = circle; higher
  = squircle, Tahoe-like), `general:border_size`, `general:gaps_in`,
  `general:gaps_out` (may be 4 values), `general:col.active_border` /
  `col.inactive_border` (gradients), `decoration:dim_inactive` +
  `dim_strength`, `decoration:active_opacity` / `inactive_opacity`,
  `decoration:blur:{enabled,size,passes,…}`, `animations:enabled`,
  `misc:…`.
- Mode, accent, fonts: from the portal / gsettings / fontconfig (§1),
  because Hyprland itself has none.

**2. How to read and live**
- Request socket `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock`,
  `j/getoption <name>` → JSON with `int` / `float` / `css` / `custom` /
  `gradient` / `bool` field (checked: `gaps_out` is `{"css":"10 10 10 10"}`,
  `col.active_border` is `{"gradient":"ff7aa2f7 0deg"}` — ARGB hex + angle).
- Events: `.socket2.sock`, line `configreloaded>>` — **live** (in code).
  Also `hyprctl keyword` changes at runtime do **not** emit
  `configreloaded` — guess; check whether a `keyword` triggers any event.
  Omarchy's theme switch reloads the config, so it is covered.
- Hyprland 0.55+ moved config to Lua (hyprlang deprecated) [hypr wiki];
  reading via the socket keeps Banda independent of the file format.

**3. Shape (defaults)** [hypr wiki 0.44–0.55]
- rounding **0**, rounding_power 2.0, border_size **1**, gaps_in **5**,
  gaps_out **20**, blur on, size 8, passes 1.
- Omarchy sets rounding 0 by default in some versions, arc has 12 and
  gaps 5/10 (checked; Roma's own config).
- Mapping to ADR 0080 levels: `window` = rounding; `tile` = rounding
  (Banda's tiles *are* the windows' peers); gaps inner = gaps_in, outer =
  gaps_out (today code uses gaps_in for both — small bug/limit); border
  colour = first gradient stop → `focus.border`.
- `rounding_power` → a future `[shape] squircle` / CSS
  `corner-shape: superellipse()` (Chromium shipped `corner-shape` in 2025
  — guess, verify the Chromium version in Electron 45).

**4. Translucency**
- Hyprland blurs any non-opaque window if `decoration:blur:enabled` (and
  window rules don't say `noblur`). So on Hyprland Banda could use the
  **system's** blur (transparent window, CSS background with alpha) instead
  of drawing its own wallpaper blur — cheaper, matches other windows.
  Today Banda draws its own (ADR 0030 "Linux draws"). Worth an A/B.
- Sensible default: glass follows `blur:enabled` **and** whether the
  user's windows are translucent (`active_opacity < 1` or a terminal with
  opacity). On Omarchy windows are solid but the terminal is translucent.
  guess
- No reduce-transparency setting on Linux.

**5. Detect:** `HYPRLAND_INSTANCE_SIGNATURE` set **and** the socket
exists (in code). `XDG_CURRENT_DESKTOP=Hyprland` as a hint only.

---

## 7. niri

**1. What to follow**
- `layout { gaps N }`, `focus-ring { width, active-color, inactive-color,
  off }`, `border { off/on, width, active-color }`, `shadow {…}`,
  window-rule `geometry-corner-radius` (+ `clip-to-geometry true`),
  `prefer-no-csd`, `animations { off; slowdown }`.
- Mode/accent/fonts from the portal (niri usually runs with
  xdg-desktop-portal-gnome or -gtk).

**2. How to read and live**
- niri's IPC (`$NIRI_SOCKET`, `niri msg --json …`) does **not** return the
  layout config (gaps, radii) — no `getoption` equivalent found
  [niri IPC docs, niri-ipc crate]. So Banda must **parse
  `config.kdl`**: `$NIRI_CONFIG`, else `~/.config/niri/config.kdl`, else
  `/etc/niri/config.kdl`. Recent niri adds `include` → follow includes.
  Use the `kdl` crate, or `niri-config` crate (heavy, tied to niri's
  version). guess on `include` version.
- Window rules: corner radius is per window-rule with matchers; Banda
  should take the rule that matches its `app-id` (`banda`) or a rule with
  no matcher. Getting that exactly right = re-implementing matching;
  take the simple path (no-matcher rule, then `app-id` regex match).
- Live: `niri msg --json event-stream` / socket request `EventStream`
  sends `ConfigLoaded { failed }` on each reload [niri-ipc 26.4]. On that
  event, re-parse the file. Or inotify on the config folder.

**3. Shape (defaults)** [niri default-config.kdl]
- gaps **16**, focus ring **on, width 4, `#7fc8ff`**, border off (width 4,
  `#ffc87f`), no corner radius (example rule shows 12, commented),
  shadows off, `prefer-no-csd` off.
- Mapping: `window`/`tile` = geometry-corner-radius (0 → square), gaps
  inner = outer = gaps, focus = ring colour + width (ring is *outside* the
  window: Banda's `[focus] ring` grows into the gap — good fit).
- Newer: `geometry-corner-radius-exponent` (superellipse, like
  Hyprland's rounding_power) in PR #4006 [niri PR].

**4. Translucency**
- niri: background blur was being worked on in 2025–26; I could not
  confirm it shipped. unknown — check `niri --version` + wiki. Until then
  Banda's own glass; default **off** (niri's default look is solid).

**5. Detect:** `NIRI_SOCKET` set and the socket exists;
`XDG_CURRENT_DESKTOP=niri` as a hint.

---

## 8. Omarchy

**1. What to follow**
- Current theme: `colors.toml` palette (with `mode`), background picture,
  plus Hyprland's shape (§6). Font: `omarchy-font-current` (fontconfig
  monospace; checked "JetBrainsMono Nerd Font"). Omarchy has no separate
  UI sans → Banda keeps Inter, or uses the mono for the UI as Omarchy's
  own apps do? Roma's call.
- Omarchy also writes `gsettings color-scheme` + gtk theme (checked
  prefer-dark / Adwaita-dark), so the portal agrees with the theme's mode.

**2. How to read and live**
- Folder `~/.local/state/omarchy/current/theme/` (new) or
  `~/.config/omarchy/current/theme/` (old); also `theme.name`,
  `theme.generation`, `background` (checked). Sources disagree on which
  path is current [instagit ×2] — Banda's code already tries both.
- Live: inotify on `~/.local/state/omarchy/current/` for `theme.generation`
  (a counter that changes on each switch — guess on meaning, it is there)
  — the cleanest trigger. Alternative: drop a script in
  `~/.config/omarchy/hooks/theme-set.d/` and `font-set.d/` (checked these
  folders exist) — but writing into the Person's config is intrusive;
  prefer inotify.
- Hyprland reload follows a theme switch → `configreloaded` (in code).

**3. Shape:** Hyprland's (§6). Focus = Hyprland border, no shadow (move
from `theme.rs` into the omarchy base file, ADR 0080 decision 9).

**4. Translucency:** Hyprland blur is on in Omarchy; terminals are
translucent. Default glass: on (Roma's habit) with Banda's wallpaper or
Hyprland's blur. Hyprland/Omarchy have no reduce-transparency.

**5. Detect:** Omarchy's current theme folder with `colors.toml` exists
**and** we run under Hyprland (an Omarchy install booted into GNOME
should not get the omarchy base). `DESKTOP_SESSION=omarchy` (checked)
is a strong extra hint.

---

## 9. Plain `banda` / `linux`

- `banda`: Banda's own colours + shape (ADR 0075 decision 4), light/dark
  by the system mode.
- `linux` base: `banda` + the portal's mode, accent, contrast, reduced
  motion. Used for XFCE, Cinnamon, COSMIC, Sway, Budgie, etc.
- Font: `fc-match sans-serif` / `monospace` via fontconfig (code exists
  for mono).

---

## 10. Detection order (proposal)

```
1. darwin                                   -> macos
2. win32 (build >= 22000)                   -> windows   (Win10 -> banda)
3. linux:
   a. HYPRLAND socket alive  AND omarchy current theme  -> omarchy
   b. HYPRLAND socket alive                              -> hyprland
   c. NIRI_SOCKET alive                                   -> niri
   d. XDG_CURRENT_DESKTOP has KDE                         -> kde
   e. XDG_CURRENT_DESKTOP has GNOME                       -> gnome
   f. portal answers                                      -> linux
   g. else                                                -> banda
```

- Live sockets beat env names: a nested or SSH-forwarded session can carry
  a stale `XDG_CURRENT_DESKTOP` or `HYPRLAND_INSTANCE_SIGNATURE`.
- Omarchy only with Hyprland (Omarchy is Hyprland-based).
- Detection runs on the **device** (ADR 0080 decision 1). A remote engine
  (two-machines slice) must not decide the client's base: the window's
  machine detects and passes inputs.
- `look.toml theme = "<name>"` always wins over detection; `banda theme
  show` should print which base was detected and why.

---

## 11. Tables per platform (input → source → live? → token)

### macOS
| input | source | live | token |
|---|---|---|---|
| mode | `nativeTheme.shouldUseDarkColors` | yes | mode |
| accent | `getAccentColor` + `AppleColorPreferencesChangedNotification` | yes | `primary`, `ring`, `sidebar-primary` |
| selection | `getColor("selected-content-background")` / `AppleHighlightColor` | yes | `selection` |
| window bg | `getColor("window-background")` | on `updated` | `background` seed |
| text | `getColor("label")`, `("secondary-label")` | on `updated` | `foreground`, `muted-foreground` |
| lines | `getColor("separator")` | on `updated` | `border` |
| font | `system-ui`, 13 | n/a | `font.sans`, `font.size` |
| mono | `ui-monospace` (SF Mono) | n/a | `font.mono` |
| radii | measured Tahoe: window ~26?, control pill | n/a | `window`, `control`, `pill` |
| contrast | `shouldUseHighContrastColors` | yes | contrast variant (lines stronger) |
| reduce transparency | `prefersReducedTransparency` | workspace notif. (verify) | `desk.glass = false` |
| reduce motion | `getAnimationSettings()` | verify | `motion.off` |

### Windows 11
| input | source | live | token |
|---|---|---|---|
| mode | `nativeTheme.shouldUseDarkColors` | yes | mode |
| accent | `getAccentColor` + `accent-color-changed` | yes | `primary`, `ring` |
| window / text / highlight | `getColor("window" / "window-text" / "highlight")` | `color-changed` | seeds, `selection` |
| font | Segoe UI Variable, 14 px | n/a | `font.sans` |
| mono | Cascadia Mono | n/a | `font.mono` |
| radii | 8 / 4, no pill | n/a | `window`, `control` |
| material | `backgroundMaterial` mica/acrylic | set live | `desk.material` |
| high contrast | `inForcedColorsMode` | yes | contrast variant / let forced colours win |
| transparency off | `prefersReducedTransparency` (verify) / `EnableTransparency` | verify | `desk.glass = false` |
| reduce motion | `getAnimationSettings()` | verify | `motion.off` |

### GNOME
| input | source | live | token |
|---|---|---|---|
| mode | portal `color-scheme` / gsettings | yes | mode |
| accent | portal `accent-color` / gsettings name → hex | yes | `primary`, `ring` |
| contrast | portal `contrast` | yes | contrast variant |
| reduced motion | portal `reduced-motion` / `enable-animations` | yes | `motion.off` |
| font | gsettings `font-name` (pt) × `text-scaling-factor` | `gsettings monitor` | `font.sans`, `font.size` |
| mono | gsettings `monospace-font-name` | same | `font.mono` |
| radii | libadwaita: window 15, control ~6–9 (verify) | n/a | `window`, `control` |
| glass | none native | — | `desk.glass = false` default |

### KDE
| input | source | live | token |
|---|---|---|---|
| mode | portal `color-scheme` | yes | mode |
| accent | portal `accent-color` | yes | `primary`, `ring` |
| palette | kdeglobals `[Colors:Window/View/Selection/Button]` | KConfig D-Bus notify / inotify | `background`, `card`, `selection`, `secondary`, `muted-foreground` |
| focus | `[Colors:View] DecorationFocus` | same | `ring` |
| font / mono | kdeglobals `font=`, `fixed=` (pt) | same | `font.*` |
| reduced motion | portal `reduced-motion` | yes | `motion.off` |
| contrast | none | — | — |
| radii | Breeze 5 control, window measure | n/a | `window`, `control` |
| glass | KWin blur not reachable → Banda's own; default off | — | `desk.glass` |

### Hyprland
| input | source | live | token |
|---|---|---|---|
| rounding | `getoption decoration:rounding` | `configreloaded` | `window`, `tile` |
| rounding power | `decoration:rounding_power` | same | future `squircle` |
| border | `general:border_size` | same | `tile.border` |
| border colour | `general:col.active_border` / `inactive_border` | same | `focus.border`, `focus.inactive-border` |
| gaps | `general:gaps_in`, `gaps_out` | same | `gaps.inner`, `gaps.outer` |
| dim | `decoration:dim_inactive`, `dim_strength` | same | `tile.dim-inactive` |
| opacity | `decoration:active_opacity`, `inactive_opacity` | same | `tile.opacity` hint |
| blur | `decoration:blur:enabled/size` | same | `desk.glass` default, `desk.blur` |
| animations | `animations:enabled` | same | `motion.off` |
| mode/accent | portal | yes | as linux |

### niri
| input | source | live | token |
|---|---|---|---|
| gaps | config.kdl `layout { gaps }` | `ConfigLoaded` event | `gaps.*` |
| focus ring | `layout { focus-ring { width, active-color } }` | same | `focus.ring`, `focus.border` |
| border | `layout { border { … } }` | same | `tile.border` |
| radius | window-rule `geometry-corner-radius` | same | `window`, `tile` |
| shadow | `layout { shadow { on … } }` | same | `focus.shadow`, `tile.shadow` |
| animations | `animations { off; slowdown }` | same | `motion.off`, `motion.slowdown` |
| mode/accent | portal | yes | as linux |

### Omarchy
| input | source | live | token |
|---|---|---|---|
| palette | `current/theme/colors.toml` | inotify `current/` (`theme.generation`) | all colour seeds via `tokens::derive` |
| wallpaper | `current/background` | same | `desk.wallpaper` |
| mono font | `omarchy-font-current` / fontconfig | inotify `~/.config/fontconfig` | `font.mono` |
| shape | Hyprland (above) | `configreloaded` | shape |
| focus | Hyprland border, no shadow | — | `focus.shadow = 0` (in the base file) |

---

## 12. Proposed adapters and effort

| # | adapter | where | does | effort |
|---|---|---|---|---|
| A1 | `portal` | look crate (Rust, zbus/ashpd), `--follow` | color-scheme, accent, contrast, reduced-motion, live; gsettings fallback | **M** |
| A2 | `gsettings-fonts` | look crate | GNOME font/mono/scale; `gsettings monitor` child | **S** |
| A3 | `kdeglobals` | look crate | INI parse of Colors/fonts; watch via inotify (or kconfig D-Bus) | **M** |
| A4 | `hyprland` (grow) | `hyprland.rs` | add gaps_out (css), rounding_power, border colours (gradient), blur, opacity; tests from JSON answers | **S** |
| A5 | `niri` | look crate | find + parse config.kdl (with includes), event-stream ConfigLoaded | **M** |
| A6 | `omarchy` | `theme.rs` → base file | inotify on `current/`; move hard-coded focus/hyprland into theme file | **S** |
| A7 | `macos` | `main.ts` → look input | system colours, contrast, reduce transparency/motion as resolver inputs (not CSS vars) | **M** |
| A8 | `windows` | `main.ts` → look input | same with Windows colours; mica vs acrylic; title bar overlay | **M** |
| A9 | `detect` | look crate | the order in §10, reported by `banda theme show` | **S** |
| A10 | `a11y` mapping | resolver | contrast variant, glass-off on reduce-transparency/high-contrast, motion-off | **S** |

Base theme files (gnome/kde/windows/niri shape numbers): **S** each once
radii are measured. The window→page path for mac/win inputs exists (accent
bridge); generalising it to a struct of inputs is part of A7/A8.

Order that matches the roadmap: A9 + A1 + A4 + A6 (Roma's own machine,
Omarchy) → A7 (Roma's Mac) → A10 → A2/A3/A5 → A8.

---

## 13. Risks and unknowns

- **Portal backends differ.** gtk backend (Omarchy) has no accent;
  KDE has no contrast; GNOME's enable-animations had a bug. Always keep a
  fallback and "no preference" handling.
- **Electron's Linux nativeTheme is not reliably live** — don't depend on
  it; Banda already sets `themeSource`.
- **Tahoe radii are not documented** in px; depend on window style.
  Must be measured on Roma's Mac.
- **Liquid Glass** is not reachable from Electron; vibrancy is the old
  material. The look may feel "pre-Tahoe" whatever the radii.
- **KWin and Mutter blur** are not reachable from Electron; Banda's own
  glass stays on those.
- **niri config parsing** is fragile: KDL, includes, per-window rules,
  version drift. The IPC has no getoption.
- **Hyprland `keyword` changes** may not fire `configreloaded`.
  Hyprland's Lua config migration may rename options (0.55+).
- **Font units:** GNOME/KDE give points; Banda uses px. DPI and fractional
  scale change the result.
- **Remote/two-machines:** the engine on arc must not detect the Mac's
  platform; detection and inputs belong to the client device (ADR 0080
  decision 1). Today `banda look --follow` runs where the window is; keep
  it that way.
- **Squircles:** rounding_power / niri exponent / Tahoe's continuous
  corners need CSS `corner-shape`; check Electron 45's Chromium support.
- Some sourced facts come from third-party pages (Omarchy paths,
  registry keys, Tahoe 26 px); marked above.

## 14. Only real hardware can check

- macOS Tahoe: window radius of Banda's hidden-title-bar window, control
  radius, vibrancy look, whether Reduce Transparency / Reduce Motion /
  Increase Contrast fire a live event in Electron 45.
- Windows 11: mica vs acrylic look, `prefersReducedTransparency` live
  with Transparency effects off, `inForcedColorsMode`, Segoe UI Variable
  rendering, `titleBarOverlay`. (Win10: solid fallback.)
- GNOME 48/49 VM: portal ReadAll output (accent, contrast, interface
  keys), button/card radii, Adwaita Sans size in px.
- Plasma 6.5 VM: portal keys, kdeglobals change signal, decoration
  radius, whether KWin blurs a transparent Electron window anyway.
- niri: config shapes in the wild, ConfigLoaded timing, blur availability.
- Hyprland: whether `hyprctl keyword` fires any event; system blur vs
  Banda glass A/B on arc.

---

## Sources

- [portal docs] https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html
- [phoronix] https://www.phoronix.com/news/XDG-Desktop-Portal-1.17.1 , https://www.phoronix.com/news/Flatpak-1.18-Released
- [ashpd] https://docs.rs/ashpd/latest/ashpd/desktop/settings/struct.Settings.html
- [mundy] https://docs.rs/crate/mundy/0.2.3/source/src/freedesktop/mod.rs
- [kde settings.cpp] https://invent.kde.org/plasma/xdg-desktop-portal-kde/-/raw/master/src/settings.cpp
- [kde 512260] https://bugs.kde.org/show_bug.cgi?id=512260
- [kde 506018] https://bugs.kde.org/show_bug.cgi?id=506018
- [kde discuss accent CLI] https://discuss.kde.org/t/set-the-type-of-accent-color-via-cli-from-theme-wallpaper-custom/3770
- [kde 44134] https://discuss.kde.org/t/x-kde-plasmaimagewallpaper-accentcolor-not-picked-up-correctly-by-plasma/44134
- [breeze MR 449] https://invent.kde.org/plasma/breeze/-/merge_requests/449
- [kde discuss rounder] https://discuss.kde.org/t/breeze-is-now-more-round/13615
- [omgubuntu] https://omgubuntu.co.uk/2025/07/kde-plasma-6-5-rounded-window-corners-kwin
- [gnome commit] https://lists.gnome.org/archives/commits-list/2021-December/msg07210.html
- [gnome #119] https://gitlab.gnome.org/GNOME/xdg-desktop-portal-gnome/-/issues/119
- [ubuntu bug] https://lists.snapcraft.io/archives/foundations-bugs/2024-October/525177.html
- [libadwaita css-variables] https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/css-variables.html
- [twig 185] https://thisweek.gnome.org/posts/2025/01/twig-185/
- [electron native-theme] https://www.electronjs.org/docs/latest/api/native-theme
- [electron system-preferences] https://www.electronjs.org/docs/latest/api/system-preferences , https://raw.githubusercontent.com/electron/electron/main/docs/api/system-preferences.md
- [electron releases] https://releases.electronjs.org/pr/47629
- [electron #38977] https://ayakael.net/mirrors/electron/commit/480f48b2fcf659e031e2440b9af67c38cc061aca
- [chromium change] https://chromium.googlesource.com/chromium/src/+/4e1c63a05bda3af72503c16fbbe5d8746b356d6d
- [claude issue 79995] https://claudeissues.com/issue/79995-bug-desktop-linux-theme-does-not-follow-system-light-dark-changes-at-runtime-res
- [MS geometry] https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry
- [MS rounded corners] https://learn.microsoft.com/windows/apps/desktop/modernize/apply-rounded-corners
- [fluent2] https://fluent2.microsoft.design/shapes
- [MS UISettings] https://learn.microsoft.com/uwp/api/windows.ui.viewmanagement.uisettings.colorvalueschanged
- [elevenforum] https://www.elevenforum.com/t/change-to-dark-or-light-color-mode-in-windows-11.555/ , https://www.elevenforum.com/t/change-accent-color-in-windows-11.1146/
- [WWDC25 310] https://developer.apple.com/videos/play/wwdc2025/310/
- [lapcat] https://lapcatsoftware.com/articles/2026/3/1.html , https://lapcatsoftware.com/articles/2026/3/4.html
- [macrumors] https://forums.macrumors.com/threads/2484925/
- [kirby] https://kirby.pika.page/posts/a-time-and-a-place-for-concentricity
- [1024jp deck] https://speakerdeck.com/1024jp/whats-new-in-appkit-on-macos-26
- [axiom ref] https://skill-extrachatgpt-com.pages.dev/s/CharlesWiltgen/Axiom/axiom-swiftui-26-ref
- [hypr wiki] https://wiki.hypr.land/Configuring/Basics/Variables/ , https://wiki.hypr.land/0.55.0/Configuring/Basics/Variables/ , https://wiki.hypr.land/0.44.0/Configuring/Variables/
- [niri default-config] https://raw.githubusercontent.com/YaLTeR/niri/main/resources/default-config.kdl
- [niri IPC] https://niri-wm.github.io/niri/IPC.html , https://docs.rs/crate/niri-ipc/26.4.0/source/src/state.rs
- [niri PR] https://github.com/niri-wm/niri/pull/4006
- [instagit omarchy] https://instagit.com/basecamp/omarchy/how-themes-structured-applied-omarchy/ , https://instagit.com/omacom/omarchy/how-to-set-a-new-omarchy-theme/
