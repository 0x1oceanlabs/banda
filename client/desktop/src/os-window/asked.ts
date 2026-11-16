/**
 * What Banda's app is asked from outside its windows, and does (ADR 0086,
 * decisions 3 and 4; closing.ts has the rules):
 *
 * - **Its last window closed.** It quits: closing the last window closes
 *   the window only. An engine that is the session's service goes on, and
 *   its Agents with it; one that is the window's child, as on Windows, on
 *   a Linux without systemd and in Banda Local, stops with it. On macOS
 *   the main window hides as it closes instead, and Banda lives in the
 *   menu bar, so this comes on Linux and Windows.
 * - **To quit.** On macOS a quit the app is asked for, by the app menu's
 *   or the Dock's Quit, or by ⌘Q where the page leaves the key (in a
 *   terminal, over a dialog, with the window hidden), is Quit Banda: it
 *   asks first while Agents work. Elsewhere ⌘Q is the page's own Quit
 *   Banda key. A quit Banda makes itself goes through, as does a logout,
 *   restart or shutdown, and every quit on Linux and Windows.
 * - **For its window, by the Dock's icon.** The window shows again,
 *   hidden as it closed on macOS.
 *
 * A part of the device's window (ADR 0089, decision 9), over the windows
 * (windows.ts) and whether Banda quits (quitting.ts): nothing asks it
 * anything, so it is a layer with no service, as the system's is
 * (system.ts). It listens until its scope closes.
 */
import { quitAsks } from "@banda/contract"
import { Effect, FiberSet, Layer } from "effect"
import { Acts, runOwn } from "../acts"
import { onDock, quitAsking } from "../closing"
import { Stop } from "../engine"
import { Status } from "../status"
import { type App, type AppEvent, Quitting } from "./quitting"
import { Windows } from "./windows"

export const askedLayer = (app: App) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const quitting = yield* Quitting
      const windows = yield* Windows
      const status = yield* Status
      const stop = yield* Stop
      const run = yield* FiberSet.makeRuntimePromise<Acts>()

      /**
       * Quit Banda as macOS's Quit runs it (closing.ts): `banda stop`
       * with no terminal to ask in stops the engine where no Agent works,
       * and Banda quits. Where some do, the window comes to the front and
       * its page's Quit Banda asks first, as on Ctrl+Q, run by the road
       * main asks the page's actions on (acts.ts); a page that crashed or
       * loads, or a quit that comes again soon after, asks in a system
       * dialog instead.
       */
      const askToQuit = quitAsking<Acts>({
        working: stop.unlessWorking,
        // With no window shown, as Banda lives in the menu bar, macOS
        // asks.
        pageCan: Effect.sync(() => {
          const window = windows.main()
          const contents = window?.webContents
          return (
            !!window?.isVisible() &&
            !!contents &&
            !contents.isCrashed() &&
            !contents.isLoadingMainFrame()
          )
        }),
        // Nothing waits on the page's answer: a quit that comes again
        // soon after asks in a system dialog.
        askPage: Effect.sync(() => windows.inFront()).pipe(
          Effect.andThen(Effect.forkDetach(runOwn("banda.quit"))),
          Effect.asVoid
        ),
        // How many work, as the menu bar heard: one at least, as `banda
        // stop` found some. Over the window when it shows; else in front,
        // by itself.
        askSystem: Effect.flatMap(status.current, (now) => {
          const working = now?.agents?.working ?? 0
          const asks = quitAsks(Math.max(1, working), app.platform === "darwin")
          if (!asks) return Effect.succeed(true)
          const over = windows.main()?.isVisible() ? windows.inFront() : null
          if (!over) app.focus()
          return app.confirm(over, {
            message: asks.title,
            detail: asks.detail,
            yes: asks.quit,
            no: asks.cancel,
          })
        }),
        quitBanda: quitting.banda,
        leave: Effect.sync(quitting.leave),
      })

      const listen = (event: AppEvent, heard: Parameters<App["listen"]>[1]) =>
        Effect.acquireRelease(
          Effect.sync(() => app.listen(event, heard)),
          (stops) => Effect.sync(stops)
        )

      yield* listen("window-all-closed", () => app.quit())
      yield* listen("before-quit", (event) => {
        if (!quitting.asksFirst(!!windows.main())) return
        event.preventDefault()
        // What cannot run it has no engine to ask about.
        void run(askToQuit).catch(() => quitting.leave())
      })
      // Only once main's root opened the first window: the app is
      // activated as it starts too, which would open a second.
      yield* listen("activate", () => {
        if (!windows.began()) return
        const does = onDock(quitting.closing(), windows.main() !== null)
        if (does === "show") windows.inFront()
        else if (does === "open") void run(windows.open())
      })
    })
  )
