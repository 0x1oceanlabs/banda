import { vi } from "vitest"

/** Electron, as the windows use it: a window and its page, the app's
 * focus, and what opens outside Banda. */
const electron = vi.hoisted(() => ({
  focused: [] as unknown[],
  outside: [] as string[],
}))
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  class BrowserWindow extends EventEmitter {
    readonly did: string[] = []
    minimized = false
    full = false
    readonly webContents = Object.assign(new EventEmitter(), {
      handler: null as null | ((details: { url: string }) => unknown),
      setWindowOpenHandler(handler: (details: { url: string }) => unknown) {
        this.handler = handler
      },
    })
    readonly made: unknown
    constructor(made: unknown) {
      super()
      this.made = made
    }
    loadURL(url: string) {
      this.did.push(`load ${url}`)
      return Promise.resolve()
    }
    show() {
      this.did.push("show")
    }
    hide() {
      this.did.push("hide")
    }
    focus() {
      this.did.push("focus")
    }
    restore() {
      this.did.push("restore")
    }
    flashFrame(on: boolean) {
      this.did.push(`flash ${on}`)
    }
    setFullScreen(on: boolean) {
      this.did.push(`full ${on}`)
    }
    isMinimized() {
      return this.minimized
    }
    isFullScreen() {
      return this.full
    }
  }
  return {
    app: {
      isPackaged: true,
      whenReady: () => Promise.resolve(),
      focus: (how: unknown) => electron.focused.push(how),
    },
    BrowserWindow,
    shell: {
      openExternal: (url: string) => {
        electron.outside.push(url)
        return Promise.resolve()
      },
    },
    nativeTheme: {},
    net: {},
    protocol: {},
    session: {},
  }
})
import type { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import { Window } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import type { BrowserWindow, WebContents } from "electron"
import type { Closing } from "../closing"
import { Material } from "./material"
import { PAGE } from "./page"
import { type Root, Windows } from "./windows"

/** A window of the fake Electron above. */
type Fake = BrowserWindow & {
  readonly made: Record<string, unknown>
  readonly did: string[]
  minimized: boolean
  full: boolean
  readonly webContents: EventEmitter & {
    handler: (details: { url: string }) => unknown
  }
}

/** Main's root, as the windows ask it, and what they asked. */
function rootAt(closing: Closing) {
  const asked: string[] = []
  const heard: WebContents[] = []
  let dock: Promise<void> | null = null
  const root: Root = {
    closing: () => closing,
    followDock: () => asked.push("followDock"),
    showDock: () => {
      asked.push("showDock")
      return dock
    },
    opened: (contents) => heard.push(contents),
    closePopped: () => asked.push("closePopped"),
  }
  return {
    root,
    asked,
    heard,
    /** The Dock's icon comes back as it is asked for. */
    dockShows: () => {
      dock = Promise.resolve()
    },
  }
}

const LINUX: Closing = {
  platform: "linux",
  quitting: false,
  poweringOff: false,
}
const MAC: Closing = { platform: "darwin", quitting: false, poweringOff: false }

/** The windows over `root`, made of a material that says only which
 * window it made. */
const over = (root: Root) =>
  Windows.layer(root).pipe(
    Layer.provide(
      Layer.succeed(Material)({
        open: (main, make) =>
          Effect.sync(() =>
            make({ backgroundColor: main ? "#main" : "#pane" })
          ),
        lookIn: () => Effect.succeed(null),
        insetOf: () => Effect.succeed(null),
      })
    )
  )

const windows = Windows.use((windows) => Effect.succeed(windows))
const open = (shows?: boolean) =>
  Windows.use((windows) => windows.open(shows)).pipe(
    Effect.map((opened) => opened as Fake)
  )

it.effect(
  "the main window opens made of the look, loads the page and shows as it is ready; the kit's Window says which it is until it is closed",
  () => {
    const { root, asked, heard } = rootAt(LINUX)
    return Effect.gen(function* () {
      const { main } = yield* windows
      const kit = yield* Window
      expect(main()).toBeNull()
      expect(kit.now()).toBeNull()
      const opened = yield* open()
      expect(opened.made).toEqual({
        width: 1280,
        height: 820,
        minWidth: 640,
        minHeight: 420,
        title: "Banda",
        show: false,
        backgroundColor: "#main",
        webPreferences: {
          preload: expect.stringMatching(/preload\.cjs$/),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          autoplayPolicy: "no-user-gesture-required",
          webviewTag: true,
        },
      })
      expect(opened.did).toEqual([`load ${PAGE}`])
      // The modules' parts hear of it.
      expect(heard).toEqual([opened.webContents])
      expect(main()).toBe(opened)
      expect(kit.now()).toBe(opened)
      opened.emit("ready-to-show")
      expect(opened.did).toEqual([`load ${PAGE}`, "show"])
      // The Dock follows it, and a flashing frame stops as it is focused.
      opened.emit("show")
      opened.emit("minimize")
      opened.emit("focus")
      expect(asked).toEqual(["followDock", "followDock"])
      expect(opened.did.at(-1)).toBe("flash false")
      // Off macOS it closes as it is asked to, and its Panes' own
      // windows go with it.
      const close = { preventDefault: vi.fn() }
      opened.emit("close", close)
      expect(close.preventDefault).not.toHaveBeenCalled()
      asked.length = 0
      opened.emit("closed")
      expect(asked).toEqual(["followDock", "closePopped"])
      expect(main()).toBeNull()
      expect(kit.now()).toBeNull()
    }).pipe(Effect.provide(over(root)))
  }
)

it.effect(
  "a window the engine opened Banda for loads its page and shows only when asked",
  () => {
    const { root, asked, dockShows } = rootAt(MAC)
    return Effect.gen(function* () {
      const { inFront, openBanda } = yield* windows
      // None is open: nothing comes to the front, and the Dock is left.
      expect(inFront()).toBeNull()
      expect(asked).toEqual([])
      const opened = yield* open(false)
      opened.emit("ready-to-show")
      expect(opened.did).toEqual([`load ${PAGE}`])
      // Asked for, it comes to the front, out of the Dock if it is there;
      // the Dock's icon comes back first, and Banda takes the focus.
      opened.minimized = true
      dockShows()
      expect(inFront()).toBe(opened)
      expect(asked).toEqual(["showDock"])
      expect(opened.did).toEqual([`load ${PAGE}`, "restore", "show", "focus"])
      yield* Effect.promise(() => Promise.resolve())
      expect(electron.focused).toEqual([{ steal: true }])
      // Open Banda brings it to the front, and opens no second one.
      expect(yield* openBanda).toBe(opened)
      // Closed, Open Banda opens it again.
      opened.emit("closed")
      const again = (yield* openBanda) as Fake
      expect(again).not.toBe(opened)
      expect(again.did).toEqual([`load ${PAGE}`])
    }).pipe(Effect.provide(over(root)))
  }
)

it.effect(
  "on macOS the main window hides as it closes, out of full screen first, unless it is shown again meanwhile; a quit closes it (ADR 0086, decision 4)",
  () => {
    const closing = { ...MAC }
    const { root, asked } = rootAt(closing)
    return Effect.gen(function* () {
      const { inFront, main } = yield* windows
      const opened = yield* open()
      opened.did.length = 0
      const close = () => {
        const event = { preventDefault: vi.fn() }
        opened.emit("close", event)
        return event.preventDefault.mock.calls.length > 0
      }
      // It hides, its Panes' own windows close, and it is still the
      // main window.
      expect(close()).toBe(true)
      expect(asked).toEqual(["closePopped"])
      expect(opened.did).toEqual(["hide"])
      expect(main()).toBe(opened)
      // In full screen it leaves it first, then hides.
      opened.did.length = 0
      opened.full = true
      expect(close()).toBe(true)
      expect(opened.did).toEqual(["full false"])
      opened.emit("leave-full-screen")
      expect(opened.did).toEqual(["full false", "hide"])
      // Shown again before it left full screen, it stays shown.
      opened.did.length = 0
      expect(close()).toBe(true)
      inFront()
      opened.emit("leave-full-screen")
      expect(opened.did).toEqual(["full false", "show", "focus"])
      // Banda quits: the window closes.
      closing.quitting = true
      expect(close()).toBe(false)
    }).pipe(Effect.provide(over(root)))
  }
)

it.effect(
  "a Pane's own window is a solid one that shows as it is ready, and the page never leaves: a link opens outside Banda",
  () => {
    const { root, heard } = rootAt(LINUX)
    return Effect.gen(function* () {
      const { page, main, inFront } = yield* windows
      const pane = (yield* page({ width: 480, height: 360 })) as Fake
      expect(pane.made).toMatchObject({
        width: 480,
        height: 360,
        show: false,
        backgroundColor: "#pane",
      })
      expect(heard).toEqual([pane.webContents])
      // It is not the main window, and loads what its opener says.
      expect(main()).toBeNull()
      expect(pane.did).toEqual([])
      pane.emit("ready-to-show")
      expect(pane.did).toEqual(["show"])
      expect(inFront(pane)).toBe(pane)
      expect(pane.did).toEqual(["show", "show", "focus"])
      // A new window is refused, and nothing navigates.
      expect(pane.webContents.handler({ url: "https://banda.so/" })).toEqual({
        action: "deny",
      })
      expect(pane.webContents.handler({ url: "file:///etc/passwd" })).toEqual({
        action: "deny",
      })
      const event = { preventDefault: vi.fn(), url: "http://example.com/" }
      pane.webContents.emit("will-navigate", event)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(electron.outside).toEqual([
        "https://banda.so/",
        "http://example.com/",
      ])
    }).pipe(Effect.provide(over(root)))
  }
)
