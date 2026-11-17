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
 * 12). An AppImage updates so, and an installed Windows Banda, whose
 * installer runs as it quits and starts it again (ADR 0090, step 6). On macOS, where an app signed ad hoc
 * cannot swap itself, brew takes it while Banda runs, and installs it on
 * Restart, or by itself once no window shows (ADR 0121); a Banda brew
 * did not install only says that a version is out, with the brew command
 * that installs it (ADR 0033, decision 6). Banda Local, run from a
 * checkout, has none, and says nothing; nor does a Banda run with
 * `BANDA_UPDATES=off`, for trials and CI; and where the engine takes
 * nothing (`off`: `updates = "off"`, a package manager's Banda), the app
 * takes nothing either.
 *
 * One machine does this on every system; how a version is taken and
 * installed is its `Installer`'s (installer.ts). With no window shown it
 * restarts into a version ready by itself, where its installer can start
 * it so: a Mac's today.
 *
 * The app restarts at once when the Person says: the engine and its
 * Agents go on, as when the window closes (ADR 0086, decision 3), and
 * the engine moves onto its new copy once nothing runs (ADR 0119,
 * decision 4).
 *
 * What it says is one `Update`, which it tells its machine's engine with
 * `updates.app` at each change (ADR 0137, decision 2): the engine says
 * it on `updates.state`, where the window, `banda update` and every
 * other machine read it. It restarts when the engine asks (`wants_app`):
 * the Person's Update is the engine's `updates.restart`, never a call of
 * main's. A look or a download that fails for want of a network says
 * nothing, and the next look tries again; only what the Person has to
 * mend shows, and a Restart that could not check its version is still
 * out.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { Engine as Client } from "@banda/contract"
import {
  type AppUpdate,
  UPDATES_CHECK,
  UPDATES_STATE,
  type UpdateState,
} from "@banda/contract/updates"
import { app } from "electron"
import { autoUpdater, type UpdateInfo } from "electron-updater"
import { brewOf } from "./brew"
import { appImageInstaller } from "./appimage"
import { brewInstaller, type Installer, windowsInstaller } from "./installer"
import { isAbove, sourceOf, versionInName, type Which } from "./releases"

/** How long after this system's files, or brew's tap, are found missing
 * it reads again. */
const RETRY = 60_000
/** How old the last look may be for a quit to install what it offered:
 * an hour, as the engine looks hourly, and a minute for it to come back. */
const FRESH = 3_600_000 + RETRY
/** How many looks a minute apart wait for this system's files, or brew's
 * tap, which come within ten minutes or so of the release: a pack that
 * failed sends none. */
const RETRIES = 15
/** How long a restart that looks first waits for an engine that is away,
 * as one that moves onto its own copy on the same Update. */
const ENGINE_BACK = 2 * 60_000
/** How often a Banda with a version ready looks whether a window shows:
 * two looks with none, and it restarts into it. */
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
  /** Whether no window of it shows, as on macOS it lives in the menu
   * bar: it may restart into a new version unseen. */
  alone: () => boolean
  /** Whether it quits now, as the Person or macOS asked. */
  quits: () => boolean
}

/** What the app says of itself whatever its state. */
type Known = {
  /** Its name, `Banda Dev`. */
  name: string
  /** The version that runs. */
  have: string
  /** Its widget stays on the bar with nothing to say, as Banda Dev's is
   * (ADR 0045). */
  always: boolean
}

/**
 * Where this app's own update is: nothing to say, a version downloading,
 * one ready to install on the quit or as the engine asks, one out that
 * the Person installs with `command` (on macOS, through brew: ADR 0033,
 * decision 6), one that cannot install until the Person mends something,
 * or that this Banda restarted into its version.
 */
