import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import {
  type Configure,
  type Size,
  TileBox,
  TileContext,
  boxOf,
  holdTile,
  tileOf,
  useTile,
} from "./tile"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** An element as `tileOf` reads it: in the Tile `box`, or in none. */
const inside = (box: object | null) =>
  ({
    closest: (selector: string) => (selector === "[data-tile]" ? box : null),
  }) as unknown as Element

test("a Tile starts shown, of no size, and its Pane hears each new state, counted", () => {
  const tile = new TileBox()
  expect(tile.now()).toEqual({
    state: "shown",
    size: { width: 0, height: 0 },
    scale: 1,
    serial: 0,
  })
  const heard: Configure[] = []
  const stop = tile.watch((configure) => heard.push(configure))
  tile.configure("moving")
  tile.configure("moving")
  tile.configure("hidden")
  expect(heard).toMatchObject([
    { state: "moving", serial: 1 },
    { state: "hidden", serial: 2 },
  ])
  expect(tile.now()).toBe(heard[1])
  stop()
  tile.configure("shown")
  expect(heard).toHaveLength(2)
  expect(tile.now()).toMatchObject({ state: "shown", serial: 3 })
})

test("an element finds the Tile it stands in while the Tiling holds it, and else one always shown", () => {
  const box = {} as Element
  const element = inside(box)
  const tile = new TileBox()
  tile.configure("hidden")
  expect(boxOf(element)).toBeUndefined()
  // Asked before the Tiling holds its Tile, it says so, once, and the
  // Pane gets a Tile of its own.
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const early = tileOf(element)
  expect(early.now().state).toBe("shown")
  expect(tileOf(element)).toBe(early)
  expect(warn).toHaveBeenCalledTimes(1)
  warn.mockRestore()

  const release = holdTile(box, tile)
  expect(boxOf(element)).toBe(tile)
  expect(tileOf(element)).toBe(tile)
  expect(tileOf(inside(null)).now().state).toBe("shown")

  release()
  expect(boxOf(element)).toBeUndefined()
})

test("a Pane in React selects of its Tile's Configure", () => {
  const tile = new TileBox()
  tile.configure("moving")
  function State() {
    return <>{useTile((configure) => configure.state)}</>
  }
  expect(renderToStaticMarkup(<State />)).toBe("shown")
  expect(
    renderToStaticMarkup(
      <TileContext value={tile}>
        <State />
      </TileContext>
    )
  ).toBe("moving")
})

test("while the window is away every Tile is hidden, and each shows again as it comes back", async () => {
  let changed = () => {}
  const page = {
    visibilityState: "hidden",
    addEventListener: (type: string, heard: () => void) => {
      if (type === "visibilitychange") changed = heard
    },
  }
  vi.stubGlobal("document", page)
  vi.resetModules()
  const away = await import("./tile")

  // A Tile the Tiling holds.
  const moving = new away.TileBox()
  away.holdTile({} as Element, moving)
  moving.configure("moving")
  expect(moving.now().state).toBe("hidden")
  const heard: string[] = []
  moving.watch(({ state }) => heard.push(state))

  // A Pane outside the Tiling is hidden too.
  const alone = away.tileOf(inside(null))
  expect(alone.now().state).toBe("hidden")

  page.visibilityState = "visible"
  changed()
  expect(heard).toEqual(["moving"])
  expect(alone.now().state).toBe("shown")

  page.visibilityState = "hidden"
  changed()
  expect(heard).toEqual(["moving", "hidden"])
  // What the Tiling gives it meanwhile shows once the window is back.
  moving.configure("shown")
  expect(heard).toEqual(["moving", "hidden"])
  page.visibilityState = "visible"
  changed()
  expect(heard).toEqual(["moving", "hidden", "shown"])
})

/** The browser's ResizeObserver, as the resize gate uses it: each made,
 * with what it observes, and `lay` lays an element out at a size. */
class Observer {
  static made: Observer[] = []
  readonly seen = new Set<Element>()
  readonly heard: (entries: { target: Element; contentRect: Size }[]) => void
  constructor(heard: Observer["heard"]) {
    this.heard = heard
    Observer.made.push(this)
  }
  observe(target: Element) {
    this.seen.add(target)
  }
  unobserve(target: Element) {
    this.seen.delete(target)
  }
  lay(target: Element, width: number, height: number) {
    this.heard([{ target, contentRect: { width, height } }])
  }
}

