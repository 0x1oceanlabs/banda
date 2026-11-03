---
status: accepted
date: 2026-11-03
---

# Banda updates itself, and says so on the bar

ADR 0033, decision 5, says how Banda updates itself on Linux. electron-updater finds a new version in the background, downloads it, and installs it when the app quits. Banda reads the Stable releases, Banda Dev the prereleases. Neither asks, and neither restarts by itself. Decision 10 held this back until the repository was public, and on 2026-11-03 it became public (ADR 0038).

ADR 0024 gave the bar its widgets, and named none for Banda's own update. Roma, on 2026-11-03: "and let's think through a widget in the bar for auto-update right away." Roma looked at mocks of the widget in four states and of three ways to show a download, and decided:

- The widget is only an icon: an arrow up in a circle, in the bar's muted text. A line on hover says what it is. A version or a word beside the icon (`dev.66`, "Restart to update") was weighed and not taken.
- Its popover has a button to restart now.
- While a version downloads, the bar shows it: the circle around the arrow fills as the download goes, so a full circle is the icon that says the version is ready. A dim arrow that pulses and a thin line under the arrow were weighed and not taken.

**What electron-updater does**, read in its source (6.8.11) on 2026-11-03:

- Its GitHub provider reads `releases.atom`, the repository's public feed, so it needs no token and no API calls.
  - When the running version is a prerelease, `allowPrerelease` is on. With `0.1.0-dev.N`, the channel is `dev`, and it takes the newest release whose tag is also a `-dev.` one. So Banda Dev never takes a Stable.
  - When the running version is not a prerelease, it takes `releases/latest`, which is never a prerelease.
- It reads the release's `<channel>-linux.yml`, and `latest-linux.yml` when that file is missing. The file names the AppImage, its size and its sha512. Today a release holds only the AppImage, so nothing could update.
- An AppImage carries its own blockmap, so it downloads only the blocks that changed, falling back to the whole file. An AppImage is 140 MB, and Dev comes many times a day.
- On install it deletes the running AppImage and moves the new one in.
  - When the old file's name holds a version, as ours do (`banda-dev-0.1.0-dev.65-x86_64.AppImage`), the new file takes its own name beside it.
  - It then runs the new file once with `APPIMAGE_EXIT_AFTER_INSTALL=true`, unless the app restarts.

**Decision.**

1. **Every release carries what electron-updater reads.**
   - electron-builder writes `latest-linux.yml` beside the AppImage, from a `publish` entry for GitHub.
   - `scripts/release.mjs` uploads it with the AppImage. It still publishes the release itself, as ADR 0033 (step 3) has it.
   - The app knows the repository from the `app-update.yml` that electron-builder packs, so main does not name it.

2. **Main looks for a new version and downloads it, then installs it on quit.**
   - It looks a minute after the start. After that, Banda Dev looks every hour and Banda every four hours. It also looks when the Person asks.
   - It downloads a new version as soon as it finds one, and installs it when the app quits (`autoInstallOnAppQuit`).
   - Only an AppImage updates. Banda Local, run from a checkout, does not look: it has no `APPIMAGE`.
   - Main sends its state to the page as one value: `none`, `downloading` with a share, `ready` with the version and its notes, or `failed` with a reason.
   - Two actions reach it:
     - `update.check` looks now. The Banda menu offers it as "Check for updates".
     - `update.restart` installs the version that is ready and starts it (`quitAndInstall`). It does nothing when no version is ready.

3. **The new AppImage lists itself again, and stops.**
   - Started with `APPIMAGE_EXIT_AFTER_INSTALL=true`, Banda writes its desktop entry for its own path (`listApp`, ADR 0033 step 2), and quits before it opens a window or starts the engine.
   - Without this, quitting would start Banda again, and the launcher's entry would point at the deleted file.
   - Started by `update.restart`, the new one lists itself as at any start.

4. **The widget stands on the bar's right, before the engine's connection.**
   - It is the window's own state, as the connection is, so it is part of the bar and not a module's widget. When ADR 0024's step 2 brings widgets, it becomes `banda.update`, with the same look.
   - It follows ADR 0024, decision 2: an icon in the bar's muted text, and colour only for a state.
   - **`none`**: it draws nothing. That also covers looking and a look that failed for want of a network.
   - **`downloading`**: the arrow in a circle that fills with the share. It shows only once the download has run two seconds, since a Dev that differs by a few blocks takes less, and the bar would only flicker. The line on hover says "Downloading Banda Dev 0.1.0-dev.66 · 38%".
   - **`ready`**: the arrow in a full circle. The line on hover says "Banda Dev 0.1.0-dev.66 is ready: it installs when you quit Banda".
   - **`failed`**: the same icon in `--destructive`, only when the Person has to fix something, such as an AppImage Banda cannot write. The line says why. A look or a download that failed for want of a network stays quiet and tries again at the next look.
   - A click opens the popover:
     - The new version, the version the Person has, and when it installs.
     - What changed: the notes of every release since the Person's version, newest first (`fullChangelog`). A Dev's notes are the title of its commit.
     - While Threads work, a line that a restart stops their turns, as quitting does.
     - "Later", which closes it, and "Restart", which is `update.restart`.

5. **Not now.**
   - **macOS**, where the app cannot update itself until it is signed (ADR 0033, decision 6). It comes with ADR 0033's step 6: the same look for a new version, and a popover with `brew upgrade --cask banda` and a button that copies it, with no "Restart".
   - A setting that turns updates off, for a Banda a package manager installed. It comes with the AUR package.
   - A Stable that stops the Person until they update.

**Consequences.**

- ADR 0024 gets one more thing on the bar's right, beside the connection. Its decision 6, a widget for a Harness's sign-in or update, stays for later.
- `GLOSSARY.md` gets **Update**.
- The order of work, each step its own PR:
  1. This ADR.
  2. Releases carry `latest-linux.yml`. Check it on a Dev release.
  3. Main updates the AppImage: electron-updater, the start with `APPIMAGE_EXIT_AFTER_INSTALL`, and the two actions. Check it with two Dev builds: an old one installed, and it updates to the next.
  4. The widget and its popover, mocked first (the mocks of 2026-11-03).