export type Update = Known &
  (
    | { state: "none" }
    | {
        state: "downloading"
        version: string
        share: number
        /** Bytes down, and of how many, when electron-updater says. */
        down?: number
        size?: number
      }
    | {
        state: "ready"
        version: string
        /** What Banda does since the Person said Update: it installs the
         * version, then restarts into it. None while it waits for them. */
        doing?: "installing" | "restarting"
      }
    | { state: "out"; version: string; command: string }
    | { state: "failed"; reason: string }
    | {
        /** A Banda that restarted into a new version (ADR 0072, decision
         * 4), until it has more to say. */
        state: "updated"
        from: string
      }
  )

/** What it asks of this machine's engine: a look now, which answers the
 * state it found (`updates.check`), and to say what this app's update is
 * (`updates.app`). */
export type Engine = {
  check: () => Promise<UpdateState>
  app: (said: AppUpdate) => Promise<unknown>
}

/** What main does with Banda's update. */
export type Updates = {
  readonly current: () => Update
  /** What the engine says on `updates.state`, each change: its looks,
   * what it has of this app's update, and whether it asks the app to
   * restart. */
  readonly heard: (state: UpdateState) => void
}

/** `now`, as the engine takes it (`updates.app`). */
export function appOf(now: Update): AppUpdate {
  const known = {
    name: now.name,
    running: now.have,
    ...(now.always && { always: true }),
  }
  switch (now.state) {
    case "none":
      return { ...known, phase: "none" }
    case "downloading":
      return {
        ...known,
        phase: "downloading",
        version: now.version,
        share: now.share,
        ...(now.down !== undefined && { down: Math.round(now.down) }),
        ...(now.size !== undefined && { size: Math.round(now.size) }),
      }
    case "ready":
      return { ...known, phase: now.doing ?? "ready", version: now.version }
    case "out":
      return {
        ...known,
        phase: "out",
        version: now.version,
        command: now.command,
      }
    case "failed":
      return { ...known, phase: "failed", why: now.reason }
    case "updated":
      return { ...known, phase: "updated", from: now.from }
  }
}

/**
 * Banda's update for `mine`, which it tells `engine` at each change;
 * `leaving` is called as Banda quits to install it. One machine on every system: what
 * differs between them is its `Installer` (installer.ts).
 *
 * A look offers a version; the installer takes it, and it is `ready`.
 * Once the engine asks, as the Person said Update, it installs it and
 * starts it, saying each step (`doing`), after a
 * look first when the last one is over an hour old, as the version may
 * have been withdrawn since (ADR 0092, decision 10). With no window
 * shown, it restarts so by itself, unseen, and never under the Person's
 * hands (ADR 0121). A Banda nothing here can install only says that a
 * version is `out`, with the command that installs it.
 */
