/**
 * Banda's windows: the main one, and each window that shows Banda's page,
 * as a Pane's own does (ADR 0025, decision 9). Which window the main one
 * is, how it opens, and how it comes to the front are kept here and
 * nowhere else; the kit's `Window`, which a module asks which window it
 * is, is answered from here.
 *
 * On macOS the main window hides as it closes, unless Banda quits, and
 * leaves full screen first (closing.ts; ADR 0086, decision 4). What
 * quitting is, the Dock, and which Panes have windows of their own are
 * main's root's still: it hands them in (`Root`).
 *
 * A part of the device's window (ADR 0089, decision 9), made of what the
 * look says (material.ts).
 */
import { join } from "node:path"
import { Window } from "@banda/desktop-kit"
import { Context, Effect, Layer } from "effect"
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  shell,
  type WebContents,
} from "electron"
import { type Closing, hidesOnClose } from "../closing"
import { revive } from "../revive"
import { Material } from "./material"
import { PAGE } from "./page"

/** What the windows ask of main's root, which keeps it. */
export type Root = {
  /** Where the app is, for what closing does (closing.ts). */
  readonly closing: () => Closing
  /** The Dock's icon follows the windows there are (macOS). */
  readonly followDock: () => void
  /** Brings the Dock's icon back (macOS): the show, when it shows now. */
  readonly showDock: () => Promise<void> | null
  /** The modules' parts hear of each window that shows the page. */
  readonly opened: (contents: WebContents) => void
  /** Closes the Panes' own windows, back to their places: they are the
   * main window's, and go as it hides or closes. */
  readonly closePopped: () => void
}

/** What a window that shows the page is made with, but for what the look
 * and the page decide. */
export type PageOptions = Omit<
  BrowserWindowConstructorOptions,
  "show" | "backgroundColor" | "webPreferences"
>

export class Windows extends Context.Service<
  Windows,
  {
    /** The main window now; none while it is closed. */
    readonly main: () => BrowserWindow | null
    /** The main window, or `shown`, brought to the front; none when it is
     * closed. On macOS, from the menu bar alone, the Dock's icon comes
     * back first, and Banda comes to the front. */
    readonly inFront: (shown?: BrowserWindow | null) => BrowserWindow | null
    /** Opens the main window; one the engine opened Banda for loads its
     * page, and shows only when asked (`shows`). */
    readonly open: (shows?: boolean) => Effect.Effect<BrowserWindow>
    /** The main window brought to the front, or opened where there is
     * none. */
    readonly openBanda: Effect.Effect<BrowserWindow>
    /** A window that shows Banda's page, solid, in the system's frame, as
     * it is ready: a Pane's own. */
    readonly page: (options: PageOptions) => Effect.Effect<BrowserWindow>
  }
>()("banda/Windows") {
  /** The windows, and the kit's `Window` answered from them. */
  static readonly layer = (root: Root) =>
    Layer.effect(Window)(
      Windows.use((windows) => Effect.succeed({ now: windows.main }))
    ).pipe(Layer.provideMerge(Layer.effect(Windows)(make(root))))
}

const make = (root: Root) =>
  Effect.gen(function* () {
    const material = yield* Material
    let window: BrowserWindow | null = null
    /** Set while the window, closed in full screen on macOS, leaves it to
     * hide; showing it again meanwhile keeps it shown. */
    let hiding = false

    const inFront = (shown = window): BrowserWindow | null => {
      if (!shown) return null
      if (shown === window) hiding = false
      void root.showDock()?.then(() => app.focus({ steal: true }))
      if (shown.isMinimized()) shown.restore()
      shown.show()
      shown.focus()
      return shown
    }

    /** A window that shows Banda's page, made of what the look says
     * (`main` for the main window; material.ts), as it is ready, unless it
     * `shows` only when asked. */
    const pageWindow = (options: PageOptions, main = false, shows = true) =>
      Effect.map(
        material.open(
          main,
          (made) =>
            new BrowserWindow({
              ...options,
              show: false,
              ...made,
              webPreferences: {
                preload: join(import.meta.dirname, "preload.cjs"),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                // Banda's sounds play before the Person first clicks (ADR
                // 0009).
                autoplayPolicy: "no-user-gesture-required",
                // The browser's pages (@banda/browser-desktop).
                webviewTag: true,
              },
            })
        ),
        (opened) => {
          root.opened(opened.webContents)
          if (shows) opened.once("ready-to-show", () => opened.show())
          // The Dock's icon is there while a window is open, however it
          // shows.
          opened.on("show", root.followDock)
          opened.on("hide", root.followDock)
          opened.on("minimize", root.followDock)
          opened.on("closed", root.followDock)
          opened.on("focus", () => opened.flashFrame(false))
          const contents = opened.webContents
          // A page whose process died loads again, as it was (#343).
          revive(contents)
          // The page never leaves: links open in the browser, nothing
          // navigates.
          contents.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//.test(url)) void shell.openExternal(url)
            return { action: "deny" }
          })
          contents.on("will-navigate", (event) => {
            event.preventDefault()
            if (/^https?:\/\//.test(event.url))
              void shell.openExternal(event.url)
          })
          if (!app.isPackaged) {
            contents.on("before-input-event", (event, input) => {
              if (input.type === "keyDown" && input.key === "F12") {
                contents.toggleDevTools()
                event.preventDefault()
              }
            })
          }
          return opened
        }
      )

    const open = (shows = true) =>
      Effect.map(
        pageWindow(
          {
            width: 1280,
            height: 820,
            minWidth: 640,
            minHeight: 420,
            title: "Banda",
          },
          true,
          shows
        ),
        (opened) => {
          void opened.loadURL(PAGE)
          // On macOS it hides as it closes, unless Banda quits
          // (closing.ts). Its Panes in windows of their own close, back to
          // their places, as they do when it closes.
          opened.on("close", (event) => {
            if (!hidesOnClose(root.closing())) return
            event.preventDefault()
            root.closePopped()
            if (!opened.isFullScreen()) {
              opened.hide()
              return
            }
            // A window hidden in full screen would leave its Space black:
            // it leaves full screen first, and comes back windowed.
            hiding = true
            opened.once("leave-full-screen", () => {
              if (hiding) opened.hide()
              hiding = false
            })
            opened.setFullScreen(false)
          })
          opened.on("closed", () => {
            window = null
            // Their Panes are the window's: they go with it.
            root.closePopped()
          })
          window = opened
          return opened
        }
      )

    return {
      main: () => window,
      inFront,
      open,
      openBanda: Effect.suspend(() => {
        const shown = inFront()
        return shown ? Effect.succeed(shown) : open()
      }),
      page: (options: PageOptions) => pageWindow(options),
    }
  })
