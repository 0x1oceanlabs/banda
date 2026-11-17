/**
 * Banda's menus outside its page, and the door `banda menu` knocks at:
 *
 * - **The app's menu.** macOS's: the app menu, with its Quit (⌘Q); File's
 *   Close Window (⌘W); Edit; and Window, whose Banda shows the main
 *   window, as the menu bar's Open Banda does. Linux and Windows have
 *   none.
 * - **The menu bar's icon and its menu** (ADR 0086, decision 4), where
 *   Banda lives in the menu bar (`hasMenuBar`): macOS's, the tray on
 *   Linux and Windows' notification area (ADR 0136, proposed in #1871).
 *   Drawn from `banda status --follow` alone (status.ts; menubar.ts says
 *   what they are, tray.ts draws them): a row opens its Thread in the
 *   window, Open Banda the window, as a click on the icon does off macOS,
 *   and Quit Banda is ⌘Q's.
 * - **The door** (door.ts, ADR 0017): `banda menu [route]` opens the
 *   Banda menu in the window, or the settings at a route of their own;
 *   the page tells them apart. The bridge's `menu` is answered here, by
 *   the same rule.
 *
 * A part of the device's window (ADR 0089, decision 9), over the windows
 * (windows.ts): nothing asks it anything, so it is a layer with no
 * service, as what the app is asked is (asked.ts). The icon follows the
 * status, and the door is open, until its scope closes.
 */
import { type Answers, Engine, tellPage, text } from "@banda/desktop-kit"
import { Effect, FiberSet, Layer, Stream } from "effect"
import { app, Menu } from "electron"
import { type Acts, runOwn } from "../acts"
import { BRIDGE } from "../bridge"
import { channel } from "../channel"
import { type Commands, openDoor } from "../door"
import { hasMenuBar } from "../menubar"
import { Status } from "../status"
import { headless, menuBar, type MenuBarDoes } from "../tray"
import { Windows } from "./windows"

/** The system's menus and the door, as this part uses them: Electron's
 * and Node's in main (`thisMenus`), fakes in a test. */
export type Menus = {
  readonly platform: NodeJS.Platform
  /** Whether the window draws on no screen, where Linux has no tray. */
  readonly headless: boolean
  /** Sets the app's menu: macOS's, whose Window → Banda does `banda`, or
   * none. */
  readonly appMenu: (banda: (() => void) | null) => void
  /** Shows Banda's icon in the menu bar or the tray, with no status yet;
   * returns how to show one, and how to take the icon away. */
  readonly menuBar: (does: MenuBarDoes) => ReturnType<typeof menuBar>
  /** Listens at `path` and answers by `commands`; returns how to shut it
   * (door.ts). */
  readonly door: (path: string, commands: Commands) => () => void
  /** Asks the app to quit, as its menu's Quit does. */
  readonly quit: () => void
}

/** The menus of the app Electron runs, and the door. */
export const thisMenus = (): Menus => ({
  platform: process.platform,
  headless: headless(),
  appMenu: (banda) =>
    Menu.setApplicationMenu(
      banda &&
        Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "fileMenu" },
          { role: "editMenu" },
          {
            role: "windowMenu",
            submenu: [
              { role: "minimize" },
              { role: "zoom" },
              { type: "separator" },
              { label: "Banda", click: banda },
              { type: "separator" },
              { role: "front" },
            ],
          },
        ])
    ),
  menuBar: (does) =>
    menuBar(channel.name, app.getVersion(), does, process.platform),
  door: openDoor,
  quit: () => app.quit(),
})

/** Opens the menu at `route` in the main window, brought to the front;
 * the page tells the routes apart, the settings' too. `ok`, or what went
 * wrong. */
function openMenu(windows: Windows["Service"], route: unknown): string {
  if (typeof route !== "string") return "the route is not a string"
  const shown = windows.inFront()
  if (!shown) return "no window"
  tellPage(shown.webContents, BRIDGE.menu.listen, route)
  return "ok"
}

export const menusLayer = (menus: Menus) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const windows = yield* Windows
      const status = yield* Status
      const engine = yield* Engine
      const run = yield* FiberSet.makeRuntime<Acts>()

      menus.appMenu(
        menus.platform === "darwin" ? () => void windows.inFront() : null
      )

      if (hasMenuBar(menus.platform, menus.headless)) {
        const bar = yield* Effect.acquireRelease(
          Effect.sync(() =>
            menus.menuBar({
              open: () => void run(windows.openBanda),
              // The Thread's Pane where a workspace shows it, or opened
              // (the page's `pane.pick`, as a call's notice goes there);
              // the Thread Pane's kind is the agents module's
              // (ThreadPane.tsx).
              openThread: (project, thread, title) =>
                void run(
                  Effect.andThen(
                    windows.openBanda,
                    runOwn("pane.pick", {
                      project,
                      pane: {
                        kind: "agents.thread",
                        args: { thread, harness: "", title },
                      },
                    })
                  )
                ),
              // As ⌘Q: Quit Banda, asking first while Agents work
              // (closing.ts).
              quit: menus.quit,
            })
          ),
          (bar) => Effect.sync(() => bar.destroy())
        )
        yield* Effect.forkScoped(
          status.changes.pipe(
            Stream.runForEach((now) => Effect.sync(() => bar.show(now)))
          )
        )
      }

      // Once the engine names the door's path.
      yield* Effect.forkScoped(
        Effect.flatMap(engine.door, (path) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              menus.door(path, { menu: (route) => openMenu(windows, route) })
            ),
            (shut) => Effect.sync(shut)
          )
        )
      )
    })
  )

/** Main's answers to the page's channels of `menu`. */
export const menuAnswers: Answers<typeof BRIDGE.menu, Windows> = {
  open: [
    text,
    ([route]) =>
      Windows.use((windows) => Effect.sync(() => openMenu(windows, route))),
  ],
}
