/**
 * Banda's own update (ADR 0041, decision 2). electron-updater reads the
 * channel's releases, a minute after the start and then every hour for
 * Banda Dev, every four for Banda; it downloads a new version at once and
 * installs it when Banda quits. Only an AppImage updates. On macOS, where
 * an app signed ad hoc cannot, Banda only looks, and says that a version
 * is out with the brew command that installs it (ADR 0033, decision 6).
 * Banda Local, run from a checkout, has none, and says nothing.
 *
 * What it tells the page is one `Update`, for the bar (decision 4). A look
 * or a download that fails for want of a network says nothing, and the
 * next look tries again; only what the Person has to mend shows. A look
 * the Person asks for says what it found, and "Update now" restarts into
 * the new version once it is down (ADR 0045).
 */
import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { dirname } from "node:path"
import type { Note, Update } from "@banda/web/host"
import { app } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import { CHANNELS, channel } from "./channel"
import { listApp } from "./entry"

const FIRST_LOOK = 60_000
const EVERY = (channel === CHANNELS.dev ? 1 : 4) * 3_600_000

/** What main does with Banda's update. */
export type Updates = {
  readonly current: () => Update
  /** Looks for a new version now, as the Person asked; not while one
   * downloads or is ready. */
  readonly check: () => void
  /** Restarts into a new version as soon as one is down, looking for it
   * first when none downloads (ADR 0045). */
  readonly now: () => void
  /** Keeps the version that downloads for the quit. */
  readonly later: () => void
  /** Installs the version that is ready and starts it; nothing if none is. */
  readonly restart: () => void
}

/** Starts looking for Banda's update; `tell` hears each change. */
export function updates(tell: (now: Update) => void): Updates {
  const image = process.env.APPIMAGE
  const brew =
    process.platform === "darwin" &&
    app.isPackaged &&
    channel !== CHANNELS.local
  const known = {
    name: channel.name,
    have: app.getVersion(),
    always: Boolean(image || brew) && channel === CHANNELS.dev,
  }
  const { have } = known
  let now: Update = { ...known, state: "none" }
  if (!image && brew) return brewUpdates(known, tell)
  if (!image) {
    const nothing = () => {}
    return {
      current: () => now,
      check: nothing,
      now: nothing,
      later: nothing,
      restart: nothing,
    }
  }
  const set = (next: DistributiveOmit<Update, keyof typeof known>) => {
    now = { ...known, ...next }
    tell(now)
  }
  // The Person asked for the look that runs (it says what it found), and
  // for a restart once its version is down.
  let asked = false
  let restarts = false
  let looked: number | undefined
  const rest = (missed?: string) => {
    asked = restarts = false
    set({ state: "none", looked, missed })
  }
  const fail = (reason: string) => {
    asked = restarts = false
    set({ state: "failed", reason })
  }

  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.fullChangelog = true
  autoUpdater.logger = { info() {}, debug() {}, warn: console.warn, error() {} }
  // A newer version while one is ready keeps the ready one shown, until
  // the newer one is down.
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (now.state !== "ready")
      set({
        state: "downloading",
        version: info.version,
        share: 0,
        notes: notesOf(info, have),
        restarts,
      })
  })
  autoUpdater.on("download-progress", ({ percent }: { percent: number }) => {
    if (now.state === "downloading")
      set({ ...now, share: Math.min(1, percent / 100) })
  })
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    asked = false
    const unwritable = cannotWrite(image)
    if (unwritable) {
      fail(`${unwritable}, so ${info.version} cannot install`)
      return
    }
    set({ state: "ready", version: info.version, notes: notesOf(info, have) })
    if (restarts) restart()
  })
  // Installed, the new AppImage took its own name when the old one's holds
  // a version, as Banda's do: the launcher's entry names it now, as the new
  // one would at its start (ADR 0041, decision 3).
  let installed = image
  autoUpdater.on("appimage-filename-updated", (path: string) => {
    installed = path
    listApp(path)
  })
  autoUpdater.on("update-not-available", () => {
    looked = Date.now()
    if (now.state !== "ready" && now.state !== "failed") rest()
  })
  autoUpdater.on("error", (error: Error) => {
    console.warn("Banda could not update itself:", error.message)
    if (needsPerson(error)) fail(error.message)
    else if (asked) {
      looked = Date.now()
      rest(firstLine(error.message))
    } else if (now.state === "downloading") rest()
  })

  const look = (byPerson: boolean) => {
    if (now.state === "ready" || now.state === "downloading") return
    // Banda's widget says nothing with nothing new: its look stays quiet,
    // as ADR 0041 has it.
    if (byPerson && known.always) {
      asked = true
      set({ state: "looking" })
    }
    // The same error comes as an "error" event.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  const restart = () => {
    if (now.state !== "ready") return
    // Installed by the time it returns; the app quits right after.
    autoUpdater.quitAndInstall(true, false)
    startAfter(installed)
  }
  setTimeout(() => look(false), FIRST_LOOK)
  setInterval(() => look(false), EVERY)
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
      restarts = false
      if (now.state === "downloading") set({ ...now, restarts })
    },
    restart,
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
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.fullChangelog = true
  autoUpdater.logger = { info() {}, debug() {}, warn: console.warn, error() {} }
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    asked = false
    set({
      state: "out",
      version: info.version,
      notes: notesOf(info, known.have),
      command,
    })
  })
  autoUpdater.on("update-not-available", () => {
    looked = Date.now()
    asked = false
    if (now.state !== "out") set({ state: "none", looked })
  })
  autoUpdater.on("error", (error: Error & { code?: string }) => {
    console.warn("Banda could not look for its update:", error.message)
    // Linux publishes first; the Mac's files arrive a few minutes later.
    // Keep looking soon, even when this was a background check.
    const publishing = error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
    if (publishing && retry === undefined)
      retry = setTimeout(() => look(false), FIRST_LOOK)
    if (!asked) return
    asked = false
    looked = Date.now()
    if (now.state !== "out")
      set({
        state: "none",
        looked,
        missed: publishing
          ? "The macOS release is still publishing; checking again in a minute"
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
  setTimeout(() => look(false), FIRST_LOOK)
  setInterval(() => look(false), EVERY)
  const nothing = () => {}
  return {
    current: () => now,
    check: () => look(true),
    now: () => look(true),
    later: nothing,
    restart: nothing,
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

/** What changed since `have`, newest first, as text: GitHub gives each
 * release's notes as HTML. */
export function notesOf(info: UpdateInfo, have: string): Note[] {
  const notes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes
    : [{ version: info.version, note: info.releaseNotes ?? null }]
  return notes
    .filter((n) => n.version !== have && n.note)
    .map((n) => ({ version: n.version, text: textOf(n.note ?? "") }))
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
}

/** A block's tags part words; an inline one's, as `<code>`, do not. */
function textOf(html: string): string {
  return html
    .replace(/<\/?(p|br|li|ul|ol|div|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/\s+/g, " ")
    .trim()
}
