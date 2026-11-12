---
status: accepted
date: 2026-11-12
---

# A Mac's Banda updates its app through brew, until it is signed

_It amends ADR 0033, decision 6 ("the app does not update itself"), and
builds ADR 0119's decision 2 for macOS: the desktop part carries out
brew, as it carries out the AppImage swap._

Roma, on 2026-11-12 (translated): "how do we make the Mac update itself
too?", then, of the two ways offered: "yes, way 1; I will start on way 2".
Way 2 is an Apple Developer ID, which Roma is getting.

## Where it stands

- Each machine's engine updates itself (ADR 0119): arc and devbox moved
  from dev.711 and dev.712 to dev.716 on their own once idle, and the Mac's
  engine from dev.710 to dev.714.
- The Mac's app does not. It is signed ad hoc, so Squirrel.Mac refuses to
  swap it. The widget says the version is out, with the command
  `brew update && brew upgrade --cask banda-dev`, and the app stays where
  it was until the Person types it: dev.710 while dev.714 was out.

## Decision

1. **brew takes the version while Banda runs.** When the release the
   engine says is newest has its Mac files, the app runs `brew update`,
   reads the cask's version, and, once the tap has that version,
   `brew fetch`es its zip into brew's cache. Until then it reads again
   a minute later, as it does while the Mac's files publish, for at most
   15 minutes a version; after that each hourly look tries brew once. The
   widget then shows the version ready, as on Linux.
2. **Restart installs it.** `brew upgrade --cask banda-dev` runs while
   Banda still runs from its old files, only if the tap's cask still has
   the version ready; if the tap moved, the engine looks again and brew
   takes what it finds. brew runs on its own, so Banda quitting never cuts
   it halfway. Then Banda quits, and opens again from the new app once it
   is gone. The engine and its Agents go on, as with the AppImage (ADR
   0119, decision 4). A quit the Person asked for meanwhile goes as asked,
   and the next start is the new version.
3. **With no window shown, it restarts by itself.** Banda in the menu bar
   with no window, seen so twice half a minute apart, restarts unseen and
   opens again with no window, as the engine opens it (`--hidden`). A window
   shown, or Banda hidden by ⌘H, holds it, as does a logout. It restarts so
   only while the last look offered the version; after a sleep it waits for
   the engine's next look, and never shows a failure nobody asked about. A
   window opened during the upgrade opens again with the new app, and the
   "Updated from" line waits until the window has the focus.
4. **Only a Banda brew installed.** The cask must be installed, and its
   app must be the one that runs (`brew info --json=v2`'s target). A copy
   elsewhere, or no brew, keeps the command.
5. **A brew that fails falls back.** If `brew update` or `brew fetch` fails,
   the widget says the command, which still works by hand; the next look
   tries again. If `brew upgrade` fails, Banda stays and says why, and that
   version waits for the Person's Restart, not another unseen try.
6. **The rest is as on Linux.** A version withdrawn goes (ADR 0092,
   decision 10). A Restart after an hour with no look looks first. The new
   Banda says what it updated from (ADR 0072, decision 4).

## Consequences

- The Mac's app follows its channel like the other machines, with no
  command typed.
- Each update is a new ad hoc signature: macOS may ask again for what it
  asked before, as it does after a `brew upgrade` by hand.
- `brew update` runs when a new version is out, several times a day on
  Dev, and updates the Person's other taps as the command did.
- For the few seconds brew swaps the app, the app's own Electron, which
  the engine uses as Node for some Harnesses' adapters, is not there: an
  Agent that starts in those seconds fails to start. Agents already
  running go on.
- A crash of brew during the upgrade can leave no app in Applications;
  the cask is still installed, and `brew reinstall --cask banda-dev` puts
  it back.

## Later

- With a Developer ID, CI signs and notarizes the Mac's app, and it
  updates itself as the AppImage does; this goes, and the cask stays for
  installing.
