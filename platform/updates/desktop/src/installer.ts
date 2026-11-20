/**
 * How one system takes this app's new version and installs it: the three
 * things that differ between an AppImage, an installed Windows Banda and
 * a Mac's Banda from brew. What to take, when, and what the Person is
 * told is app.ts's, the same on each.
 *
 * - An AppImage and Windows: electron-updater downloads the file, and
 *   installs it as Banda quits. An AppImage is swapped in this process;
 *   Windows' installer runs once Banda is gone, shows its own window, and
 *   starts Banda again (ADR 0090, step 6).
 * - macOS (ADR 0121): an app signed ad hoc cannot swap itself, so brew
 *   takes the cask's zip into its cache while Banda runs, upgrades while
 *   the window stays, and Banda opens again from the new app.
 */
import { accessSync, constants } from "node:fs"
import { dirname } from "node:path"
import { app } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import { startAfter } from "./after"
import type { App } from "./app"
import type { Brew } from "./brew"

/** How long the page has to draw "Restarting" before main is held by
 * the install: an AppImage's is done in this process. */
const SAID = 150

/** A download, as far as it is. */
export type Progress = { share: number; down?: number; size?: number }

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
   * comes as electron-updater's `error`, as a look's does, and the quit
   * installs a version ready when app.ts says so
   * (`autoUpdater.autoInstallOnAppQuit`). */
  readonly downloads: boolean
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
}

/** What an AppImage's or Windows' installer needs of the app, and the
 * AppImage this Banda runs from; none on Windows. */
type Swapped = Pick<App, "listApp" | "quits"> & { image: string | undefined }

/** An AppImage's installer, and Windows': electron-updater's. */
export function electronInstaller(mine: Swapped): Installer {
  const { image } = mine
  /** What hears the download that runs. */
  let taking: Taking | undefined
  autoUpdater.on(
    "download-progress",
    (progress: { percent: number; transferred?: number; total?: number }) =>
      taking?.progress({
        share: Math.min(1, progress.percent / 100),
        down: progress.transferred,
        size: progress.total,
      })
  )
  autoUpdater.on("update-downloaded", () => taking?.done(true))
  // Installed, the new AppImage took its own name when the old one's holds
  // a version, as Banda's do: the launcher's entry names it now, as the new
  // one would at its start (ADR 0041, decision 3).
  let installed = image
  autoUpdater.on("appimage-filename-updated", (path: string) => {
    installed = path
    mine.listApp(path)
  })
  return {
    name: "Banda",
    downloads: true,
    unseen: false,
    cannot(info) {
      // An AppImage Banda cannot replace downloads nothing.
      const unwritable = image && cannotWrite(image)
      return unwritable
        ? `${unwritable}, so ${info.version} cannot install`
        : undefined
    },
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
        // An AppImage is installed by the time it returns, and the new one
        // starts once this one is gone. Windows' installer shows Banda's
        // card while it works, as Banda has none then, and starts Banda
        // itself (client/desktop/setup).
        autoUpdater.quitAndInstall(image !== undefined, !installed)
        if (installed) startAfterImage(installed)
      }, SAID)
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
  }
}

/**
 * Starts the AppImage at `image`, with this Banda's arguments, once this
 * Banda is gone, so the new one gets the window and its lock. Not
 * `app.relaunch`: its helper runs from this AppImage, unmounted as Banda
 * exits. An AppImage keeps the APPIMAGE and APPDIR it is given, so the
 * new one gets none, and sets its own.
 */
function startAfterImage(image: string) {
  const env = { ...process.env }
  for (const name of ["APPIMAGE", "APPDIR", "ARGV0", "OWD"]) delete env[name]
  startAfter([image, ...process.argv.slice(1)], env)
}

/** Why Banda cannot replace the AppImage at `image`, if it cannot. */
function cannotWrite(image: string): string | undefined {
  for (const path of [dirname(image), image]) {
    try {
      accessSync(path, constants.W_OK)
    } catch {
      return `Banda cannot write ${path}`
    }
  }
  return undefined
}
