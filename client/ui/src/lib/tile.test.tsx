import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import {
  type Configure,
  TileBox,
  TileContext,
  boxOf,
  holdTile,
  tileOf,
  useTile,
} from "./tile"

afterEach(() => {
  vi.unstubAllGlobals()
})

/** An element as `tileOf` reads it: in the Tile `box`, or in none. */
const inside = (box: object | null) =>
  ({
    closest: (selector: string) => (selector === "[data-tile]" ? box : null),
  }) as unknown as Element

test("a Tile starts shown, and its Pane hears each new state, counted", () => {
  const tile = new TileBox()
  expect(tile.now()).toEqual({ state: "shown", serial: 0 })
  const heard: Configure[] = []
  const stop = tile.watch((configure) => heard.push(configure))
  tile.configure("moving")
  tile.configure("moving")
  tile.configure("hidden")
  expect(heard).toEqual([
    { state: "moving", serial: 1 },
    { state: "hidden", serial: 2 },
  ])
  expect(tile.now()).toBe(heard[1])
  stop()
  tile.configure("shown")
  expect(heard).toHaveLength(2)
  expect(tile.now()).toEqual({ state: "shown", serial: 3 })
})

test("an element finds the Tile it stands in while the Tiling holds it, and else one always shown", () => {
  const box = {} as Element
  const element = inside(box)
  const tile = new TileBox()
  tile.configure("hidden")
  expect(boxOf(element)).toBeUndefined()
  expect(tileOf(element).now().state).toBe("shown")

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

  const moving = new away.TileBox()
  moving.configure("moving")
  expect(moving.now().state).toBe("hidden")
  const heard: string[] = []
  moving.watch(({ state }) => heard.push(state))

  page.visibilityState = "visible"
  changed()
  expect(heard).toEqual(["moving"])

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
