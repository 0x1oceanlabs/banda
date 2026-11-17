/**
 * How one system takes this app's new version and installs it: the three
 * things that differ between an AppImage, an installed Windows Banda and
 * a Mac's Banda from brew. What to take, when, and what the Person is
 * told is app.ts's, the same on each.
 *
 * - An AppImage (appimage.ts): electron-updater downloads the file, and
 *   Banda puts it beside the one that runs and renames it into place.
 * - Windows: electron-updater downloads the installer, which runs once
 *   Banda is gone, shows its own window, and starts Banda again (ADR
 *   0090, step 6).
 * - macOS (ADR 0121): an app signed ad hoc cannot swap itself, so brew
 *   takes the cask's zip into its cache while Banda runs, upgrades while
 *   the window stays, and Banda opens again from the new app.
 */
import { app } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import type { App } from "./app"
import type { Brew } from "./brew"

/** How long the page has to draw "Restarting" before Banda quits for
 * Windows' installer. */
const SAID = 150

/** A download, as far as it is. */
export type Progress = { share: number; down?: number; size?: number }

/** electron-updater's word of a download, as far as it is. */
export const progressOf = (progress: {
  percent: number
  transferred?: number
  total?: number
}): Progress => ({
  share: Math.min(1, progress.percent / 100),
  down: progress.transferred,
  size: progress.total,
})

/** What hears a take: how far it is, and how it ended. */
export type Taking = {
  progress: (now: Progress) => void
  /** It ended: down, or not out for this system yet. */
  done: (down: boolean) => void
  failed: (error: Error) => void
}

/** How this system takes and installs a version. */
export type Installer = {
  /** Who installs, in what the Person reads of a failure. */
  readonly name: string
  /** Whether it downloads the file itself, with electron-updater, and
   * says how far it is: brew says nothing. Then a failure of the download
   * comes as electron-updater's `error`, as a look's does. */
  readonly downloads: boolean
  /** Why the version it last installed is not the one that runs, if it
   * did not start: said as Banda starts. */
  readonly failed?: string
  /** Whether it can restart Banda with no window shown, so that it may
   * do so by itself, unseen. Only a Mac's can yet: elsewhere Banda has
   * no tray to stay in (#1870). */
  readonly unseen: boolean
  /** Why it cannot take `info`'s version, if it cannot. */
  cannot(info: UpdateInfo): string | undefined
  /** Takes `info`'s version, so that installing it needs no network, and
   * tells `on` how it goes. One that `downloads` says no failure here. */
  take(info: UpdateInfo, on: Taking): void
  /** Installs `version` as far as it can while the window stays: false
   * when another version is out by now. */
  install(version: string): Promise<boolean>
  /** Quits Banda and starts the version installed, `hidden` with no
   * window, as it is now. */
  relaunch(hidden: boolean): void
  /** Banda quits, as the Person asked: `installs`, whether the quit
   * installs the version ready, as app.ts says. */
  quitting(installs: boolean): void
}

/** Windows' installer: electron-updater's, whose own installer swaps
 * the app once Banda is gone. */
export function windowsInstaller(mine: Pick<App, "quits">): Installer {
  /** What hears the download that runs. */
  let taking: Taking | undefined
  // electron-updater reads this at the quit, and after a download only
  // listens for the quit while it is on: `quitting` says what it installs.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on("download-progress", (progress) =>
    taking?.progress(progressOf(progress))
  )
  autoUpdater.on("update-downloaded", () => taking?.done(true))
  return {
    name: "Banda",
    downloads: true,
    unseen: false,
    cannot: () => undefined,
    take(_info, on) {
      taking = on
      // The same error comes as an "error" event.
      autoUpdater.downloadUpdate().catch(() => {})
    },
    install: () => Promise.resolve(true),
    relaunch() {
      setTimeout(() => {
        // Quit meanwhile, as the Person asked: that quit installs it.
        if (mine.quits()) return
        // The installer shows its own window while it works, as Banda
        // has none then, and starts Banda itself.
        autoUpdater.quitAndInstall(false, true)
      }, SAID)
    },
    quitting(installs) {
      autoUpdater.autoInstallOnAppQuit = installs
    },
  }
}

/** A Mac's installer: `brew`, the cask that installed this Banda. */
export function brewInstaller(brew: Brew): Installer {
  return {
    name: "brew",
    downloads: false,
    unseen: true,
    cannot: () => undefined,
    // The tap's cask comes after the release's files.
    take: (info, on) =>
      void brew
        .newest()
        .then((cask) =>
          cask === info.version ? brew.fetch().then(() => true) : false
        )
        .then(on.done, on.failed),
    install: (version) => brew.upgrade(version),
    relaunch(hidden) {
      brew.reopen(hidden)
      app.quit()
    },
    // brew installs nothing as Banda quits.
    quitting() {},
  }
}
