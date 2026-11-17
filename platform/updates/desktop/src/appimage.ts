/**
 * An AppImage's installer (ADR 0137, plan step 4): electron-updater
 * downloads the new file, and Banda swaps it in itself.
 *
 * - The file down is put beside the one that runs, under a name of its
 *   own (`.<name>.new`), as soon as it is down: a version is ready once
 *   installing it is one rename, which needs no room and cannot stop half
 *   way.
 * - Installing renames it into place. The file that runs is never
 *   removed, and its path is never empty: it stays beside the new one
 *   until the new Banda ran a minute.
 * - Banda quits and the new file starts once it is gone. One that ends
 *   badly in its first seconds is not the end: the old file starts again
 *   (after.ts), says what happened, and that version is not taken again.
 *
 * None of its housekeeping stops Banda from starting: what it cannot
 * read or remove it leaves, and says so in the log.
 */
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { copyFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { app } from "electron"
import { autoUpdater } from "electron-updater"
import { FELL_BACK, startAfterOr } from "./after"
import type { App } from "./app"
import { type Installer, progressOf, type Taking } from "./installer"
import { versionInName } from "./releases"

/** How long the new Banda runs before the file it updated from goes. */
const SETTLED = 60_000

/** What an AppImage's installer needs of the app. */
export type Imaged = Pick<App, "listApp" | "folder"> & {
  /** The AppImage this Banda runs from. */
  image: string
  /** The version that runs. */
  have: string
  /** The app's folder of data, where it keeps what it swapped. */
  data: string
}

/** The swap that was made: the file that ran, the one put in place, and
 * its version. Kept until the new one ran a minute. */
type Swap = { old: string; new: string; to: string }

/** A file down and put beside the one that runs, ready to be renamed
 * into place. */
type Placed = { beside: string; destination: string; version: string }

/** An AppImage's installer, for the Banda at `mine.image`. */
export function appImageInstaller(mine: Imaged): Installer {
  /** The file this Banda runs from: the old one's name again, once it
   * came back in place of one that did not start. */
  let image = mine.image
  const swapAt = join(mine.data, "update-swap.json")
  const badAt = join(mine.data, "update-bad.json")
  /** The versions that did not start here. */
  const bad = new Set<string>()
  /** What ends the wait for the file this Banda updated from to go. */
  let settling: (() => void) | undefined
  let failed: string | undefined
  try {
    const kept = read(badAt)
    if (Array.isArray(kept))
      for (const version of kept)
        if (typeof version === "string") bad.add(version)
    failed = settle()
    sweep()
  } catch (error) {
    console.warn("Banda could not tidy up after its last update:", error)
  }
  let taking: Taking | undefined
  let placed: Placed | undefined
  let swapped: Swap | undefined
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on("download-progress", (progress) =>
    taking?.progress(progressOf(progress))
  )
  autoUpdater.on(
    "update-downloaded",
    (down: { version: string; downloadedFile?: string }) => {
      const on = taking
      taking = undefined
      if (!on) return
      place(down.downloadedFile, down.version).then(
        (ready) => {
          placed = ready
          on.done(true)
        },
        (error: Error) => on.failed(error)
      )
    }
  )

  /** What the last swap left, as this Banda starts. The new one runs:
   * the old file goes once it ran a minute. The old one runs in place of
   * a new one that did not start, as the script that started it says:
   * that version is not taken again, and this one says so. */
  function settle(): string | undefined {
    const swap = read(swapAt) as Partial<Swap> | undefined
    const fell = process.env[FELL_BACK]
    delete process.env[FELL_BACK]
    if (!swap?.old || !swap.new || !swap.to) return undefined
    const { old, new: put, to } = swap as Swap
    if (image === put) {
      const done = () => {
        clearTimeout(timer)
        settling = undefined
        if (old !== put) remove(old)
        remove(swapAt)
      }
      const timer = setTimeout(done, SETTLED).unref()
      settling = done
      return undefined
    }
    // Started by hand from the old file: the new one says the rest once
    // it runs.
    if (image !== old || fell !== put) return undefined
    bad.add(to)
    keep(badAt, [...bad])
    // The old file takes its own name back, where it moved aside for the
    // new one; else the new one's file goes.
    if (old === `${put}.old`) {
      renameSync(old, put)
      image = put
      process.env.APPIMAGE = put
    } else remove(put)
    remove(swapAt)
    mine.listApp(image)
    return `${to} did not start, so ${mine.have} is back`
  }

  /** Whether `name` is a file this app put beside itself to install,
   * whole or still being copied. */
  const ours = (name: string) => {
    const of = /^\.(.+)\.new(\.part)?$/.exec(name)?.[1]
    return (
      of !== undefined &&
      (of === basename(image) || versionInName(of, mine.folder) !== undefined)
    )
  }

  /** Removes the files put beside Banda that were not installed: of a
   * version a newer one replaced, or withdrawn, or of a quit that
   * installed nothing. All but `keeping`. */
  function sweep(keeping?: string) {
    const dir = dirname(image)
    for (const name of readdirSync(dir))
      if (ours(name) && join(dir, name) !== keeping) remove(join(dir, name))
  }

  /** Puts the file down beside the one that runs. */
  async function place(
    file: string | undefined,
    version: string
  ): Promise<Placed> {
    if (!file) throw new Error("electron-updater named no file it downloaded")
    // A file whose name holds no version keeps the name the Person gave
    // it; Banda's own take the new version's.
    const named = versionInName(basename(image), mine.folder) !== undefined
    const name = named ? basename(file) : basename(image)
    const beside = join(dirname(image), `.${name}.new`)
    sweep()
    try {
      renameSync(file, beside)
    } catch (error) {
      // The cache is on another disk: copied, apart from main's work,
      // and whole before it has its name.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
      await copyFile(file, `${beside}.part`)
      renameSync(`${beside}.part`, beside)
      remove(file)
    }
    chmodSync(beside, 0o755)
    return { beside, destination: join(dirname(image), name), version }
  }

  /** Renames the file placed into place; the one that runs stays, and
   * its path is never empty. */
  function swap(ready: Placed): Swap {
    if (!existsSync(ready.beside))
      throw new Error(`the file of ${ready.version} is gone from beside Banda`)
    // The swap before this one is over: this Banda ran.
    settling?.()
    let old = image
    if (ready.destination === image) {
      // In place of the file that runs: that one is kept under a second
      // name first, and the new one then takes its place in one step.
      old = `${image}.old`
      remove(old)
      try {
        linkSync(image, old)
      } catch {
        copyFileSync(image, old)
      }
    }
    renameSync(ready.beside, ready.destination)
    const made = { old, new: ready.destination, to: ready.version }
    keep(swapAt, made)
    mine.listApp(ready.destination)
    placed = undefined
    return made
  }

  return {
    name: "Banda",
    downloads: true,
    unseen: false,
    failed,
    cannot(info) {
      if (bad.has(info.version))
        return `${info.version} did not start here before: Banda waits for the next version`
      const unwritable = cannotWrite(image)
      return unwritable
        ? `${unwritable}, so ${info.version} cannot install`
        : undefined
    },
    take(_info, on) {
      taking = on
      // The same error comes as an "error" event.
      autoUpdater.downloadUpdate().catch(() => {})
    },
    install(version) {
      const ready = placed
      if (!ready || ready.version !== version)
        return Promise.reject(
          new Error(`the file of ${version} is gone from beside Banda`)
        )
      try {
        swapped = swap(ready)
        return Promise.resolve(true)
      } catch (error) {
        return Promise.reject(error as Error)
      }
    },
    relaunch() {
      if (!swapped) return
      // The new file starts once this Banda is gone, and the old one if
      // that ends badly at once.
      startAfterOr(swapped.new, swapped.old)
      app.quit()
    },
    quitting(installs) {
      if (!installs || !placed) return
      try {
        swap(placed)
      } catch (error) {
        console.warn("Banda could not install its update as it quit:", error)
      }
    },
  }
}

/** What the file at `path` holds, if it reads. */
function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

/** Keeps `value` at `path`, whole or not at all; a folder that takes no
 * file loses only the way back. */
function keep(path: string, value: unknown) {
  try {
    writeFileSync(`${path}.new`, JSON.stringify(value))
    renameSync(`${path}.new`, path)
  } catch (error) {
    console.warn(`Banda could not keep ${path}:`, error)
  }
}

/** Removes the file at `path`; one that will not go stays, and is said. */
function remove(path: string) {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    console.warn(`Banda could not remove ${path}:`, error)
  }
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
