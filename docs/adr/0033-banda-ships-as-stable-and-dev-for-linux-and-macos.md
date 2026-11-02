---
status: accepted
date: 2026-11-02
---

# Banda ships as Stable and Dev, for Linux and macOS

Banda is not packaged yet. It runs from a checkout (`pnpm --filter @banda/desktop start`), and the window takes the engine from `target/debug/banda`. Only `app/desktop/src/main.ts` knows a packaged app at all: when `app.isPackaged` it takes the engine from `resources/` and ignores `BANDA_PAGE`.

Roma wants to build Banda inside Banda, not in T3 Code, and to give it to a few people. Two builds then live on one machine: the one Roma works in every day, and a newer one to try. Today they cannot:

- Both keep everything in the same places (`engine/src/places.rs`): `~/.local/share/banda`, `~/.local/state/banda` with `engine.lock`, `window.sock`, `engine.json`, and `~/.config/banda`. The lock allows one engine per state folder, so the second would not start. The window's Electron profile is `~/.config/@banda/desktop` for both.
- The window's class is `banda-desktop` for both, so window rules cannot tell them apart.
- A window an agent starts from its worktree (`pnpm start`) takes the same places too, so it would open the Person's real Spaces.

What the platforms allow, checked on 2026-11-02:

- **macOS** needs an Apple Developer ID to sign and notarize, or Gatekeeper stops the app. On Apple silicon an app must carry a signature of some kind, so an unsigned build is signed ad hoc. Electron's own updater on macOS (Squirrel.Mac) works only for a signed app ([Electron, code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
- **Homebrew** removes casks that fail Gatekeeper from its main repository from 2026-09-01. Its maintainers say a tap of one's own may still carry unsigned apps ([Homebrew discussion #6334](https://github.com/orgs/Homebrew/discussions/6334)). Whether `--no-quarantine` still exists is unsettled ([brew #20755](https://github.com/Homebrew/brew/issues/20755)), so the cask takes the quarantine off itself.
- **GitHub's macOS runners** count ten times their minutes on a private repository and are free on a public one ([GitHub, Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). The repository is private now.
- **AppImage**: the older AppImage runtime needs `libfuse2`. Omarchy has only `fuse3` (checked on this machine). Which runtime electron-builder packs is checked in step 2.

Roma, 2026-11-02:

- "Linux and Mac. On Mac through brew for now, while there is no certificate."
- "We make the repository open source", as a step of its own, prepared separately.
- "Dev on every merge into main."
- "For now a few people, in person."

## Decision

1. **Two apps: Banda and Banda Dev.** Stable is the one to work in. Dev is what `main` is now. They install side by side and never share anything but `~/Banda`, where new Spaces' folders go:

   | | Banda | Banda Dev | from a checkout |
   |---|---|---|---|
   | app ID | `so.banda.app` | `so.banda.dev` | none |
   | window class | `banda` | `banda-dev` | `banda-local` |
   | places (`data`, `state`, `config`) | `…/banda` | `…/banda-dev` | `…/banda-local` |
   | Electron profile | `state/window` | `state/window` | `state/window` |
   | icon | Banda's | Banda's, marked Dev | Banda's, marked Dev |

   - The channel is fixed when the app is built (`BANDA_CHANNEL`: `stable`, `dev`, `local`). A checkout is `local`, so an agent's window never opens the Person's real Spaces. `BANDA_ROOT`, `BANDA_DATA`, `BANDA_STATE` and `BANDA_CONFIG` still move each place, as the tests do.
   - The window's profile moves under `state`, as it already does when `BANDA_STATE` is set. Nobody runs a packaged Banda yet, so nothing is moved over.
   - The window's class changes from `banda-desktop` to `banda`. Roma's Hyprland config no longer matches it (ADR 0023 dropped the rule), so nothing has to follow.

2. **One version for the whole app**, set at build time: the Cargo workspace, `app/desktop`'s package and the engine's `serverInfo` say the same.
   - Stable is `0.X.Y`, from its tag `v0.X.Y`. The first is `0.1.0`.
   - Dev is `0.X.Y-dev.N`, where `0.X.Y` is the next minor after the last Stable, and `N` is the release workflow's run number.

