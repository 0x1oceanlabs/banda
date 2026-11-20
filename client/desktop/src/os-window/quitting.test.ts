import { vi } from "vitest"

vi.mock("electron", () => ({ app: {}, powerMonitor: {}, ipcMain: {} }))
import { expect, it } from "@effect/vitest"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import type { IpcMainEvent } from "electron"
import { Stop } from "../engine"
import { fakeApp } from "../testing"
import { POWERING_OFF, quitAnswer, Quitting } from "./quitting"

/** Whether Banda quits, over the app faked on `platform` and a `banda
 * stop` that says what it did among the app's. */
function on(platform: NodeJS.Platform, icon = true) {
  const fake = fakeApp(platform, false, { icon })
  const layer = Quitting.layer(fake.app).pipe(
    Layer.provideMerge(
      Layer.succeed(Stop)({
        engine: Effect.sync(() => void fake.did.push("banda stop --force")),
        unlessWorking: Effect.succeed(false),
      })
    )
  )
  return { ...fake, layer }
}

it.effect(
  "Quit Banda stops the engine, then quits, and counts as quitting from its start; the bridge's quit runs it",
  () => {
    const { did, layer } = on("darwin")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      expect(quitting.closing()).toEqual({
        platform: "darwin",
        quitting: false,
        poweringOff: false,
        icon: true,
      })
      yield* quitAnswer[1]([], {} as IpcMainEvent)
      expect(did).toEqual(["banda stop --force", "quit"])
      expect(quitting.closing().quitting).toBe(true)
      expect(quitting.quits()).toBe(true)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "an engine that cannot be stopped still leaves the window to quit",
  () => {
    const fake = fakeApp("linux")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      const exit = yield* Effect.exit(quitting.banda)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(fake.did).toEqual(["quit"])
      expect(quitting.closing().quitting).toBe(true)
    }).pipe(
      Effect.provide(
        Quitting.layer(fake.app).pipe(
          Layer.provide(
            Layer.succeed(Stop)({
              engine: Effect.die("banda stop broke"),
              unlessWorking: Effect.succeed(false),
            })
          )
        )
      )
    )
  }
)

it.effect(
  "the engine Quit Banda stopped takes the window with it, unless an update restarts it",
  () => {
    const stopped = on("linux")
    const updated = on("linux")
    return Effect.gen(function* () {
      yield* Quitting.use((quitting) =>
        Effect.sync(() => quitting.engineStopped())
      ).pipe(Effect.provide(stopped.layer))
      expect(stopped.did).toEqual(["quit"])
      yield* Effect.gen(function* () {
        const quitting = yield* Quitting
        quitting.updating()
        quitting.engineStopped()
        expect(updated.did).toEqual([])
        // An update's restart counts as quitting, so the window closes
        // rather than hides; yet nobody asked Banda to quit.
        expect(quitting.closing().quitting).toBe(true)
        expect(quitting.quits()).toBe(false)
        expect(quitting.asksFirst(true)).toBe(false)
      }).pipe(Effect.provide(updated.layer))
    })
  }
)

it.effect(
  "on macOS a quit the app is asked for asks first with a window to ask in; one that does not goes through, and Banda quits from then on",
  () => {
    const { did, layer } = on("darwin")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      expect(quitting.asksFirst(true)).toBe(true)
      expect(quitting.closing().quitting).toBe(false)
      expect(quitting.asksFirst(false)).toBe(false)
      expect(quitting.closing().quitting).toBe(true)
      // On its way out it asks nothing more.
      expect(quitting.asksFirst(true)).toBe(false)
      expect(did).toEqual([])
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "off macOS a quit the app is asked for goes through, but the icon's Quit Banda, which asks first (ADR 0136)",
  () => {
    const { app, did, layer, listening } = on("linux")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      // Linux's `shutdown` would hold the session's shutdown for Banda.
      expect(listening()).toBe(0)
      // As asked.ts hears each quit: whether it asks first.
      const heard: boolean[] = []
      app.listen("before-quit", (event) => {
        const asks = quitting.asksFirst(true)
        heard.push(asks)
        if (asks) event.preventDefault()
      })
      quitting.byIcon()
      expect(heard).toEqual([true])
      expect(did).toEqual([])
      expect(quitting.closing().quitting).toBe(false)
      // A quit that comes after it, by a signal, is not the icon's.
      app.quit()
      expect(heard).toEqual([true, false])
      expect(did).toEqual(["quit"])
      expect(quitting.closing().quitting).toBe(true)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "where Banda's icon is, and whether a tray host is there, are the app's to say",
  () => {
    const { layer } = on("linux", false)
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      expect(quitting.closing().icon).toBe(false)
      expect(yield* quitting.trayHost).toBe(true)
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "a logout, restart or shutdown lets a quit through for a minute, then Quit Banda asks again",
  () => {
    const { layer, powerOff } = on("darwin")
    return Effect.gen(function* () {
      const quitting = yield* Quitting
      powerOff()
      expect(quitting.closing().poweringOff).toBe(true)
      expect(quitting.quits()).toBe(true)
      yield* TestClock.adjust(POWERING_OFF - 1)
      expect(quitting.closing().poweringOff).toBe(true)
      // Another app stopped the logout.
      yield* TestClock.adjust(1)
      expect(quitting.closing()).toEqual({
        platform: "darwin",
        quitting: false,
        poweringOff: false,
        icon: true,
      })
      expect(quitting.asksFirst(true)).toBe(true)
      // The quit that comes with it goes through.
      powerOff()
      expect(quitting.asksFirst(true)).toBe(false)
    }).pipe(Effect.provide(layer))
  }
)

it.effect("it listens to the system only while main runs", () => {
  const { app, layer, listening, powerOff } = on("darwin")
  return Effect.gen(function* () {
    const scope = yield* Scope.make()
    const quitting = Context.get(
      yield* Layer.buildWithScope(layer, scope),
      Quitting
    )
    expect(app.platform).toBe("darwin")
    expect(listening()).toBe(1)
    powerOff()
    yield* Scope.close(scope, Exit.void)
    expect(listening()).toBe(0)
    // What waited to end the minute went with it.
    yield* TestClock.adjust(POWERING_OFF)
    expect(quitting.closing().poweringOff).toBe(true)
  })
})
