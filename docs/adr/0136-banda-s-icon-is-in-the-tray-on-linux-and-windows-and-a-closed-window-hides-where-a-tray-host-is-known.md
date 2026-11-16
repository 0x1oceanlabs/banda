---
status: accepted
date: 2026-11-17
---

# Banda's icon is in the tray on Linux and Windows, and a closed window hides where a tray host is known

_It amends ADR 0086, decisions 3 and 4, for Linux and Windows. Track 3
(the window), slice "the tray on Linux and Windows", PR 1 of #1870. It
serves principle 9 of [what we build](../what-we-build.md), where the work
runs makes no difference: the Agents work on with the window closed, and
the Person sees who calls them on Linux and Windows as on a Mac._

Roma saw the mock on 2026-11-17 and chose the recommended answer to each
of its seven questions (#1870). The evidence is Electron 45.1.0's own
pages and code, read on 2026-11-16 and kept beside the mock
(`~/Banda/artifacts/window-architecture/tray-linux-windows/findings.md`).
Nothing is built.

## Where it stands

- **Banda's icon is in the menu bar on macOS alone** (`hasMenuBar` in
  `client/desktop/src/menubar.ts`; ADR 0086, decision 4, as step 7e built
  it). Closing the window hides it there, and the app stays.
- **On Linux and Windows closing the last window quits the app**
  (`window-all-closed` in `main.ts`). The engine goes on, but nothing on
  the screen says that Banda runs or who calls.
- **ADR 0086, decision 4, gave Omarchy a shell plugin** and other Linux
  desktops nothing. The plugin is not built.
- **Electron gives less off macOS.** No number beside the icon
  (`setTitle`), no picture the bar colours itself (a template), no second
  line and no heading in a menu's row. On Linux the icon is a
  StatusNotifierItem that a tray host draws; Banda hears only `click`,
  and the host opens the menu and draws it. With no host Electron keeps
  an icon that shows nothing and says nothing.

## Decision

Banda's icon is in the tray on Linux, as a StatusNotifierItem, and in
Windows' notification area, as it is in the macOS menu bar: the same
Mark, the same menu, from the same line of `banda status --follow`.
macOS stays as it is.

1. **The icon is the sign alone, with no number on it.** How many call
   the Person is in the tooltip and in the menu's first line ("Your
   turn · 2"). Only macOS writes text beside an icon, and at 16 px one
   digit reads at the limit and "9+" does not. The sign says "your turn"
   by its shape and its orange already.

2. **Closing the window hides it only where a tray host is known.**
   There Banda stays in the tray, as on macOS. Where none is known, the
   window closes as today and the app quits. Anything but a clear yes is
   no: no session bus, as behind the fence, a question that timed out,
   a tray that cannot be asked. Main asks at each close, since a host can
   stop. A hidden Banda with no icon would be a window the Person cannot
   find again. On Windows the notification area is always there.

3. **A left click opens the window, a right click the menu,** as tray
   icons do on both systems. Banda opens the window on Electron's
   `click`. On Windows Electron opens the menu on a right click. On Linux
   the host decides which gesture is which, and Banda cannot open the
   menu itself.

4. **A Thread's row is one line, "title · state",** with no Project.
   The menus of Linux and Windows draw no second line. A heading is a
   line that cannot be picked, with its count.

5. **The ink follows the desktop's colour scheme on Linux and the
   taskbar's on Windows.** With no templates, each sign is drawn in a
   light and a dark ink. Windows says its taskbar's colour apart from
   its apps'. Linux says only the desktop's scheme, not the bar's own; a
   setting comes only if that is wrong on a bar.

6. **On Windows the first close says once that Banda still runs,** and
   where its icon is. Once for the Person, never again.

7. **The tray icon takes the place of the Omarchy plugin** of ADR 0086,
   decision 4. One icon serves every desktop with a tray host, Omarchy's
   too, and nothing is installed. A Waybar module with the number as text
   may come later, if wanted.

**What must stay true.** A window hidden to the tray gives its page
`visibilitychange` to `hidden`, as on macOS. A machine reads "the Person
looks at this device" there, and pushes a Thread's call to the phone only
when they look at none (ADR 0124, decision 10). A hidden window that
stayed `visible` would silence the phone. The PR that hides the window
checks it.

## Not known yet

These are settled in the build, and are not facts until then.

- **How main learns that a tray host is there.** Electron does not say
  whether the icon is shown. Chromium registers the item when
  `org.kde.StatusNotifierWatcher` is on the session bus and its
  `IsStatusNotifierHostRegistered` is true, so Banda asks the same two
  things. A child of main asks, `busctl`, each time the answer is
  needed (`os-window/tray-host.ts`, #1896).
- **What a tray host does with a click.** Remembered, not read in a
  source or tried: Waybar gives a left click as `click` and opens the
  menu on a right click, and shows the tooltip. GNOME's AppIndicator
  extension opens the menu on a click (Chromium's own comment); decision
  3 may not hold there.
- **Whether the desktop's scheme matches the bar** on Roma's Hyprland
  themes. A guess.
- **Where Windows 11 puts a new icon.** Remembered: in the overflow,
  which is why decision 6 is there. How the notice is shown is open too.
- **Tried by nobody:** GNOME with and without the extension, KDE. Roma
  tries Hyprland and Windows 11 by hand; the devbox has no display and
  no tray host, so tests hold the rules with fakes.

## Consequences

- Where the window hides, `window-all-closed` no longer quits the app on
  Linux and Windows. The app stays, with its page, so it calls the Person
  (ADR 0011) and sounds with no window shown.
- Quit Banda's ask follows: where closing hides, a quit the app is asked
  for is Quit Banda, which asks first while Agents work, in ADR 0086's
  one set of words. Quit Banda is in the tray's menu.
- Where no tray host is known, nothing changes: the window closes, the
  app quits, the engine goes on.
- ADR 0086's line "on Linux, the Electron process exits with its last
  window" holds only where no tray host is known.
- The Omarchy plugin and its offer on the first run are not built.
- Each sign is drawn twice more, in two inks, as PNG for Linux and
  `.ico` for Windows.
- Not decided here, each later and its own: Banda starting hidden at
  login, the engine opening the app on Linux as it does on macOS, the
  Waybar module.

## Changed here

- **ADR 0086, decision 3,** on Linux and Windows: closing the last
  window hides it and keeps the app where a tray host is known
  (decision 2). Quit Banda is also in the tray's menu.
- **ADR 0086, decision 4,** on Linux and Windows: Banda's icon in the
  tray takes the place of the Omarchy shell plugin, and "other Linux
  desktops get nothing" goes (decision 7). `banda status --follow`
  stays its one source.

## Plan

The PRs and what Roma tries are in #1870: this ADR; the icons; the icon
and its menu with the window closing as today; the tray host's answer;
closing hides where a host is known, with Windows' notice.
