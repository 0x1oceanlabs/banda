/**
 * The updates module's part in the window's main process (ADR 0119,
 * decision 2; ADR 0028): it carries out what only the window can, the
 * swap of its own app, and decides nothing the engine decides. The
 * engine's updates module looks at the channel's releases by its rules,
 * at its times and when the Person asks (`updates.check`), and says the
 * newest on `updates.state` (`heard`); then this part reads that release
 * for its app (releases.ts) with electron-updater, downloads it at once,
 * and installs it on Restart, or when Banda quits, if a look at most an
 * hour old still offered it (ADR 0041, decision 2; ADR 0092, decision
 * 12). An AppImage updates so. On macOS, where an app signed ad hoc
 * cannot swap itself, brew takes it while Banda runs, and installs it on
 * Restart, or by itself once no window shows (ADR 0121); a Banda brew
 * did not install only says that a version is out, with the brew command
 * that installs it (ADR 0033, decision 6). Banda Local, run from a
 * checkout, has none, and says nothing; nor does a Banda run with
 * `BANDA_UPDATES=off`, for trials and CI; and where the engine takes
 * nothing (`off`: `updates = "off"`, a package manager's Banda), the app
 * takes nothing either.
 *
 * The app restarts at once when the Person says: the engine and its
 * Agents go on, as when the window closes (ADR 0086, decision 3), and
 * the engine moves onto its new copy once nothing runs (ADR 0119,
 * decision 4).
 *
 * What it tells the page is one `Update`, for the bar (ADR 0041,
 * decision 4). A look or a download that fails for want of a network
 * says nothing, and the next look tries again; only what the Person has
 * to mend shows, and a Restart that could not check its version is still
 * out. A look the Person asks for says what it found, and "Update now"
 * restarts into the new version once it is down (ADR 0045).
 */
