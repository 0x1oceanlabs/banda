/**
 * What closing Banda's window and quitting the app do (ADR 0086, decision
 * 3; ADR 0136, decisions 2 and 6). The cases, by where Banda's icon is:
 *
 * | The main window closes | It | Then |
 * |---|---|---|
 * | macOS | hides | Banda lives in the menu bar |
 * | Windows | hides | Banda lives in the notification area, and says so the first time |
 * | Linux, a tray host there | hides | Banda lives in the tray |
 * | Linux, no tray host known, or no icon (no screen) | closes | the app quits, as its last window went |
 * | anywhere, as Banda quits or an update restarts it | closes | the app quits |
 *
 * | The app is asked to quit | It |
 * |---|---|
 * | by the icon's Quit Banda, anywhere | asks first while Agents work: Quit Banda |
 * | macOS, by anything else (its menu, the Dock, ⌘Q, a signal) | the same |
 * | Linux and Windows, by anything else (a signal, the last window closed) | quits at once |
 * | by Banda itself, or as macOS powers off | quits at once |
 *
 * An engine that is the session's service goes on wherever the app
 * quits unasked. On Linux a tray host comes and goes, so it is asked for
 * as the window closes (`onClose`; os-window/tray-host.ts), and anything
 * but a clear yes closes the window: a hidden one with no icon could not
 * be found again.
 *
 * Hidden, the window's page is left alive to call the Person (ADR 0011)
 * and sound (ADR 0009), and reads as not in front (`visibilitychange` to
 * `hidden`), so the machine pushes a call to the phone (ADR 0124,
 * decision 10). The icon's Open Banda or a click on it, a row of its
 * menu, `banda menu`, or Banda opened again, shows it.
 *
 * On macOS the engine is a launchd job, which outlives the app (decision
 * 4, menubar.ts), and the Dock's icon goes while no window is open
 * (`dockShows`). A launch the engine made, as it found no app, shows no
 * window (`startsHidden`). A quit the app is asked for there comes by
 * the menu bar's Quit Banda, the app menu's or the Dock's Quit, or by ⌘Q
 * where the page leaves the key (in a terminal, over a dialog, with the
 * window hidden); elsewhere ⌘Q, and Ctrl+Q off macOS, is the page's own
 * Quit Banda key. A Pane's own window closes as anywhere (ADR 0025,
 * decision 9).
 */
import { Clock, Effect } from "effect"

/** Where the app is, as its window closes or it is asked to quit. */
export type Closing = {
  readonly platform: NodeJS.Platform
  /** Banda quits already: by Quit Banda, `banda stop`, the engine
   * stopping as asked, an update's restart, or a quit that went through. */
  readonly quitting: boolean
  /** The system logs out, restarts or shuts down: nobody may be there to
   * answer, and macOS gives up on it unless every app quits. */
  readonly poweringOff: boolean
  /** Whether Banda's icon is in the menu bar or the tray here
   * (`hasMenuBar`, menubar.ts): not on a Linux window with no screen. */
  readonly icon: boolean
}

/**
 * Whether closing the main window hides it, rather than closing it:
 * where Banda's icon is, with a tray `host` known to show it, unless
 * Banda quits.
 */
export function hidesOnClose(
  { icon, quitting }: Closing,
  host: boolean
): boolean {
  return icon && host && !quitting
}

/**
 * What a main window asked to close does: closes; hides; or, on Linux,
 * asks whether a tray host is there now, and then hides or closes by
 * what it hears (`hidesOnClose`). macOS's menu bar and Windows'
 * notification area are always there.
 */
export function onClose(at: Closing): "close" | "hide" | "ask" {
  if (!hidesOnClose(at, true)) return "close"
  return at.platform === "linux" ? "ask" : "hide"
}

/**
 * Whether a quit the app is asked for is Quit Banda, which asks first
 * while Agents work (`quitAsking`), rather than going at once: while
 * there is a window to ask in, unless Banda quits already or the system
 * powers off. On macOS every such quit is; on Linux and Windows only the
 * icon's own Quit Banda (`byIcon`), so a signal, as a session ending
 * sends, still quits at once.
 */
export function asksOnQuit(
  at: Closing,
  hasWindow: boolean,
  byIcon: boolean
): boolean {
  if (at.quitting || at.poweringOff || !hasWindow) return false
  return at.platform === "darwin" || byIcon
}

/**
 * Whether a window that hides says that Banda still runs (ADR 0136,
 * decision 6): on Windows, which puts a new icon in the notification
 * area's overflow, and only until it was `said` once.
 */
export function saysStillRuns(
  platform: NodeJS.Platform,
  said: boolean
): boolean {
  return platform === "win32" && !said
}

/** What the engine tells an app it opens, as it found none (engine/src/
 * service/app.rs): `open -g -j <app> --args --hidden`. */
export const HIDDEN = "--hidden"

/**
 * Whether this launch of the app shows no window, only the menu bar
 * icon: on macOS, one the engine made, which `args` say (`HIDDEN`, which
 * only an app that starts hears), or which left the app `hidden` as it
 * started, as `open -j` does.
 */
export function startsHidden(
  platform: NodeJS.Platform,
  args: readonly string[],
  hidden: boolean
): boolean {
  return platform === "darwin" && (args.includes(HIDDEN) || hidden)
}

