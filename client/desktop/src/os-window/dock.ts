/**
 * Banda's icon in macOS's Dock (ADR 0086, decision 4): it shows only
 * while a window is open, shown or minimized; with none, Banda lives in
 * the menu bar. What the icon was last set to, the show that is never
 * repeated and the hide that waits for a show to settle are kept here and
 * nowhere else; the rules are closing.ts's. A launch the engine made, as
 * it found no app, starts with no icon and shows no window
 * (`startsHidden`). Off macOS there is no Dock, and nothing is done.
 *
 * A part of the device's window (ADR 0089, decision 9), under the windows
 * (windows.ts), which say when one shows, hides or closes.
 */
import { Clock, Context, Effect, type Fiber, FiberSet, Layer } from "effect"
import { app, BrowserWindow } from "electron"
import {
  type Counted,
  DOCK_SETTLES,
  dockShows,
  dockStep,
  startsHidden,
  unseen,
} from "../closing"

/** The app and its Dock, as this part reads them: Electron's in main
 * (`thisDock`), a fake in a test. */
export type Docked = {
  readonly platform: NodeJS.Platform
  /** What the app was started with. */
  readonly args: readonly string[]
  /** Whether the app is hidden, by ⌘H or as it opened so: asked on macOS
   * alone. */
  readonly hidden: () => boolean
  /** Banda's windows, as the Dock counts them. */
  readonly windows: () => Counted[]
  /** The Dock's icon; none off macOS. `show` ends once it shows. */
  readonly icon: () =>
    | { readonly show: () => Promise<void>; readonly hide: () => void }
    | undefined
}

/** The app Electron runs, and its Dock. */
export const thisDock = (): Docked => ({
  platform: process.platform,
  args: process.argv,
  hidden: () => app.isHidden(),
  windows: () =>
    BrowserWindow.getAllWindows()
      .filter((one) => !one.isDestroyed())
      .map((one) => ({
        visible: one.isVisible(),
        minimized: one.isMinimized(),
      })),
  icon: () => app.dock,
})

export class Dock extends Context.Service<
  Dock,
  {
    /** Whether this launch shows no window and no Dock icon, only the
     * menu bar's: one the engine made (closing.ts). */
    readonly startsHidden: boolean
    /** The icon follows the windows there are. */
    readonly follow: () => void
    /** Brings the icon back: the show, when it shows now. */
    readonly show: () => Promise<void> | null
    /** Whether no window of Banda's is there for the Person, nor its
     * icon here, so it may restart into its new version unseen (ADR
     * 0121). */
    readonly unseen: () => boolean
  }
>()("banda/Dock") {
  /** The Dock of `system`: one that starts hidden loses its icon as the
   * layer is built. */
  static readonly layer = (system: Docked) =>
    Layer.effect(Dock)(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock
        const run = yield* FiberSet.makeRuntime()
        /** What the icon was last set to, shown as Banda starts, and when
         * it last showed. */
        let docked = true
        let shownAt = 0
        /** A hide that waits for the Dock to settle after a show. */
        let later: Fiber.Fiber<void> | null = null

        const hidden = () => system.platform === "darwin" && system.hidden()

        const follow = (): void => {
          const wanted = dockShows(system.platform, system.windows(), hidden())
          if (wanted !== null) void to(wanted)
        }

        /** Sets the icon as `wanted`; the show, when it shows now. */
        const to = (wanted: boolean): Promise<void> | null => {
          const icon = system.icon()
          if (!icon) return null
          later?.interruptUnsafe()
          later = null
          const now = clock.currentTimeMillisUnsafe()
          switch (dockStep(wanted, docked, shownAt, now)) {
            case "show":
              docked = true
              shownAt = now
              return icon.show()
            case "hide":
              docked = false
              icon.hide()
              return null
            case "later":
              later = run(
                Effect.andThen(
                  Effect.sleep(DOCK_SETTLES - (now - shownAt)),
                  Effect.sync(() => {
                    later = null
                    follow()
                  })
                )
              )
              return null
            case null:
              return null
          }
        }

        const starts = startsHidden(system.platform, system.args, hidden())
        if (starts) void to(false)
        return {
          startsHidden: starts,
          follow,
          show: () => to(true),
          unseen: () => unseen(system.platform, system.windows(), docked),
        }
      })
    )
}
