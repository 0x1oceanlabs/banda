/**
 * Banda's own update (ADR 0041, decision 2). electron-updater reads each
 * app's own source (releases.ts, ADR 0092, decision 12) a minute after the
 * start or a wake, then every hour, also while a version is ready; it
 * downloads a new version at once and installs it on Restart, or when
 * Banda quits, if a look at most an hour old still offered it. Only an
 * AppImage updates. On macOS, where an app signed ad hoc cannot, Banda
 * only looks, and says that a version is out with the brew command that
 * installs it (ADR 0033, decision 6). Banda Local, run from a checkout,
 * has none, and says nothing; nor does a Banda run with
 * `BANDA_UPDATES=off`, for trials and CI (ADR 0092, decision 12).
 *
 * What it tells the page is one `Update`, for the bar (decision 4). A look
 * or a download that fails for want of a network says nothing, and the
 * next look tries again; only what the Person has to mend shows, and a
 * Restart that could not check its version is still out. A look the Person
 * asks for says what it found, and "Update now" restarts into the new
 * version once it is down (ADR 0045). "Restart when idle" outlasts a
 * network that is down.
 */
import { spawn } from "node:child_process"
import {
  accessSync,
  constants,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import type { Note, Update } from "@banda/web/host"
import { app, powerMonitor } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import { CHANNELS, channel } from "./channel"
import { listApp, listedImage } from "./entry"
import { isAbove, sourceOf, versionInName } from "./releases"

const FIRST_LOOK = 60_000
const EVERY = 3_600_000
/** How old the last look may be for a quit to install what it offered:
 * an hour, and a minute for the hourly look to come back. */
const FRESH = EVERY + FIRST_LOOK
/** How many looks a minute apart wait for a Mac's files, which come
 * within ten minutes of the release: a pack that failed sends none. */
const RETRIES = 15

/** What main does with Banda's update. */
export type Updates = {
  readonly current: () => Update
  /** Looks for a new version now, as the Person asked; not while one
   * downloads. */
  readonly check: () => void
  /** Restarts into a new version as soon as one is down, looking for it
   * first when none downloads (ADR 0045). */
  readonly now: () => void
  /** Keeps the version that downloads for the quit. */
  readonly later: () => void
  /** Installs the version that is ready and starts it; nothing if none
   * is. When the last look is over an hour old, only once a look offers it
   * again. */
  readonly restart: () => void
  /** Restarts into the version that is ready once no Thread works; the
   * window asks for the restart (ADR 0072, decision 3). */
  readonly wait: () => void
  /** The Person saw that Banda updated: `none` again. */
  readonly seen: () => void
}

/** Starts looking for Banda's update; `tell` hears each change, and
 * `before` runs before a restart into the new version, as the engine
 * stops. */
export function updates(
  tell: (now: Update) => void,
  before: () => Promise<void> = async () => {}
): Updates {
  const image = process.env.APPIMAGE
  const brew = process.platform === "darwin" && app.isPackaged
  // On Linux only an AppImage: Banda from the AUR has no APPIMAGE, and
  // its `package-type` (scripts/aur.mjs) would turn electron-updater to
  // `sudo pacman -U`.
  const looks =
    channel !== CHANNELS.local &&
    process.env.BANDA_UPDATES !== "off" &&
    Boolean(image || brew)
  const known = {
    name: channel.name,
    have: app.getVersion(),
    always: looks && channel === CHANNELS.dev,
  }
  const { have } = known
  let now: Update = { ...known, state: "none" }
  if (!looks) {
    const nothing = () => {}
    return {
      current: () => now,
      check: nothing,
      now: nothing,
      later: nothing,
      restart: nothing,
      wait: nothing,
      seen: nothing,
    }
  }
  autoUpdater.setFeedURL(sourceOf(channel === CHANNELS.dev ? "dev" : "stable"))
  // Banda downloads what a look offers itself, or brew installs it: a look
  // while a version is ready offers it again, and downloading it again
  // would start it over.
  autoUpdater.autoDownload = false
  autoUpdater.fullChangelog = true
  autoUpdater.logger = { info() {}, debug() {}, warn: console.warn, error() {} }
  if (!image) return brewUpdates(known, tell)
  // The Banda this one restarted from left what it was (ADR 0072,
  // decision 4).
  const left = leftBehind(have)
  if (left) now = { ...known, state: "updated", ...left }
  const set = (next: DistributiveOmit<Update, keyof typeof known>) => {
    now = { ...known, ...next }
    tell(now)
  }
  // The Person asked for the look that runs (it says what it found), and
  // for a restart once its version is down.
  let asked = false
  let restarts = false
  // The Person asked to restart once no Thread works ("Restart when idle"):
  // kept through looks and downloads that fail for want of a network, and
  // for a newer version that takes the place of the one ready.
  let idle = false
  // A restart waits for the look that runs to offer the version ready
  // again, as the last one is over an hour old.
  let confirms = false
  // Banda restarts into the version ready: no look or answer changes it
  // while the engine stops, nor deletes its file.
  let restarting = false
  let looked: number | undefined
  /** The version the last look offered, `have` when none, and when it
   * came back: a quit or a restart installs only that one (ADR 0092,
   * decision 12). */
  let offered: Offered | undefined
  const rest = (missed?: string) => {
    asked = restarts = confirms = false
    set({ state: "none", looked, missed })
  }
  const fail = (reason: string) => {
    asked = restarts = confirms = idle = false
    set({ state: "failed", reason })
  }

  // The quit installs only what `installsAtQuit` says, set as Banda quits:
  // electron-updater reads this at the quit, and after a download only
  // listens for the quit while it is on.
  autoUpdater.autoInstallOnAppQuit = true
  app.on("will-quit", () => {
    const listed = listedImage()
    autoUpdater.autoInstallOnAppQuit = installsAtQuit({
      ready: now.state === "ready" ? now.version : undefined,
      offered,
      listed: listed && versionInName(basename(listed), channel.folder),
      at: Date.now(),
    })
  })
  // A newer version replaces one that is ready: electron-updater keeps one
  // download, and the newer one's takes its place.
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (restarting) return
    offered = { version: info.version, at: Date.now() }
    if (now.state === "ready" && now.version === info.version) {
      if (confirms) restart()
      // A look that failed held "Restart when idle" back: the window asks
      // for the restart again once no Thread works.
      else if (idle && !now.waits) set({ ...now, waits: true })
      return
    }
    // An AppImage Banda cannot replace downloads nothing.
    const unwritable = cannotWrite(image)
    if (unwritable) {
      fail(`${unwritable}, so ${info.version} cannot install`)
      return
    }
    if (now.state === "ready" && confirms) restarts = true
    confirms = false
    set({
      state: "downloading",
      version: info.version,
      share: 0,
      notes: notesOf(info, have),
      restarts: restarts || idle,
    })
    // The same error comes as an "error" event.
    autoUpdater.downloadUpdate().catch(() => {})
  })
  autoUpdater.on(
    "download-progress",
    (progress: { percent: number; transferred?: number; total?: number }) => {
      if (now.state === "downloading")
        set({
          ...now,
          share: Math.min(1, progress.percent / 100),
          down: progress.transferred,
          size: progress.total,
        })
    }
  )
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    asked = false
    // "Update now" restarts once no Thread works, as "Restart when idle"
    // does: the window asks for it (ADR 0072, decision 3).
    set({
      state: "ready",
      version: info.version,
      notes: notesOf(info, have),
      waits: restarts || idle,
    })
  })
  // Installed, the new AppImage took its own name when the old one's holds
  // a version, as Banda's do: the launcher's entry names it now, as the new
  // one would at its start (ADR 0041, decision 3).
  let installed = image
  autoUpdater.on("appimage-filename-updated", (path: string) => {
    installed = path
    listApp(path)
  })
  // Nothing above `have`: a version ready, or that could not install, was
  // withdrawn, and goes (ADR 0092, decision 10).
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    if (restarting) return
    looked = Date.now()
    offered = { version: info.version, at: looked }
    if (now.state === "ready")
      console.warn(`Banda ${now.version} is no longer out: it will not install`)
    if (["ready", "failed", "looking", "none"].includes(now.state)) {
      idle = false
      rest()
    }
  })
  autoUpdater.on("error", (error: Error & { code?: string }) => {
    console.warn("Banda could not update itself:", error.message)
    if (needsPerson(error)) fail(error.message)
    else if (confirms && now.state === "ready") {
      // No look says the version ready is still out, so no restart into
      // it. "Restart when idle" stays, and comes back with the next look
      // that offers the version again, a minute after a wake at the
      // latest; a Restart the Person clicked says why nothing happened.
      confirms = false
      if (now.waits) {
        idle = true
        set({ ...now, waits: false })
      } else
        fail(
          `Could not check that ${now.version} is still out: ${firstLine(error.message)}`
        )
    } else if (asked) {
      looked = Date.now()
      rest(firstLine(error.message))
    } else if (now.state === "downloading") rest()
  })

  const look = (byPerson: boolean) => {
    if (restarting || now.state === "downloading") return
    // Banda's widget says nothing with nothing new: its look stays quiet,
    // as ADR 0041 has it; and one ready stays shown while Banda looks.
    if (byPerson && known.always && now.state !== "ready") {
      asked = true
      set({ state: "looking" })
    }
    // The same error comes as an "error" event.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  const restart = () => {
    if (now.state !== "ready" || restarting) return
    const ready = now
    // After a sleep or looks that failed, a look first: the version may
    // have been withdrawn since (ADR 0092, decision 10).
    if (!isOffered(offered, ready.version, Date.now())) {
      confirms = true
      look(false)
      return
    }
    confirms = false
    restarting = true
    void before().finally(() => {
      leave({ from: have, to: ready.version, notes: ready.notes })
      // Installed by the time it returns; the app quits right after.
      autoUpdater.quitAndInstall(true, false)
      startAfter(installed)
    })
  }
  lookOften(() => look(false))
  return {
    current: () => now,
    check: () => look(true),
    now() {
      restarts = true
      if (now.state === "ready") restart()
      else if (now.state === "downloading") set({ ...now, restarts })
      else look(true)
    },
    later() {
      restarts = confirms = idle = false
      if (now.state === "downloading") set({ ...now, restarts })
      if (now.state === "ready") set({ ...now, waits: false })
    },
    restart,
    wait() {
      if (now.state !== "ready") return
      idle = true
      set({ ...now, waits: true })
    },
    seen() {
      if (now.state === "updated") set({ state: "none", looked })
    },
  }
}

