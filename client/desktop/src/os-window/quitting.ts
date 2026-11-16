/**
 * Whether Banda quits (ADR 0086, decision 3): by Quit Banda, `banda stop`,
 * an update's restart, a quit that went through, or as macOS logs out,
 * restarts or shuts down. It is kept here and nowhere else, with Quit
 * Banda itself, which stops the engine and then quits; what closing and
 * quitting do with it are closing.ts's rules. The bridge's `quit` is
 * answered here.
 *
 * A part of the device's window (ADR 0089, decision 9), under the windows
 * (windows.ts), whose main one hides or closes by it. What the app is
 * asked from outside its windows is over them (asked.ts).
 */
import { type Answer, type Ask, confirm, none } from "@banda/desktop-kit"
import { Context, Effect, FiberSet, Layer } from "effect"
import { app, type BrowserWindow, powerMonitor } from "electron"
import type { BRIDGE } from "../bridge"
import { asksOnQuit, type Closing } from "../closing"
import { Stop } from "../engine"

/** What the app is asked from outside its windows. */
export type AppEvent = "before-quit" | "activate" | "window-all-closed"

/** The app, as this part and asked.ts use it: Electron's in main
 * (`thisApp`), a fake in a test. */
export type App = {
  readonly platform: NodeJS.Platform
  /** Asks the app to quit, as its menu's Quit does. */
  readonly quit: () => void
  /** Calls `heard` on each `event`; returns how to stop. */
  readonly listen: (
    event: AppEvent,
    heard: (event: { preventDefault: () => void }) => void
  ) => () => void
  /** Calls `off` each time the system says it logs out, restarts or
   * shuts down; returns how to stop. */
  readonly onPowerOff: (off: () => void) => () => void
  /** Brings the app to the front, by itself. */
  readonly focus: () => void
  /** Asks the Person `ask` in a system dialog, over `window` when there
   * is one. */
  readonly confirm: (
    window: BrowserWindow | null,
    ask: Ask
  ) => Effect.Effect<boolean>
}

/** The app Electron runs. */
export const thisApp = (): App => ({
  platform: process.platform,
  quit: () => app.quit(),
  listen: (event, heard) => {
    const on = app as unknown as NodeJS.EventEmitter
    on.on(event, heard)
    return () => on.removeListener(event, heard)
  },
  onPowerOff: (off) => {
    powerMonitor.on("shutdown", off)
    return () => powerMonitor.removeListener("shutdown", off)
  },
  focus: () => app.focus({ steal: true }),
  confirm,
})

/** How long a logout, restart or shutdown lets a quit through unasked:
 * macOS's quit comes moments after it says so, and a logout another app
 * stops leaves Quit Banda asking again. */
export const POWERING_OFF = 60_000

export class Quitting extends Context.Service<
  Quitting,
  {
    /** Where the app is, for what closing and quitting do. An update's
     * restart counts as quitting: one that closes the windows before it
     * quits, as `quitAndInstall` does, would otherwise only hide the
     * window on macOS, and never install. */
    readonly closing: () => Closing
    /** Whether it quits now, as the Person or macOS asked. */
    readonly quits: () => boolean
    /** Whether a quit the app is asked for is Quit Banda, which asks
     * first while Agents work (closing.ts); one that is not goes through,
     * and Banda quits from then on. */
    readonly asksFirst: (hasWindow: boolean) => boolean
    /** Quits Banda, asking nothing. */
    readonly leave: () => void
    /**
     * Quit Banda: the engine stops (engine.ts), which stops its Agents,
     * Harnesses and Terminals, and the window quits once it has gone. Its
     * follower hears the engine stop as asked and quits the window too;
     * one that cannot be stopped in time still leaves the window to quit.
     */
    readonly banda: Effect.Effect<void>
    /** An update restarts Banda's app from now: the quit is the
     * update's. */
    readonly updating: () => void
    /** Quit Banda stopped the engine, here or by `banda stop`: the window
     * goes with it, unless an update restarts it. */
    readonly engineStopped: () => void
  }
>()("banda/Quitting") {
  static readonly layer = (app: App) =>
    Layer.effect(Quitting)(
      Effect.gen(function* () {
        const stop = yield* Stop
        const run = yield* FiberSet.makeRuntime()
        /** Set as an update restarts Banda's app. */
        let updating = false
        /** Set once Banda quits: closing the window hides nothing then,
         * and a quit goes through (closing.ts). */
        let quitting = false
        /** Set for a while as macOS logs out, restarts or shuts down. */
        let poweringOff = false

        const closing = (): Closing => ({
          platform: app.platform,
          quitting: quitting || updating,
          poweringOff,
        })
        const leave = (): void => {
          quitting = true
          app.quit()
        }

        // macOS says it logs out, restarts or shuts down before it asks
        // Banda to quit (Electron's `shutdown`, on
        // NSWorkspaceWillPowerOffNotification): that quit goes through
        // unasked, as nobody may be there to answer and macOS would give
        // up waiting; the engine, a launchd job, stops as the session
        // ends. Only there: on Linux the event holds the session's
        // shutdown for Banda (a logind delay lock).
        if (app.platform === "darwin")
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              app.onPowerOff(() => {
                poweringOff = true
                run(
                  Effect.andThen(
                    Effect.sleep(POWERING_OFF),
                    Effect.sync(() => {
                      poweringOff = false
                    })
                  )
                )
              })
            ),
            (stops) => Effect.sync(stops)
          )

        return {
          closing,
          quits: () => quitting || poweringOff,
          asksFirst: (hasWindow) => {
            if (asksOnQuit(closing(), hasWindow)) return true
            quitting = true
            return false
          },
          leave,
          banda: Effect.sync(() => {
            quitting = true
          }).pipe(
            Effect.andThen(stop.engine),
            Effect.ensuring(Effect.sync(leave))
          ),
          updating: () => {
            updating = true
          },
          engineStopped: () => {
            if (!updating) leave()
          },
        }
      })
    )
}

/** Main's answer to the page's `quit`: Quit Banda (ADR 0086, decision 3).
 * The page asked first when Agents are working. */
export const quitAnswer: Answer<typeof BRIDGE.quit, Quitting> = [
  none,
  () => Quitting.use((quitting) => quitting.banda),
]
