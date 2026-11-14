import { vi } from "vitest"

/** Electron, as the Panes' own windows use it: a window, its page, and
 * which window a page is in. */
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  class BrowserWindow extends EventEmitter {
    static fromWebContents(contents: { in?: BrowserWindow }) {
      return contents.in ?? null
    }
    readonly did: string[] = []
    readonly webContents = {
      in: this as BrowserWindow,
      heard: [] as unknown[],
      send(name: string, value: unknown) {
        this.heard.push([name, value])
      },
    }
    readonly made: unknown
    constructor(made: unknown) {
      super()
      this.made = made
    }
    loadURL(url: string) {
      this.did.push(`load ${url}`)
      return Promise.resolve()
    }
    close() {
      this.did.push("close")
      this.emit("closed")
    }
  }
  return {
    app: { isPackaged: true, whenReady: () => Promise.resolve() },
    BrowserWindow,
    shell: {},
    nativeTheme: {},
    net: {},
    protocol: {},
    session: {},
  }
})
import type { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import { BrowserWindow, type IpcMainEvent, type WebContents } from "electron"
import { BRIDGE } from "../bridge"
import { PAGE } from "./page"
import { Popped, poppedAnswers } from "./popped"
import { type PageOptions, Windows } from "./windows"

/** A window of the fake Electron above. */
type Fake = BrowserWindow &
  EventEmitter & {
    readonly made: PageOptions
    readonly did: string[]
    readonly webContents: WebContents & { heard: unknown[] }
  }

const fake = (made: PageOptions = {}) =>
  new (BrowserWindow as unknown as new (made: PageOptions) => Fake)(made)

/** The windows, as the Panes' own ask them: a main window, each window
 * made for a Pane, and which came to the front. */
function windowsWith(main: Fake | null = fake()) {
  const made: Fake[] = []
  const front: (BrowserWindow | null)[] = []
  const open = Effect.die("the main window is not opened here")
  const layer = Popped.layer.pipe(
    Layer.provide(
      Layer.succeed(Windows)({
        main: () => main,
        inFront: (shown = main) => {
          front.push(shown)
          return shown
        },
        open: () => open,
        openBanda: open,
        page: (options) =>
          Effect.sync(() => {
            const opened = fake(options)
            made.push(opened)
            return opened
          }),
      })
    )
  )
  return { main, made, front, layer }
}

/** What the page in `shown` sends on the bridge's `popped`, answered as
 * main does. */
const from = (shown: Fake) =>
  ({ sender: shown.webContents }) as unknown as IpcMainEvent
const [, open] = poppedAnswers.open
const [, close] = poppedAnswers.close
const [, current] = poppedAnswers.current
const [asks, ask] = poppedAnswers.ask
const told = (...lists: string[][]) =>
  lists.map((list) => [BRIDGE.popped.listen.name, list])

it.effect(
  "the main window pops a Pane out into a window of its own, as big as its tile within bounds, and hears which Panes have one as it opens and closes",
  () => {
    const { main, made, front, layer } = windowsWith()
    return Effect.gen(function* () {
      expect(yield* current([], from(main!))).toEqual([])
      yield* open(["p-1", 800.4, 600], from(main!))
      expect(made.map((one) => one.made)).toEqual([
        {
          width: 800,
          height: 600,
          minWidth: 320,
          minHeight: 240,
          title: "Banda",
        },
      ])
      expect(made[0]!.did).toEqual([`load ${PAGE}#pane/p-1`])
      expect(yield* current([], from(main!))).toEqual(["p-1"])
      expect(main!.webContents.heard).toEqual(told(["p-1"]))
      // A tile too small, too big or of no size still makes a window.
      yield* open(["p-2", 10, 99_999], from(main!))
      yield* open(["p-3", Number.NaN, 0], from(main!))
      expect(made.slice(1).map((one) => one.made)).toMatchObject([
        { width: 480, height: 4096 },
        { width: 480, height: 360 },
      ])
      // Popped out again, its window comes to the front: no second one.
      yield* open(["p-1", 800, 600], from(main!))
      expect(made).toHaveLength(3)
      expect(front).toEqual([made[0]])
      // Its window closed, by the Person or by the page, the Pane is back
      // in its place.
      main!.webContents.heard.length = 0
      made[1]!.emit("closed")
      yield* close(["p-1"], from(main!))
      yield* close(["gone"], from(main!))
      expect(made[0]!.did.at(-1)).toBe("close")
      expect(main!.webContents.heard).toEqual(told(["p-1", "p-3"], ["p-3"]))
      expect(yield* current([], from(main!))).toEqual(["p-3"])
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "only the main window's page pops a Pane out, and only a Pane the engine could have named",
  () => {
    const { main, made, layer } = windowsWith()
    return Effect.gen(function* () {
      yield* open(["p-1", 800, 600], from(main!))
      // A Pane's own window pops nothing out, nor does a page of no window.
      yield* open(["p-2", 800, 600], from(made[0]!))
      yield* open(["p-2", 800, 600], from(fake()))
      // No ID of the engine's: a route of its own, or one too long.
      yield* open(["p/../x", 800, 600], from(main!))
      yield* open(["", 800, 600], from(main!))
      yield* open(["p".repeat(65), 800, 600], from(main!))
      expect(made).toHaveLength(1)
      expect(yield* current([], from(main!))).toEqual(["p-1"])
    }).pipe(Effect.provide(layer))
  }
)

it.effect("with no main window, nothing is popped out", () => {
  const { made, layer } = windowsWith(null)
  return Effect.gen(function* () {
    yield* open(["p-1", 800, 600], from(fake()))
    expect(made).toEqual([])
  }).pipe(Effect.provide(layer))
})

it.effect(
  "what a Pane in its own window asks, the main window's page hears, brought to the front; asked from any other page, nothing",
  () => {
    const { main, made, front, layer } = windowsWith()
    const asked = { run: { action: "pane.close" } }
    return Effect.gen(function* () {
      yield* open(["p-1", 800, 600], from(main!))
      main!.webContents.heard.length = 0
      yield* ask([asked], from(main!))
      yield* ask([asked], from(fake()))
      expect(front).toEqual([])
      expect(main!.webContents.heard).toEqual([])
      yield* ask([asked], from(made[0]!))
      expect(front).toEqual([main])
      expect(main!.webContents.heard).toEqual([
        [BRIDGE.popped.asked.name, asked],
      ])
      // Its window closed, it asks nothing more.
      made[0]!.close()
      main!.webContents.heard.length = 0
      yield* ask([asked], from(made[0]!))
      expect(main!.webContents.heard).toEqual([])
    }).pipe(Effect.provide(layer))
  }
)

it("an ask is to open a Pane beside or to run an action, and nothing else", () => {
  const decoded = (sent: unknown) =>
    Option.isSome(Schema.decodeUnknownOption(asks)(sent))
  const pane = { kind: "terminal", args: { cwd: "/" } }
  expect(decoded([{ run: { action: "pane.close" } }])).toBe(true)
  expect(decoded([{ run: { action: "pane.zoom", args: { by: 1 } } }])).toBe(
    true
  )
  expect(decoded([{ open: { project: "p", pane, from: "p-1" } }])).toBe(true)
  expect(
    decoded([{ open: { project: "p", pane, from: "p-1", place: "right" } }])
  ).toBe(true)
  expect(decoded([])).toBe(false)
  expect(decoded([{ run: { action: 1 } }])).toBe(false)
  expect(decoded([{ run: {} }])).toBe(false)
  expect(decoded([{ open: { project: "p", pane } }])).toBe(false)
  expect(
    decoded([{ open: { project: "p", pane, from: "p-1", place: "left" } }])
  ).toBe(false)
  expect(decoded([{ close: "p-1" }])).toBe(false)
})

it.effect(
  "the Panes' own windows all close, back to their places, as main's root asks when the main window hides or closes",
  () => {
    const { main, made, layer } = windowsWith()
    return Effect.gen(function* () {
      const popped = yield* Popped
      yield* open(["p-1", 800, 600], from(main!))
      yield* open(["p-2", 800, 600], from(main!))
      expect(popped.windows()).toEqual(made)
      main!.webContents.heard.length = 0
      popped.closeAll()
      expect(made.map((one) => one.did.at(-1))).toEqual(["close", "close"])
      expect(main!.webContents.heard).toEqual(told(["p-2"], []))
      expect(popped.windows()).toEqual([])
      expect(popped.current()).toEqual([])
      // With none, nothing closes.
      popped.closeAll()
      expect(main!.webContents.heard).toHaveLength(2)
    }).pipe(Effect.provide(layer))
  }
)