/** The version a look offered, `have` when nothing is above it, and when
 * the look came back. */
export type Offered = { version: string; at: number }

/** Whether the last look, at most an hour old at `at`, offered
 * `version`: one withdrawn since is not. */
function isOffered(
  offered: Offered | undefined,
  version: string,
  at: number
): boolean {
  return offered?.version === version && at - offered.at <= FRESH
}

/**
 * Whether quitting installs the version that is `ready` (ADR 0092,
 * decision 12): only when the last look, at most an hour old, still
 * offered it, so one withdrawn since is dropped; and never one at or below
 * the version the launcher's entry starts, `listed`, as when a newer Banda
 * started from another file since.
 */
export function installsAtQuit(quit: {
  ready: string | undefined
  offered: Offered | undefined
  listed: string | undefined
  at: number
}): boolean {
  const { ready, offered, listed, at } = quit
  if (ready === undefined || !isOffered(offered, ready, at)) return false
  return listed === undefined || isAbove(ready, listed)
}

/** Runs `look` a minute after the start, then hourly, and a minute after
 * the machine wakes: a timer stands still while it sleeps, and the network
 * comes back after it wakes. */
function lookOften(look: () => void) {
  setTimeout(look, FIRST_LOOK)
  setInterval(look, EVERY)
  powerMonitor.on("resume", () => setTimeout(look, FIRST_LOOK))
}

