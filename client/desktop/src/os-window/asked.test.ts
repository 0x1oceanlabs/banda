import { vi } from "vitest"

vi.mock("electron", () => ({ app: {}, powerMonitor: {}, ipcMain: {} }))
import { expect, it } from "@effect/vitest"
import { type EngineStatus, quitAsks } from "@banda/contract"
import { Effect, Exit, Layer, Scope, Stream } from "effect"
import type { BrowserWindow } from "electron"
import { Acts } from "../acts"
import { Stop } from "../engine"
import { Status } from "../status"
import { fakeApp } from "../testing"
import { askedLayer } from "./asked"
import { Quitting } from "./quitting"
import { Windows } from "./windows"

/** Lets what a quit started run. */
const settled = Effect.yieldNow.pipe(Effect.repeat({ times: 20 }))

/**
 * The app faked on `platform`, with what it is asked answered over fakes
 * that say what they did among the app's: `banda stop`, which finds
 * `working` Agents; the windows, whose main one is `open` and `visible`;
 * and the page's actions. A system dialog is answered `yes`.
 */
function on(
  platform: NodeJS.Platform,
  { working = 2, yes = false, open = true } = {}
) {
  const fake = fakeApp(platform, yes)
  const { did } = fake
  const now = { open, visible: true, began: open }
  const window = {
    isVisible: () => now.visible,
    webContents: { isCrashed: () => false, isLoadingMainFrame: () => false },
  } as unknown as BrowserWindow
  const main = () => (now.open ? window : null)
  const under = Layer.mergeAll(
    Layer.succeed(Stop)({
      engine: Effect.sync(() => void did.push("banda stop --force")),
      unlessWorking: Effect.sync(() => {
        did.push("banda stop")
        return working > 0
      }),
    }),
    Layer.succeed(Windows)({
      main,
      began: () => now.began,
      inFront: () => {
        if (main()) did.push("in front")
        return main()
      },
      open: () =>
        Effect.sync(() => {
          did.push("open")
          now.open = true
          now.began = true
          return window
        }),
      openBanda: Effect.succeed(window),
      page: () => Effect.succeed(window),
    }),
    Layer.succeed(Status)({
      current: Effect.succeed({ agents: { working } } as EngineStatus),
      changes: Stream.empty,
    }),
    Layer.succeed(Acts)({
      run: (action) => Effect.sync(() => void did.push(`page: ${action}`)),
      answered: () => Effect.void,
    })
  )
  const layer = askedLayer(fake.app).pipe(
    Layer.provideMerge(Quitting.layer(fake.app)),
    Layer.provide(under)
  )
  return { ...fake, now, layer }
}

it.effect("as its last window closes, the app quits", () => {
  const { did, asked, layer } = on("linux")
  return Effect.sync(() => {
    asked("window-all-closed")
    expect(did).toEqual(["quit"])
  }).pipe(Effect.provide(layer))
})

it.effect(
  "off macOS a quit goes through at once, and the Dock's icon is not there",
  () => {
    const { did, asked, layer } = on("win32")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      asked("activate")
      expect(asked("before-quit")).toBe(false)
      yield* settled
      expect(did).toEqual([])
      expect(quitting.closing().quitting).toBe(true)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "off macOS the icon's Quit Banda asks first while Agents work: the page with the window shown, the system with it hidden in the tray; and a quit by anything else still goes at once (ADR 0136)",
  () => {
    const { did, app, asked, now, layer } = on("linux")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      quitting.byIcon()
      yield* settled
      expect(did).toEqual(["banda stop", "in front", "page: banda.quit"])
      did.length = 0
      now.visible = false
      // Soon after the page asked, and with no window shown: the system.
      quitting.byIcon()
      yield* settled
      expect(did).toEqual([
        "banda stop",
        "focus",
        `alone: ${quitAsks(2, false)?.title}`,
      ])
      expect(quitting.closing().quitting).toBe(false)
      did.length = 0
      // A signal, as a session ending sends: at once, with no question.
      app.quit()
      expect(did).toEqual(["quit"])
      expect(asked("before-quit")).toBe(false)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "off macOS the icon's Quit Banda stops the engine and quits where no Agent works, and as the Person says where some do",
  () => {
    const idle = on("win32", { working: 0 })
    const yes = on("win32", { yes: true })
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        ;(yield* Quitting).byIcon()
        yield* settled
        expect(idle.did).toEqual(["banda stop", "quit"])
      }).pipe(Effect.provide(idle.layer))
      yield* Effect.gen(function* () {
        yes.now.visible = false
        ;(yield* Quitting).byIcon()
        yield* settled
        expect(yes.did.slice(3)).toEqual(["banda stop --force", "quit"])
      }).pipe(Effect.provide(yes.layer))
    })
  }
)