3. **Dev is built on every push to `main`, once `ci` is green on that commit.** The release workflow builds it and publishes a GitHub prerelease tagged with its version, `v0.X.Y-dev.N`, as electron-updater reads a release's version from its tag. Only the last 20 Dev releases are kept.

4. **Stable is a Dev that Roma has lived with.** Roma tags a commit that has a Dev build, `v0.X.Y`. The workflow builds it again from that commit with the Stable channel and publishes a release, with its notes taken from the titles of the PRs merged since the last Stable. Stable never loses a Person's data: an update runs the modules' migrations (ADR 0002), and a change that cannot migrate does not go into a Stable.

5. **Linux: an AppImage for x64, which updates itself.**
   - Built with electron-builder on the devbox runners, the engine inside.
   - electron-updater finds a new version in the background, downloads it, and installs it when the app quits. Banda reads the Stable releases, Banda Dev the prereleases. Neither asks, and neither restarts by itself: Dev can change many times a day.
   - It has to run on Omarchy, which has only `fuse3`, and on a plain GNOME and KDE (step 2).
   - A pacman package in the AUR comes later, if asked.

6. **macOS: an app for Apple silicon, through our own Homebrew tap, until there is a certificate.**
   - The build is signed ad hoc and not notarized. The tap `0x1oceanlabs/homebrew-banda` has two casks, `banda` and `banda-dev`. Each takes the quarantine off the app it installs, so Gatekeeper lets it open.
   - The app does not update itself, since Squirrel.Mac needs a signed app. It checks the releases as on Linux and says that a new version is out, with the command: `brew upgrade --cask banda`.
   - It is built on GitHub's macOS runners. While the repository is private, only Stable is built for macOS; Dev follows once it is public, where those runners are free.
   - Nobody has run Banda on a Mac yet. Its first step is that the engine and the window build and pass `check.sh` there. The glass (ADR 0030, #192) is tried there too.
   - With a Developer ID, the app is signed and notarized and updates itself as on Linux. That is a new ADR then.

7. **Windows comes later, on its own.** The engine's terminals (`pty-process`) and the window's socket (`window.sock`) are Unix only.

8. **What a Person needs beside Banda**: Claude Code or Codex, signed in. For now also Node with `npx`, which starts their ACP adapters (`modules/agents/engine/src/settings.rs`). When `npx` is not found, the Harness says so where it is listed, as a missing CLI does. Packing the adapters into the app, run by Electron's own Node, is a later step.

9. **A crash is kept on the machine.** Electron's crash reporter writes to `state/crashes`, with nothing uploaded, and the engine's panics go to its log. Sending a report is a later decision, and only when the Person agrees.

10. **Opening the source is a step of its own**: a license, the history checked for secrets, a README for people who did not build Banda. Until then the releases are in the private repository: Roma installs them with `gh release download`, and automatic updates (decision 5) start once the repository is public.

## Steps

1. **The channels**: `BANDA_CHANNEL`, its places, the app ID, the window class and the icon (decision 1). Tried from a checkout beside a running window.
2. **The Linux AppImage**: electron-builder, the engine inside, the version (decision 2). Tried on Omarchy, and on a plain GNOME and KDE.
3. **The release workflow**: Dev on every green push to `main`, Stable on a tag, the last 20 Dev releases kept (decisions 3 and 4).
4. **Open source**: its own checklist (decision 10).
5. **Updates on Linux**: electron-updater for both channels (decision 5).
6. **macOS**: the build passing on a Mac runner, then the tap and its two casks (decision 6).
7. **A Person's first run**: what is missing (a Harness, `npx`) says how to get it, and the README tells how to install.

## Consequences

- Roma works in Banda; Banda Dev and the agents' windows from their worktrees run beside it without touching its Spaces.
- `main` is out on Dev minutes after a merge. Stable moves only when Roma tags it.
- A Mac user updates through brew until there is a certificate, and gets Dev only once the repository is public.
- A window rule, Omarchy's or a Person's, tells the three apart by their class.
- Each Stable has to keep a Person's data: a change to the store comes with its migration.