/** What a Banda that restarts into a new version leaves for it (ADR 0072,
 * decision 4). */
type Left = { from: string; to: string; notes: Note[] }

/** Where it leaves it: the app's folder of data, the same for both. */
const leftAt = () => join(app.getPath("userData"), "update.json")

/** Leaves `left` for the Banda that starts next. */
function leave(left: Left) {
  try {
    writeFileSync(leftAt(), JSON.stringify(left))
  } catch (error) {
    console.warn("Banda could not say what it updated from:", error)
  }
}

/** What the Banda this one restarted from left, when it restarted into
 * `have`; the file goes either way. */
function leftBehind(have: string): Omit<Left, "to"> | undefined {
  const at = leftAt()
  let text: string
  try {
    text = readFileSync(at, "utf8")
  } catch {
    return undefined
  }
  rmSync(at, { force: true })
  return arrivedAt(text, have)
}

/** What `text`, as `leave` wrote it, says Banda updated from, when it
 * restarted into `have`. */
export function arrivedAt(
  text: string,
  have: string
): Omit<Left, "to"> | undefined {
  try {
    const left = JSON.parse(text) as Partial<Left>
    if (left.to !== have || typeof left.from !== "string") return undefined
    return {
      from: left.from,
      notes: Array.isArray(left.notes) ? left.notes : [],
    }
  } catch {
    return undefined
  }
}

/**
 * macOS's: electron-updater only looks, at the same times, and a version
 * out is `out`, with the brew command that installs it. "Update now" is
 * a look the Person asked for.
 */