import {
  accessSync,
  constants,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import type { Note, Update } from "@banda/core"
import type { Engine as Client } from "@banda/contract"
import {
  UPDATES_CHECK,
  UPDATES_STATE,
  type UpdateState,
} from "@banda/contract/updates"
import { app } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import { startAfter } from "./after"
import { type Brew, brewOf } from "./brew"
import { isAbove, sourceOf, versionInName, type Which } from "./releases"

/** How long after a Mac's files are found missing it reads again. */
const RETRY = 60_000
/** How old the last look may be for a quit to install what it offered:
 * an hour, as the engine looks hourly, and a minute for it to come back. */
const FRESH = 3_600_000 + RETRY
/** How many looks a minute apart wait for a Mac's files, which come
 * within ten minutes of the release: a pack that failed sends none. */
const RETRIES = 15
/** How often a Mac's Banda with a version ready looks whether a window
 * shows: two looks with none, and it restarts into it. */
const ALONE = 30_000

/** The app this window is, as main knows it. */
export type App = {
  /** Its name, `Banda Dev`. */
  name: string
  /** Its folder, which its files' names start with: `banda-dev`. */
  folder: string
  /** Its channel; `local` for a checkout's, which takes nothing. */
  which: Which | "local"
  /** Where its releases are, as GitHub names the repository. */
  repository: { owner: string; repo: string }
  /** Names `image` in the launcher's entry (entry.ts). */
  listApp: (image: string) => void
  /** The AppImage the launcher's entry starts, if it names one. */
  listedImage: () => string | undefined
  /** Whether no window of it shows, on macOS, as it lives in the menu
   * bar: it may restart into a new version unseen. */
  alone: () => boolean
  /** Whether it quits now, as the Person or macOS asked. */
  quits: () => boolean
}

/** What the window says of its app whatever its state. */
type Known = { name: string; have: string; always: boolean }

/** What it asks of this machine's engine: a look now, as the Person
 * asked, which answers the state it found (`updates.check`). */
export type Engine = { check: () => Promise<UpdateState> }

/** What main does with Banda's update. */
export type Updates = {
  readonly current: () => Update
  /** What the engine says on `updates.state`, each change. */
  readonly heard: (state: UpdateState) => void
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
  /** The Person saw that Banda updated: `none` again. */
  readonly seen: () => void
}

/** Banda's update for `mine`; `tell` hears each change, and `leaving` is
 * called as Banda quits to install it. */
export function updates(
  mine: App,
  engine: Engine,
  tell: (now: Update) => void,
  leaving: () => void = () => {}
): Updates {
  const image = process.env.APPIMAGE
  const brew = process.platform === "darwin" && app.isPackaged
  // On Linux only an AppImage: Banda from the AUR has no APPIMAGE, and
  // its `package-type` (scripts/aur.mjs) would turn electron-updater to
  // `sudo pacman -U`.
  const which = mine.which === "local" ? undefined : mine.which
  const looks =
    which !== undefined &&
    process.env.BANDA_UPDATES !== "off" &&
    Boolean(image || brew)
  const known: Known = {
    name: mine.name,
    have: app.getVersion(),
    always: looks && which === "dev",
  }
  const { have } = known
  let now: Update = { ...known, state: "none" }
  if (!looks || !which) {
    const nothing = () => {}
    return {
      current: () => now,
      heard: nothing,
      check: nothing,
      now: nothing,
      later: nothing,
      restart: nothing,
      seen: nothing,
    }
  }
  /** The engine's last word: the release the looks read. */
  let said: UpdateState | undefined
  autoUpdater.setFeedURL(
    sourceOf({
      which,
      folder: mine.folder,
      repository: mine.repository,
      newest: () => said?.newest,
    })
  )
  // Banda downloads what a look offers itself, or brew takes it: a look
  // while a version is ready offers it again, and downloading it again
  // would start it over.
  autoUpdater.autoDownload = false
  autoUpdater.fullChangelog = true
  autoUpdater.logger = { info() {}, debug() {}, warn: console.warn, error() {} }
  const looking = engineLooks(engine)
  // The Banda this one restarted from left what it was (ADR 0072,
  // decision 4).
  const left = leftBehind(have)
  if (!image) {
    const brewed = brewUpdates(mine, known, looking, tell, {
      brew: brewOf(mine.folder, process.execPath),
      leaving,
      left,
    })
    return {
      ...brewed,
      heard(state) {
        said = state
        brewed.heard(state)
      },
    }
  }
  if (left) now = { ...known, state: "updated", ...left }
  const set = (next: DistributiveOmit<Update, keyof Known>) => {
    now = { ...known, ...next }
    tell(now)
  }
  // The Person asked for the look that runs (it says what it found), and
  // for a restart once its version is down.
  let asked = false
  let restarts = false
  // A restart waits for the look that runs to offer the version ready
  // again, as the last one is over an hour old.
  let confirms = false
  // Banda restarts into the version ready: no look or answer changes it
  // as it quits, nor deletes its file.
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
    asked = restarts = confirms = false
    set({ state: "failed", reason })
  }

  // The quit installs only what `installsAtQuit` says, set as Banda quits:
  // electron-updater reads this at the quit, and after a download only
  // listens for the quit while it is on.
  autoUpdater.autoInstallOnAppQuit = true
  app.on("will-quit", () => {
    const listed = mine.listedImage()
    autoUpdater.autoInstallOnAppQuit = installsAtQuit({
      ready: now.state === "ready" ? now.version : undefined,
      offered,
      listed: listed && versionInName(basename(listed), mine.folder),
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
      restarts,
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
    set({ state: "ready", version: info.version, notes: notesOf(info, have) })
    // "Update now" restarts once it is down (ADR 0045).
    if (restarts) restart()
  })
  // Installed, the new AppImage took its own name when the old one's holds
  // a version, as Banda's do: the launcher's entry names it now, as the new
  // one would at its start (ADR 0041, decision 3).
  let installed = image
  autoUpdater.on("appimage-filename-updated", (path: string) => {
    installed = path
    mine.listApp(path)
  })
  // Nothing above `have`: a version ready, or that could not install, was
  // withdrawn, and goes (ADR 0092, decision 10).
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    if (restarting) return
    looked = Date.now()
    offered = { version: info.version, at: looked }
    if (now.state === "ready")
      console.warn(`Banda ${now.version} is no longer out: it will not install`)
    if (["ready", "failed", "looking", "none"].includes(now.state)) rest()
  })
  autoUpdater.on("error", (error: Error & { code?: string }) => {
    console.warn("Banda could not update itself:", error.message)
    if (needsPerson(error)) fail(error.message)
    else if (confirms && now.state === "ready") {
      // No look says the version ready is still out, so no restart into
      // it: the Restart the Person clicked says why nothing happened.
      confirms = false
      fail(
        `Could not check that ${now.version} is still out: ${firstLine(error.message)}`
      )
    } else if (asked) {
      looked = Date.now()
      rest(firstLine(error.message))
    } else if (now.state === "downloading") rest()
  })

  /** Reads the release the engine said is newest. */
  const read = () => {
    if (restarting || now.state === "downloading") return
    // The same error comes as an "error" event.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  /** Asks the engine to look now, as the Person did, or as a restart
   * after an hour with no look does; its answer is read as it comes. */
  const look = (byPerson: boolean) => {
    if (restarting || now.state === "downloading") return
    // Banda's widget says nothing with nothing new: its look stays quiet,
    // as ADR 0041 has it; and one ready stays shown while Banda looks.
    if (byPerson && known.always && now.state !== "ready") {
      asked = true
      set({ state: "looking" })
    }
    looking.now(
      (state) => heard(state),
      (missed) => {
        if (confirms && now.state === "ready") {
          confirms = false
          fail(`Could not check that ${now.version} is still out: ${missed}`)
        } else if (asked) {
          looked = Date.now()
          rest(missed)
        }
      }
    )
  }
  const heard = (state: UpdateState) => {
    said = state
    if (!looking.anew(state)) return
    if (state.off) {
      // The engine takes nothing here, and the app neither.
      if (asked) rest(state.off)
      return
    }
    read()
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
    leaving()
    leave({ from: have, to: ready.version, notes: ready.notes })
    // Installed by the time it returns; the app quits right after.
    autoUpdater.quitAndInstall(true, false)
    startAfterImage(installed)
  }
  return {
    current: () => now,
    heard,
    check: () => look(true),
    now() {
      restarts = true
      if (now.state === "ready") restart()
      else if (now.state === "downloading") set({ ...now, restarts })
      else look(true)
    },
    later() {
      restarts = confirms = false
      if (now.state === "downloading") set({ ...now, restarts })
    },
    restart,
    seen() {
      if (now.state === "updated") set({ state: "none", looked })
    },
  }
}

/**
 * Hears this machine's `updates.state` on `client`, each change, for
 * `heard`. An engine that runs another version than `have`, the app's,
 * is asked to look at once: its copy of the app's engine is in place
 * beside it (program.ts), and the engine moves onto it as onto one it
 * took, once nothing runs; an older engine than the window's is never
 * left waiting an hour for its next look. Returns what stops hearing.
 */
export function followEngine(
  client: Client,
  have: string,
  heard: (state: UpdateState) => void
): () => void {
  let first = true
  return client.stream(
    undefined,
    UPDATES_STATE,
    {},
    (state) => {
      if (first && state.running !== have && !state.off)
        client.call(UPDATES_CHECK, {}).catch(() => {})
      first = false
      heard(state)
    },
    (refusal) => {
      if (refusal)
        console.warn(`Banda's engine says no updates: ${refusal.message}`)
    }
  )
}

/** The engine's looks, as the window follows them: `anew` says whether a
 * state it said is of a look not yet read, and `now` asks for one. */
function engineLooks(engine: Engine) {
  let read: number | undefined
  let reading = false
  return {
    anew(state: UpdateState): boolean {
      // Off, the engine looks at nothing: only a look asked for hears it.
      if (state.off) {
        const was = reading
        reading = false
        return was
      }
      if (state.looked === undefined || state.looked === read) return false
      read = state.looked
      reading = false
      return true
    },
    now(heard: (state: UpdateState) => void, missed: (why: string) => void) {
      reading = true
      engine.check().then(
        (state) => {
          // The stream may have said it first.
          if (reading) heard(state)
        },
        (error: Error) => {
          reading = false
          missed(firstLine(error.message))
        }
      )
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
 * macOS's (ADR 0121): electron-updater only reads the release the engine
 * says is newest, and brew takes it. Once the tap's cask has that
 * version, its zip comes into brew's cache while Banda runs, and the
 * version is `ready`: Restart installs it with `brew upgrade` and opens
 * Banda again, the engine and its Agents going on. With no window shown,
 * as Banda lives in the menu bar, it restarts so by itself, unseen, and
 * opens again with no window; never under the Person's hands. A Banda
 * brew did not install, or a brew that fails, says the version is `out`,
 * with the command that installs it. "Update now" is a look the Person
 * asked for, and a restart once its version is down.
 */
export function brewUpdates(
  mine: Pick<App, "folder" | "alone" | "quits">,
  known: Known,
  looking: ReturnType<typeof engineLooks>,
  tell: (now: Update) => void,
  hands: {
    /** The cask that installed this Banda, if brew did. */
    brew: Brew | undefined
    /** Called as Banda quits to install it. */
    leaving: () => void
    /** What the Banda this one restarted from left. */
    left?: Omit<Left, "to">
  }
): Updates {
  const { brew, leaving, left } = hands
  let now: Update = left
    ? { ...known, state: "updated", ...left }
    : { ...known, state: "none" }
  const set = (next: DistributiveOmit<Update, keyof Known>) => {
    now = { ...known, ...next }
    tell(now)
  }
  // `brew upgrade` alone reads the tap as it was at the last `brew update`,
  // which may be a day old: one line that works as it is copied.
  const command = `brew update && brew upgrade --cask ${mine.folder}`
  let asked = false
  let looked: number | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  /** The reads a minute apart that wait for the Mac's files, and for the
   * tap's cask of `version`: each waits at most RETRIES times. */
  const files = { tries: 0 }
  const tap = { version: "", tries: 0 }
  // The Person asked for a restart once its version is down.
  let restarts = false
  // A restart waits for the look that runs to offer the version ready
  // again, as the last one is over an hour old.
  let confirms = false
  // brew installs the version ready, and Banda quits.
  let restarting = false
  /** The version brew takes now, while it does. */
  let taking: string | undefined
  /** The version the last look offered, and when. */
  let offered: Offered | undefined
  /** A version brew could not install: it waits for the Person, not
   * restarting unseen again. */
  let refused: string | undefined
  let watch: ReturnType<typeof setInterval> | undefined
  autoUpdater.autoInstallOnAppQuit = false

  /** Says `info`'s version is out, with the command that installs it. */
  const out = (info: UpdateInfo) => {
    asked = restarts = confirms = false
    set({
      state: "out",
      version: info.version,
      notes: notesOf(info, known.have),
      command,
    })
  }
  const fail = (reason: string) => {
    asked = restarts = confirms = false
    set({ state: "failed", reason })
  }
  /** Reads the release again in a minute, as its Mac's files and the
   * tap's cask come a few minutes after it, while `wait` has tries left;
   * whether it will. */
  const again = (wait: { tries: number }) => {
    if (retry === undefined && wait.tries < RETRIES) {
      wait.tries += 1
      retry = setTimeout(read, RETRY)
    }
    return retry !== undefined
  }
  /** Why a look found nothing to take yet, and whether it reads again. */
  const publishing = (soon: boolean) =>
    `The macOS release is still publishing${soon ? "; checking again in a minute" : ""}`

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (restarting) return
    files.tries = 0
    offered = { version: info.version, at: Date.now() }
    if (!brew) {
      out(info)
      return
    }
    if (now.state === "ready" && now.version === info.version) {
      asked = false
      if (confirms) restart()
      return
    }
    // The Restart that looked first goes on to the newer version.
    if (now.state === "ready" && confirms) restarts = true
    confirms = false
    // One brew at a time: the next look offers what came meanwhile.
    if (taking === undefined) take(info)
  })
  /** A version brew could not take: one ready stays as it is; else the
   * command, which still installs it by hand. */
  const drop = (info: UpdateInfo) => {
    if (now.state !== "ready") out(info)
    else asked = restarts = false
  }
  /** brew takes `info`'s version: ready once its zip is down. */
  const take = (info: UpdateInfo) => {
    if (!brew) return
    taking = info.version
    const notes = notesOf(info, known.have)
    brew
      .newest()
      .then((cask) => {
        if (cask !== info.version) return false
        return brew.fetch().then(() => true)
      })
      .then(
        (down) => {
          taking = undefined
          if (!down) {
            // The tap's cask comes after the release's files: a version
            // waits for it once, and then each look tries brew once.
            if (tap.version !== info.version)
              Object.assign(tap, { version: info.version, tries: 0 })
            if (again(tap)) missed(publishing(true))
            else drop(info)
            return
          }
          asked = false
          set({ state: "ready", version: info.version, notes })
          if (restarts) restart()
          else watchAlone()
        },
        (error: Error) => {
          taking = undefined
          console.warn("brew could not take Banda's update:", error.message)
          drop(info)
        }
      )
  }
  // Nothing above `have`: a version ready or out was withdrawn, and goes
  // (ADR 0092, decision 10).
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    if (restarting) return
    looked = Date.now()
    offered = { version: info.version, at: looked }
    asked = false
    files.tries = 0
    if (now.state === "ready")
      console.warn(`Banda ${now.version} is no longer out: it will not install`)
    if (now.state !== "updated") {
      confirms = restarts = false
      set({ state: "none", looked })
    }
  })
  const missed = (why: string) => {
    if (confirms && now.state === "ready") {
      // No look says the version ready is still out, so no restart into
      // it: the Restart says why nothing happened.
      confirms = false
      fail(`Could not check that ${now.version} is still out: ${why}`)
      return
    }
    // A Restart waits only for a look that runs again soon.
    if (retry === undefined) restarts = false
    if (!asked) return
    asked = false
    looked = Date.now()
    if (now.state === "looking" || now.state === "none")
      set({ state: "none", looked, missed: why })
  }
  autoUpdater.on("error", (error: Error & { code?: string }) => {
    console.warn("Banda could not look for its update:", error.message)
    // Linux publishes first; the Mac's files arrive a few minutes later.
    // Read again soon, even when this was a background look, until ADR
    // 0092's step 5 publishes a release with all its files.
    missed(
      error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
        ? publishing(again(files))
        : firstLine(error.message)
    )
  })
  /** Reads the release the engine said is newest. */
  function read() {
    clearTimeout(retry)
    retry = undefined
    if (restarting) return
    // The same error comes as an "error" event.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  const heard = (state: UpdateState) => {
    if (!looking.anew(state)) return
    if (state.off) missed(state.off)
    else read()
  }
  /** Asks the engine to look now, as the Person did, or as a restart
   * after an hour with no look does. */
  const look = (byPerson: boolean) => {
    if (restarting) return
    if (byPerson && known.always) {
      asked = true
      if (now.state !== "out" && now.state !== "ready")
        set({ state: "looking" })
    }
    looking.now(heard, missed)
  }
  /** With the version ready, restarts into it unseen once no window has
   * shown for two looks in a row, half a minute apart. */
  function watchAlone() {
    if (watch !== undefined) return
    let alone = 0
    watch = setInterval(() => {
      if (now.state !== "ready" || restarting) {
        clearInterval(watch)
        watch = undefined
        return
      }
      alone = mine.alone() && !mine.quits() ? alone + 1 : 0
      if (alone >= 2) restart(true)
    }, ALONE)
  }
  /** Restarts into the version ready: `unseen`, by itself, with no
   * window shown, or as the Person asked. */
  function restart(unseen = false) {
    if (now.state !== "ready" || restarting || !brew) return
    const ready = now
    const fresh = isOffered(offered, ready.version, Date.now())
    // Unseen, only into a version the last look offered and brew did not
    // refuse, with none coming down: it never looks first, nor says a
    // failure the Person did not ask about.
    if (unseen && (!fresh || refused === ready.version || taking)) return
    // A newer version comes down meanwhile: the restart waits for it.
    if (taking !== undefined) {
      restarts = true
      return
    }
    // After a sleep or looks that failed, a look first: the version may
    // have been withdrawn since (ADR 0092, decision 10).
    if (!fresh) {
      confirms = true
      look(false)
      return
    }
    confirms = restarts = false
    restarting = true
    brew.upgrade(ready.version).then(
      (upgraded) => {
        if (!upgraded) {
          // The tap moved since: the engine looks, and brew takes the
          // version it finds.
          restarting = false
          if (!unseen) restarts = true
          look(false)
          return
        }
        const left = { from: known.have, to: ready.version, notes: ready.notes }
        leave(left)
        // Quit as the Person or macOS asked meanwhile: the next start is
        // the new version, and says so.
        if (mine.quits()) return
        leaving()
        // As it is now: a window shown since opens again shown.
        brew.reopen(mine.alone())
        app.quit()
      },
      (error: Error) => {
        restarting = false
        refused = ready.version
        console.warn("brew could not install Banda's update:", error.message)
        fail(
          `brew could not install ${ready.version}: ${firstLine(error.message)}`
        )
      }
    )
  }
  return {
    current: () => now,
    heard,
    check: () => look(true),
    now() {
      restarts = true
      refused = undefined
      if (now.state === "ready") restart()
      else if (taking === undefined) look(true)
    },
    // Nothing downloads for the quit.
    later() {},
    restart() {
      refused = undefined
      restart()
    },
    seen() {
      if (now.state === "updated") set({ state: "none", looked })
    },
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
 * exits. An AppImage keeps the APPIMAGE and APPDIR it is given, so the
 * new one gets none, and sets its own.
 */
function startAfterImage(image: string) {
  const env = { ...process.env }
  for (const name of ["APPIMAGE", "APPDIR", "ARGV0", "OWD"]) delete env[name]
  startAfter([image, ...process.argv.slice(1)], env)
}

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
