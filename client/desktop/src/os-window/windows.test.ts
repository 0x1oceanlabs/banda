import { vi } from "vitest"

/** Electron, as the windows use it: a window and its page, the app's
 * focus, and what opens outside Banda. */
const electron = vi.hoisted(() => ({
  focused: [] as unknown[],
  outside: [] as string[],
  /** The window's folder in Banda's state, and the notices shown. */
  userData: "",
  notices: [] as { made: unknown; click: () => void }[],
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
    isDestroyed() {
      return false
    }
    /** As Electron's: it closes unless a listener stops it. */
    close() {
      let stopped = false
      this.emit("close", { preventDefault: () => (stopped = true) })
      this.did.push(stopped ? "close stopped" : "closes")
    }
  }
  class Notification extends EventEmitter {
    static isSupported() {
      return true
    }
    readonly made: unknown
    constructor(made: unknown) {
      super()
      this.made = made
    }
    show() {
      electron.notices.push({
        made: this.made,
        click: () => this.emit("click"),
      })
    }
  }
  return {
    app: {
      isPackaged: true,
      whenReady: () => Promise.resolve(),
      focus: (how: unknown) => electron.focused.push(how),
      getPath: () => electron.userData,
    },
    BrowserWindow,
    Notification,
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
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "@effect/vitest"
import { Window } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import type { BrowserWindow, WebContents } from "electron"
import type { Closing } from "../closing"
import { Dock } from "./dock"
import { Material } from "./material"
import { PAGE } from "./page"
import { Quitting } from "./quitting"
import { SAID, stillRuns } from "./still-runs"
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

/** Main's root, whether Banda quits and the Dock, as the windows ask
 * them, and what they asked. A tray host is there as `host` says when it
 * is asked for. */
function rootAt(closing: Closing, host: { there: boolean } = { there: true }) {
  const asked: string[] = []
  const heard: WebContents[] = []
  let dock: Promise<void> | null = null
  const root: Root = {
    opened: (contents) => heard.push(contents),
    closePopped: () => asked.push("closePopped"),
  }
  const under = Layer.merge(
    Layer.succeed(Quitting)({
      closing: () => closing,
      quits: () => false,
      // The bus answers later, never within the close itself.
      trayHost: Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() => {
          asked.push("tray host?")
          return host.there
        })
      ),
      asksFirst: () => false,
      byIcon: () => {},
      leave: () => {},
      banda: Effect.void,
      updating: () => {},
      engineStopped: () => {},
    }),
    Layer.succeed(Dock)({
      startsHidden: false,
      follow: () => asked.push("followDock"),
      show: () => {
        asked.push("showDock")
        return dock
      },
      unseen: () => false,
    })
  )
  return {
    root: { ...root, under },
    asked,
    heard,
    /** The Dock's icon comes back as it is asked for. */
    dockShows: () => {
      dock = Promise.resolve()
    },
  }
}

const MAC: Closing = {
  platform: "darwin",
  quitting: false,
  poweringOff: false,
  icon: true,
}
/** With no icon, as a window with no screen: it closes as it is asked. */
const LINUX: Closing = { ...MAC, platform: "linux", icon: false }
const TRAY: Closing = { ...MAC, platform: "linux" }
const WINDOWS: Closing = { ...MAC, platform: "win32" }

/** Lets what a close started run. */
const settled = Effect.yieldNow.pipe(Effect.repeat({ times: 20 }))

/** Asks `opened` to close, as its close button does; whether it was
 * stopped. */
const closeOf = (opened: Fake) => {
  const event = { preventDefault: vi.fn() }
  opened.emit("close", event)
  return event.preventDefault.mock.calls.length > 0
}

/** The windows over `root`, made of a material that says only which
 * window it made. */
const over = (root: Root & { under: Layer.Layer<Quitting | Dock> }) =>
  Windows.layer(root).pipe(
    Layer.provide(root.under),
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
      // With no icon it closes as it is asked to, nothing asked of the
      // bus, and its Panes' own windows go with it.
      asked.length = 0
      expect(closeOf(opened)).toBe(false)
      expect(asked).toEqual([])
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
      const close = () => closeOf(opened)
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
  "on Linux the main window asks for a tray host as it closes: it hides where one is, in full screen too, and comes back as it is asked for (ADR 0136, decision 2)",
  () => {
    const { root, asked } = rootAt(TRAY)
    return Effect.gen(function* () {
      const { inFront, main } = yield* windows
      const opened = yield* open()
      opened.did.length = 0
      // The close waits for the answer, and a second one meanwhile asks
      // nothing more.
      expect(closeOf(opened)).toBe(true)
      expect(closeOf(opened)).toBe(true)
      expect(opened.did).toEqual([])
      yield* settled
      expect(asked).toEqual(["tray host?", "closePopped"])
      expect(opened.did).toEqual(["hide"])
      expect(main()).toBe(opened)
      expect(electron.notices).toEqual([])
      // Open Banda, a row, banda menu or a second Banda shows it.
      expect(inFront()).toBe(opened)
      expect(opened.did).toEqual(["hide", "show", "focus"])
      // Only macOS leaves full screen first.
      opened.did.length = 0
      opened.full = true
      expect(closeOf(opened)).toBe(true)
      yield* settled
      expect(opened.did).toEqual(["hide"])
    }).pipe(Effect.provide(over(root)))
  }
)

it.effect(
  "on Linux with no tray host known the window closes, as it does when Banda quits while the bus is asked",
  () => {
    const closing = { ...TRAY }
    const host = { there: false }
    const { root, asked } = rootAt(closing, host)
    return Effect.gen(function* () {
      yield* windows
      const opened = yield* open()
      opened.did.length = 0
      expect(closeOf(opened)).toBe(true)
      yield* settled
      // The close it makes itself goes through, with nothing asked again.
      expect(opened.did).toEqual(["closes"])
      expect(asked).toEqual(["tray host?"])

      // A host is there, yet Banda quits before it says so.
      const again = yield* open()
      again.did.length = 0
      host.there = true
      asked.length = 0
      expect(closeOf(again)).toBe(true)
      closing.quitting = true
      // The quit's own close is not held by the question.
      expect(closeOf(again)).toBe(false)
      yield* settled
      expect(again.did).toEqual(["closes"])
      expect(asked).toEqual(["tray host?"])
    }).pipe(Effect.provide(over(root)))
  }
)

it.effect(
  "on Windows the main window hides as it closes, and says once ever that Banda still runs; a click on the notice shows it (ADR 0136, decision 6)",
  () => {
    const closing = { ...WINDOWS }
    const { root, asked } = rootAt(closing)
    electron.userData = mkdtempSync(join(tmpdir(), "banda-test-"))
    electron.notices.length = 0
    return Effect.gen(function* () {
      yield* windows
      const opened = yield* open()
      opened.did.length = 0
      expect(closeOf(opened)).toBe(true)
      // Nothing is asked: the notification area is always there.
      expect(asked).toEqual(["closePopped"])
      expect(opened.did).toEqual(["hide"])
      expect(electron.notices.map((one) => one.made)).toEqual([
        { ...stillRuns("Banda Local"), silent: true },
      ])
      expect(existsSync(join(electron.userData, SAID))).toBe(true)
      electron.notices[0]?.click()
      expect(opened.did).toEqual(["hide", "show", "focus"])
      // Never again, in this run or the next.
      expect(closeOf(opened)).toBe(true)
      expect(electron.notices).toHaveLength(1)
      // Banda quits, or an update restarts it: the window closes.
      closing.quitting = true
      expect(closeOf(opened)).toBe(false)
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