/** A window, as the Dock counts it. */
export type Counted = { readonly visible: boolean; readonly minimized: boolean }

/**
 * Whether the Dock shows Banda's icon: on macOS only while a window is
 * open, shown or minimized into the Dock; with none, Banda lives in the
 * menu bar. While the app is `hidden`, by ⌘H or as it opened so, the
 * icon stays as it is (`null`), as off macOS, where there is no Dock.
 */
export function dockShows(
  platform: NodeJS.Platform,
  windows: readonly Counted[],
  hidden: boolean
): boolean | null {
  if (platform !== "darwin" || hidden) return null
  return anyShown(windows)
}

/** Whether a window shows, or waits minimized in the Dock. */
function anyShown(windows: readonly Counted[]): boolean {
  return windows.some((one) => one.visible || one.minimized)
}

/**
 * Whether no window of Banda's is there for the Person, so it may restart
 * into its new version unseen (ADR 0121): on macOS, with no window shown
 * or minimized and its Dock icon gone, as it lives in the menu bar,
 * opened so by the engine too. ⌘H hides its windows and leaves the Dock
 * icon, `docked`: that holds it.
 */
export function unseen(
  platform: NodeJS.Platform,
  windows: readonly Counted[],
  docked: boolean
): boolean {
  return platform === "darwin" && !docked && !anyShown(windows)
}

/** A little over the second after the Dock's icon shows in which
 * Electron ignores hiding it. */
export const DOCK_SETTLES = 1_100

/**
 * What sets the Dock's icon as `wanted`, as it was last set (`was`) and
 * last shown (`shownAt`): a show, a hide, or nothing as it is so. A show
 * is never repeated, as each takes Banda's focus away and back; a hide
 * within `DOCK_SETTLES` of a show waits (`later`), or it would be lost.
 */
export function dockStep(
  wanted: boolean,
  was: boolean,
  shownAt: number,
  now: number
): "show" | "hide" | "later" | null {
  if (wanted === was) return null
  if (wanted) return "show"
  return now - shownAt < DOCK_SETTLES ? "later" : "hide"
}

/** What clicking the Dock's icon does: shows the window, hidden or not,
 * or opens one where there is none, as a defence (the main window closes
 * only as Banda quits); nothing on the way out. */
export function onDock(
  at: Closing,
  hasWindow: boolean
): "show" | "open" | null {
  if (at.platform !== "darwin" || at.quitting) return null
  return hasWindow ? "show" : "open"
}

/** How soon after the page was asked a quit counts as asked again: its
 * ask did not come, or the Person said no and quits once more. */
export const AGAIN = 10_000

/**
 * Where a quit asks while Agents work: in the page, by its Quit Banda, as
 * on Ctrl+Q; or in a system dialog where the page cannot (`pageCan`: no
 * window shows, as Banda lives in the menu bar, or it crashed, or loads)
 * or did not, as a quit comes again within `AGAIN` of its last ask
 * (`askedAt`): it hangs, or shows only a card, as when it broke.
 */
export function asksIn(
  pageCan: boolean,
  askedAt: number | null,
  now: number
): "page" | "system" {
  return pageCan && (askedAt === null || now - askedAt >= AGAIN)
    ? "page"
    : "system"
}

/** What Quit Banda asks first with, as a quit the app is asked for runs
 * it (`quitAsking`). */
export type Asker<R> = {
  /** `banda stop` with no terminal to ask in: whether Agents work, and it
   * stopped nothing. Else it stopped the engine, found none, or could not
   * stop it, and Banda quits, the engine its child going with it. */
  readonly working: Effect.Effect<boolean, never, R>
  /** Whether the page can ask: its window shows, and it has not
   * crashed, and is not loading. */
  readonly pageCan: Effect.Effect<boolean, never, R>
  /** Runs the page's Quit Banda in the window, brought to the front. */
  readonly askPage: Effect.Effect<void, never, R>
  /** Asks in a system dialog whether to stop the Agents and quit, in the
   * words Quit says everywhere (`quitAsks`, @banda/contract). */
  readonly askSystem: Effect.Effect<boolean, never, R>
  /** Quit Banda as the Person said: stops the engine, then quits. */
  readonly quitBanda: Effect.Effect<void, never, R>
  /** Quits, asking nothing. */
  readonly leave: Effect.Effect<void, never, R>
}

/**
 * Quit Banda, as a quit the app is asked for runs it where it asks first
 * (`asksOnQuit`): `banda stop` stops the engine where no Agent works, and
 * Banda quits. Where some do, the page asks, or a system dialog
 * (`asksIn`), and Banda quits if the Person says so. A quit asked for
 * while one is still being asked about does nothing.
 */
export function quitAsking<R>(asker: Asker<R>): Effect.Effect<void, never, R> {
  let busy = false
  let askedAt: number | null = null
  const ask = Effect.gen(function* () {
    if (!(yield* asker.working)) return yield* asker.leave
    const now = yield* Clock.currentTimeMillis
    if (asksIn(yield* asker.pageCan, askedAt, now) === "page") {
      askedAt = now
      return yield* asker.askPage
    }
    askedAt = null
    if (yield* asker.askSystem) yield* asker.quitBanda
  })
  return Effect.suspend(() => {
    if (busy) return Effect.void
    busy = true
    return ask.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          busy = false
        })
      )
    )
  })
}
