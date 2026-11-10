/**
 * What closing Banda's window and quitting the app do (ADR 0086, decision
 * 3). On Linux, and on Windows, closing the window closes it, and the
 * last one quits the app; an engine that is the session's service goes
 * on. On macOS the engine is a launchd job, which outlives the app, and
 * the app lives in the menu bar (decision 4, menubar.ts): closing the
 * main window hides it, its page left alive to call the Person (ADR 0011)
 * and sound (ADR 0009), and the Dock's icon goes while no window is
 * open (`dockShows`); the menu bar's Open Banda, or Banda opened again, shows
 * it. A launch the engine made, as it found no app, shows no window
 * (`startsHidden`). A quit the app is asked for there, by the menu bar's
 * Quit Banda, the app menu's or the Dock's Quit, or by ⌘Q where the page
 * leaves the key (in a terminal, over a dialog, with the window hidden),
 * is Quit Banda, which asks first while Agents work (`quitAsking`);
 * elsewhere ⌘Q is the page's own Quit Banda key. A Pane's own window
 * closes as anywhere (ADR 0025, decision 9).
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
}

/** Whether closing the main window hides it, rather than closing it. */
export function hidesOnClose({ platform, quitting }: Closing): boolean {
  return platform === "darwin" && !quitting
}

/**
 * Whether a quit the app is asked for is Quit Banda, which asks first
 * while Agents work (`quitAsking`), rather than going at once: where
 * closing the window hides it, while there is a window to ask in, and
 * unless the system powers off.
 */
export function asksOnQuit(at: Closing, hasWindow: boolean): boolean {
  return hidesOnClose(at) && !at.poweringOff && hasWindow
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
  return windows.some((one) => one.visible || one.minimized)
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
  if (!hidesOnClose(at)) return null
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