export function updates(
  mine: App,
  engine: Engine,
  leaving: () => void = () => {}
): Updates {
  const image = process.env.APPIMAGE
  const mac = process.platform === "darwin" && app.isPackaged
  const windows = process.platform === "win32" && app.isPackaged
  // On Linux only an AppImage: Banda from the AUR has no APPIMAGE, and
  // its `package-type` (scripts/aur.mjs) would turn electron-updater to
  // `sudo pacman -U`.
  const which = mine.which === "local" ? undefined : mine.which
  const looks =
    which !== undefined &&
    process.env.BANDA_UPDATES !== "off" &&
    Boolean(image || mac || windows)
  const known: Known = {
    name: mine.name,
    have: app.getVersion(),
    always: looks && which === "dev",
  }
  const { have } = known
  // The Banda this one restarted from left what it was (ADR 0072,
  // decision 4).
  const left = looks ? leftBehind(have) : undefined
  let now: Update = left
    ? { ...known, state: "updated", ...left }
    : { ...known, state: "none" }
  if (!looks || !which)
    // It says nothing, so the engine says nothing of an app.
    return { current: () => now, heard: () => {} }
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
  // The installer takes what a look offers: a look while a version is
  // ready offers it again, and downloading it again would start it over.
  autoUpdater.autoDownload = false
  autoUpdater.logger = { info() {}, debug() {}, warn: console.warn, error() {} }
  const looking = engineLooks(engine)
  /** How this system installs; none for a Mac's Banda brew did not
   * install, which only says the command. */
  const brew =
    image || windows ? undefined : brewOf(mine.folder, process.execPath)
  const installer: Installer | undefined = image
    ? appImageInstaller({
        image,
        have,
        data: app.getPath("userData"),
        listApp: mine.listApp,
        folder: mine.folder,
      })
    : windows
      ? windowsInstaller(mine)
      : brew && brewInstaller(brew)
  // The version it last installed did not start, and this one is back.
  if (installer?.failed)
    now = { ...known, state: "failed", reason: installer.failed }
  /** Whether electron-updater downloads. */
  const downloads = installer?.downloads ?? false
  // What a Mac's Banda brew did not install says: `brew upgrade` alone
  // reads the tap as it was at the last `brew update`, which may be a day
  // old, so one line that works as it is copied.
  const command = `brew update && brew upgrade --cask ${mine.folder}`
  const system = windows ? "Windows" : mac ? "macOS" : "Linux"

  /** Tells the engine what this app's update is now. One older than ADR
   * 0137 refuses it, and one away hears it as it comes back (`heard`). */
  const say = () => void engine.app(appOf(now)).catch(() => {})
  const set = (next: DistributiveOmit<Update, keyof Known>) => {
    now = { ...known, ...next }
    say()
  }
  // A restart goes on into a newer version that comes down meanwhile,
  // once it is down.
  let restarts = false
  /** Until when the engine asks the app to restart, as it last said, in
   * ms since the epoch; and the one acted on, each only once. */
  let wants = 0
  let obeyed = 0
  /** Whether the engine heard this Banda's update once. */
  let told = false
  /** Set while a restart's look waits for an engine that is away: what
   * ends the wait. */
  let away: ReturnType<typeof setTimeout> | undefined
  // A restart waits for the look that runs to offer the version ready
  // again, as the last one is over an hour old.
  let confirms = false
  // Banda restarts into the version ready: no look or answer changes it
  // as it quits, nor deletes its file.
  let restarting = false
  let retry: ReturnType<typeof setTimeout> | undefined
  /** The reads a minute apart that wait for this system's files, and for
   * what the installer takes of `version` (brew's tap): each waits at
   * most RETRIES times. */
  const files = { tries: 0 }
  const tap = { version: "", tries: 0 }
  /** The version the installer takes now, while it does. */
  let taking: string | undefined
  /** The version the last look offered, `have` when none, and when it
   * came back: a quit or a restart installs only that one (ADR 0092,
   * decision 12). */
  let offered: Offered | undefined
  /** A version that could not install: it waits for the Person, not
   * restarting unseen again. */
  let refused: string | undefined
  let watch: ReturnType<typeof setInterval> | undefined

  const fail = (reason: string) => {
    restarts = confirms = false
    set({ state: "failed", reason })
  }
  /** Nothing new, as the last look found. */
  const rest = () => {
    restarts = confirms = false
    set({ state: "none" })
  }
  /** Says `info`'s version is out, with the command that installs it. */
  const out = (info: UpdateInfo) => {
    restarts = confirms = false
    set({ state: "out", version: info.version, command })
  }
  /** The version ready waits for the Person again: what it did since
   * they said Update came to nothing. */
  const waits = () => {
    if (now.state === "ready" && now.doing && !restarting)
      set({ state: "ready", version: now.version })
  }
  /** A version that could not be taken: one ready stays, and waits for
   * the Person again; else the command, which still installs it by hand. */
  const drop = (info: UpdateInfo) => {
    if (now.state !== "ready") return out(info)
    restarts = false
    waits()
  }
  /** Reads the release again in a minute, as this system's files and the
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
    `The ${system} release is still publishing${soon ? "; checking again in a minute" : ""}`

  // The quit installs only what `installsAtQuit` says, said as Banda
  // quits.
  if (installer)
    app.on("will-quit", () => {
      const listed = mine.listedImage()
      installer.quitting(
        installsAtQuit({
          ready: now.state === "ready" ? now.version : undefined,
          offered,
          listed: listed && versionInName(basename(listed), mine.folder),
          at: Date.now(),
        })
      )
    })

  // A newer version replaces one that is ready: the installer keeps one,
  // and the newer one's takes its place.
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (restarting) return
    files.tries = 0
    offered = { version: info.version, at: Date.now() }
    if (!installer) return out(info)
    if (now.state === "ready" && now.version === info.version) {
      if (confirms) restart()
      else waits()
      return
    }
    const cannot = installer.cannot(info)
    if (cannot) return fail(cannot)
    // The Restart that looked first goes on to the newer version.
    if (now.state === "ready" && confirms) restarts = true
    confirms = false
    // One at a time: the next look offers what came meanwhile.
    if (taking === undefined) take(installer, info)
  })
  /** `by` takes `info`'s version: ready once it is down. */
  const take = (by: Installer, info: UpdateInfo) => {
    taking = info.version
    if (by.downloads)
      set({
        state: "downloading",
        version: info.version,
        share: 0,
      })
    by.take(info, {
      progress(progress) {
        // Said as often as its row changes: each hundredth.
        if (
          now.state === "downloading" &&
          Math.round(progress.share * 100) !== Math.round(now.share * 100)
        )
          set({ ...now, ...progress })
      },
      done(down) {
        taking = undefined
        if (!down) {
          // What it takes comes after the release's files: a version
          // waits for it once, and then each look tries once.
          if (tap.version !== info.version)
            Object.assign(tap, { version: info.version, tries: 0 })
          if (again(tap)) missed(publishing(true))
          else drop(info)
          return
        }
        set({ state: "ready", version: info.version })
        // The Person said Update while it came down, or the engine still
        // asks: it restarts once it is down.
        if (restarts || wants > Date.now()) restart()
        else if (by.unseen) watchAlone()
      },
      failed(error) {
        taking = undefined
        console.warn(`${by.name} could not take Banda's update:`, error.message)
        // Its own download's file: the Person mends it. brew's says the
        // command instead.
        if (by.downloads) fail(firstLine(error.message))
        else drop(info)
      },
    })
  }
  // Nothing above `have`: a version ready, out, or that could not install
  // was withdrawn, and goes (ADR 0092, decision 10).
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    if (restarting) return
    offered = { version: info.version, at: Date.now() }
    files.tries = 0
    if (now.state === "ready")
      console.warn(`Banda ${now.version} is no longer out: it will not install`)
    // That Banda updated stays until it has more to say.
    if (now.state !== "updated") rest()
  })
  /** A look that came to nothing, or the download (`download`), and
   * `why`. One that fails for want of a network says nothing, and the
   * next look tries again. */
  const missed = (why: string, download = false) => {
    if (confirms && now.state === "ready") {
      // No look says the version ready is still out, so no restart into
      // it: the row says why nothing happened.
      confirms = false
      fail(`Could not check that ${now.version} is still out: ${why}`)
      return
    }
    // A Restart waits only for a look that runs again soon, or for the
    // version that comes down.
    if (retry === undefined && taking === undefined) {
      restarts = false
      waits()
    }
    if (download && now.state === "downloading") set({ state: "none" })
  }
  autoUpdater.on("error", (error: Error & { code?: string }) => {
    console.warn("Banda could not update itself:", error.message)
    // electron-updater's download says its failure here too: the one
    // that ran, if any, is over.
    const download = downloads && taking !== undefined
    if (download) taking = undefined
    // A file Banda may not write, a full disk: its own download's.
    if (downloads && needsPerson(error)) return fail(error.message)
    // A release out before its files for this system, as Windows' and the
    // Mac's come after Linux's: read again soon, even when this was a
    // background look, until ADR 0092's step 5 publishes a release with
    // all its files.
    missed(
      error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
        ? publishing(again(files))
        : firstLine(error.message),
      download
    )
  })

  /** Nothing looks while a version comes down, or Banda restarts. */
  const busy = () => restarting || now.state === "downloading"
  /** Reads the release the engine said is newest. */
  function read() {
    clearTimeout(retry)
    retry = undefined
    if (busy()) return
    // The same error comes as an "error" event.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  /** What the engine says: what it has of this app's update, whether it
   * asks the app to restart, and its looks; whether `state` was of a look
   * not yet read. */
  const heard = (state: UpdateState): boolean => {
    said = state
    // The engine hears what this app's update is as this Banda first
    // hears it, as it may have what the Banda before it said; and again
    // one that started since, which has nothing of this app.
    if (!told || state.app?.running !== have) say()
    told = true
    wants = state.wants_app ?? 0
    if (wants > Date.now() && wants !== obeyed) {
      obeyed = wants
      // The Person's Update (ADR 0137, decision 3).
      refused = undefined
      // One that comes down still restarts once it is down, while the
      // engine asks.
      if (now.state === "ready") restart()
    }
    // The engine is back: the look a restart waited for runs.
    if (away !== undefined && confirms) {
      clearTimeout(away)
      away = undefined
      look()
    }
    if (!looking.anew(state)) return false
    // The engine takes nothing here, and the app neither.
    if (state.off) missed(state.off)
    else read()
    return true
  }
  /** Asks the engine to look now, as a restart after an hour with no
   * look does; its answer is read as it comes. */
  const look = () => {
    if (busy()) return
    looking.now(
      (state) => {
        // No look to read: the Restart that waited for one is over.
        if (!heard(state) && confirms) {
          confirms = false
          waits()
        }
      },
      (why) => {
        // The engine is away, as one that moves on the same Update: the
        // look runs again once it is heard, for a while.
        if (confirms && away === undefined)
          away = setTimeout(() => {
            away = undefined
            missed(why)
          }, ENGINE_BACK)
        else missed(why)
      }
    )
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
    if (now.state !== "ready" || restarting || !installer) return
    const ready = now
    const fresh = isOffered(offered, ready.version, Date.now())
    // Unseen, only into a version the last look offered and nothing
    // refused, with none coming down: it never looks first, nor says a
    // failure the Person did not ask about.
    if (unseen && (!fresh || refused === ready.version || taking)) return
    // The window stays and says so; unseen, it says nothing, as nobody
    // asked.
    if (!unseen) set({ ...ready, doing: "installing" })
    // A newer version comes down meanwhile: the restart waits for it.
    if (taking !== undefined) {
      restarts = true
      return
    }
    // After a sleep or looks that failed, a look first: the version may
    // have been withdrawn since (ADR 0092, decision 10).
    if (!fresh) {
      confirms = true
      look()
      return
    }
    confirms = restarts = false
    restarting = true
    installer.install(ready.version).then(
      (installed) => {
        if (!installed) {
          // Another version is out since: the engine looks, and the
          // installer takes the version it finds.
          restarting = false
          if (!unseen) restarts = true
          look()
          return
        }
        leave({ from: have, to: ready.version })
        if (!unseen) set({ ...ready, doing: "restarting" })
        // Quit as the Person or the system asked meanwhile: the next
        // start is the new version, and says so.
        if (mine.quits()) return
        leaving()
        // As it is now: a window shown since opens again shown.
        installer.relaunch(mine.alone())
      },
      (error: Error) => {
        restarting = false
        refused = ready.version
        console.warn(
          `${installer.name} could not install Banda's update:`,
          error.message
        )
        fail(
          `${installer.name} could not install ${ready.version}: ${firstLine(error.message)}`
        )
      }
    )
  }
  return { current: () => now, heard: (state) => void heard(state) }
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
type Left = { from: string; to: string }

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
    return { from: left.from }
  } catch {
    return undefined
  }
}

/** An error's first line: electron-updater's HTTP errors carry their
 * headers after it. */
export function firstLine(message: string): string {
  return message.split("\n", 1)[0]!.trim()
}

/** Omit, over each member of a union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

/** A failure that a later look cannot mend: a file Banda may not write,
 * a full disk. A network that is down, a release without its update file,
 * mend themselves. */
export function needsPerson(error: Error & { code?: string }): boolean {
  return ["EACCES", "EPERM", "EROFS", "ENOSPC"].includes(error.code ?? "")
}