it.effect(
  "on macOS a quit asked while Agents work is the page's to ask, in the window brought to the front, and Banda keeps running",
  () => {
    const { did, asked, layer } = on("darwin")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      expect(asked("before-quit")).toBe(true)
      yield* settled
      expect(did).toEqual(["banda stop", "in front", "page: banda.quit"])
      expect(quitting.closing().quitting).toBe(false)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "with the window hidden, as Banda lives in the menu bar, the system asks: Cancel keeps Banda running, and Quit stops the engine and quits",
  () => {
    const no = on("darwin")
    const yes = on("darwin", { yes: true })
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const quitting = yield* Quitting
        no.now.visible = false
        expect(no.asked("before-quit")).toBe(true)
        yield* settled
        expect(no.did).toEqual([
          "banda stop",
          "focus",
          `alone: ${quitAsks(2, true)?.title}`,
        ])
        expect(quitting.closing().quitting).toBe(false)
        // Asked again, it asks again.
        expect(no.asked("before-quit")).toBe(true)
        yield* settled
        expect(no.did).toHaveLength(6)
      }).pipe(Effect.provide(no.layer))
      yield* Effect.gen(function* () {
        const quitting = yield* Quitting
        yes.now.visible = false
        expect(yes.asked("before-quit")).toBe(true)
        yield* settled
        expect(yes.did.slice(3)).toEqual(["banda stop --force", "quit"])
        expect(quitting.closing().quitting).toBe(true)
        // The quit Banda made itself goes through.
        expect(yes.asked("before-quit")).toBe(false)
      }).pipe(Effect.provide(yes.layer))
    })
  }
)

it.effect(
  "where no Agent works, banda stop stopped the engine, and Banda quits unasked",
  () => {
    const { did, asked, layer } = on("darwin", { working: 0 })
    return Effect.gen(function* () {
      expect(asked("before-quit")).toBe(true)
      yield* settled
      expect(did).toEqual(["banda stop", "quit"])
      expect((yield* Quitting).closing().quitting).toBe(true)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "a logout, a restart or a shutdown, an update's restart and a quit before the window opens go through unasked",
  () => {
    const off = on("darwin")
    const update = on("darwin")
    const early = on("darwin", { open: false })
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        off.powerOff()
        expect(off.asked("before-quit")).toBe(false)
      }).pipe(Effect.provide(off.layer))
      yield* Effect.gen(function* () {
        ;(yield* Quitting).updating()
        expect(update.asked("before-quit")).toBe(false)
      }).pipe(Effect.provide(update.layer))
      yield* Effect.sync(() => {
        expect(early.asked("before-quit")).toBe(false)
      }).pipe(Effect.provide(early.layer))
      yield* settled
      expect([...off.did, ...update.did, ...early.did]).toEqual([])
    })
  }
)

it.effect(
  "the Dock's icon shows the window, or opens one where it is gone; not before main opened the first, nor as Banda quits",
  () => {
    const { did, asked, now, layer } = on("darwin", { open: false })
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      // The app is activated as it starts too.
      asked("activate")
      expect(did).toEqual([])
      now.open = true
      now.began = true
      asked("activate")
      expect(did).toEqual(["in front"])
      now.open = false
      asked("activate")
      yield* settled
      expect(did).toEqual(["in front", "open"])
      quitting.updating()
      asked("activate")
      expect(did).toEqual(["in front", "open"])
    }).pipe(Effect.provide(layer))
  }
)

it.effect("it listens to the app only while main runs", () => {
  const { did, asked, listening, layer } = on("darwin")
  return Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Layer.buildWithScope(layer, scope)
    // A quit, the Dock's icon and the last window, and the power.
    expect(listening()).toBe(4)
    yield* Scope.close(scope, Exit.void)
    expect(listening()).toBe(0)
    expect(asked("before-quit")).toBe(false)
    asked("window-all-closed")
    expect(did).toEqual([])
  })
})