export function brewUpdates(
  known: { name: string; have: string; always: boolean },
  tell: (now: Update) => void
): Updates {
  let now: Update = { ...known, state: "none" }
  const set = (next: DistributiveOmit<Update, keyof typeof known>) => {
    now = { ...known, ...next }
    tell(now)
  }
  // `brew upgrade` alone reads the tap as it was at the last `brew update`,
  // which may be a day old: one line that works as it is copied.
  const command = `brew update && brew upgrade --cask ${channel.folder}`
  let asked = false
  let looked: number | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    asked = false
    retries = 0
    set({
      state: "out",
      version: info.version,
      notes: notesOf(info, known.have),
      command,
    })
  })
  // Nothing above `have`: a version out was withdrawn, and goes (ADR
  // 0092, decision 10).
  autoUpdater.on("update-not-available", () => {
    looked = Date.now()
    asked = false
    retries = 0
    set({ state: "none", looked })
  })
  autoUpdater.on("error", (error: Error & { code?: string }) => {
    console.warn("Banda could not look for its update:", error.message)
    // Linux publishes first; the Mac's files arrive a few minutes later.
    // Keep looking soon, even when this was a background check, until
    // ADR 0092's step 5 publishes a release with all its files.
    const publishing = error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
    if (publishing && retry === undefined && retries < RETRIES) {
      retries += 1
      retry = setTimeout(() => look(false), FIRST_LOOK)
    }
    if (!asked) return
    asked = false
    looked = Date.now()
    if (now.state !== "out")
      set({
        state: "none",
        looked,
        missed: publishing
          ? `The macOS release is still publishing${retry ? "; checking again in a minute" : ""}`
          : firstLine(error.message),
      })
  })
  const look = (byPerson: boolean) => {
    clearTimeout(retry)
    retry = undefined
    if (byPerson && known.always) {
      asked = true
      if (now.state !== "out") set({ state: "looking" })
    }
    // The same error comes as an "error" event.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  lookOften(() => look(false))
  const nothing = () => {}
  return {
    current: () => now,
    check: () => look(true),
    now: () => look(true),
    later: nothing,
    restart: nothing,
    wait: nothing,
    seen: nothing,
  }
}

/** An error's first line: electron-updater's HTTP errors carry their
 * headers after it. */
export function firstLine(message: string): string {
  return message.split("\n", 1)[0]!.trim()
}

/**
 * Starts the AppImage at `image`, with this Banda's arguments, once this
 * Banda is gone, so the new one gets the window and its lock. Not
 * `app.relaunch`: its helper runs from this AppImage, unmounted as Banda
 * exits. The shell closes what it got open from Banda (its profile's
 * locks, this AppImage's folder) before it starts the new one; an
 * AppImage keeps the APPIMAGE and APPDIR it is given, so the new one gets
 * none, and sets its own.
 */
function startAfter(image: string) {
  const env = { ...process.env }
  for (const name of ["APPIMAGE", "APPDIR", "ARGV0", "OWD"]) delete env[name]
  spawn(
    "/bin/bash",
    ["-c", START_AFTER, String(process.pid), image, ...process.argv.slice(1)],
    {
      detached: true,
      stdio: "ignore",
      env,
    }
  ).unref()
}

/** `bash -c START_AFTER PID IMAGE ARGS…`: what `startAfter` runs. */
const START_AFTER = [
  'for fd in /proc/self/fd/*; do n=${fd##*/}; ((n > 2)) && eval "exec $n>&-"; done 2>/dev/null',
  'while kill -0 "$0" 2>/dev/null; do sleep 0.2; done',
  'exec "$@"',
].join("; ")

/** Omit, over each member of a union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

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

/** A failure that a later look cannot mend: a file Banda may not write,
 * a full disk. A network that is down, a release without its update file,
 * mend themselves. */
export function needsPerson(error: Error & { code?: string }): boolean {
  return ["EACCES", "EPERM", "EROFS", "ENOSPC"].includes(error.code ?? "")
}

/** What changed since `have`, newest first: each release's notes as
 * text (releases.ts), a line apiece, with no blank ones. */
export function notesOf(info: UpdateInfo, have: string): Note[] {
  const notes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes
    : [{ version: info.version, note: info.releaseNotes ?? null }]
  return notes
    .map((n) => ({ version: n.version, text: linesOf(n.note ?? "") }))
    .filter((n) => n.version !== have && n.text)
}

/** `text`'s lines, each trimmed, with no blank ones. */
function linesOf(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}
