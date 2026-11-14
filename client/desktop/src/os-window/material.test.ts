import { vi } from "vitest"

/** Electron, as the material uses it: the system's mode, and the window a
 * page is in. */
const electron = vi.hoisted(() => ({
  theme: { themeSource: "system", shouldUseDarkColors: false },
  windows: new Map<unknown, unknown>(),
}))
vi.mock("electron", () => ({
  app: { whenReady: () => Promise.resolve() },
  nativeTheme: electron.theme,
  BrowserWindow: {
    fromWebContents: (contents: unknown) =>
      electron.windows.get(contents) ?? null,
  },
}))
import { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import type { Look as LookValue } from "@banda/contract/look"
import { Look } from "@banda/desktop-kit"
import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect"
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
} from "electron"
import {
  buttonsAt,
  frameAnswers,
  INSET,
  lookAnswers,
  Material,
  systemMaterial,
} from "./material"

/** A look in `mode` whose desk is as `desk` says, its bar `bar` px high. */
const lookOf = (
  desk: Partial<LookValue["desk"]>,
  mode: LookValue["mode"] = "light",
  bar = "36px"
) =>
  ({
    mode,
    vars: { "--bar-height": bar },
    desk,
    schemes: {
      light: { "--background": "#fafafa" },
      dark: { "--background": "#101010" },
    },
  }) as unknown as LookValue

const GLASS = lookOf({ glass: true, material: "system" })
const SOLID = lookOf({ glass: false, material: "system" })
/** Banda's own glass. */
const OWN = lookOf({ glass: true, material: "banda" })

/** A window, what it was made with, and what it was told and set since. */
function fakeWindow(made: BrowserWindowConstructorOptions) {
  const told: Array<[channel: string, value: unknown]> = []
  const set: Array<[what: string, value: unknown]> = []
  const window = Object.assign(new EventEmitter(), {
    made,
    told,
    set,
    full: false,
    webContents: {
      send: (channel: string, value: unknown) => told.push([channel, value]),
    },
    isFullScreen: () => window.full,
    setBackgroundColor: (colour: string) => set.push(["background", colour]),
    setWindowButtonPosition: (at: unknown) => set.push(["buttons", at]),
    setVibrancy: (kind: unknown) => set.push(["vibrancy", kind]),
    setBackgroundMaterial: (kind: unknown) => set.push(["material", kind]),
  })
  electron.windows.set(window.webContents, window)
  return window as unknown as BrowserWindow & typeof window
}

/** The material on `platform` under a look that starts as `first`, and
 * how to change that look. */
const on = (
  platform: NodeJS.Platform,
  first: LookValue | null,
  version = "10.0.22631"
) =>
  Effect.gen(function* () {
    const look = yield* SubscriptionRef.make(Option.fromNullishOr(first))
    const layer = Material.layer(platform, () => version).pipe(
      Layer.provide(
        Layer.succeed(Look)({
          current: Effect.map(SubscriptionRef.get(look), Option.getOrNull),
          changes: SubscriptionRef.changes(look).pipe(
            Stream.filter(Option.isSome),
            Stream.map((some) => some.value)
          ),
        })
      )
    )
    return {
      layer,
      change: (next: LookValue) =>
        SubscriptionRef.set(look, Option.some(next)).pipe(
          Effect.andThen(settle)
        ),
    }
  })

/** Lets the look's follower run. */
const settle = Effect.sleep("20 millis")

const open = (main: boolean) =>
  Material.use((material) => material.open(main, fakeWindow)).pipe(
    Effect.map((opened) => opened as ReturnType<typeof fakeWindow>)
  )

/** The page of `window` asks the bridge's `look` and `frame`. */
const asks = (window: BrowserWindow) => {
  const event = { sender: window.webContents } as IpcMainInvokeEvent
  return Effect.all({
    look: lookAnswers.current[1]([], event),
    frame: frameAnswers.current[1]([], event),
  })
}

it("each system has its material: vibrancy, acrylic from Windows 11 22H2, a transparent window, or none (ADR 0030)", () => {
  expect(systemMaterial("darwin", () => "")?.made).toEqual({
    vibrancy: "under-window",
  })
  const linux = systemMaterial("linux", () => "")
  expect(linux?.made).toEqual({ transparent: true })
  // Made once: turning it on shows from the next start.
  expect(linux?.set).toBeUndefined()
  expect(systemMaterial("win32", () => "10.0.22621")?.made).toEqual({
    backgroundMaterial: "acrylic",
  })
  expect(systemMaterial("win32", () => "10.0.19045")).toBeNull()
})

it("the window buttons sit in the middle of a bar as high as the look says", () => {
  expect(buttonsAt(null)).toEqual({ x: 12, y: buttonsAt(null).y })
  expect(buttonsAt(lookOf({}, "light", "40px"))).toEqual({ x: 12, y: 13 })
  expect(buttonsAt(lookOf({}, "light", "33px"))).toEqual({ x: 12, y: 10 })
})

it.live(
  "on macOS the main window draws its own title bar over the system's material, and a Pane's own window is solid in the system's frame",
  () =>
    Effect.gen(function* () {
      const { layer } = yield* on("darwin", GLASS)
      yield* Effect.gen(function* () {
        const main = yield* open(true)
        expect(main.made).toEqual({
          titleBarStyle: "hidden",
          trafficLightPosition: { x: 12, y: 11 },
          vibrancy: "under-window",
          backgroundColor: "#00000000",
        })
        const pane = yield* open(false)
        expect(pane.made).toEqual({ backgroundColor: "#fafafa" })
        // The system's glass shows only where the desktop comes through.
        expect(yield* asks(main)).toEqual({ look: GLASS, frame: INSET })
        expect(yield* asks(pane)).toEqual({
          look: { ...GLASS, desk: { ...GLASS.desk, glass: false } },
          frame: null,
        })
        // In full screen the bar takes the buttons' room back.
        main.full = true
        main.emit("enter-full-screen")
        main.full = false
        main.emit("leave-full-screen")
        expect(
          main.told.filter(([channel]) => channel === "frame.listen")
        ).toEqual([
          ["frame.listen", 0],
          ["frame.listen", INSET],
        ])
        expect(
          pane.told.filter(([channel]) => channel === "frame.listen")
        ).toEqual([])
      }).pipe(Effect.provide(layer))
    })
)