/** `./tile` afresh, with the observer above and the screen's scale `at`,
 * whose next change `rescale` tells. */
async function sized(at = 1) {
  Observer.made = []
  const asked: string[] = []
  let rescale = () => {}
  vi.stubGlobal("ResizeObserver", Observer)
  vi.stubGlobal("devicePixelRatio", at)
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener: (_: string, heard: () => void) => {
      asked.push(query)
      rescale = heard
    },
  }))
  vi.resetModules()
  const tiles = await import("./tile")
  return { tiles, asked, rescale: () => rescale() }
}

test("a Tile's Pane hears each size the box it is drawn in is laid out at, in every state, through one observer", async () => {
  const { tiles } = await sized()
  const pane = {} as Element
  const section = { lastElementChild: pane } as unknown as Element
  const tile = new tiles.TileBox()
  const release = tiles.holdTile(section, tile)
  const other = new tiles.TileBox()
  const second = {} as Element
  tiles.holdTile({ lastElementChild: second } as unknown as Element, other)
  expect(Observer.made).toHaveLength(1)
  const [observer] = Observer.made
  expect([...observer.seen]).toEqual([pane, second])

  const heard: Configure[] = []
  tile.watch((configure) => heard.push(configure))
  observer.lay(pane, 400, 300)
  // The same size again is no new Configure.
  observer.lay(pane, 400, 300)
  tile.configure("moving")
  // "Every frame": a moving Tile's Pane takes each size, and a hidden
  // one's keeps it.
  observer.lay(pane, 420, 300)
  tile.configure("hidden")
  observer.lay(pane, 440, 300)
  expect(
    heard.map(({ state, size, serial }) => [state, size.width, serial])
  ).toEqual([
    ["shown", 400, 1],
    ["moving", 400, 2],
    ["moving", 420, 3],
    ["hidden", 420, 4],
    ["hidden", 440, 5],
  ])
  // A size that stays is the same object, for a reader to tell at once.
  expect(heard[1].size).toBe(heard[0].size)
  expect(heard[0].size).toEqual({ width: 400, height: 300 })

  release()
  expect([...observer.seen]).toEqual([second])
  observer.lay(pane, 500, 300)
  expect(heard).toHaveLength(5)
})

test("each Tile hears the screen's scale change", async () => {
  const { tiles, asked, rescale } = await sized(1)
  const tile = new tiles.TileBox()
  const release = tiles.holdTile({} as Element, tile)
  expect(tile.now().scale).toBe(1)
  const heard: number[] = []
  tile.watch(({ scale }) => heard.push(scale))
  vi.stubGlobal("devicePixelRatio", 1.6)
  rescale()
  expect(heard).toEqual([1.6])
  // It asks again, for the next change.
  expect(asked).toEqual(["(resolution: 1dppx)", "(resolution: 1.6dppx)"])
  release()
  // A Tile no longer held hears it no more.
  vi.stubGlobal("devicePixelRatio", 2)
  rescale()
  expect(heard).toEqual([1.6])
})

test("outside the Tiling, a Pane's element is a Tile of its own, as large as it, observed while it is watched", async () => {
  const { tiles } = await sized()
  const element = inside(null)
  const tile = tiles.tileOf(element)
  expect(tiles.tileOf(element)).toBe(tile)
  expect(Observer.made).toHaveLength(0)

  const heard: Configure[] = []
  const stop = tile.watch((configure) => heard.push(configure))
  const second = tile.watch(() => {})
  const [observer] = Observer.made
  expect([...observer.seen]).toEqual([element])
  observer.lay(element, 300, 200)
  expect(heard).toMatchObject([
    { state: "shown", size: { width: 300, height: 200 } },
  ])
  stop()
  stop()
  expect([...observer.seen]).toEqual([element])
  second()
  expect(observer.seen.size).toBe(0)
  // It keeps what it was, and is watched again as asked.
  expect(tile.now().size).toEqual({ width: 300, height: 200 })
  tile.watch(() => {})
  expect([...observer.seen]).toEqual([element])

  // So is one asked for before the Tiling holds the Tile: it hears the
  // size of the element it was asked with.
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const early = inside({})
  tiles.tileOf(early).watch(() => {})
  expect([...observer.seen]).toEqual([element, early])
})