it.live(
  "the material, the buttons and the first colour follow the look, and each window hears it as it can show it",
  () =>
    Effect.gen(function* () {
      const { layer, change } = yield* on("darwin", SOLID)
      yield* Effect.gen(function* () {
        const main = yield* open(true)
        const pane = yield* open(false)
        expect(main.made.backgroundColor).toBe("#fafafa")
        expect(main.made.vibrancy).toBeUndefined()
        yield* settle
        main.set.length = 0
        main.told.length = 0
        pane.set.length = 0
        pane.told.length = 0
        // The look turns to the system's glass, in the dark, on a higher bar.
        const dark = lookOf({ glass: true, material: "system" }, "dark", "40px")
        yield* change(dark)
        expect(electron.theme.themeSource).toBe("dark")
        expect(main.set).toEqual([
          ["buttons", { x: 12, y: 13 }],
          ["vibrancy", "under-window"],
          ["background", "#00000000"],
        ])
        expect(main.told).toEqual([["look.listen", dark]])
        expect(pane.set).toEqual([["background", "#101010"]])
        expect(pane.told).toEqual([
          ["look.listen", { ...dark, desk: { ...dark.desk, glass: false } }],
        ])
        // And back: the window is solid again, in the look's colour.
        main.set.length = 0
        yield* change(SOLID)
        expect(main.set).toEqual([
          ["buttons", { x: 12, y: 11 }],
          ["vibrancy", null],
          ["background", "#fafafa"],
        ])
        // Banda's own glass shows in every window.
        pane.told.length = 0
        yield* change(OWN)
        expect(pane.told).toEqual([["look.listen", OWN]])
        // A closed window hears nothing more, and is the main one no more.
        pane.emit("closed")
        main.emit("closed")
        main.set.length = 0
        main.told.length = 0
        pane.told.length = 0
        yield* change(GLASS)
        expect([main.set, main.told, pane.told]).toEqual([[], [], []])
        expect((yield* asks(main)).frame).toBeNull()
      }).pipe(Effect.provide(layer))
    })
)

it.live(
  "on Linux the window is transparent from its start or not at all, and Windows sets acrylic as the look turns",
  () =>
    Effect.gen(function* () {
      const linux = yield* on("linux", SOLID)
      yield* Effect.gen(function* () {
        const main = yield* open(true)
        expect(main.made).toEqual({ backgroundColor: "#fafafa" })
        yield* settle
        main.set.length = 0
        yield* linux.change(GLASS)
        // Made solid, it stays solid: its page paints itself.
        expect(main.set).toEqual([["background", "#fafafa"]])
        expect(main.told.at(-1)).toEqual([
          "look.listen",
          { ...GLASS, desk: { ...GLASS.desk, glass: false } },
        ])
        expect((yield* asks(main)).frame).toBeNull()
      }).pipe(Effect.provide(linux.layer))

      const clear = yield* on("linux", GLASS)
      yield* Effect.gen(function* () {
        const main = yield* open(true)
        expect(main.made).toEqual({
          transparent: true,
          backgroundColor: "#00000000",
        })
        yield* settle
        expect(main.set).toEqual([])
        expect(main.told).toEqual([["look.listen", GLASS]])
      }).pipe(Effect.provide(clear.layer))

      const windows = yield* on("win32", SOLID)
      yield* Effect.gen(function* () {
        const main = yield* open(true)
        expect(main.made).toEqual({ backgroundColor: "#fafafa" })
        yield* settle
        main.set.length = 0
        yield* windows.change(GLASS)
        expect(main.set).toEqual([
          ["material", "acrylic"],
          ["background", "#00000000"],
        ])
        expect(yield* asks(main)).toEqual({ look: GLASS, frame: null })
      }).pipe(Effect.provide(windows.layer))

      // Windows 10 has no material: the desk is solid there.
      const old = yield* on("win32", GLASS, "10.0.19045")
      yield* Effect.gen(function* () {
        const main = yield* open(true)
        expect(main.made).toEqual({ backgroundColor: "#fafafa" })
        expect((yield* asks(main)).look).toEqual({
          ...GLASS,
          desk: { ...GLASS.desk, glass: false },
        })
      }).pipe(Effect.provide(old.layer))
    })
)

it.live(
  "before the first look a window opens in the system's mode, and nothing follows the look once main's runtime is disposed",
  () =>
    Effect.gen(function* () {
      const { layer, change } = yield* on("darwin", null)
      const main = yield* Effect.gen(function* () {
        electron.theme.shouldUseDarkColors = true
        const dark = yield* open(true)
        expect(dark.made.backgroundColor).toBe("#0a0a0a")
        electron.theme.shouldUseDarkColors = false
        const light = yield* open(false)
        expect(light.made.backgroundColor).toBe("#ffffff")
        expect((yield* asks(dark)).look).toBeNull()
        return dark
      }).pipe(Effect.provide(layer))
      main.told.length = 0
      yield* change(SOLID)
      expect(main.told).toEqual([])
    })
)
